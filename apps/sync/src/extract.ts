import { z } from "zod";
import { PRIORITIES, type WikiRecord } from "@strada/shared";
import type { VaultEntity } from "./vault.js";

/**
 * Turning a wiki page into a contact, locally.
 *
 * The page text goes to a model running on this machine and stops there. What leaves is
 * a handful of derived fields — never verbatim page text — which is what keeps the
 * privacy claim a property of the system rather than a promise about behaviour.
 */

/** Constrains generation. LM Studio enforces this shape; Zod then re-checks it. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    is_person: { type: "boolean" },
    name: { type: "string" },
    company: { type: "string" },
    role: { type: "string" },
    met_where: { type: "string" },
    priority: { type: "string", enum: [...PRIORITIES] },
    bio: { type: "string" },
  },
  required: [
    "is_person",
    "name",
    "company",
    "role",
    "met_where",
    "priority",
    "bio",
  ],
} as const;

/**
 * The model's output is untrusted input, exactly like a request body.
 *
 * `priority` is the shared PRIORITIES tuple, so an extraction cannot invent a value the
 * database would refuse. Anything failing this is skipped and named, never silently
 * coerced into something plausible.
 */
const extractionSchema = z.object({
  is_person: z.boolean(),
  name: z.string(),
  company: z.string(),
  role: z.string(),
  met_where: z.string(),
  priority: z.enum(PRIORITIES),
  bio: z.string(),
});

export type Extraction = z.infer<typeof extractionSchema>;

/**
 * The first version of this prompt asked only "how actively worth staying close to this
 * person appears to be", and every one of eleven people came back `high`.
 *
 * A field with no variance carries no information: sorting and filtering by priority is
 * a core feature, and it was silently useless. All classes collapsing to one value is
 * the signal that a measurement is reading the prompt rather than the page. With the
 * criteria below the same vault produced 9 high / 2 medium, so the vagueness was the
 * cause rather than the data. A separate probe confirmed the model can reach `low`.
 */
const PROMPT = `You are extracting contact details from someone's personal wiki page.

Rules:
- is_person: true ONLY if the page is about a human being. Laptops, servers, software,
  companies and projects are not people.
- If is_person is false, set every other string field to "" and priority to "low".
- company, role, met_where: take from the page. Use "" if the page does not say.
  Never invent a value.
- bio: ONE or TWO short sentences, in your own words, describing who this person is and
  what they work on. Do NOT copy sentences from the page. Describe the person; do not
  suggest what to do about them — what to do next is the operator's to write, not
  yours.
- priority: use these definitions, and note that MEDIUM is the common case.
    high   — there is a specific open loop: an unanswered message, a promised follow-up,
             an introduction in flight, or an explicitly agreed next conversation.
    medium — a real relationship with no particular next step outstanding.
    low    — met briefly, or the page records background rather than a live connection.
  Do not mark someone high merely because the page speaks warmly about them, or because
  they are senior or well known. High means an open loop exists.

PAGE:
`;

/**
 * Scope the prompt to one person when the page is about several.
 *
 * A page carrying a `people:` list is usually about the work, not the person — a hire
 * track, a pitch, a course. Without naming the target, the model returns whichever
 * person it noticed first, and a two-person page silently yields one contact twice.
 */
function promptFor(entity: VaultEntity & { person?: string }): string {
  if (!entity.person) return PROMPT;
  return (
    PROMPT +
    `\nTHIS PAGE MENTIONS SEVERAL PEOPLE. Extract ONLY ${entity.person}. ` +
    `Ignore everyone else on the page, including the page's author. If the page does ` +
    `not describe ${entity.person} as a person, set is_person to false.\n`
  );
}

export interface ExtractorConfig {
  baseUrl: string;
  model: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

export class ExtractionError extends Error {}

/** One page in, one validated extraction out. Throws so the caller can name the page. */
export async function extractOne(
  entity: VaultEntity,
  config: ExtractorConfig,
): Promise<Extraction> {
  const doFetch = config.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          { role: "user", content: promptFor(entity) + entity.body.slice(0, 8000) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "contact", strict: true, schema: RESPONSE_SCHEMA },
        },
      }),
    });
  } catch (cause) {
    // No silent degradation: a sync that cannot reach its model must stop, not write
    // worse data that looks like a successful run.
    throw new ExtractionError(
      `Cannot reach the local model at ${config.baseUrl}. Is LM Studio running with a ` +
        `model loaded? (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }

  if (!response.ok) {
    throw new ExtractionError(
      `The local model returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new ExtractionError("The local model returned no content.");

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new ExtractionError("The local model returned text that is not JSON.");
  }

  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExtractionError(
      `The extraction did not match the expected shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

const blank = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** Extraction → the record shape the API accepts. Drops non-people. */
export function toRecord(
  entity: VaultEntity,
  extraction: Extraction,
): WikiRecord | null {
  if (!extraction.is_person) return null;

  const name = blank(extraction.name) ?? blank(entity.title);
  // A contact with no name cannot exist: the database refuses it and so does the app.
  if (!name) return null;

  return {
    wiki_slug: entity.slug,
    name,
    company: blank(extraction.company),
    role: blank(extraction.role),
    met_where: blank(extraction.met_where),
    // A sensitive page contributes a card, never a summary.
    //
    // Sync never transmits page text, so name/company/role/met_where are a business
    // card and carry none of what makes a page sensitive. `bio` is different in kind:
    // it is the model's summary OF that prose, and it is the one field that can carry
    // the page's substance off the machine. On a `visibility/pii` source it is dropped
    // rather than sent, so the person is reachable and the sensitive material is not.
    bio: entity.visibility === "pii" ? null : blank(extraction.bio),
    priority: extraction.priority,
  };
}
