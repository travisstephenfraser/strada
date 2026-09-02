import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Search } from "lucide-react";
import { PRIORITIES } from "@strada/shared";
import { cn } from "@/lib/utils";
import { SORTS, SORT_LABELS, type Sort, type View } from "@/lib/view";

/**
 * A caption line, not a toolbar.
 *
 * No container, no fill, no button chrome. Set at 11–13px against names at 17px in a
 * serif, so the people outweigh the controls by two full steps. There is exactly one
 * such line, and the count moves to a footer beneath the list — where a printed list
 * would put it, and one fewer thing above the content.
 */
export function ViewControls({
  view,
  onChange,
  disabled,
}: {
  view: View;
  onChange: (next: View) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--hairline)] px-5 py-3">
      <label className="flex min-w-40 flex-1 items-center gap-2">
        <Search className="size-3.5 shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
        <span className="sr-only">Search people</span>
        <input
          type="search"
          value={view.q}
          disabled={disabled}
          placeholder="Search people"
          onChange={(e) => onChange({ ...view, q: e.target.value })}
          className="w-full border-0 bg-transparent text-[0.8125rem] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
        />
      </label>

      {/* Four options is below the threshold where a dropdown earns its click, and
          showing the whole taxonomy inline teaches the encoding for free. */}
      <ToggleGroup.Root
        type="single"
        value={view.priority}
        disabled={disabled}
        onValueChange={(next) =>
          next && onChange({ ...view, priority: next as View["priority"] })
        }
        className="flex items-center gap-3"
        aria-label="Filter by priority"
      >
        {(["all", ...PRIORITIES] as const).map((option) => (
          <ToggleGroup.Item
            key={option}
            value={option}
            className={cn(
              "eyebrow border-b-2 border-transparent pb-0.5 transition-colors duration-[140ms]",
              "text-[var(--ink-faint)] hover:text-[var(--ink)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
              "data-[state=on]:border-[var(--brass)] data-[state=on]:text-[var(--ink)]",
            )}
          >
            {option}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      {/* The trigger states its own value, so it needs no separate label. */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={disabled}
          className="flex items-center gap-1 text-[0.8125rem] text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {SORT_LABELS[view.sort]}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-48 rounded-[10px] border border-[var(--hairline)] bg-[var(--popover)] p-1 shadow-[var(--shadow-overlay)]"
          >
            {SORTS.map((sort: Sort) => (
              <DropdownMenu.Item
                key={sort}
                onSelect={() => onChange({ ...view, sort })}
                className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-[0.8125rem] text-[var(--ink)] outline-none data-[highlighted]:bg-[var(--sunken)]"
              >
                {SORT_LABELS[sort]}
                {view.sort === sort && (
                  <Check className="size-3.5 text-[var(--bay)]" aria-hidden="true" />
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
