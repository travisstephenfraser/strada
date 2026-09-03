import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proof that User A cannot see or change User B's contacts.
 *
 * Design notes, because the obvious version of this test does not test anything:
 *
 * 1. It runs over HTTP against the deployed Neon Data API, using tokens obtained by
 *    actually signing in. An earlier design connected with `pg` and DATABASE_URL —
 *    but that connects as the table OWNER, and in Postgres an owner bypasses RLS
 *    unless FORCE ROW LEVEL SECURITY is set. That version would have gone green with
 *    the policies deleted. Testing the real path also covers things a direct
 *    connection cannot see at all: JWKS verification, the exposed schema, and grants.
 *
 * 2. B's reads are UNFILTERED. A `where user_id = B` would quietly do RLS's job for
 *    it, and the test would pass with RLS switched off.
 *
 * 3. The positive control matters but is not the strongest anchor. "B sees 0 rows"
 *    passes identically whether RLS is working or whether the request is denied
 *    everything — so asserting that A CAN read their own row separates those. The
 *    real anchors are the two WITH CHECK assertions, which fail loudly if the
 *    ownership rule is absent rather than merely over-restrictive.
 *
 * 4. It throws rather than skips when unconfigured. See vitest.rls.config.mts.
 *
 * WARNING — this suite WRITES AND DELETES against whichever database it is pointed at.
 * One assertion issues an unfiltered DELETE, which is harmless only while RLS is
 * working. Point it at a branch you are willing to lose, never at anything real.
 */

interface Env {
  authUrl: string;
  dataApiUrl: string;
  a: { email: string; password: string };
  b: { email: string; password: string };
}

function loadEnv(): Env {
  const required = [
    "NEON_AUTH_BASE_URL",
    "NEON_DATA_API_URL",
    "RLS_TEST_A_EMAIL",
    "RLS_TEST_A_PASSWORD",
    "RLS_TEST_B_EMAIL",
    "RLS_TEST_B_PASSWORD",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `npm run test:rls needs two real test accounts and cannot run without them.\n` +
        `Missing: ${missing.join(", ")}\n` +
        `This suite deliberately fails rather than skipping: a security test that ` +
        `skips still prints as a pass, which is worse than no test at all.`,
    );
  }
  return {
    authUrl: process.env.NEON_AUTH_BASE_URL!.replace(/\/+$/, ""),
    dataApiUrl: process.env.NEON_DATA_API_URL!.replace(/\/+$/, ""),
    a: {
      email: process.env.RLS_TEST_A_EMAIL!,
      password: process.env.RLS_TEST_A_PASSWORD!,
    },
    b: {
      email: process.env.RLS_TEST_B_EMAIL!,
      password: process.env.RLS_TEST_B_PASSWORD!,
    },
  };
}

const env = loadEnv();

/** Sign in for real and return the access token plus the user id RLS will compare. */
async function signIn(creds: { email: string; password: string }) {
  const res = await fetch(`${env.authUrl}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5177" },
    body: JSON.stringify(creds),
  });
  if (!res.ok) {
    throw new Error(`Could not sign in ${creds.email}: ${res.status} ${await res.text()}`);
  }
  const cookie = res.headers.getSetCookie?.().join("; ") ?? "";

  const tokenRes = await fetch(`${env.authUrl}/token`, {
    headers: { Cookie: cookie, Origin: "http://localhost:5177" },
  });
  if (!tokenRes.ok) {
    throw new Error(`Could not mint a token: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { token } = (await tokenRes.json()) as { token: string };
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString(),
  ) as { sub: string };
  return { token, userId: claims.sub };
}

function data(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${env.dataApiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
}

let A: { token: string; userId: string };
let B: { token: string; userId: string };
let rowId: string;
const MARKER = `rls-proof-${Date.now()}`;

beforeAll(async () => {
  [A, B] = await Promise.all([signIn(env.a), signIn(env.b)]);
  expect(A.userId, "the two accounts must be different users").not.toBe(B.userId);

  const res = await data(A.token, "/contacts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: MARKER,
      company: "Owned by A",
      priority: "high",
      user_id: A.userId,
    }),
  });
  expect(res.status, `A should be able to create their own row: ${await res.clone().text()}`).toBe(201);
  const [row] = (await res.json()) as { id: string }[];
  rowId = row!.id;
});

afterAll(async () => {
  if (rowId) await data(A.token, `/contacts?id=eq.${rowId}`, { method: "DELETE" });
});

