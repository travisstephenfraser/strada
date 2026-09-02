import { describe, expect, it } from "vitest";
import type { Contact } from "../src/contact.js";
import {
  SYNCABLE_FIELDS,
  asPriority,
  mergeOne,
  planSync,
  type WikiRecord,
} from "../src/sync.js";

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c-1",
    user_id: "u-1",
    name: "Sample Person",
    company: null,
    role: null,
    met_where: null,
    notes: null,
    priority: "medium",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    wiki_slug: null,
    operator_set: [],
    wiki_synced_at: null,
    ...over,
  };
}

const record: WikiRecord = {
  wiki_slug: "sample-person",
  name: "Sample Person",
  company: "Example Lab",
  role: "Researcher",
  met_where: "a seminar",
  notes: "Ask about the new evaluation work.",
  priority: "high",
};

describe("creating a contact from a wiki page", () => {
  it("creates when no contact carries that slug", () => {
    const out = mergeOne(record, null);
    expect(out.kind).toBe("create");
    if (out.kind !== "create") return;
    expect(out.values.wiki_slug).toBe("sample-person");
    expect(out.values.name).toBe("Sample Person");
    expect(out.values.priority).toBe("high");
  });

  it("writes only syncable fields — never ids, timestamps or operator_set", () => {
    const out = mergeOne(record, null);
    if (out.kind !== "create") throw new Error("expected create");
    const allowed = new Set<string>([...SYNCABLE_FIELDS, "wiki_slug"]);
    expect(Object.keys(out.values).filter((k) => !allowed.has(k))).toEqual([]);
  });
});

describe("a human's edits are never overwritten", () => {
  it("leaves an operator-set field alone and reports it as protected", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      notes: "My own note. Do not touch.",
      operator_set: ["notes"],
    });

    const out = mergeOne(record, existing);
    if (out.kind !== "update") throw new Error("expected update");

    expect(out.values).not.toHaveProperty("notes");
    expect(out.protectedFields).toContain("notes");
    expect(out.changed).toContain("company");
  });

  it("changes nothing at all when the human owns every differing field", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Somewhere Else",
      role: "Something Else",
      met_where: "elsewhere",
      notes: "Mine.",
      priority: "low",
      operator_set: [...SYNCABLE_FIELDS],
    });

    const out = mergeOne(record, existing);
    expect(out.kind).toBe("unchanged");
    if (out.kind !== "unchanged") return;
    // Silence would be wrong here: the wiki disagreed and was refused, and the report
    // has to be able to say so.
    expect(out.protectedFields.length).toBeGreaterThan(0);
  });

  it("still updates fields the human never touched", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      operator_set: ["priority"],
      priority: "low",
    });

    const out = mergeOne(record, existing);
    if (out.kind !== "update") throw new Error("expected update");
    expect(out.changed).toContain("company");
    expect(out.values).not.toHaveProperty("priority");
  });
});

describe("only real differences count", () => {
  it("reports unchanged when the contact already matches", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Example Lab",
      role: "Researcher",
      met_where: "a seminar",
      notes: "Ask about the new evaluation work.",
      priority: "high",
    });
    expect(mergeOne(record, existing).kind).toBe("unchanged");
  });

  it.each([
    ["null vs absent", null, undefined],
    ["null vs empty string", null, ""],
    ["untrimmed vs trimmed", "Example Lab", "  Example Lab  "],
  ])("treats %s as the same value", (_label, stored, incoming) => {
    const existing = contact({
      wiki_slug: "s",
      company: stored as string | null,
      name: "N",
      priority: "low",
    });
    const out = mergeOne(
      { wiki_slug: "s", name: "N", priority: "low", company: incoming as string },
      existing,
    );
    // Each of these comparing as different is what would make every run report
    // updates for identical data — a sync that looks busy and does nothing.
    expect(out.kind).toBe("unchanged");
  });
});

describe("planSync over a whole run", () => {
  it("is idempotent: applying a plan makes the next plan all-unchanged", () => {
    const first = planSync([record], []);
    expect(first.outcomes[0]!.kind).toBe("create");

    // Apply the created values, as the database would.
    const created = first.outcomes[0]!;
    if (created.kind !== "create") throw new Error("expected create");
    const applied = contact({ ...(created.values as Partial<Contact>), id: "c-9" });

    const second = planSync([record], [applied]);
    expect(second.outcomes[0]!.kind).toBe("unchanged");
    expect(second.orphaned).toEqual([]);
  });

  it("reports a contact whose wiki page vanished, and never deletes it", () => {
    const gone = contact({ id: "c-7", wiki_slug: "departed", name: "Departed Person" });
    const plan = planSync([record], [gone]);

    expect(plan.orphaned).toEqual([
      { id: "c-7", wiki_slug: "departed", name: "Departed Person" },
    ]);
    // Nothing in the plan can remove a row: there is no delete outcome at all.
    expect(plan.outcomes.map((o) => o.kind)).not.toContain("delete");
  });

  it("ignores hand-made contacts that carry no slug", () => {
    const handMade = contact({ id: "c-3", wiki_slug: null, name: "Typed By Hand" });
    const plan = planSync([record], [handMade]);
    expect(plan.orphaned).toEqual([]);
    expect(plan.outcomes[0]!.kind).toBe("create");
  });
});

describe("asPriority guards the one validation contract", () => {
  it.each(["high", "medium", "low"])("accepts %s", (p) => {
    expect(asPriority(p)).toBe(p);
  });

  it.each(["urgent", "HIGH", "", null, 3, undefined])(
    "rejects %o so a model cannot invent a value the database refuses",
    (p) => {
      expect(asPriority(p)).toBeNull();
    },
  );
});
