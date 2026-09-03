import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proof that the wiki layer is locked in the DATABASE, not merely in the API.
 *
 * Why this suite is live rather than hermetic: the thing under test is a Postgres
 * trigger. A mocked test of a trigger proves the mock works. It runs over the Data API
 * with a real end-user token — the same path the browser takes, and the same path an
 * attacker with their own token would take — so it exercises the trigger exactly as
 * production does, bypassing apps/api entirely. That matters: the API's 403 is a
 * courtesy, and this asserts the guarantee underneath it.
 *
 * WHAT THIS PROVES: sync's columns cannot be changed by an ordinary write.
 *
 * WHAT IT DOES NOT PROVE: that a determined owner cannot change them. They can — see
 * the last test, which demonstrates the bypass rather than hiding it. Sync and the app
 * carry the same token, so the only thing separating them is a convention about
 * `wiki_synced_at`. This is a correctness guarantee against bugs, not a security
 * boundary against people. RLS is the security boundary, and it is a different claim
 * tested in two-account.test.ts.
 *
 * WARNING — this suite WRITES AND DELETES against whichever database it is pointed at.
 */

interface Env {
  authUrl: string;
  dataApiUrl: string;
  a: { email: string; password: string };
}

function loadEnv(): Env {
  const required = [
    "NEON_AUTH_BASE_URL",
    "NEON_DATA_API_URL",
    "RLS_TEST_A_EMAIL",
    "RLS_TEST_A_PASSWORD",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `npm run test:rls needs a real test account and cannot run without one.\n` +
        `Missing: ${missing.join(", ")}\n` +
        `This suite deliberately fails rather than skipping: a guard that is absent ` +
        `produces no event, so a skipped test for it is indistinguishable from a pass.`,
    );
  }
  return {
    authUrl: process.env.NEON_AUTH_BASE_URL!.replace(/\/+$/, ""),
    dataApiUrl: process.env.NEON_DATA_API_URL!.replace(/\/+$/, ""),
    a: {
      email: process.env.RLS_TEST_A_EMAIL!,
      password: process.env.RLS_TEST_A_PASSWORD!,
    },
  };
}

const env = loadEnv();

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
  if (!tokenRes.ok) throw new Error(`Could not mint a token: ${tokenRes.status}`);
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

const patch = (token: string, id: string, body: Record<string, unknown>) =>
  data(token, `/contacts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body) });

let A: { token: string; userId: string };
let wikiRowId = "";
let handRowId = "";
const MARKER = `wiki-layer-proof-${Date.now()}`;

beforeAll(async () => {
  A = await signIn(env.a);

  const create = async (body: Record<string, unknown>) => {
    const res = await data(A.token, "/contacts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...body, user_id: A.userId }),
    });
    expect(res.status, `setup write failed: ${await res.clone().text()}`).toBe(201);
    const [row] = (await res.json()) as { id: string }[];
    return row!.id;
  };

  wikiRowId = await create({
    name: MARKER,
    company: "Meridian Labs",
    role: "Staff research engineer",
    met_where: "Haas AI mixer",
    bio: "Runs the evaluation group.",
    priority: "high",
    wiki_slug: `${MARKER}-slug`,
    wiki_synced_at: new Date().toISOString(),
  });

  handRowId = await create({ name: `${MARKER}-by-hand`, company: "Typed", priority: "low" });
});

afterAll(async () => {
  for (const id of [wikiRowId, handRowId]) {
    if (id) await data(A.token, `/contacts?id=eq.${id}`, { method: "DELETE" });
  }
});

describe("the wiki layer is read-only to an ordinary write", () => {
  it.each(["name", "company", "role", "met_where", "bio"])(
    "refuses a change to %s on a wiki-linked row",
    async (field) => {
      const res = await patch(A.token, wikiRowId, { [field]: "changed by hand" });
      // The status alone is a weak assertion: any upstream failure would produce one.
      // The message names this trigger, so a different error cannot pass as this one.
      expect(res.ok).toBe(false);
      expect(await res.text()).toMatch(/cannot be edited here/);
    },
  );

  it("leaves the value in place after a refusal", async () => {
    await patch(A.token, wikiRowId, { company: "Hacked Co" });
    const res = await data(A.token, `/contacts?id=eq.${wikiRowId}&select=company`);
    const [row] = (await res.json()) as { company: string }[];
    expect(row!.company).toBe("Meridian Labs");
  });
});

describe("everything else still works", () => {
  it("allows an edit that restates wiki fields without changing them", async () => {
    // This is the shape the edit form actually sends: every field, most unchanged.
    // Rejecting on presence rather than on change would make wiki contacts uneditable,
    // and this is the test that would catch it.
    const res = await patch(A.token, wikiRowId, {
      name: MARKER,
      company: "Meridian Labs",
      role: "Staff research engineer",
      met_where: "Haas AI mixer",
      notes: "Coffee on Thursday.",
      priority: "low",
    });
    expect(res.ok, await res.clone().text()).toBe(true);
  });

  it("allows the operator's own layer to change freely", async () => {
    const res = await patch(A.token, wikiRowId, { notes: "Mine.", priority: "medium" });
    expect(res.ok).toBe(true);
  });

  it("leaves a hand-made contact fully editable", async () => {
    // The assignment's CRUD path. A regression here breaks the graded feature.
    const res = await patch(A.token, handRowId, { name: "Renamed", company: "New Co" });
    expect(res.ok, await res.clone().text()).toBe(true);
  });
});

describe("the limit of this guarantee, stated rather than hidden", () => {
  it("lets a caller who sets wiki_synced_at through: this is not a security boundary", async () => {
    // Sync is identified only by stamping wiki_synced_at, and any holder of this token
    // can stamp it too. Documenting the bypass in a passing test keeps the README's
    // claim honest — if this ever starts failing, the guarantee changed and the README
    // needs to change with it.
    const res = await patch(A.token, wikiRowId, {
      company: "Set by a direct caller",
      wiki_synced_at: new Date().toISOString(),
    });
    expect(res.ok).toBe(true);

    await patch(A.token, wikiRowId, {
      company: "Meridian Labs",
      wiki_synced_at: new Date().toISOString(),
    });
  });
});
