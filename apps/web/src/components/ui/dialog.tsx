import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-[rgb(11_26_35_/_0.45)]",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          // Overlays are the only things that float; the list and its controls never do.
          "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[560px]",
          "-translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-[var(--hairline)]",
          "bg-[var(--plate)] p-6 shadow-[var(--shadow-overlay)]",
          "max-h-[calc(100dvh-2rem)] overflow-y-auto",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute top-5 right-5 rounded-md p-1 text-[var(--ink-faint)] transition-colors hover:bg-[var(--sunken)] hover:text-[var(--ink)]"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[1.25rem] leading-tight font-semibold text-[var(--ink)]", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[0.9375rem] text-[var(--ink-soft)]", className)}
      {...props}
    />
  );
}
