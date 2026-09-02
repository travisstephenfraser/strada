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

const record = {
  wiki_slug: "sample-person",
  name: "Sample Person",
  company: "Example Lab",
  role: "Researcher",
  met_where: "a seminar",
  notes: "Ask about the evaluation work.",
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

describe("a human's edits survive a sync", () => {
  it("never writes a field the operator owns, and says so in the report", async () => {
    const existing = contact({
      id: "c-9",
      wiki_slug: "sample-person",
      notes: "My own note.",
      operator_set: ["notes"],
    });
    const up = upstreamWith([existing]);

    const res = await request(makeApp(up))
      .post("/api/contacts/sync")
      .set(AUTH)
      .send({ records: [record] });

    const [, init] = writesTo(up)[0]!;
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("notes");
    expect(body.company).toBe("Example Lab");

    expect(res.body.report.protected).toEqual([
      { wiki_slug: "sample-person", fields: ["notes"] },
    ]);
  });

  it("never rewrites operator_set itself", async () => {
    const up = upstreamWith([
      contact({ id: "c-9", wiki_slug: "sample-person", operator_set: ["notes"] }),
    ]);
    await request(makeApp(up)).post("/api/contacts/sync").set(AUTH).send({ records: [record] });

    for (const [, init] of writesTo(up)) {
      expect(JSON.parse(init.body)).not.toHaveProperty("operator_set");
    }
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
        notes: "Ask about the evaluation work.",
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

describe("editing in the app claims fields for the human", () => {
  it("adds the edited field to operator_set, additively", async () => {
    // A real uuid: the route's id guard rejects anything else before it reaches the
    // database, which is exactly what an earlier version of this test tripped over.
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const up = upstreamWith([
      contact({ id, wiki_slug: "sample-person", operator_set: ["priority"] }),
    ]);

    await request(makeApp(up))
      .patch(`/api/contacts/${id}`)
      .set(AUTH)
      .send({ notes: "Typed by hand." });

    const patch = writesTo(up).find(([, i]) => i.method === "PATCH")!;
    const body = JSON.parse(patch[1].body);
    expect(body.operator_set.toSorted()).toEqual(["notes", "priority"]);
  });
});
