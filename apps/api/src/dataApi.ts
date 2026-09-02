/**
 * A deliberately narrow client for the Neon Data API (PostgREST).
 *
 * The rule this file exists to enforce: **nothing from the client's request shapes the
 * upstream request except the bearer token and a validated body.** No `req.query`, no
 * `req.headers`, no pass-through.
 *
 * PostgREST's request surface is very wide — `select=`, `columns=`, `on_conflict=`,
 * `Accept-Profile`, `Range`, and arbitrary filters. RLS bounds all of it to the caller's
 * own rows, so none of it is a cross-user leak, but a proxy that forwarded the query
 * string would still hand the client operations the app does not offer: an unfiltered
 * `DELETE /contacts` wipes every row the caller owns, and `columns=` defeats any
 * server-side body shaping. So every filter here is built from a validated path
 * parameter, and `Prefer` is set by this file rather than accepted from the caller.
 */

export interface UpstreamResult<T> {
  status: number;
  data: T | null;
  /** PostgREST's error body, when the status is not 2xx. */
  error: { message?: string; code?: string; details?: string } | null;
}

export interface DataApiRequest {
  token: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Table path only, e.g. "contacts". Never client-supplied. */
  table: string;
  /** Built server-side from validated values, e.g. { id: `eq.${uuid}` }. */
  filters?: Record<string, string>;
  /** Ordering, built server-side from a fixed string. */
  order?: string;
  body?: unknown;
  /** Extra Prefer directives. `return=representation` is always included for writes. */
  prefer?: string[];
}

export class DataApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>({
    token,
    method,
    table,
    filters,
    order,
    body,
    prefer = [],
  }: DataApiRequest): Promise<UpstreamResult<T>> {
    const url = new URL(`${this.baseUrl}/${table}`);
    for (const [key, value] of Object.entries(filters ?? {})) {
      url.searchParams.set(key, value);
    }
    if (order) url.searchParams.set("order", order);

    const preferDirectives = [...prefer];
    if (method !== "GET") {
      // Without this PostgREST answers 201/204 with an empty body and the UI has
      // nothing to render after a create or an edit.
      preferDirectives.push("return=representation");
    }

    const headers: Record<string, string> = {
      // The user's own token. This is what makes RLS apply to this request.
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (preferDirectives.length > 0) {
      headers["Prefer"] = preferDirectives.join(", ");
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    const parsed: unknown = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      return {
        status: response.status,
        data: null,
        error: (parsed as UpstreamResult<T>["error"]) ?? {
          message: text || response.statusText,
        },
      };
    }

    return { status: response.status, data: parsed as T, error: null };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/**
 * Maps a PostgREST failure onto a response this app is willing to make.
 *
 * `42501` is the code Postgres raises when a WITH CHECK expression rejects a row —
 * i.e. someone tried to create or move a row into another user's ownership. That is a
 * genuine 403 and the two-account test asserts it.
 */
export function mapUpstreamError(result: UpstreamResult<unknown>): {
  status: number;
  body: { error: string; code?: string };
} {
  const code = result.error?.code;

  if (code === "42501" || result.status === 403) {
    return { status: 403, body: { error: "Not yours to change.", code } };
  }
  if (code === "23514") {
    return {
      status: 400,
      body: { error: "That value is not allowed.", code },
    };
  }
  if (code === "23502") {
    return { status: 400, body: { error: "A required field was empty.", code } };
  }
  if (code === "PGRST116" || result.status === 404) {
    return { status: 404, body: { error: "Contact not found.", code } };
  }
  if (code === "PGRST124") {
    // max-affected tripped: a write matched more rows than the route intends.
    return { status: 409, body: { error: "Refused: too many rows.", code } };
  }
  if (result.status === 401) {
    return { status: 401, body: { error: "Session expired.", code: "expired" } };
  }
  return { status: 502, body: { error: "The database rejected that request.", code } };
}
