import { Router, type Request, type Response } from "express";
import {
  WIKI_OWNED_FIELDS,
  contactInputSchema,
  contactPatchSchema,
  fieldErrors,
  stripServerOwnedFields,
  type Contact,
} from "@strada/shared";
import { DataApiClient, mapUpstreamError } from "../dataApi.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Express 5 types a path parameter as `string | string[]`. Anything that is not a
 * single well-formed uuid is refused outright rather than coerced, so nothing but a
 * uuid can ever reach the upstream filter.
 */
function uuidParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/**
 * Which wiki-owned fields this patch would actually CHANGE.
 *
 * The comparison is by value, not by presence. The edit form submits every field, so an
 * ordinary edit of a wiki-linked contact necessarily restates `name`, `company`, `role`
 * and `met_where`; rejecting a restatement would reject every edit, including one that
 * only touched notes. Only a real change is a conflict.
 *
 * A hand-made contact has no wiki layer and never conflicts.
 *
 * This is the friendly half of the guarantee — it produces a 403 naming the field. The
 * database trigger in migration 003 is the half that holds when this code is wrong.
 */
function changedWikiFields(
  patch: Record<string, unknown>,
  existing: Contact,
): string[] {
  if (!existing.wiki_slug) return [];
  const same = (a: unknown, b: unknown) => {
    const norm = (v: unknown) =>
      v === undefined || v === null ? "" : typeof v === "string" ? v.trim() : v;
    return norm(a) === norm(b);
  };
  return WIKI_OWNED_FIELDS.filter(
    (field) =>
      field in patch &&
      !same(patch[field], (existing as unknown as Record<string, unknown>)[field]),
  );
}

/**
 * Every route takes the row id from a PATH PARAMETER and builds the upstream filter
 * itself. There is deliberately no route that accepts a filter from the client, so
 * there is no way to reach an unfiltered PATCH or DELETE through this API.
 */
export function createContactsRouter(dataApi: DataApiClient): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    const result = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "GET",
      table: "contacts",
      // Sorting and filtering happen in the browser over the caller's own rows, which
      // keeps PostgREST's ordering and filter grammar out of the client's reach.
      order: "created_at.desc",
    });

    if (result.error) {
      const mapped = mapUpstreamError(result);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    res.json({ contacts: result.data ?? [] });
  });

  router.post("/", async (req: Request, res: Response) => {
    const parsed = contactInputSchema.safeParse(
      stripServerOwnedFields(req.body ?? {}),
    );
    if (!parsed.success) {
      res.status(400).json({
        error: "That contact could not be saved.",
        fields: fieldErrors(parsed.error),
      });
      return;
    }

    const result = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "POST",
      table: "contacts",
      // user_id comes from the verified `sub`, never from the body. The column default
      // and the INSERT policy's WITH CHECK both back this up, but PostgREST writes an
      // explicit null for a missing key unless asked otherwise, so we set it here.
      body: { ...parsed.data, user_id: req.userId },
    });

    if (result.error) {
      const mapped = mapUpstreamError(result);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    res.status(201).json({ contact: first(result.data) });
  });

  router.patch("/:id", async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Not a valid contact id." });
      return;
    }

    const parsed = contactPatchSchema.safeParse(
      stripServerOwnedFields(req.body ?? {}),
    );
    if (!parsed.success) {
      res.status(400).json({
        error: "That change could not be saved.",
        fields: fieldErrors(parsed.error),
      });
      return;
    }

    // A wiki-linked contact has a read-only layer, so read the row before writing it.
    const before = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "GET",
      table: "contacts",
      filters: { id: `eq.${id}` },
    });
    if (before.error) {
      const mapped = mapUpstreamError(before);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    const existing = first(before.data);
    if (!existing) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    const conflicts = changedWikiFields(parsed.data, existing);
    if (conflicts.length > 0) {
      res.status(403).json({
        error: `That contact comes from your wiki page "${existing.wiki_slug}". Edit the page and sync again.`,
        fields: Object.fromEntries(
          conflicts.map((f) => [f, "This comes from your wiki and cannot be edited here."]),
        ),
      });
      return;
    }

    const result = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "PATCH",
      table: "contacts",
      filters: { id: `eq.${id}` },
      body: parsed.data,
      // Belt to the path-parameter braces: if a filter ever matched more than one row,
      // PostgREST refuses the write rather than applying it.
      prefer: ["max-affected=1", "handling=strict"],
    });

    if (result.error) {
      const mapped = mapUpstreamError(result);
      res.status(mapped.status).json(mapped.body);
      return;
    }

    const contact = first(result.data);
    if (!contact) {
      // RLS filtered the row out: it belongs to someone else, or it does not exist.
      // Both answer 404 — telling them apart would be an existence oracle.
      res.status(404).json({ error: "Contact not found." });
      return;
    }
    res.json({ contact });
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const id = uuidParam(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Not a valid contact id." });
      return;
    }

    const result = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "DELETE",
      table: "contacts",
      filters: { id: `eq.${id}` },
      prefer: ["max-affected=1", "handling=strict"],
    });

    if (result.error) {
      const mapped = mapUpstreamError(result);
      res.status(mapped.status).json(mapped.body);
      return;
    }

    const contact = first(result.data);
    if (!contact) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }
    // Returned so the UI can offer undo without having cached the row itself.
    res.json({ contact });
  });

  return router;
}

function first(data: Contact[] | null): Contact | undefined {
  return Array.isArray(data) ? data[0] : undefined;
}
