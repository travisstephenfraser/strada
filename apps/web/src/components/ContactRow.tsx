import { useState } from "react";
import type { Contact } from "@strada/shared";
import { cn } from "@/lib/utils";
import { SPINE_HEIGHT } from "@/lib/priority";
import { Button } from "@/components/ui/button";

/**
 * One person.
 *
 * Rows are hairline-separated articles, not cards and not table rows: twelve people is
 * a list, not tabular data, and giving each a card would put twelve floating surfaces
 * around the twelve most important pieces of text on the screen — their names.
 *
 * Actions stay hidden until hover, focus, or expansion, which is what keeps a short
 * list from reading as a toolbar farm.
 */
export function ContactRow({
  contact,
  onEdit,
  onRemove,
  ghost = false,
}: {
  contact: Contact;
  onEdit?: (contact: Contact) => void;
  onRemove?: (contact: Contact) => void;
  /** Phantom row for the empty state. Never real data. */
  ghost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = [contact.company, contact.role, contact.met_where]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1/2 left-0 w-[3px] -translate-y-1/2 rounded-full bg-[var(--brass)]",
          "transition-[width] duration-[140ms]",
          !ghost && "group-hover:w-[4px]",
          ghost && "opacity-35",
        )}
        style={{ height: SPINE_HEIGHT[contact.priority] }}
      />
      <div className="flex items-baseline justify-between gap-3 pl-3">
        <span
          className={cn(
            "truncate font-serif text-[1.0625rem] leading-tight tracking-[-0.005em]",
            ghost ? "text-[var(--ghost)]" : "text-[var(--ink)]",
          )}
        >
          {contact.name}
        </span>
        <span
          className={cn(
            "eyebrow shrink-0",
            ghost ? "text-[var(--ghost)]" : "text-[var(--ink-faint)]",
          )}
        >
          {contact.priority}
        </span>
      </div>
      {meta && (
        <p
          className={cn(
            "pl-3 text-[0.8125rem] leading-relaxed",
            ghost ? "text-[var(--ghost)]" : "text-[var(--ink-soft)]",
          )}
        >
          {meta}
        </p>
      )}
    </>
  );

  if (ghost) {
    return (
      <article
        aria-hidden="true"
        className="pointer-events-none relative border-b border-[var(--hairline)] px-5 py-3.5 select-none last:border-b-0"
      >
        {body}
      </article>
    );
  }

  return (
    <article className="group relative border-b border-[var(--hairline)] last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full cursor-pointer px-5 py-3.5 text-left transition-colors duration-[140ms] hover:bg-[var(--sunken)] focus-visible:bg-[var(--sunken)] focus-visible:outline-none"
      >
        {body}
      </button>

      {/* Actions appear on hover for a pointer, and on expand for everyone else. */}
      <div
        className={cn(
          "absolute top-3 right-5 flex items-center gap-1",
          "opacity-0 transition-opacity duration-[140ms]",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          open && "opacity-100",
        )}
      >
        <Button variant="ghost" size="sm" onClick={() => onEdit?.(contact)}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onRemove?.(contact)}>
          Remove
        </Button>
      </div>

      {open && (
        <div className="px-5 pb-4 pl-8">
          {contact.notes ? (
            <p className="max-w-[60ch] text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-[var(--ink-soft)]">
              {contact.notes}
            </p>
          ) : (
            <p className="text-[0.8125rem] text-[var(--ink-faint)]">No notes yet.</p>
          )}
        </div>
      )}
    </article>
  );
}
