import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
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

const USER_A = "user-a-sub";
const ROW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Stands in for a verified JWT so route behaviour can be asserted without JWKS. */
const fakeAuth: RequestHandler = (req, res, next) => {
  const header = req.header("authorization");
  if (header !== `Bearer token-for-${USER_A}`) {
    res.status(401).json({ error: "Invalid token." });
    return;
  }
  req.userId = USER_A;
  req.accessToken = `token-for-${USER_A}`;
  next();
};

function makeApp(upstream: ReturnType<typeof vi.fn>) {
  return createApp({
    config,
    fetchImpl: upstream as unknown as typeof fetch,
    authMiddleware: fakeAuth,
  });
}

function upstreamReturning(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const AUTH = { Authorization: `Bearer token-for-${USER_A}` };
const row = {
  id: ROW_ID,
  user_id: USER_A,
  name: "Priya Raman",
  company: null,
  role: null,
  met_where: null,
  notes: null,
  priority: "high",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  upstream = upstreamReturning([row]);
});

describe("authentication", () => {
  it("rejects a request with no bearer token", async () => {
    const res = await request(makeApp(upstream)).get("/api/contacts");
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a request with a bad bearer token", async () => {
    const res = await request(makeApp(upstream))
      .get("/api/contacts")
      .set("Authorization", "Bearer nonsense");
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("validation rejects before any upstream call", () => {
  it("refuses an invalid priority with a 400 and never calls the database", async () => {
    const res = await request(makeApp(upstream))
      .post("/api/contacts")
      .set(AUTH)
      .send({ name: "Dana Whitfield", priority: "urgent" });

    expect(res.status).toBe(400);
    expect(res.body.fields.priority).toMatch(/high, medium, or low/i);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses an empty name with a 400 and never calls the database", async () => {
    const res = await request(makeApp(upstream))
      .post("/api/contacts")
      .set(AUTH)
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.fields.name).toMatch(/name is required/i);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a non-uuid id without calling the database", async () => {
    const res = await request(makeApp(upstream))
      .patch("/api/contacts/not-a-uuid")
      .set(AUTH)
      .send({ priority: "low" });

    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("the client cannot shape the upstream request", () => {
  it("ignores a client-supplied query string", async () => {
    // PostgREST would honour `select` and `id` as a filter. The proxy builds its own
    // URL, so neither reaches the database.
    await request(makeApp(upstream))
      .get("/api/contacts?select=*,users(*)&id=eq.someone-elses-row&limit=9999")
      .set(AUTH);

    const [url] = upstream.mock.calls[0]!;
    expect(url).not.toContain("users");
    expect(url).not.toContain("someone-elses-row");
    expect(url).not.toContain("limit");
    expect(url).toBe(
      "https://data.example.test/neondb/rest/v1/contacts?order=created_at.desc",
    );
  });

  it("does not forward client headers such as Prefer or Accept-Profile", async () => {
    await request(makeApp(upstream))
      .get("/api/contacts")
      .set(AUTH)
      .set("Prefer", "count=exact")
      .set("Accept-Profile", "neon_auth");

    const [, init] = upstream.mock.calls[0]!;
    expect(init.headers["Accept-Profile"]).toBeUndefined();
    expect(init.headers["Prefer"]).toBeUndefined();
    expect(init.headers["Authorization"]).toBe(`Bearer token-for-${USER_A}`);
  });

  it("replaces a client-supplied user_id with the verified subject", async () => {
    await request(makeApp(upstream))
      .post("/api/contacts")
      .set(AUTH)
      .send({ name: "Priya Raman", user_id: "victim-user-id" });

    const [, init] = upstream.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.user_id).toBe(USER_A);
  });

  it("strips a client-supplied id so the primary key cannot be probed", async () => {
    await request(makeApp(upstream))
      .post("/api/contacts")
      .set(AUTH)
      .send({ name: "Priya Raman", id: "00000000-0000-4000-8000-000000000001" });

    const [, init] = upstream.mock.calls[0]!;
    expect(JSON.parse(init.body)).not.toHaveProperty("id");
  });

  it("offers no route for an unfiltered PATCH or DELETE", async () => {
    const app = makeApp(upstream);
    expect((await request(app).patch("/api/contacts").set(AUTH).send({ priority: "low" })).status).toBe(404);
    expect((await request(app).delete("/api/contacts").set(AUTH)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("upstream request shape", () => {
  it("filters a write by the path-parameter id and caps rows affected", async () => {
    await request(makeApp(upstream))
      .patch(`/api/contacts/${ROW_ID}`)
      .set(AUTH)
      .send({ priority: "low" });

    // PATCH first READS the row so it can add the edited fields to operator_set
    // without discarding earlier claims, so the write is the second upstream call.
    const write = upstream.mock.calls.find(
      ([, init]) => (init?.method ?? "GET") === "PATCH",
    )!;
    const [url, init] = write;
    expect(url).toBe(
      `https://data.example.test/neondb/rest/v1/contacts?id=eq.${ROW_ID}`,
    );
    expect(init.headers["Prefer"]).toContain("max-affected=1");
    expect(init.headers["Prefer"]).toContain("handling=strict");
    expect(init.headers["Prefer"]).toContain("return=representation");
  });

  it("asks for the written row back so the UI has something to render", async () => {
    await request(makeApp(upstream))
      .post("/api/contacts")
      .set(AUTH)
      .send({ name: "Priya Raman" });

    const [, init] = upstream.mock.calls[0]!;
    expect(init.headers["Prefer"]).toContain("return=representation");
  });
});

describe("upstream failures map to honest statuses", () => {
  it("turns a WITH CHECK rejection into a 403", async () => {
    const denied = upstreamReturning(
      { code: "42501", message: "new row violates row-level security policy" },
      403,
    );
    const res = await request(makeApp(denied))
      .patch(`/api/contacts/${ROW_ID}`)
      .set(AUTH)
      .send({ priority: "low" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when RLS filters the row out, without saying whether it exists", async () => {
    const empty = upstreamReturning([]);
    const res = await request(makeApp(empty))
      .patch(`/api/contacts/${ROW_ID}`)
      .set(AUTH)
      .send({ priority: "low" });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/exist|owner|another user/i);
  });
});
