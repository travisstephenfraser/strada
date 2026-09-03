import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import type { Contact } from "@strada/shared";
import { createApp } from "../src/app.js";
import type { ApiConfig } from "../src/env.js";

const config: ApiConfig = {
  authBaseUrl: "https://auth.example.test/neondb/auth",
  dataApiUrl: "https://data.example.test/neondb/rest/v1",
  webOrigins: ["http://localhost:5177"],
  issuer: undefined,
  audience: undefined,
  port: 0,
};

const USER = "user-a-sub";
const AUTH = { Authorization: `Bearer token-for-${USER}` };

const fakeAuth: RequestHandler = (req, res, next) => {
  if (req.header("authorization") !== `Bearer token-for-${USER}`) {
    res.status(401).json({ error: "Invalid token." });
    return;
  }
  req.userId = USER;
  req.accessToken = `token-for-${USER}`;
  next();
};

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c-1",
    user_id: USER,
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

const record = {
  wiki_slug: "sample-person",
  name: "Sample Person",
  company: "Example Lab",
  role: "Researcher",
  met_where: "a seminar",
  bio: "Runs the evaluation group.",
  priority: "high" as const,
};

/** Upstream double: first GET returns `existing`, writes echo their own body back. */
function upstreamWith(existing: Contact[]) {
  return vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "GET") {
      const byId = /id=eq\.([^&]+)/.exec(url);
      const rows = byId ? existing.filter((c) => c.id === byId[1]) : existing;
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response(JSON.stringify([{ ...contact(), ...body }]), {
      status: method === "POST" ? 201 : 200,
    });
  });
}

function makeApp(upstream: ReturnType<typeof vi.fn>) {
  return createApp({
    config,
    fetchImpl: upstream as unknown as typeof fetch,
    authMiddleware: fakeAuth,
  });
}

const writesTo = (upstream: ReturnType<typeof vi.fn>) =>
  upstream.mock.calls.filter((c) => (c[1]?.method ?? "GET") !== "GET");

let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  upstream = upstreamWith([]);
});

describe("POST /api/contacts/sync", () => {
  it("requires a token", async () => {
    const res = await request(makeApp(upstream)).post("/api/contacts/sync").send({ records: [] });
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("creates a contact for a new wiki record", async () => {
    const res = await request(makeApp(upstream))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [record] });

    expect(res.status).toBe(200);
    expect(res.body.report.created).toEqual(["sample-person"]);

    const [, init] = writesTo(upstream)[0]!;
    const body = JSON.parse(init.body);
    expect(body.user_id).toBe(USER);
    expect(body.wiki_slug).toBe("sample-person");
    expect(body.wiki_synced_at).toBeTruthy();
  });

  it("rejects a record whose priority the database would refuse, without writing", async () => {
    const res = await request(makeApp(upstream))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [{ ...record, priority: "urgent" }] });

    expect(res.status).toBe(400);
    expect(writesTo(upstream)).toHaveLength(0);
  });

  it("writes nothing on a dry run but still reports what it would do", async () => {
    const res = await request(makeApp(upstream))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [record], dryRun: true });

    expect(res.body.report.created).toEqual(["sample-person"]);
    expect(res.body.report.dryRun).toBe(true);
    expect(writesTo(upstream)).toHaveLength(0);
  });
});

describe("sync cannot reach the operator's layer", () => {
  it("writes no operator-owned column when it updates the wiki layer", async () => {
    const existing = contact({
      id: "c-9",
      wiki_slug: "sample-person",
      notes: "My own note.",
      priority: "low",
    });
    const up = upstreamWith([existing]);

    await request(makeApp(up))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [record] });

    const [, init] = writesTo(up)[0]!;
    const body = JSON.parse(init.body);
    // Asserting on the exact body, not on the absence of an error: a write of
    // `notes: null` would pass a weaker "my text survived" check on this mock.
    expect(body).not.toHaveProperty("notes");
    expect(body).not.toHaveProperty("priority");
    expect(body.company).toBe("Example Lab");
  });

  it("seeds priority on create, and never again", async () => {
    const fresh = upstreamWith([]);
    await request(makeApp(fresh)).post("/api/contacts/sync").set(AUTH).send({ records: [record] });
    expect(JSON.parse(writesTo(fresh)[0]![1].body).priority).toBe("high");

    // Same record, same wiki priority, but the operator has since demoted them.
    const later = upstreamWith([
      contact({ id: "c-9", wiki_slug: "sample-person", priority: "low" }),
    ]);
    await request(makeApp(later)).post("/api/contacts/sync").set(AUTH).send({ records: [record] });
    for (const [, init] of writesTo(later)) {
      expect(JSON.parse(init.body)).not.toHaveProperty("priority");
    }
  });

  it("refuses a record carrying notes rather than quietly dropping it", async () => {
    // A prompt that starts emitting operator text should fail loudly, not be ignored.
    const res = await request(makeApp(upstream))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [{ ...record, notes: "extraction should not produce this" }] });

    expect(res.status).toBe(400);
    expect(writesTo(upstream)).toHaveLength(0);
  });
});

