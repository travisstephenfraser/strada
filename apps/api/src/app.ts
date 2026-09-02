import express, { type Express } from "express";
import cors from "cors";
import type { ApiConfig } from "./env.js";
import { createAuthMiddleware } from "./auth.js";
import { DataApiClient } from "./dataApi.js";
import { createContactsRouter } from "./routes/contacts.js";

export interface AppDeps {
  config: ApiConfig;
  /** Injected in tests so route behaviour can be asserted without a live Data API. */
  fetchImpl?: typeof fetch;
  /** Injected in tests to bypass JWKS verification. */
  authMiddleware?: express.RequestHandler;
}

export function createApp({
  config,
  fetchImpl,
  authMiddleware,
}: AppDeps): Express {
  const app = express();

  // CORS MUST be mounted before the auth middleware.
  //
  // `Authorization` is a non-simple header, so the browser sends an OPTIONS preflight
  // before every request — and that preflight carries no Authorization header. With the
  // auth middleware first, every preflight 401s and the whole app fails with an opaque
  // browser CORS error that looks nothing like an auth bug.
  app.use(
    cors({
      origin: config.webOrigins,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 86_400,
    }),
  );

  app.use(express.json({ limit: "128kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const dataApi = new DataApiClient(config.dataApiUrl, fetchImpl);
  const requireAuth = authMiddleware ?? createAuthMiddleware(config);

  app.use("/api/contacts", requireAuth, createContactsRouter(dataApi));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  return app;
}
