import { useEffect, useState, type FormEvent } from "react";
import {
  contactInputSchema,
  fieldErrors,
  type Contact,
  type ContactInput,
  type Priority,
} from "@strada/shared";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PriorityPicker } from "@/components/ui/priority-picker";

interface Draft {
  name: string;
  company: string;
  role: string;
  met_where: string;
  notes: string;
  priority: Priority;
}

const EMPTY: Draft = {
  name: "",
  company: "",
  role: "",
  met_where: "",
  notes: "",
  priority: "medium",
};

function draftFrom(contact: Contact | null): Draft {
  if (!contact) return EMPTY;
  return {
    name: contact.name,
    company: contact.company ?? "",
    role: contact.role ?? "",
    met_where: contact.met_where ?? "",
    notes: contact.notes ?? "",
    priority: contact.priority,
  };
}

export function ContactForm({
  open,
  onOpenChange,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means "add someone"; a contact means "edit them". */
  editing: Contact | null;
  onSubmit: (input: ContactInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(editing));
      setErrors({});
      setFormError(null);
    }
  }, [open, editing]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    // The same schema the API validates with, so a rejection here and a rejection
    // there carry the identical message.
    const parsed = contactInputSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});

    setBusy(true);
    try {
      await onSubmit(parsed.data);
      onOpenChange(false);
    } catch (error) {
      // A 400 from the server lands on the field, never in a toast: the API returns
      // per-field messages, so a server rejection appears on the same pixel a client
      // rejection would have.
      if (error instanceof ApiError && error.fields) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError(
          error instanceof Error ? error.message : "That could not be saved.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const isEdit = editing !== null;

  /**
   * A contact that came from the wiki has a read-only layer. The inputs are disabled
   * rather than hidden: seeing the value and being told where it comes from explains
   * the model, where an absent field would just look like a missing feature.
   *
   * Disabling is a courtesy, not the guarantee. The API refuses a changed wiki field
   * with a 403, and a database trigger refuses it under that.
   */
  const fromWiki = Boolean(editing?.wiki_slug);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {isEdit ? (
            <>
              Edit <span className="font-serif font-medium">{editing.name}</span>
            </>
          ) : (
            "Add someone"
          )}
        </DialogTitle>

        <form onSubmit={handleSubmit} noValidate className="mt-5 grid gap-4">
          <Field id="name" label="Name" error={errors.name}>
            <Input
              id="name"
              value={draft.name}
              autoFocus
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "name-error" : undefined}
              onChange={(e) => set("name", e.target.value)}
              disabled={fromWiki}
              // The one serif input in the app: it makes this feel like writing a name
              // rather than filling a field, and keeps "serif means proper noun" true.
              className="font-serif text-[1.25rem]"
            />
          </Field>

          {fromWiki && (
            <p className="-mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-faint)]">
              Name, company, role and where you met come from your wiki page{" "}
              <span className="text-[var(--brass-ink)]">{editing!.wiki_slug}</span> and
              are refreshed on every sync. Edit the page to change them. Your notes and
              priority below are yours; sync never touches them.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="company" label="Company" error={errors.company}>
              <Input
                id="company"
                value={draft.company}
                aria-invalid={Boolean(errors.company)}
                onChange={(e) => set("company", e.target.value)}
                disabled={fromWiki}
              />
            </Field>
            <Field id="role" label="Role" error={errors.role}>
              <Input
                id="role"
                value={draft.role}
                aria-invalid={Boolean(errors.role)}
                onChange={(e) => set("role", e.target.value)}
                disabled={fromWiki}
              />
            </Field>
          </div>

          <Field id="met_where" label="Where you met" error={errors.met_where}>
            <Input
              id="met_where"
              value={draft.met_where}
              placeholder="Caffè Strada, after the Haas fireside"
              aria-invalid={Boolean(errors.met_where)}
              onChange={(e) => set("met_where", e.target.value)}
              disabled={fromWiki}
            />
          </Field>

          <Field
            id="priority"
            label="Priority"
            hint="how close you want to stay in touch"
            error={errors.priority}
          >
            <PriorityPicker
              value={draft.priority}
              onChange={(priority) => set("priority", priority)}
            />
          </Field>

          <Field id="notes" label="Notes" error={errors.notes}>
            <Textarea
              id="notes"
              value={draft.notes}
              placeholder="What you want to talk about next time."
              aria-invalid={Boolean(errors.notes)}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          {formError && (
            <p
              role="alert"
              className="border-l-2 border-[var(--invalid)] bg-[var(--invalid-wash)] py-2 pl-3 text-[0.8125rem] text-[var(--invalid)]"
            >
              {formError}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2 border-t border-[var(--hairline)] pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save changes" : "Add person"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
