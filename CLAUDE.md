# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                    # 121 hermetic tests. No credentials, no network, no database
npm run test:rls            # 22 live tests. Needs two real accounts; FAILS (never skips) if unset
npm run build               # workspaces, in order: shared -> web -> api
npm run check:secrets       # run with the API's env loaded, or the value checks silently skip
npm run migrate             # applies db/migrations/*.sql in filename order, once each

npm run dev:api             # :3001
npm run dev:web             # :5177 (strictPort; 5173 is taken by another project)

npm run sync -- --dry-run   # wiki sync, reports without writing. Needs LM Studio loaded
npm run sync
npm run sync:login          # stores the sync password in the macOS keychain, once
```

Run a single test file or case:

```bash
npx vitest run packages/shared/tests/sync.test.ts
npx vitest run -t "refuses a changed wiki field"
npx vitest run --config vitest.rls.config.mts tests/rls/wiki-layer.test.ts
```

`packages/shared` has a `prepare` script, so its `dist/` exists after any install. Both
test scripts rebuild it first — a stale `dist/` there produces failures that do not
reproduce.

CI runs `npm test`, `npm run build`, and `npm run check:secrets` on every push. The live
suite is not in CI because it needs credentials.

## Architecture

```
apps/web        React 19 + Vite + TS + Tailwind v4   -> Vercel project A (static)
apps/api        Express 5 + TS (ESM)                 -> Vercel project B
apps/sync       local-only wiki sync CLI             -> NEVER deployed
packages/shared one Zod contract + the merge rule (pure, tested first)
db/migrations   001 contacts + RLS · 002 wiki columns · 003 two-layer ownership
```

Request path: browser → Express (CORS → JWT verify via JWKS → Zod) → Neon Data API
(PostgREST) → RLS → Postgres. Express builds every upstream URL itself and forwards only
`Authorization` and `Content-Type`.

### The constraint that shaped everything

**The database enforces ownership, not the API. No component in the request path holds a
credential that bypasses RLS.** Express has no connection string and no Postgres driver —
`apps/api/tests/secrets.invariant.test.ts` asserts both structurally, along with the
absence of server-only names in web sources and of any tracked `.env` but `.env.example`.

Consequences that are easy to undo by accident:

- **The API is fail-fast and UX, not the security boundary.** The Data API is reachable
  by any signed-in user with their own token, so RLS and the CHECK constraints are the
  enforceable guarantees. Input limits are therefore stated twice on purpose — in the Zod
  schema and in the migration — and must change together.
- **No route may accept a filter from a client.** Ids come from path parameters and every
  upstream URL is built server-side. RLS bounds a request to the caller's own rows; it
  does not stop an unfiltered `DELETE` from wiping all of them.
- **`id` is a `uuid`, not a sequential integer.** Constraint checks run outside RLS, so a
  client-chosen integer key leaks cross-user row existence through duplicate-key errors.
- **`FORCE ROW LEVEL SECURITY` is set.** Without it the table owner — the role a migration
  or `psql $DATABASE_URL` connects as — bypasses every policy.

### Two layers of field ownership (migration 003)

A contact linked to a wiki page has two halves with exactly one writer each:

| Layer | Fields | Written by |
|---|---|---|
| Wiki | `name`, `company`, `role`, `met_where`, `bio` | sync, every run |
| Operator | `notes`, `priority` | the app only |

`priority` is seeded on create and never re-asserted. A contact with no `wiki_slug` has no
wiki layer and is fully editable — that is the path the assignment's CRUD requirements
exercise, so regressions there matter.

**The rule is "no changes", not "no mentions".** The edit form submits every field, so an
ordinary edit of a wiki-linked contact restates `name`, `company`, `role`, `met_where`.
Rejecting a body that merely *mentions* a wiki field rejects every edit. Both enforcement
points compare values (`IS DISTINCT FROM`).

Enforced twice: `apps/api` returns a 403 naming the field; a `BEFORE UPDATE` trigger
refuses the write underneath. The trigger keys on `wiki_synced_at` advancing, which only
sync does. That is a **correctness guarantee, not a security boundary** — sync and the
browser carry the same token, so any token holder can set that column. `tests/rls/wiki-layer.test.ts`
ends with a test that performs the bypass and asserts it succeeds; if that test ever
fails, the guarantee changed and the README must change with it.

This replaced an `operator_set` per-field claim system. Do not reintroduce arbitration.

### Wiki sync (`apps/sync`, local only)

The vault is a directory on a laptop; Strada runs on Vercel, so a sync button is
impossible by construction. The CLI signs in as the same user and holds no privilege the
browser lacks.

- **The vault is read-only.** No writes, moves, or git operations — a write-back path is
  deliberately absent, not merely unused.
- **Only derived fields leave the machine.** Extraction runs on a local model via LM
  Studio; page text never leaves. A hosted model is not an option.
- **A `pii` source contributes a card, never a summary.** `bio` is the model's summary of
  sensitive prose, so `toRecord` drops it when `visibility === "pii"`. The identity fields
  still sync. Both visibility tags are otherwise included by default.
- **Discovery has three inputs**: `type: person` on an entity page, `type: self` (the
  vault owner — read, never synced), and `people: [...]` on any page, naming who that page
  is the *primary* source for. The vault folds people into the work they belong to, so
  most of the network has no entity page and never will.
- People slug as an entity page would (`Rosa Delgado` → `rosa-delgado`), so a later
  promotion updates the contact instead of duplicating it.

## Working in this repo

**Demo data is fictional, and screenshots are shot against the test account.** A
screenshot taken against the real vault put seven real people into a public repo. The
secret scanner passed throughout — it hunts credentials, and that was disclosure of other
people's data. Never point a screenshot, fixture, or example at real vault content.

**A migration that DROPS or RENAMES a column takes the live API down** until the Data API
schema cache is refreshed: PostgREST keeps naming the dropped column and Postgres answers
`42703`. Use `neon data-api refresh-schema`; `notify pgrst, 'reload schema'` is not a
reliable substitute. Order is **deploy code → migrate → refresh**.

**Guards must be proven able to fail.** Both are, and the numbers are in the README:
dropping the wiki trigger fails 6 of its 10 assertions; disabling RLS fails 8 of 12. When
adding a guard, break it deliberately and confirm the suite goes red — a guard that works
produces no event, so a passing suite is not evidence the test is attached to it. Assert
on the *identity* of a rejection (sqlstate, message), not merely that one occurred: an
early version of the 003 trigger raised `malformed array literal` and a weaker test passed
on a completely broken trigger.

**The README is the grading surface** and every count in it is real output. Changing test
counts, screenshots, or sync behaviour means updating `docs/test-output-*.txt` and the
figures quoted in the README in the same commit.

`feed/` is gitignored and holds the assignment brief and rubric. Course material stays out
of the public repo; `docs/HANDOFF-*.md` is the durable handoff.

## Note

An OpenAI Codex config exists at `~/.codex/config.toml`. Reply `/import` to scan and list
what is importable (MCP servers, slash commands, subagents, skills, instructions), then
`/import --yes=<digest>` to apply the user-level items. If `/import` is unavailable on
this surface, run `claude import` from a terminal.
