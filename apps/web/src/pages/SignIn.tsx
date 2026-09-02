import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

type Mode = "signin" | "signup";

/**
 * Turn whatever the auth client hands back into something true.
 *
 * A browser cannot distinguish "server unreachable" from "response blocked by CORS",
 * so neither can this — but it can avoid asserting a cause it does not know, and it
 * can pass through a message the server actually sent.
 */
function describeAuthError(error: unknown): string {
  const shape = error as { message?: string; code?: string } | null;

  if (shape?.code === "INVALID_ORIGIN") {
    return "This site is not an approved origin for sign-in. Add it to the Neon Auth trusted domains.";
  }
  if (shape?.message) return shape.message;
  if (error instanceof TypeError) {
    // A thrown TypeError from fetch means the request never produced a response.
    return "The sign-in service did not respond. It may be unreachable, or this site may not be an approved origin.";
  }
  return "That did not work. Check your details and try again.";
}

/**
 * Sign in and sign up are one screen with a toggled mode, not two routes: the fields
 * are nearly identical and a person who guesses wrong should not have to navigate.
 */
export default function SignIn() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === "signup";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password are both required.");
      return;
    }
    if (isSignUp && password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({
            email: email.trim(),
            password,
            name: name.trim() || email.trim().split("@")[0]!,
          })
        : await authClient.signIn.email({ email: email.trim(), password });

      // The adapter configures Better Auth with `throw: false`, so failures arrive
      // here rather than as exceptions.
      if (result.error) {
        setError(describeAuthError(result.error));
        return;
      }
      // A successful session flips the session store, which swaps the screen.
    } catch (caught) {
      // Report what actually happened. An earlier version said "check your
      // connection" for every failure, which sent a real INVALID_ORIGIN rejection —
      // a configuration problem — off to be debugged as a network one.
      console.error("[strada] sign-in failed", caught);
      setError(describeAuthError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--fog)] px-5 py-10">
      <div className="w-full max-w-[400px]">
        <header className="mb-7 text-center">
          <h1 className="font-serif text-[2.5rem] leading-none font-medium tracking-[-0.01em] text-[var(--ink)]">
            Strada
          </h1>
          <p className="mt-2 text-[0.8125rem] text-[var(--ink-faint)]">
            people you want to stay close to at Berkeley
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          noValidate
          className="grid gap-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--plate)] p-6"
        >
          {isSignUp && (
            <Field id="name" label="Your name" hint="optional">
              <Input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}

          <Field id="email" label="Email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field id="password" label="Password" hint={isSignUp ? "8+ characters" : undefined}>
            <Input
              id="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="border-l-2 border-[var(--invalid)] bg-[var(--invalid-wash)] py-2 pl-3 text-[0.8125rem] text-[var(--invalid)]"
            >
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "One moment…" : isSignUp ? "Create account" : "Sign in"}
          </Button>

          <div className="border-t border-[var(--hairline)] pt-3 text-center text-[0.8125rem] text-[var(--ink-soft)]">
            {isSignUp ? "Already have an account? " : "New here? "}
            <button
              type="button"
              className="text-[var(--bay)] underline-offset-4 hover:underline"
              onClick={() => {
                setMode(isSignUp ? "signin" : "signup");
                setError(null);
              }}
            >
              {isSignUp ? "Sign in" : "Create one"}
            </button>
          </div>
        </form>

        {/* Not decoration: this states the actual guarantee, in the user's language,
            on the first screen anyone sees. */}
        <p className="mt-5 text-center text-[0.6875rem] leading-relaxed text-[var(--ink-faint)]">
          Your table is private. Only you can read it —
          <br />
          enforced by the database, not just the app.
        </p>
      </div>
    </main>
  );
}
