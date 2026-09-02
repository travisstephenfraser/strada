import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md border bg-[var(--sunken)] px-3 text-[0.9375rem] text-[var(--ink)]",
        "border-[var(--hairline-strong)] placeholder:text-[var(--ink-faint)]",
        "transition-colors duration-[140ms] outline-none",
        "focus-visible:border-[var(--bay)] focus-visible:ring-2 focus-visible:ring-[var(--bay)]/20",
        // The red left edge borrows the priority spine idiom: the left edge of a thing
        // is where this app says what kind of thing it is.
        "aria-[invalid=true]:border-l-2 aria-[invalid=true]:border-[var(--invalid)]",
        "aria-[invalid=true]:bg-[var(--invalid-wash)]",
        className,
      )}
      {...props}
    />
  );
}
