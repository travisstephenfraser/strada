import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-md border bg-[var(--sunken)] px-3 py-2",
        "text-[0.9375rem] leading-relaxed text-[var(--ink)]",
        "border-[var(--hairline-strong)] placeholder:text-[var(--ink-faint)]",
        "transition-colors duration-[140ms] outline-none",
        "focus-visible:border-[var(--bay)] focus-visible:ring-2 focus-visible:ring-[var(--bay)]/20",
        "aria-[invalid=true]:border-l-2 aria-[invalid=true]:border-[var(--invalid)]",
        "aria-[invalid=true]:bg-[var(--invalid-wash)]",
        className,
      )}
      {...props}
    />
  );
}
