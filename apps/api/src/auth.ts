import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type { ApiConfig } from "./env.js";
import { jwksUrl } from "./env.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The verified `sub` claim. Set only by requireAuth. */
      userId?: string;
      /** The raw bearer token, forwarded verbatim to the Data API. */
      accessToken?: string;
    }
  }
}

/**
 * Verifying here is a fail-fast measure, NOT the ownership control.
 *
 * The Data API verifies the token independently and RLS is what enforces ownership.
 * This middleware exists so the service returns a clean 401 instead of relaying junk
 * upstream, and so it never acts as an open relay. If it were removed, a user still
 * could not read another user's rows.
 */
export function createAuthMiddleware(config: ApiConfig) {
  // Cached across requests; jose refetches on unknown `kid` with its own rate limiting.
  const jwks = createRemoteJWKSet(jwksUrl(config.authBaseUrl));

  return async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (!token) {
      res.status(401).json({ error: "Missing bearer token." });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        // Neon Auth signs with Ed25519, not the RS256 most examples assume.
        algorithms: ["EdDSA"],
        ...(config.issuer ? { issuer: config.issuer } : {}),
        ...(config.audience ? { audience: config.audience } : {}),
      });

      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        res.status(401).json({ error: "Token carries no subject." });
        return;
      }

      req.userId = payload.sub;
      req.accessToken = token;
      next();
    } catch (error) {
      // A JWKS fetch failure is our problem, not the caller's, and must never fall
      // through to an upstream call without credentials.
      if (
        error instanceof joseErrors.JWKSNoMatchingKey ||
        error instanceof joseErrors.JWKSMultipleMatchingKeys ||
        error instanceof joseErrors.JWKSInvalid ||
        error instanceof joseErrors.JWKSTimeout
      ) {
        res
          .status(503)
          .json({ error: "Cannot reach the identity provider. Try again." });
        return;
      }
      if (error instanceof joseErrors.JWTExpired) {
        res.status(401).json({ error: "Session expired.", code: "expired" });
        return;
      }
      res.status(401).json({ error: "Invalid token." });
    }
  };
}
