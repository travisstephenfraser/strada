import { PRIORITIES } from "@strada/shared";

/**
 * Phase 0 placeholder.
 *
 * It exists to prove the deploy pipeline end to end before any feature work: Tailwind v4
 * tokens resolve, the two variable fonts load, and — the one that actually bites on
 * Vercel — the `@strada/shared` workspace package resolves from a non-root root
 * directory. If this renders on the deployed URL, the monorepo wiring is sound.
 */
export default function App() {
  return (
    <main className="min-h-dvh bg-fog px-5 py-16">
      <div className="mx-auto max-w-[880px]">
        <h1 className="font-serif text-[2.5rem] leading-none font-medium text-ink">
          Strada
        </h1>
        <p className="mt-2 text-meta text-ink-faint">
          people you want to stay close to at Berkeley
        </p>

        <div className="mt-8 overflow-hidden rounded-[14px] border border-hairline bg-plate">
          {PRIORITIES.map((priority) => (
            <div
              key={priority}
              className="relative flex items-center justify-between border-b border-hairline px-5 py-3.5 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 w-[3px] rounded-full bg-brass"
                style={{
                  height:
                    priority === "high"
                      ? "100%"
                      : priority === "medium"
                        ? "46%"
                        : "14%",
                }}
              />
              <span className="pl-4 font-serif text-name text-ink">
                Priority spine, {priority}
              </span>
              <span className="eyebrow text-ink-faint">{priority}</span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-meta text-ink-soft">
          Phase 0 — scaffold deployed. Tokens, fonts and the shared validation package
          all resolve.
        </p>
      </div>
    </main>
  );
}
