import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { PRIORITIES, type Priority } from "@strada/shared";
import { cn } from "@/lib/utils";
import { SPINE_HEIGHT } from "@/lib/priority";

/**
 * The picker renders the real spine marks, at the real proportions.
 *
 * Choosing a priority is the one moment the encoding can be taught for free, which is
 * why no legend appears anywhere else in the product.
 */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (next: Priority) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as Priority)}
      className="grid grid-cols-3 overflow-hidden rounded-md border border-[var(--hairline-strong)]"
    >
      {PRIORITIES.map((priority) => (
        <ToggleGroup.Item
          key={priority}
          value={priority}
          className={cn(
            "relative flex h-11 items-center justify-center gap-2.5 text-[0.8125rem] capitalize",
            "border-r border-[var(--hairline)] last:border-r-0",
            "transition-colors duration-[140ms] outline-none",
            "text-[var(--ink-soft)] hover:bg-[var(--sunken)]",
            "focus-visible:ring-2 focus-visible:ring-[var(--bay)]/30 focus-visible:ring-inset",
            "data-[state=on]:bg-[var(--brass-wash)] data-[state=on]:text-[var(--brass-ink)]",
            "data-[state=on]:font-medium",
          )}
        >
          <span
            aria-hidden="true"
            className="w-[3px] rounded-full bg-[var(--brass)]"
            style={{ height: `calc(${SPINE_HEIGHT[priority]} * 0.6)` }}
          />
          {priority}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
