import type { SyncReport } from "./client.js";
import type { Excluded } from "./vault.js";

/**
 * Rendering the run report.
 *
 * Every category is printed even when empty, and nothing is collapsed into a total.
 * "14 synced" is the flattering failure this feature is most prone to: it reads as
 * success whether the run did the right thing, rewrote identical values, or quietly
 * refused half its input.
 */
export function renderReport(
  report: SyncReport,
  excluded: Excluded[],
  skipped: { slug: string; reason: string }[],
): string {
  const lines: string[] = [];
  const section = (title: string, items: string[]) => {
    lines.push(`${title} (${items.length})`);
    if (items.length === 0) lines.push("    —");
    else for (const i of items) lines.push(`    ${i}`);
    lines.push("");
  };

  lines.push("");
  lines.push(report.dryRun ? "DRY RUN — nothing was written" : "Sync complete");
  lines.push("");

  section("created", report.created);
  section(
    "updated",
    report.updated.map((u) => `${u.wiki_slug}  ←  ${u.fields.join(", ")}`),
  );
  section("unchanged", report.unchanged);
  section(
    "kept your edits (wiki wanted to change these; you own them)",
    report.protected.map((p) => `${p.wiki_slug}  ✋ ${p.fields.join(", ")}`),
  );
  section(
    "excluded by visibility rules",
    excluded.map((e) => `${e.slug}  (${e.reason})`),
  );
  section(
    "skipped",
    skipped.map((s) => `${s.slug}  (${s.reason})`),
  );
  section(
    "no longer in the wiki (kept, never deleted)",
    report.orphaned.map((o) => `${o.wiki_slug}  "${o.name}"`),
  );
  section(
    "failed",
    report.failed.map((f) => `${f.wiki_slug}  ${f.error}`),
  );

  return lines.join("\n");
}
