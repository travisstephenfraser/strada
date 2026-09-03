/**
 * Talking to Strada.
 *
 * The CLI signs in exactly as the browser does and sends the user's own token, so it
 * needs no service account, no new credential, and no privilege the app does not
 * already have. RLS applies to its writes identically.
 */

export interface StradaConfig {
  authUrl: string;
  apiUrl: string;
  email: string;
  password: string;
  /**
   * Sent as `Origin` when signing in. Neon Auth refuses a request without one
   * (`MISSING_OR_NULL_ORIGIN`) and then checks it against its trusted domains, so this
   * must be a registered origin — a browser sets it automatically, a CLI must not
   * forget to.
   */
  origin: string;
  fetchImpl?: typeof fetch;
}

export interface SyncReport {
  dryRun: boolean;
  created: string[];
  updated: { wiki_slug: string; fields: string[] }[];
  unchanged: string[];
  orphaned: { wiki_slug: string; name: string }[];
  failed: { wiki_slug: string; error: string }[];
}

export class StradaError extends Error {}

export async function signIn(config: StradaConfig): Promise<string> {
  const doFetch = config.fetchImpl ?? fetch;
  const auth = config.authUrl.replace(/\/+$/, "");

  const res = await doFetch(`${auth}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: config.origin },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (!res.ok) {
    throw new StradaError(
      `Could not sign in as ${config.email}: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }

  const cookie = res.headers.getSetCookie?.().join("; ") ?? "";
  const tokenRes = await doFetch(`${auth}/token`, {
    headers: { Cookie: cookie, Origin: config.origin },
  });
  if (!tokenRes.ok) {
    throw new StradaError(`Could not mint an access token: ${tokenRes.status}`);
  }
  const { token } = (await tokenRes.json()) as { token?: string };
  if (!token) throw new StradaError("The auth service returned no token.");
  return token;
}

export async function pushRecords(
  token: string,
  records: unknown[],
  dryRun: boolean,
  config: StradaConfig,
): Promise<SyncReport> {
  const doFetch = config.fetchImpl ?? fetch;
  const res = await doFetch(`${config.apiUrl.replace(/\/+$/, "")}/api/contacts/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records, dryRun }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    report?: SyncReport;
    error?: string;
    fields?: Record<string, string>;
  };
  if (!res.ok) {
    const detail = body.fields ? ` ${JSON.stringify(body.fields)}` : "";
    throw new StradaError(`Strada refused the sync (${res.status}): ${body.error ?? ""}${detail}`);
  }
  if (!body.report) throw new StradaError("Strada returned no report.");
  return body.report;
}

/**
 * Hand fields back to the wiki.
 *
 * Without this, editing a field once claims it forever and the contact slowly ossifies:
 * every later wiki improvement is refused and the app quietly drifts from the notes it
 * was meant to mirror. Sticky edits are only safe when they can be un-stuck.
 */
export async function reclaim(
  token: string,
  contactId: string,
  config: StradaConfig,
): Promise<void> {
  const doFetch = config.fetchImpl ?? fetch;
  const res = await doFetch(
    `${config.apiUrl.replace(/\/+$/, "")}/api/contacts/${contactId}/reclaim`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new StradaError(`Could not hand fields back (${res.status}).`);
  }
}
