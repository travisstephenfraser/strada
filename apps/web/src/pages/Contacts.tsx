import { useCallback, useEffect, useState } from "react";
import type { Contact } from "@strada/shared";
import { authClient } from "@/lib/auth";
import { ApiError, contactsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; contacts: Contact[] }
  | { status: "error"; message: string; code?: number };

export default function Contacts() {
  const { data: session } = authClient.useSession();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", contacts: await contactsApi.list() });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setState({
        status: "error",
        message: apiError?.message ?? "Could not load your table.",
        code: apiError?.status,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="min-h-dvh bg-[var(--fog)] px-5 py-10">
      <div className="mx-auto max-w-[880px]">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-[1.75rem] leading-none font-medium text-[var(--ink)]">
              Strada
            </h1>
            <p className="mt-1.5 text-[0.8125rem] text-[var(--ink-faint)]">
              people you want to stay close to at Berkeley
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[0.8125rem] text-[var(--ink-soft)] sm:inline">
              {session?.user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void authClient.signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <div className="overflow-hidden rounded-[14px] border border-[var(--hairline)] bg-[var(--plate)]">
          {state.status === "loading" && <LoadingRows />}

          {state.status === "error" && (
            <div className="px-5 py-8">
              <p className="border-l-2 border-[var(--invalid)] pl-3 text-[1.0625rem] text-[var(--ink)]">
                Couldn't load your table.
              </p>
              <p className="mt-1.5 pl-3 text-[0.9375rem] text-[var(--ink-soft)]">
                {state.message} Nothing was changed — your contacts are safe.
              </p>
              <div className="mt-4 flex items-center justify-between pl-3">
                <Button variant="ghost" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
                {state.code && (
                  <span className="text-[0.6875rem] text-[var(--ink-faint)]">
                    {state.code} · {new Date().toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {state.status === "ready" && state.contacts.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="font-serif text-[1.25rem] text-[var(--ink)]">
                Your table is empty.
              </p>
              <p className="mt-1.5 text-[0.9375rem] text-[var(--ink-soft)]">
                Adding people arrives in the next slice.
              </p>
            </div>
          )}

          {state.status === "ready" &&
            state.contacts.map((contact) => (
              <article
                key={contact.id}
                className="relative border-b border-[var(--hairline)] px-5 py-3.5 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-0 w-[3px] -translate-y-1/2 rounded-full bg-[var(--brass)]"
                  style={{ height: spineHeight(contact.priority) }}
                />
                <div className="flex items-baseline justify-between gap-3 pl-3">
                  <span className="font-serif text-[1.0625rem] text-[var(--ink)]">
                    {contact.name}
                  </span>
                  <span className="eyebrow shrink-0 text-[var(--ink-faint)]">
                    {contact.priority}
                  </span>
                </div>
                <p className="pl-3 text-[0.8125rem] text-[var(--ink-soft)]">
                  {[contact.company, contact.role, contact.met_where]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </article>
            ))}
        </div>

        {state.status === "ready" && state.contacts.length > 0 && (
          <p className="px-5 py-3 text-[0.6875rem] text-[var(--ink-faint)]">
            {state.contacts.length} {state.contacts.length === 1 ? "person" : "people"}
          </p>
        )}
      </div>
    </main>
  );
}

/** Priority is ordinal, so it is encoded as a varying quantity of one thing. */
function spineHeight(priority: Contact["priority"]): string {
  return priority === "high" ? "100%" : priority === "medium" ? "46%" : "14%";
}

/** Skeleton rows carry the geometry of a real row so nothing reflows when data lands. */
function LoadingRows() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your table…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-b border-[var(--hairline)] px-5 py-3.5 last:border-b-0">
          <div className="ml-3 h-[1.0625rem] w-40 animate-pulse rounded bg-[var(--sunken)]" />
          <div className="mt-1.5 ml-3 h-[0.8125rem] w-64 animate-pulse rounded bg-[var(--sunken)]" />
        </div>
      ))}
    </div>
  );
}
