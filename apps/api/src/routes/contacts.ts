import { Router, type Request, type Response } from "express";
import {
  contactInputSchema,
  contactPatchSchema,
  fieldErrors,
  stripServerOwnedFields,
  type Contact,
} from "@strada/shared";
import { DataApiClient, mapUpstreamError } from "../dataApi.js";
import { claimedFields } from "./sync.js";

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

    // Editing in the app claims those fields for the human: wiki sync will not
    // overwrite them again. Read the current set first so a claim is additive rather
    // than replacing what earlier edits established.
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
    const operator_set = [
      ...new Set([...(existing.operator_set ?? []), ...claimedFields(parsed.data)]),
    ];

    const result = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "PATCH",
      table: "contacts",
      filters: { id: `eq.${id}` },
      body: { ...parsed.data, operator_set },
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
