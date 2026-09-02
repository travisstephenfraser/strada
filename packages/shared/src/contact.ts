import { z } from "zod";

/**
 * The single validation contract. Consumed by:
 *   - apps/api    — rejects bad input with a 400 before any upstream call
 *   - apps/web    — react-hook-form resolver, so client and server agree on the message
 *   - db/migrations/001_contacts.sql — the CHECK constraints mirror these limits
 *
 * The database is the trust boundary, not this file. The Neon Data API is reachable
 * without going through apps/api, so these limits are re-stated as CHECK constraints.
 * If you change a limit here, change it there in the same commit.
 */

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Mirrors the CHECK constraints in 001_contacts.sql. */
export const LIMITS = {
  name: 200,
  company: 200,
  role: 200,
  metWhere: 200,
  notes: 10_000,
} as const;

/** Optional free text: trim, and treat "" as absent rather than storing an empty string. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .nullable();

/**
 * The field shapes, WITHOUT defaults.
 *
 * The patch schema is built from these rather than from `contactInputSchema.partial()`:
 * a `.default()` survives `.partial()` and materialises in the parsed output, so an
 * empty `{}` patch would parse to `{ priority: "medium" }` and silently pass an
 * "at least one field" check while quietly rewriting the row's priority.
 */
const contactFields = {
  name: z
    .string({ error: "A name is required." })
    .trim()
    .min(1, "A name is required. Everything else can wait.")
    .max(LIMITS.name, `A name must be ${LIMITS.name} characters or fewer.`),
  company: optionalText(LIMITS.company, "Company"),
  role: optionalText(LIMITS.role, "Role"),
  met_where: optionalText(LIMITS.metWhere, "Where you met"),
  notes: optionalText(LIMITS.notes, "Notes"),
  priority: z.enum(PRIORITIES, {
    error: "Priority must be high, medium, or low.",
  }),
};

export const contactInputSchema = z.object({
  ...contactFields,
  priority: contactFields.priority.default("medium"),
});

/** Edits send only what changed; at least one field must actually be present. */
export const contactPatchSchema = z
  .object(contactFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "No changes were supplied.",
  });

export type ContactInput = z.infer<typeof contactInputSchema>;
export type ContactPatch = z.infer<typeof contactPatchSchema>;

/** A row as it comes back from the database. */
export interface Contact {
  id: string;
  user_id: string;
  name: string;
  company: string | null;
  role: string | null;
  met_where: string | null;
  notes: string | null;
  priority: Priority;
  created_at: string;
  updated_at: string;
}

/**
 * Fields a client may never set. The API strips these from every body before the
 * upstream call: `user_id` is taken from the verified JWT `sub`, and a client-suppliable
 * `id` would turn the primary key into a cross-user existence oracle.
 */
export const SERVER_OWNED_FIELDS = [
  "id",
  "user_id",
  "created_at",
  "updated_at",
] as const;

export function stripServerOwnedFields<T extends Record<string, unknown>>(
  body: T,
): Omit<T, (typeof SERVER_OWNED_FIELDS)[number]> {
  const out = { ...body };
  for (const field of SERVER_OWNED_FIELDS) delete out[field];
  return out;
}

/** Flatten a ZodError into `{ field: message }` so the UI can attach errors to inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) out[key] = issue.message;
  }
  return out;
}
