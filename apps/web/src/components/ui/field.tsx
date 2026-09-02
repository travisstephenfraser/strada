import type { ReactNode } from "react";
import { Label } from "./label";

/**
 * One labelled input plus its error message.
 *
 * A server 400 lands here, on the field, not in a toast: the API returns per-field
 * messages and the form maps them onto the same pixel a client-side rejection would
 * use, so the two are indistinguishable to the person typing.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hint && <span className="text-[0.6875rem] text-[var(--ink-faint)]">{hint}</span>}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[0.8125rem] text-[var(--invalid)]">
          {error}
        </p>
      )}
    </div>
  );
}
