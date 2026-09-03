import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POLICY,
  applyVisibility,
  parseFrontmatter,
  readEntities,
  readPeopleSources,
  visibilityOf,
} from "../src/vault.js";
import { ExtractionError, extractOne, toRecord } from "../src/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = join(here, "fixtures/vault");
const repoRoot = join(here, "../../..");

const entity = (over: Partial<Parameters<typeof toRecord>[0]> = {}) => ({
  slug: "rowan-alvarez",
  title: "Rowan Alvarez",
  tags: [],
  visibility: "public" as const,
  body: "# Rowan Alvarez\n\nResearch engineer.",
  ...over,
});

describe("reading the vault", () => {
  it("reads every entity page from the fixture vault", () => {
    const entities = readEntities(FIXTURE_VAULT);
    expect(entities.map((e) => e.slug)).toEqual([
      "kit-nakamura",
      "rowan-alvarez",
      "sam-quill",
      "test-widget",
      "the-owner",
    ]);
  });

  it("explains itself when pointed somewhere without an entities directory", () => {
    expect(() => readEntities(join(here, "nope"))).toThrow(/entities directory/);
  });

  it("reads title and tags, and treats unreadable frontmatter as absent", () => {
    expect(parseFrontmatter("---\ntitle: A Person\ntags: [x, y]\n---\nbody")).toEqual({
      title: "A Person",
      tags: ["x", "y"],
      people: [],
      type: null,
    });
    // Failing toward "no tags" fails toward exclusion, not toward leaking.
    expect(parseFrontmatter("no frontmatter at all")).toEqual({
      title: "",
      tags: [],
      people: [],
      type: null,
    });
  });

  it("reads a folded title, the shape the real vault uses", () => {
    expect(parseFrontmatter("---\ntitle: >-\n    A Folded Title\ntags: []\n---\n").title).toBe(
      "A Folded Title",
    );
  });
});

describe("visibility rules", () => {
  it.each([
    [["visibility/pii"], "pii"],
    [["visibility/internal"], "internal"],
    [["person"], "public"],
    [[], "public"],
  ])("classifies %o as %s", (tags, expected) => {
    expect(visibilityOf(tags as string[])).toBe(expected);
  });

  it("includes both pii and internal by default, since neither means 'not my contact'", () => {
    // A pii page still contributes only a business card: toRecord drops the bio, which
    // is the one field carrying the page's substance. The contact list is useless if it
    // is arbitrarily incomplete, so the person is included and the prose is not.
    const { included, excluded } = applyVisibility(readEntities(FIXTURE_VAULT));
    expect(included.map((e) => e.slug)).toContain("kit-nakamura"); // internal
    expect(included.map((e) => e.slug)).toContain("sam-quill"); // pii
    // The owner is the only standing exclusion, and for a different reason entirely.
    expect(excluded.map((e) => e.slug)).toEqual(["the-owner"]);
  });

  it("names a reason for every exclusion, so none is silent", () => {
    const { excluded } = applyVisibility(readEntities(FIXTURE_VAULT), {
      includePii: false,
      includeInternal: false,
    });
    expect(excluded.length).toBeGreaterThan(0);
    for (const e of excluded) expect(e.reason).toMatch(/visibility\/|vault owner/);
  });

  it("--exclude-pii and --exclude-internal each restore a stricter default", () => {
    const all = readEntities(FIXTURE_VAULT);

    const noPii = applyVisibility(all, { ...DEFAULT_POLICY, includePii: false });
    expect(noPii.excluded.map((e) => e.slug).toSorted()).toEqual(["sam-quill", "the-owner"]);

    const noInternal = applyVisibility(all, { ...DEFAULT_POLICY, includeInternal: false });
    expect(noInternal.excluded.map((e) => e.slug).toSorted()).toEqual([
      "kit-nakamura",
      "the-owner",
    ]);
  });
});

