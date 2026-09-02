import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POLICY,
  applyVisibility,
  parseFrontmatter,
  readEntities,
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
    ]);
  });

  it("explains itself when pointed somewhere without an entities directory", () => {
    expect(() => readEntities(join(here, "nope"))).toThrow(/entities directory/);
  });

  it("reads title and tags, and treats unreadable frontmatter as absent", () => {
    expect(parseFrontmatter("---\ntitle: A Person\ntags: [x, y]\n---\nbody")).toEqual({
      title: "A Person",
      tags: ["x", "y"],
    });
    // Failing toward "no tags" fails toward exclusion, not toward leaking.
    expect(parseFrontmatter("no frontmatter at all")).toEqual({ title: "", tags: [] });
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

  it("excludes pii and includes internal by default", () => {
    const { included, excluded } = applyVisibility(readEntities(FIXTURE_VAULT));
    expect(included.map((e) => e.slug)).toContain("kit-nakamura"); // internal
    expect(excluded.map((e) => e.slug)).toEqual(["sam-quill"]); // pii
  });

  it("names a reason for every exclusion, so none is silent", () => {
    const { excluded } = applyVisibility(readEntities(FIXTURE_VAULT));
    for (const e of excluded) expect(e.reason).toMatch(/visibility\//);
  });

  it("--include-pii and --exclude-internal invert each default", () => {
    const all = readEntities(FIXTURE_VAULT);

    const withPii = applyVisibility(all, { ...DEFAULT_POLICY, includePii: true });
    expect(withPii.excluded).toEqual([]);

    const noInternal = applyVisibility(all, { ...DEFAULT_POLICY, includeInternal: false });
    expect(noInternal.excluded.map((e) => e.slug).toSorted()).toEqual([
      "kit-nakamura",
      "sam-quill",
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
  talking_point: "Compare notes on grading rubrics next term.",
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
