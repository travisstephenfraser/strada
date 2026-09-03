import { Router, type Request, type Response } from "express";
import {
  fieldErrors,
  planSync,
  syncRequestSchema,
  type Contact,
} from "@strada/shared";
import { DataApiClient, mapUpstreamError } from "../dataApi.js";

/**
 * `POST /api/contacts/sync` — apply a set of wiki-derived records.
 *
 * The merge rule lives here rather than in the CLI because it is the part that can
 * silently destroy something a person wrote by hand. Here it sits inside the deployed,
 * tested, RLS-bounded surface, and any future trigger — a skill, a second machine —
 * inherits it rather than reimplementing it.
 *
 * This endpoint writes with the caller's own token like every other route, so RLS
 * applies identically. It grants sync no privilege the browser does not already have.
 */
export function createSyncRouter(dataApi: DataApiClient): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const parsed = syncRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Those sync records could not be read.",
        fields: fieldErrors(parsed.error),
      });
      return;
    }
    const { records, dryRun } = parsed.data;

    // Read the caller's own contacts. RLS scopes this; no filter is sent.
    const current = await dataApi.request<Contact[]>({
      token: req.accessToken!,
      method: "GET",
      table: "contacts",
      order: "created_at.desc",
    });
    if (current.error) {
      const mapped = mapUpstreamError(current);
      res.status(mapped.status).json(mapped.body);
      return;
    }

    const plan = planSync(records, current.data ?? []);

    const report = {
      dryRun,
      created: [] as string[],
      updated: [] as { wiki_slug: string; fields: string[] }[],
      unchanged: [] as string[],
      orphaned: plan.orphaned.map((o) => ({ wiki_slug: o.wiki_slug, name: o.name })),
      failed: [] as { wiki_slug: string; error: string }[],
    };

    const syncedAt = new Date().toISOString();

    for (const outcome of plan.outcomes) {
      if (outcome.kind === "unchanged") {
        report.unchanged.push(outcome.wiki_slug);
        continue;
      }

      if (dryRun) {
        if (outcome.kind === "create") report.created.push(outcome.wiki_slug);
        else report.updated.push({ wiki_slug: outcome.wiki_slug, fields: outcome.changed });
        continue;
      }

      const result =
        outcome.kind === "create"
          ? await dataApi.request<Contact[]>({
              token: req.accessToken!,
              method: "POST",
              table: "contacts",
              body: {
                ...outcome.values,
                // From the verified subject, never from the request body — the same
                // rule every other write path follows.
                user_id: req.userId,
                wiki_synced_at: syncedAt,
              },
            })
          : await dataApi.request<Contact[]>({
              token: req.accessToken!,
              method: "PATCH",
              table: "contacts",
              filters: { id: `eq.${outcome.id}` },
              // Only wiki-owned columns are in `values`, and `wiki_synced_at` moving is
              // what tells the database's trigger this write came from sync.
              body: { ...outcome.values, wiki_synced_at: syncedAt },
              prefer: ["max-affected=1", "handling=strict"],
            });

      if (result.error) {
        // A single bad record must not abort the run, and must not vanish either.
        report.failed.push({
          wiki_slug: outcome.wiki_slug,
          error: result.error.message ?? `upstream ${result.status}`,
        });
        continue;
      }

      if (outcome.kind === "create") report.created.push(outcome.wiki_slug);
      else report.updated.push({ wiki_slug: outcome.wiki_slug, fields: outcome.changed });
    }

    res.json({ report });
  });

  return router;
}