describe("the report distinguishes outcomes rather than counting them", () => {
  it("reports unchanged and issues no write when nothing differs", async () => {
    const up = upstreamWith([
      contact({
        id: "c-9",
        wiki_slug: "sample-person",
        company: "Example Lab",
        role: "Researcher",
        met_where: "a seminar",
        bio: "Runs the evaluation group.",
        priority: "high",
      }),
    ]);

    const res = await request(makeApp(up))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [record] });

    // The flattering failure this guards against is a run that reports success while
    // rewriting identical values.
    expect(res.body.report.unchanged).toEqual(["sample-person"]);
    expect(res.body.report.updated).toEqual([]);
    expect(writesTo(up)).toHaveLength(0);
  });

  it("names an orphaned contact and does not delete it", async () => {
    const up = upstreamWith([
      contact({ id: "c-7", wiki_slug: "departed", name: "Departed Person" }),
    ]);

    const res = await request(makeApp(up))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [record] });

    expect(res.body.report.orphaned).toEqual([
      { wiki_slug: "departed", name: "Departed Person" },
    ]);
    expect(writesTo(up).some(([, i]) => i.method === "DELETE")).toBe(false);
  });

  it("keeps going when one record fails, and names the failure", async () => {
    const up = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return new Response("[]", { status: 200 });
      const body = JSON.parse(init.body!);
      if (body.wiki_slug === "breaks") {
        return new Response(JSON.stringify({ code: "23514", message: "check violation" }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify([{ ...contact(), ...body }]), { status: 201 });
    });

    const res = await request(makeApp(up))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [{ ...record, wiki_slug: "breaks" }, record] });

    expect(res.body.report.failed).toHaveLength(1);
    expect(res.body.report.failed[0].wiki_slug).toBe("breaks");
    expect(res.body.report.created).toEqual(["sample-person"]);
  });
});

describe("the app cannot reach the wiki layer", () => {
  // A real uuid: the route's id guard rejects anything else before it reaches the
  // database, which is exactly what an earlier version of this test tripped over.
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const linked = () =>
    upstreamWith([
      contact({
        id,
        wiki_slug: "sample-person",
        name: "Sample Person",
        company: "Example Lab",
        role: "Researcher",
        met_where: "a seminar",
        bio: "Runs the evaluation group.",
      }),
    ]);

  it("refuses a changed wiki field with a 403 that names it, and writes nothing", async () => {
    const up = linked();
    const res = await request(makeApp(up))
      .patch(`/api/contacts/${id}`)
      .set(AUTH)
      .send({ company: "Somewhere Else" });

    expect(res.status).toBe(403);
    expect(res.body.fields).toHaveProperty("company");
    expect(writesTo(up).some(([, i]) => i.method === "PATCH")).toBe(false);
  });

  it("accepts an edit that only restates the wiki fields unchanged", async () => {
    // The edit form submits every field, so this is what an ordinary notes edit looks
    // like on the wire. Rejecting on presence rather than on change would 403 here and
    // make wiki-linked contacts uneditable.
    const up = linked();
    const res = await request(makeApp(up))
      .patch(`/api/contacts/${id}`)
      .set(AUTH)
      .send({
        name: "Sample Person",
        company: "Example Lab",
        role: "Researcher",
        met_where: "a seminar",
        notes: "Coffee on Thursday.",
        priority: "low",
      });

    expect(res.status).toBe(200);
    const body = JSON.parse(writesTo(up).find(([, i]) => i.method === "PATCH")![1].body);
    expect(body.notes).toBe("Coffee on Thursday.");
    expect(body.priority).toBe("low");
  });

  it("lets a hand-made contact change every field, since it has no wiki layer", async () => {
    const up = upstreamWith([contact({ id, wiki_slug: null, company: "Old Co" })]);
    const res = await request(makeApp(up))
      .patch(`/api/contacts/${id}`)
      .set(AUTH)
      .send({ company: "New Co" });

    expect(res.status).toBe(200);
    expect(JSON.parse(writesTo(up).find(([, i]) => i.method === "PATCH")![1].body).company)
      .toBe("New Co");
  });
});