function modelReturning(content: unknown, ok = true) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }),
      { status: ok ? 200 : 500 },
    ),
  );
}

const config = (fetchImpl: typeof fetch) => ({
  baseUrl: "http://localhost:1234/v1",
  model: "test-model",
  fetchImpl,
});

const goodExtraction = {
  is_person: true,
  name: "Rowan Alvarez",
  company: "Meridian Labs",
  role: "Research engineer",
  met_where: "Thursday reading group",
  priority: "high",
  bio: "Runs the statistics teaching group; works on grader agreement.",
};

describe("the model's output is untrusted input", () => {
  it("accepts a well-formed extraction", async () => {
    const fetchImpl = modelReturning(goodExtraction) as unknown as typeof fetch;
    const out = await extractOne(entity(), config(fetchImpl));
    expect(out.name).toBe("Rowan Alvarez");
  });

  it("rejects a priority the database would refuse", async () => {
    const fetchImpl = modelReturning({
      ...goodExtraction,
      priority: "urgent",
    }) as unknown as typeof fetch;
    await expect(extractOne(entity(), config(fetchImpl))).rejects.toThrow(ExtractionError);
  });

  it("rejects output that is not JSON", async () => {
    const fetchImpl = modelReturning("I'm afraid I can't do that") as unknown as typeof fetch;
    await expect(extractOne(entity(), config(fetchImpl))).rejects.toThrow(/not JSON/);
  });

  it("rejects a response missing required fields", async () => {
    const fetchImpl = modelReturning({ is_person: true }) as unknown as typeof fetch;
    await expect(extractOne(entity(), config(fetchImpl))).rejects.toThrow(/expected shape/);
  });

  it("says the model is unreachable rather than guessing at a cause", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(extractOne(entity(), config(fetchImpl))).rejects.toThrow(/Cannot reach the local model/);
  });
});

describe("mapping an extraction to a contact", () => {
  it("drops non-people so machines never become contacts", () => {
    expect(
      toRecord(entity({ slug: "test-widget" }), {
        ...goodExtraction,
        is_person: false,
        name: "",
      } as never),
    ).toBeNull();
  });

  it("falls back to the page title when the model returns no name", () => {
    const record = toRecord(entity(), { ...goodExtraction, name: "  " } as never);
    expect(record?.name).toBe("Rowan Alvarez");
  });

  it("turns empty strings into null rather than storing blanks", () => {
    const record = toRecord(entity(), {
      ...goodExtraction,
      company: "",
      role: "   ",
    } as never);
    expect(record?.company).toBeNull();
    expect(record?.role).toBeNull();
  });

  it("carries the slug so the contact stays linked to its page", () => {
    expect(toRecord(entity(), goodExtraction as never)?.wiki_slug).toBe("rowan-alvarez");
  });
});

describe("the vault cannot leak into a public repository", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx|js|mjs|json|md|sql|sh|yml)$/.test(name)) out.push(full);
    }
    return out;
  }

  const tracked = sourceFiles(join(repoRoot, "apps"))
    .concat(sourceFiles(join(repoRoot, "packages")))
    .concat(sourceFiles(join(repoRoot, "db")));

  it("finds files to check", () => {
    expect(tracked.length).toBeGreaterThan(10);
  });

  it("never hardcodes a vault path", () => {
    // The path comes from STRADA_VAULT_PATH at runtime. A committed one would both
    // break on every other machine and disclose where private notes live.
    const offenders = tracked.filter((f) => /\/\.vault\/|Developer\/\.vault/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps the fixture vault fictional and labelled", () => {
    const readme = readFileSync(join(FIXTURE_VAULT, "README.md"), "utf8");
    expect(readme).toMatch(/invented for testing/i);
  });

  it("is not deployable: no Vercel config references apps/sync", () => {
    // apps/sync reads a vault that exists only on a developer machine. If it ever
    // appeared in a deploy config, that would be the bug.
    for (const config of ["apps/web/vercel.json", "apps/api/vercel.json"]) {
      expect(readFileSync(join(repoRoot, config), "utf8")).not.toContain("sync");
    }
  });
});

