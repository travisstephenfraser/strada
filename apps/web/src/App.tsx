import { authClient } from "@/lib/auth";
import SignIn from "@/pages/SignIn";
import Contacts from "@/pages/Contacts";

/**
 * The whole routing story.
 *
 * There are exactly two states — signed out and signed in — so this is a conditional
 * rather than a router. Sort, filter and search live in the URL query string (added in
 * Phase 4) which needs no route table either.
 *
 * The third state matters as much as the other two: while the session is still being
 * resolved, render nothing rather than the sign-in screen. Otherwise every reload
 * flashes a sign-in form at an already-authenticated person.
 */
export default function App() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="min-h-dvh bg-[var(--fog)]" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  return session?.user ? <Contacts /> : <SignIn />;
}
