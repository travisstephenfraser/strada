import { z } from "zod";
import { LIMITS, PRIORITIES, type Contact, type Priority } from "./contact.js";

/**
 * The wiki-sync merge rule.
 *
 * A pure function on purpose: it is the part of this feature that can silently destroy
 * something a human wrote, so it is written and tested with no network, no database and
 * no clock anywhere near it.
 */

/** Fields sync is allowed to write. Everything else is server-owned or bookkeeping. */
export const SYNCABLE_FIELDS = [
  "name",
  "company",
  "role",
  "met_where",
  "notes",
  "priority",
] as const;

export type SyncableField = (typeof SYNCABLE_FIELDS)[number];

/** One person, as derived from a wiki page. Never contains verbatim page text. */
export interface WikiRecord {
  /** Stable id of the source page, e.g. "rosa-delgado". */
  wiki_slug: string;
  name: string;
  company?: string | null;
  role?: string | null;
  met_where?: string | null;
  notes?: string | null;
  priority: Priority;
}

export type MergeOutcome =
  | { kind: "create"; wiki_slug: string; values: Record<string, unknown> }
  | {
      kind: "update";
      wiki_slug: string;
      id: string;
      values: Record<string, unknown>;
      changed: SyncableField[];
      /** Fields the wiki wanted to change but a human owns. */
      protectedFields: SyncableField[];
    }
  | {
      kind: "unchanged";
      wiki_slug: string;
      id: string;
      protectedFields: SyncableField[];
    };

export interface SyncPlan {
  outcomes: MergeOutcome[];
  /** Contacts linked to a wiki page that no longer exists. Never deleted, only named. */
  orphaned: { id: string; wiki_slug: string; name: string }[];
}

/**
 * Compare two field values the way a person would.
 *
 * `undefined`, `null` and `""` all mean "nothing here", and whitespace is not a change.
 * Getting this wrong is the bug that makes a sync look busy and be useless: every run
 * would report an update for fields that are identical, and the idempotency test exists
 * precisely to catch that.
 */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    v === undefined || v === null ? "" : typeof v === "string" ? v.trim() : v;
  return norm(a) === norm(b);
}

function incomingValue(record: WikiRecord, field: SyncableField): unknown {
  const raw = record[field];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
  }
  return raw ?? null;
}

/**
 * Decide what one wiki record should do to one existing contact.
 *
 * The ownership rule: a field named in `operator_set` belongs to the human, and sync
 * does not touch it — not even to "correct" it. It is reported as protected so the run
 * report can say what the wiki wanted and did not get, rather than staying silent about
 * a divergence.
 */
export function mergeOne(
  record: WikiRecord,
  existing: Contact | null,
): MergeOutcome {
  if (!existing) {
    const values: Record<string, unknown> = { wiki_slug: record.wiki_slug };
    for (const field of SYNCABLE_FIELDS) values[field] = incomingValue(record, field);
    return { kind: "create", wiki_slug: record.wiki_slug, values };
  }

  const owned = new Set(
    (existing.operator_set ?? []).filter((f): f is SyncableField =>
      (SYNCABLE_FIELDS as readonly string[]).includes(f),
    ),
  );

  const values: Record<string, unknown> = {};
  const changed: SyncableField[] = [];
  const protectedFields: SyncableField[] = [];

  for (const field of SYNCABLE_FIELDS) {
    const next = incomingValue(record, field);
    const current = (existing as unknown as Record<string, unknown>)[field];

    if (sameValue(next, current)) continue;

    if (owned.has(field)) {
      protectedFields.push(field);
      continue;
    }
    values[field] = next;
    changed.push(field);
  }

  if (changed.length === 0) {
    return {
      kind: "unchanged",
      wiki_slug: record.wiki_slug,
      id: existing.id,
      protectedFields,
    };
  }

  return {
    kind: "update",
    wiki_slug: record.wiki_slug,
    id: existing.id,
    values,
    changed,
    protectedFields,
  };
}

/** Plan a whole run. Pure: same inputs, same plan, no clock and no network. */
export function planSync(records: WikiRecord[], existing: Contact[]): SyncPlan {
  const bySlug = new Map<string, Contact>();
  for (const contact of existing) {
    if (contact.wiki_slug) bySlug.set(contact.wiki_slug, contact);
  }

  const seen = new Set<string>();
  const outcomes = records.map((record) => {
    seen.add(record.wiki_slug);
    return mergeOne(record, bySlug.get(record.wiki_slug) ?? null);
  });

  // A contact whose page disappeared keeps its row. Deleting someone's record because
  // a note was renamed is not a behaviour worth having; it is reported instead.
  const orphaned = existing
    .filter((c) => c.wiki_slug && !seen.has(c.wiki_slug))
    .map((c) => ({ id: c.id, wiki_slug: c.wiki_slug!, name: c.name }));

  return { outcomes, orphaned };
}

/** Narrow an unknown string to a Priority, reusing the one validation contract. */
export function asPriority(value: unknown): Priority | null {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
    ? (value as Priority)
    : null;
}

/**
 * What the sync CLI is allowed to send.
 *
 * The same limits as a hand-typed contact, because the database enforces exactly one
 * set of CHECK constraints and a record from a model is no more trusted than one from
 * a text field. `priority` is the shared PRIORITIES tuple, so an extraction cannot
 * invent a value the database would reject.
 */
const syncText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const wikiRecordSchema = z.object({
  wiki_slug: z
    .string()
    .trim()
    .min(1, "A wiki slug is required.")
    .max(200)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "A wiki slug must look like a file stem."),
  name: z.string().trim().min(1, "A name is required.").max(LIMITS.name),
  company: syncText(LIMITS.company),
  role: syncText(LIMITS.role),
  met_where: syncText(LIMITS.metWhere),
  notes: syncText(LIMITS.notes),
  priority: z.enum(PRIORITIES),
});

export const syncRequestSchema = z.object({
  records: z.array(wikiRecordSchema).max(500),
  /** When true the API plans and reports but writes nothing. */
  dryRun: z.boolean().default(false),
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;
