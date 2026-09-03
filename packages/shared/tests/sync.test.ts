import { describe, expect, it } from "vitest";
import type { Contact } from "../src/contact.js";
import {
  OPERATOR_OWNED_FIELDS,
  SEEDED_ON_CREATE,
  WIKI_OWNED_FIELDS,
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
    bio: null,
    notes: null,
    priority: "medium",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    wiki_slug: null,
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
  bio: "Runs the evaluation group; two papers on grader agreement.",
  priority: "high",
};

/**
 * The ownership split is the whole design, so it is asserted directly rather than
 * inferred from behaviour. A field appearing in both lists would give sync a column the
 * app also writes, which is exactly the collision this replaced.
 */
describe("the two layers are disjoint and complete", () => {
  it("shares no field between the wiki layer and the operator layer", () => {
    const wiki = new Set<string>(WIKI_OWNED_FIELDS);
    const both = OPERATOR_OWNED_FIELDS.filter((f) => wiki.has(f));
    expect(both).toEqual([]);
  });

  it("seeds only fields the operator owns", () => {
    // Seeding a wiki-owned field would be redundant; seeding anything else would mean
    // sync writing a column it does not own on every create.
    const operator = new Set<string>(OPERATOR_OWNED_FIELDS);
    expect(SEEDED_ON_CREATE.filter((f) => !operator.has(f))).toEqual([]);
  });
});

describe("creating a contact from a wiki page", () => {
  it("creates when no contact carries that slug", () => {
    const out = mergeOne(record, null);
    expect(out.kind).toBe("create");
    if (out.kind !== "create") return;
    expect(out.values.wiki_slug).toBe("sample-person");
    expect(out.values.name).toBe("Sample Person");
    expect(out.values.bio).toBe(record.bio);
  });

  it("seeds priority once, so a new contact is not born without one", () => {
    const out = mergeOne(record, null);
    if (out.kind !== "create") throw new Error("expected create");
    expect(out.values.priority).toBe("high");
  });

  it("never writes notes: that column belongs to the operator from the start", () => {
    const out = mergeOne(record, null);
    if (out.kind !== "create") throw new Error("expected create");
    expect(out.values).not.toHaveProperty("notes");
  });

  it("writes only wiki-owned fields, the seed, and the slug", () => {
    const out = mergeOne(record, null);
    if (out.kind !== "create") throw new Error("expected create");
    const allowed = new Set<string>([
      ...WIKI_OWNED_FIELDS,
      ...SEEDED_ON_CREATE,
      "wiki_slug",
    ]);
    expect(Object.keys(out.values).filter((k) => !allowed.has(k))).toEqual([]);
  });
});

describe("the operator layer is untouchable on update", () => {
  it("refreshes a wiki field the operator edited in the app anyway", () => {
    // No arbitration any more: the app cannot change these, so a difference here is
    // stale data, not a human's opinion.
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Stale Lab",
    });
    const out = mergeOne(record, existing);
    if (out.kind !== "update") throw new Error("expected update");
    expect(out.values.company).toBe("Example Lab");
    expect(out.changed).toContain("company");
  });

  it("never writes priority on update, however far it has drifted", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Example Lab",
      role: "Researcher",
      met_where: "a seminar",
      bio: record.bio,
      priority: "low", // the operator demoted them; the wiki still says high
    });

    const out = mergeOne(record, existing);
    // The only difference is priority, and priority is not sync's to write.
    expect(out.kind).toBe("unchanged");
  });

  it("never writes notes, however far they have drifted", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Example Lab",
      role: "Researcher",
      met_where: "a seminar",
      bio: record.bio,
      notes: "My own note. Nothing in the vault knows about this.",
    });

    const out = mergeOne(record, existing);
    expect(out.kind).toBe("unchanged");
  });

  it("keeps notes out of the update body even when wiki fields do change", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Stale Lab",
      notes: "Mine.",
      priority: "low",
    });

    const out = mergeOne(record, existing);
    if (out.kind !== "update") throw new Error("expected update");
    // Asserting on the exact body, not merely on the absence of an error: a merge that
    // wrote `notes: null` would satisfy a weaker "did not overwrite my text" check.
    expect(out.values).not.toHaveProperty("notes");
    expect(out.values).not.toHaveProperty("priority");
  });
});

describe("only real differences count", () => {
  it("reports unchanged when every wiki field already matches", () => {
    const existing = contact({
      wiki_slug: "sample-person",
      company: "Example Lab",
      role: "Researcher",
      met_where: "a seminar",
      bio: record.bio,
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

    const created = first.outcomes[0]!;
    if (created.kind !== "create") throw new Error("expected create");
    const applied = contact({ ...(created.values as Partial<Contact>), id: "c-9" });

    const second = planSync([record], [applied]);
    expect(second.outcomes[0]!.kind).toBe("unchanged");
    expect(second.orphaned).toEqual([]);
  });

  it("stays unchanged after the operator edits their own layer", () => {
    const first = planSync([record], []);
    const created = first.outcomes[0]!;
    if (created.kind !== "create") throw new Error("expected create");

    // The operator does what the app now lets them do, and only that.
    const edited = contact({
      ...(created.values as Partial<Contact>),
      id: "c-9",
      notes: "Coffee on Thursday. He is hiring.",
      priority: "low",
    });

    expect(planSync([record], [edited]).outcomes[0]!.kind).toBe("unchanged");
  });

  it("reports a contact whose wiki page vanished, and never deletes it", () => {
    const gone = contact({ id: "c-7", wiki_slug: "departed", name: "Departed Person" });
    const plan = planSync([record], [gone]);

    expect(plan.orphaned).toEqual([
      { id: "c-7", wiki_slug: "departed", name: "Departed Person" },
    ]);
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