describe("people who live on a folded page", () => {
  // The vault folds people into the work they belong to — 179 fold decisions against 99
  // splits — so most of the network has no entity page and never could. A `people:`
  // list makes those people addressable without unfolding anything.
  it("finds person-bearing pages anywhere in the vault, not just entities/", () => {
    const sources = readPeopleSources(FIXTURE_VAULT);
    expect(sources.map((s) => s.slug).sort()).toEqual([
      "idris-bloom",
      "nadia-ford",
      "wren-calloway",
    ]);
  });

  it("gives each person their own slug, so one page yields several contacts", () => {
    const venture = readPeopleSources(FIXTURE_VAULT).filter(
      (s) => s.person === "Wren Calloway" || s.person === "Idris Bloom",
    );
    expect(venture).toHaveLength(2);
    // Same page, different people, different identities.
    expect(new Set(venture.map((s) => s.body)).size).toBe(1);
    expect(new Set(venture.map((s) => s.slug)).size).toBe(2);
  });

  it("slugs a person the same way an entity page would, so the two merge", () => {
    // If Wren later earns her own entities/wren-calloway.md, the slug must not change:
    // a changed slug creates a duplicate contact instead of updating the existing one.
    expect(readPeopleSources(FIXTURE_VAULT).find((s) => s.person === "Wren Calloway")!.slug)
      .toBe("wren-calloway");
  });

  it("carries the page's visibility through to the person", () => {
    const nadia = readPeopleSources(FIXTURE_VAULT).find((s) => s.person === "Nadia Ford")!;
    expect(nadia.visibility).toBe("pii");
  });
});

describe("a sensitive page contributes a card, never a summary", () => {
  it("drops the bio when the source page is pii, and keeps the identity fields", () => {
    // Sync never transmits page text, so the identity fields are a business card. The
    // bio is different in kind: it is a model's summary OF the sensitive prose, and it
    // is the one field that can carry the page's substance off the machine.
    const record = toRecord(entity({ slug: "nadia-ford", visibility: "pii" }), {
      is_person: true,
      name: "Nadia Ford",
      company: "Halcyon",
      role: "Chief product officer",
      met_where: "a conference panel",
      priority: "high",
      bio: "Compensation discussion is live and she is pushing for a higher band.",
    });
    expect(record).not.toBeNull();
    expect(record!.name).toBe("Nadia Ford");
    expect(record!.company).toBe("Halcyon");
    expect(record!.bio).toBeNull();
  });

  it("keeps the bio for a page that is not sensitive", () => {
    const record = toRecord(entity({ visibility: "public" }), {
      is_person: true,
      name: "Rowan Alvarez",
      company: "Meridian Labs",
      role: "Research engineer",
      met_where: "the reading group",
      priority: "medium",
      bio: "Research engineer working on evaluation methodology.",
    });
    expect(record!.bio).toBe("Research engineer working on evaluation methodology.");
  });
});

describe("the vault owner is never a contact", () => {
  it("skips a page marked type: self", () => {
    // Travis's own entity page was only ever excluded because it carried
    // visibility/pii. Once pii pages became includable that accident stopped holding,
    // and he appeared in his own contact list. The rule is now structural.
    const slugs = readEntities(FIXTURE_VAULT).map((e) => e.slug);
    expect(slugs).toContain("the-owner"); // still read...
    const { included } = applyVisibility(readEntities(FIXTURE_VAULT));
    expect(included.map((e) => e.slug)).not.toContain("the-owner"); // ...never synced
  });

  it("names the reason, so the omission is visible rather than silent", () => {
    const { excluded } = applyVisibility(readEntities(FIXTURE_VAULT));
    expect(excluded.find((e) => e.slug === "the-owner")?.reason).toMatch(/vault owner/);
  });
});
