import { useCallback, useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { Contact, ContactInput } from "@strada/shared";
import { authClient } from "@/lib/auth";
import { ApiError, contactsApi } from "@/lib/api";
import { applyView, readView, writeView, type View } from "@/lib/view";
import { Button } from "@/components/ui/button";
import { ContactForm } from "@/components/ContactForm";
import { ContactRow } from "@/components/ContactRow";
import { EmptyTable } from "@/components/EmptyTable";
import { ViewControls } from "@/components/ViewControls";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; contacts: Contact[] }
  | { status: "error"; message: string; code?: number };

export default function Contacts() {
  const { data: session } = authClient.useSession();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [view, setView] = useState<View>(() => readView(window.location.search));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);

  useEffect(() => writeView(view), [view]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", contacts: await contactsApi.list() });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setState({
        status: "error",
        message: apiError?.message ?? "The server didn't respond.",
        code: apiError?.status,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const contacts = state.status === "ready" ? state.contacts : [];
  const visible = useMemo(() => applyView(contacts, view), [contacts, view]);
  const highCount = contacts.filter((c) => c.priority === "high").length;
  const wikiCount = contacts.filter((c) => c.wiki_slug).length;
  const lastSynced = contacts
    .map((c) => c.wiki_synced_at)
    .filter((t): t is string => Boolean(t))
    .toSorted()
    .at(-1);
  const isFiltered = view.q.trim() !== "" || view.priority !== "all";

  async function handleSubmit(input: ContactInput) {
    if (editing) {
      const updated = await contactsApi.update(editing.id, input);
      setState({
        status: "ready",
        contacts: contacts.map((c) => (c.id === updated.id ? updated : c)),
      });
      toast.success("Saved.");
    } else {
      const created = await contactsApi.create(input);
      setState({ status: "ready", contacts: [created, ...contacts] });
      toast.success(`Added ${created.name}.`);
    }
  }

  async function confirmRemove() {
    const target = removing;
    if (!target) return;
    setRemoving(null);
    try {
      const deleted = await contactsApi.remove(target.id);
      setState({
        status: "ready",
        contacts: contacts.filter((c) => c.id !== target.id),
      });
      toast(`Removed ${deleted.name}.`, {
        // Long enough to actually reach. The confirmation promises "a few seconds to
        // undo", and undo is the whole reason the Remove button is ink rather than red
        // — so the default toast duration is too short to keep that promise.
        duration: 9000,
        action: {
          label: "Undo",
          // Re-creating gives the row a new id, which is honest and stated in the
          // README's limitations rather than hidden.
          onClick: () => {
            void contactsApi
              .create({
                name: deleted.name,
                company: deleted.company,
                role: deleted.role,
                met_where: deleted.met_where,
                notes: deleted.notes,
                priority: deleted.priority,
              })
              .then((restored) =>
                setState((s) =>
                  s.status === "ready"
                    ? { status: "ready", contacts: [restored, ...s.contacts] }
                    : s,
                ),
              )
              .catch(() => toast.error("Could not undo that."));
          },
        },
      });
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not remove that person.",
      );
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--fog)] px-5 py-8 sm:py-10">
      <div className="mx-auto max-w-[880px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
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
            {/* Adding is a page-level action, so it sits above the table rather than
                in the control line — which keeps the list's chrome to one row. */}
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add person
            </Button>
          </div>
        </header>

        <div className="overflow-hidden rounded-[14px] border border-[var(--hairline)] bg-[var(--plate)]">
          {(state.status === "ready" && contacts.length > 0) ||
          state.status === "loading" ? (
            <ViewControls
              view={view}
              onChange={setView}
              disabled={state.status === "loading"}
            />
          ) : null}

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
                <span className="text-[0.6875rem] text-[var(--ink-faint)]">
                  {state.code ?? "network"} · {new Date().toLocaleTimeString()}
                </span>
              </div>
            </div>
          )}

          {state.status === "ready" && contacts.length === 0 && (
            <EmptyTable
              onAdd={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            />
          )}

          {/* Filtered-to-nothing is a different state from an empty table, and must
              not reuse the empty state's copy. */}
          {state.status === "ready" && contacts.length > 0 && visible.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-[0.9375rem] text-[var(--ink)]">
                No one matches that search.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setView({ ...view, q: "", priority: "all" })}
              >
                Clear filters
              </Button>
            </div>
          )}

          {state.status === "ready" &&
            visible.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                onEdit={(c) => {
                  setEditing(c);
                  setFormOpen(true);
                }}
                onRemove={setRemoving}
              />
            ))}

          {state.status === "ready" && contacts.length > 0 && (
            <p className="px-5 py-3 text-[0.6875rem] text-[var(--ink-faint)]">
              {isFiltered
                ? `Showing ${visible.length} of ${contacts.length}`
                : `${contacts.length} ${contacts.length === 1 ? "person" : "people"}`}
              {highCount > 0 && ` · ${highCount} high`}
              {/* State only. The sync itself runs locally, because the vault lives on
                  a laptop and this app does not — see the README. */}
              {wikiCount > 0 && (
                <>
                  {` · ${wikiCount} from your wiki`}
                  {lastSynced && ` · synced ${relativeTime(lastSynced)}`}
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSubmit={handleSubmit}
      />

      <AlertDialog.Root
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-[rgb(11_26_35_/_0.45)]" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-[var(--hairline)] bg-[var(--plate)] p-6 shadow-[var(--shadow-overlay)]">
            <AlertDialog.Title className="text-[1.25rem] leading-snug font-semibold text-[var(--ink)]">
              Remove{" "}
              <span className="font-serif font-medium">{removing?.name}</span> from
              your table?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--ink-soft)]">
              This deletes the note you kept about them. You'll have a few seconds to
              undo.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                {/* Ink, not red. Removing someone from your own private list is
                    tidying, not an error, and red stays reserved for invalid input
                    so the two are never confusable on one screen. */}
                <Button variant="firm" onClick={() => void confirmRemove()}>
                  Remove
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--plate)",
            color: "var(--ink)",
            border: "1px solid var(--hairline)",
            boxShadow: "var(--shadow-toast)",
          },
        }}
      />
    </main>
  );
}

/** "2 hours ago", without pulling in a date library for one line. */
function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Skeletons carry the geometry of a real row so nothing reflows when data lands. */
function LoadingRows() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your table…</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border-b border-[var(--hairline)] px-5 py-3.5 last:border-b-0"
        >
          <div className="ml-3 h-[1.0625rem] w-40 animate-pulse rounded bg-[var(--sunken)]" />
          <div className="mt-1.5 ml-3 h-[0.8125rem] w-64 animate-pulse rounded bg-[var(--sunken)]" />
        </div>
      ))}
    </div>
  );
}
