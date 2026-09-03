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
  /** Frontmatter `type:`. `self` marks the vault owner, who is never a contact. */
  type?: string | null;
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
  // Neither tag means "keep this person out of my own private, row-level-secured
  // contact list". `visibility/internal` means do not publish. `visibility/pii` marks a
  // page whose BODY is sensitive — compensation, routing, things said in confidence.
  //
  // Sync never transmits page text, so what a pii page contributes is a business card:
  // name, company, role, where you met. The one field that could carry the page's
  // substance is `bio`, because it is the model's summary of that prose, and toRecord
  // drops it for a pii source. So the person is reachable and the sensitive material
  // stays on the machine.
  //
  // Excluding them outright was the earlier default, and it made the tracker
  // arbitrarily incomplete: eleven real people were already synced while one
  // relationship was held out on a tag describing prose that never leaves the vault. A
  // contact list is only useful if it is comprehensive; `--exclude-pii` restores the
  // stricter behaviour for anyone who wants it.
  includePii: true,
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
/** Turn a person's name into the same slug an entity page for them would have. */
export function slugifyPerson(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseFrontmatter(text: string): {
  title: string;
  tags: string[];
  people: string[];
  type: string | null;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { title: "", tags: [], people: [], type: null };
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

  const peopleLine = /^people:\s*\[(.*?)\]/ms.exec(block);
  const people = peopleLine
    ? peopleLine[1]!
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    : [];

  const typeLine = /^type:\s*(.*)$/m.exec(block);
  const type = typeLine?.[1]?.trim().replace(/^["']|["']$/g, "") || null;

  return { title, tags, people, type };
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
      const { title, tags, type } = parseFrontmatter(body);
      const slug = basename(n, ".md");
      return {
        slug,
        title: title || slug,
        tags,
        type,
        visibility: visibilityOf(tags),
        body,
      };
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
    // The vault owner is a person and never a contact. This was previously an accident
    // of his page carrying visibility/pii; once pii pages became includable, he turned
    // up in his own list. A structural marker cannot drift the same way.
    if (entity.type === "self") {
      excluded.push({ slug: entity.slug, reason: "the vault owner (type: self)" });
      continue;
    }
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


/**
 * People who live on a page that is not about them alone.
 *
 * The vault folds people into the work they belong to. Its own log records 179 fold
 * decisions against 99 splits, and the two-person venture page carries an explicit one:
 * "Single page for the pair rather than two thin person-pages, per fold discipline."
 * So most of the network has no entity page and correctly never will.
 *
 * A `people:` frontmatter list is the seam. It names the people for whom THIS page is
 * the primary source — not every page that mentions them, or the same person would be
 * extracted six times from six pages. The page stays exactly as it is; the people in it
 * become addressable.
 *
 * Each person gets `slugifyPerson(name)` as their identity, which is what an entity page
 * for them would already be called (`entities/sara-beckman.md` -> `sara-beckman`). So if
 * someone is later promoted to their own page, the slug does not move and the existing
 * contact is updated rather than duplicated.
 */
export interface PersonSource extends VaultEntity {
  /** The person this source is scoped to, verbatim from the `people:` list. */
  person: string;
}

/** Walk the whole vault for `people:` lists. Read-only, like everything here. */
export function readPeopleSources(vaultPath: string): PersonSource[] {
  const out: PersonSource[] = [];

  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        // Skip the vault's own staging and archive trees: they hold superseded copies,
        // and a person read from an archived page would resurrect stale details.
        if (name.startsWith("_") || name.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".md")) continue;

      const body = readFileSync(full, "utf8");
      const { title, tags, people } = parseFrontmatter(body);
      if (people.length === 0) continue;

      for (const person of people) {
        const slug = slugifyPerson(person);
        if (!slug) continue;
        out.push({
          slug,
          person,
          title: person,
          tags,
          visibility: visibilityOf(tags),
          body,
        });
      }
    }
  };

  walk(vaultPath);
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
