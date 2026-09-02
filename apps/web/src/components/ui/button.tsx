import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium " +
    "transition-colors duration-[140ms] ease-[var(--ease-strada)] " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Ink rather than red for destructive actions: removing someone from your own
        // list is tidying, not an error, and red stays reserved for invalid input.
        primary: "bg-[var(--bay)] text-[var(--primary-foreground)] hover:bg-[var(--bay-mid)]",
        firm: "bg-[var(--ink)] text-[var(--plate)] hover:opacity-90",
        ghost: "text-[var(--ink-soft)] hover:bg-[var(--sunken)] hover:text-[var(--ink)]",
        quiet: "text-[var(--bay)] hover:underline underline-offset-4",
      },
      size: {
        sm: "h-8 px-2.5 text-[0.8125rem]",
        md: "h-10 px-4 text-[0.875rem]",
        lg: "h-11 px-5 text-[0.9375rem] w-full",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof button> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(button({ variant, size }), className)} {...props} />;
}
