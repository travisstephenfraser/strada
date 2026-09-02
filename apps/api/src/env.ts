/**
 * Server-only configuration.
 *
 * DATABASE_URL is deliberately absent from this file and from the entire deployed API.
 * The database is reached only through the Neon Data API, carrying the end user's own
 * JWT, so RLS applies to every query this service makes. There is no privileged
 * connection anywhere in the request path.
 *
 * `npm test` asserts that no source file under apps/api/src references DATABASE_URL.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value.replace(/\/+$/, "");
}

export interface ApiConfig {
  /** e.g. https://ep-xxx.neonauth.<region>.neon.tech/<db>/auth */
  authBaseUrl: string;
  /** e.g. https://ep-xxx.<region>.aws.neon.tech/<db>/rest/v1 */
  dataApiUrl: string;
  /** Comma-separated allowlist of browser origins. */
  webOrigins: string[];
  /**
   * Expected `iss` claim. Optional because Neon's docs disagree with each other about
   * whether managed tokens carry one; Phase 1 decodes a real token and sets this if
   * present. When unset, issuer is not pinned — the JWKS URL is what binds a token to
   * this project, and it is always pinned.
   */
  issuer: string | undefined;
  /** Expected `aud` claim, same reasoning as `issuer`. */
  audience: string | undefined;
  port: number;
}

export function loadConfig(): ApiConfig {
  return {
    authBaseUrl: required("NEON_AUTH_BASE_URL"),
    dataApiUrl: required("NEON_DATA_API_URL"),
    webOrigins: (process.env.WEB_ORIGIN ?? "http://localhost:5177")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    issuer: process.env.NEON_AUTH_ISSUER || undefined,
    audience: process.env.NEON_AUTH_AUDIENCE || undefined,
    port: Number(process.env.PORT ?? 3001),
  };
}

/**
 * The JWKS endpoint. Built by concatenation, NOT `new URL(path, base)`:
 * the Neon auth URL carries a path segment (`/<db>/auth`) that URL resolution
 * against a root-relative path would discard, producing a 404 on a URL that
 * looks correct.
 */
export function jwksUrl(authBaseUrl: string): URL {
  return new URL(`${authBaseUrl}/.well-known/jwks.json`);
}
