import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Reading the vault. **Read-only, by construction.**
 *
 * This module opens files and does nothing else — no writes, no moves, no git
 * operations, not even a status check. Strada is a consumer of the wiki, never an
 * author of it. A write-back path is deliberately absent rather than merely unused: it
 * is the surface where a bug corrupts a source of truth that is not reproducible.
 */

export type Visibility = "public" | "internal" | "pii";

export interface VaultEntity {
  /** File stem, e.g. "rowan-alvarez". The stable link to a contact. */
  slug: string;
  title: string;
  tags: string[];
  visibility: Visibility;
  /** Full page text, used only for local extraction. Never sent to Strada. */
  body: string;
}

export interface VisibilityPolicy {
  /** Pages tagged `visibility/pii`. Excluded by default. */
  includePii: boolean;
  /** Pages tagged `visibility/internal`. Included by default. */
  includeInternal: boolean;
}

export const DEFAULT_POLICY: VisibilityPolicy = {
  // `visibility/internal` means "do not publish", not "do not put in my own private,
  // row-level-secured list" — and the internal pages are the high-value contacts, so
  // excluding them by default would gut the feature. `pii` is the stronger signal and
  // is excluded.
  includePii: false,
  includeInternal: true,
};

export interface Excluded {
  slug: string;
  reason: string;
}

/**
 * Minimal frontmatter reader.
 *
 * Deliberately not a YAML dependency: the only fields that matter here are `title` and
 * an inline `tags: [...]` list, and a parser that understands exactly that is easier to
 * reason about than one that understands everything. Anything it cannot read is treated
 * as absent, which fails toward exclusion rather than toward leaking.
 */
export function parseFrontmatter(text: string): { title: string; tags: string[] } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { title: "", tags: [] };
  const block = match[1]!;

  const titleLine = /^title:\s*(.*)$/m.exec(block);
  let title = titleLine?.[1]?.trim() ?? "";
  if (title === ">-" || title === "|" || title === ">") {
    // Folded scalar: the value is the next indented line.
    const folded = /^title:\s*[>|]-?\s*\r?\n\s+(.*)$/m.exec(block);
    title = folded?.[1]?.trim() ?? "";
  }
  title = title.replace(/^["']|["']$/g, "");

  const tagsLine = /^tags:\s*\[(.*?)\]/ms.exec(block);
  const tags = tagsLine
    ? tagsLine[1]!
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    : [];

  return { title, tags };
}

export function visibilityOf(tags: string[]): Visibility {
  if (tags.includes("visibility/pii")) return "pii";
  if (tags.includes("visibility/internal")) return "internal";
  return "public";
}

/** Read every entity page. Never descends outside `entities/`. */
export function readEntities(vaultPath: string): VaultEntity[] {
  const dir = join(vaultPath, "entities");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(
      `No entities directory at ${dir}. Set STRADA_VAULT_PATH to the vault root ` +
        `(the directory containing entities/).`,
    );
  }

  return names
    .filter((n) => n.endsWith(".md"))
    .filter((n) => statSync(join(dir, n)).isFile())
    .map((n) => {
      const body = readFileSync(join(dir, n), "utf8");
      const { title, tags } = parseFrontmatter(body);
      const slug = basename(n, ".md");
      return { slug, title: title || slug, tags, visibility: visibilityOf(tags), body };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Split entities into those the policy admits and those it refuses.
 *
 * Every refusal carries a reason and is reported by name. An exclusion nobody can see
 * is indistinguishable from a page that was never found.
 */
export function applyVisibility(
  entities: VaultEntity[],
  policy: VisibilityPolicy = DEFAULT_POLICY,
): { included: VaultEntity[]; excluded: Excluded[] } {
  const included: VaultEntity[] = [];
  const excluded: Excluded[] = [];

  for (const entity of entities) {
    if (entity.visibility === "pii" && !policy.includePii) {
      excluded.push({ slug: entity.slug, reason: "tagged visibility/pii" });
      continue;
    }
    if (entity.visibility === "internal" && !policy.includeInternal) {
      excluded.push({ slug: entity.slug, reason: "tagged visibility/internal" });
      continue;
    }
    included.push(entity);
  }

  return { included, excluded };
}