describe("User A's row, as seen by User A (positive control)", () => {
  // Without this, "B sees nothing" would pass just as well if the database were
  // denying everyone everything.
  it("A can read the row A created", async () => {
    const res = await data(A.token, `/contacts?id=eq.${rowId}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string; user_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe(MARKER);
    expect(rows[0]!.user_id).toBe(A.userId);
  });
});

describe("User B cannot SEE User A's contacts", () => {
  it("B's unfiltered read of the whole table does not contain A's row", async () => {
    // No filter at all: any WHERE clause here would be the test doing RLS's job.
    const res = await data(B.token, "/contacts");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; user_id: string }[];
    expect(rows.map((r) => r.id)).not.toContain(rowId);
    expect(rows.every((r) => r.user_id === B.userId)).toBe(true);
  });

  it("B cannot read A's row even when asking for it by id", async () => {
    const res = await data(B.token, `/contacts?id=eq.${rowId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("User B cannot CHANGE User A's contacts", () => {
  it("B's update of A's row affects nothing", async () => {
    const res = await data(B.token, `/contacts?id=eq.${rowId}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name: "hijacked by B" }),
    });
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) expect(await res.json()).toEqual([]);

    const check = await data(A.token, `/contacts?id=eq.${rowId}`);
    const [row] = (await check.json()) as { name: string }[];
    expect(row!.name, "A's row must be untouched").toBe(MARKER);
  });

  it("B's delete of A's row removes nothing", async () => {
    const res = await data(B.token, `/contacts?id=eq.${rowId}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) expect(await res.json()).toEqual([]);

    const check = await data(A.token, `/contacts?id=eq.${rowId}`);
    expect((await check.json()) as unknown[], "A's row must still exist").toHaveLength(1);
  });

  it("B's unfiltered delete cannot reach A's rows", async () => {
    // DANGER: this is the one destructive assertion in the suite, and it is safe ONLY
    // because RLS bounds an unfiltered DELETE to the caller's own rows. Run it against
    // a database where RLS is off and it empties the whole table — which is exactly
    // what happened once while deliberately disabling RLS to prove this suite could
    // fail. The negative control destroyed the demo data it was run against.
    //
    // So the destructive step now refuses to run until isolation has been demonstrated
    // on this very connection: if B can see A's row, RLS is not doing its job and an
    // unfiltered delete must not be issued.
    const probe = await data(B.token, `/contacts?id=eq.${rowId}`);
    const visibleToB = (await probe.json()) as unknown[];
    if (visibleToB.length !== 0) {
      throw new Error(
        "Refusing to issue an unfiltered DELETE: User B can see User A's row, so row " +
          "level security is not in effect and this operation would delete every row " +
          "in the table. Fix RLS before re-running.",
      );
    }

    await data(B.token, "/contacts", { method: "DELETE" });
    const check = await data(A.token, `/contacts?id=eq.${rowId}`);
    expect((await check.json()) as unknown[]).toHaveLength(1);
  });
});

describe("Ownership cannot be handed to another user (WITH CHECK)", () => {
  // These are the assertions that fail if the ownership rule is missing rather than
  // merely over-restrictive, which is why they are the suite's real anchor.
  it("A cannot create a row owned by B", async () => {
    const res = await data(A.token, "/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: `${MARKER}-planted`,
        priority: "low",
        user_id: B.userId,
      }),
    });
    expect(res.status, "INSERT ... WITH CHECK must reject this").toBe(403);
    expect((await res.json()).code).toBe("42501");
  });

  it("A cannot move their own row to B", async () => {
    const res = await data(A.token, `/contacts?id=eq.${rowId}`, {
      method: "PATCH",
      body: JSON.stringify({ user_id: B.userId }),
    });
    expect(res.status, "UPDATE ... WITH CHECK must reject this").toBe(403);
    expect((await res.json()).code).toBe("42501");

    const check = await data(A.token, `/contacts?id=eq.${rowId}`);
    const [row] = (await check.json()) as { user_id: string }[];
    expect(row!.user_id).toBe(A.userId);
  });
});

describe("The wiki-sync columns do not weaken ownership", () => {
  // Migrations 002 and 003 added wiki_slug, wiki_synced_at and bio. They are covered by
  // the same four policies as everything else, and this asserts that rather than
  // trusting that adding columns is automatically safe.
  it("B cannot read A's wiki linkage", async () => {
    await data(A.token, `/contacts?id=eq.${rowId}`, {
      method: "PATCH",
      body: JSON.stringify({ wiki_slug: `probe-${Date.now()}` }),
    });

    const res = await data(B.token, "/contacts?select=id,wiki_slug,bio");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).not.toContain(rowId);
  });

  it("B cannot write A's wiki layer, sync stamp or not", async () => {
    // The wiki-layer trigger is not an ownership rule, so this checks that RLS still
    // does the ownership job for the columns the trigger governs. B supplies a
    // wiki_synced_at, which is exactly what would satisfy the trigger — RLS has to be
    // what stops this, and it is.
    const res = await data(B.token, `/contacts?id=eq.${rowId}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        bio: "written by B",
        wiki_synced_at: new Date().toISOString(),
      }),
    });
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) expect(await res.json()).toEqual([]);

    const check = await data(A.token, `/contacts?id=eq.${rowId}&select=bio`);
    const [row] = (await check.json()) as { bio: string | null }[];
    expect(row!.bio).not.toBe("written by B");
  });
});

describe("An unauthenticated caller reaches nothing", () => {
  it("the Data API refuses a request with no token", async () => {
    const res = await fetch(`${env.dataApiUrl}/contacts`);
    expect(res.ok).toBe(false);
  });

  it("the Data API refuses a forged token", async () => {
    const res = await fetch(`${env.dataApiUrl}/contacts`, {
      headers: { Authorization: "Bearer not.a.realtoken" },
    });
    expect(res.ok).toBe(false);
  });
});
