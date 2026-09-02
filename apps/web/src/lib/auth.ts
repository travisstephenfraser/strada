import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

/**
 * The Neon Auth client.
 *
 * The adapter is instantiated directly rather than through `createClient`, because
 * `createClient` requires a Data API URL and this app deliberately does not have one:
 * the browser never talks to the Data API. Every read and write goes through the
 * Express API, which forwards this token. Keeping the Data API URL out of the bundle
 * costs nothing and narrows what a signed-in user can reach directly.
 *
 * `@neondatabase/auth-ui` is deliberately not used. Its prebuilt screens carry their
 * own Tailwind build and a second copy of ~18 Radix packages, and they would replace
 * Strada's design with a stock one. The forms here are a few dozen lines instead.
 */

const authUrl = import.meta.env.NEXT_PUBLIC_NEON_AUTH_URL;

if (!authUrl) {
  throw new Error(
    "NEXT_PUBLIC_NEON_AUTH_URL is not set. Copy .env.example to .env.local at the " +
      "repository root and fill it in.",
  );
}

const adapter = BetterAuthReactAdapter({
  fetchOptions: {
    // Neon Auth keeps the refresh session in an HttpOnly cookie on its own origin.
    // Without credentials the browser omits it cross-origin and every session dies
    // at the first token refresh.
    credentials: "include",
  },
})(authUrl);

/** What a sign-in or sign-up call returns. Errors are values, not exceptions. */
interface AuthResult {
  error?: { message?: string; status?: number } | null;
}

export interface Session {
  user?: { id: string; email: string; name?: string | null };
}

/**
 * The slice of the Better Auth client this app uses.
 *
 * Declared explicitly instead of inferred. The real client type is generated from the
 * plugin set and is large enough that TypeScript refuses to serialise it ("inferred
 * type exceeds the maximum length the compiler will serialize"), and it reaches into
 * a nested `zod` copy that cannot be named portably. Naming the four methods used here
 * fixes both, and has the side benefit of stating exactly how much of a beta SDK this
 * app depends on — if a release breaks one of these, it breaks here and nowhere else.
 */
export interface AuthClient {
  useSession(): { data: Session | null; isPending: boolean; error?: unknown };
  signIn: {
    email(input: { email: string; password: string }): Promise<AuthResult>;
  };
  signUp: {
    email(input: {
      email: string;
      password: string;
      name: string;
    }): Promise<AuthResult>;
  };
  signOut(): Promise<unknown>;
}

export const authClient = adapter.getBetterAuthInstance() as unknown as AuthClient;

/**
 * A currently-valid access token, or null when signed out.
 *
 * Access tokens are Ed25519 and expire after 15 minutes, and there is no long-lived
 * token in the browser to fall back on — the refresh material is the HttpOnly cookie
 * above. So callers must never cache this value or read a token off a session object
 * captured in a React render: a component holding a 15-minute-old snapshot starts
 * failing every write, which looks like a broken app rather than an expired token.
 * Ask for a fresh one per request; the adapter caches and refreshes underneath.
 */
export async function getAccessToken(): Promise<string | null> {
  return adapter.getJWTToken(false);
}
