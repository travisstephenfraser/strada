# Strada

**A private record of the people you want to stay close to at Berkeley.**

Strada is a networking tracker built around one idea: a list of people should not be a
to-do list. Most contact trackers are guilt machines — *last contacted 94 days ago*,
three overdue, a streak you broke — which is why people open them twice and never again.
Strada is named for the café where you actually met these people, and it behaves like a
record rather than a queue: no time-decay, no overdue states, no streaks. You add
someone, you write down where you met and what you want to talk about, and the list is
still there being pleasant when you come back. Every contact is private to its owner, and
that privacy is enforced by Postgres row-level security rather than by application code.

> **Status: in progress.** Phase 0 (scaffold, tests, CI, deploy skeleton) is complete.
> Sections marked _pending_ are filled in as the phases land.

- **Live app:** _pending — Phase 6_
- **CI:** _pending — badge added with the first push_

---

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Technology stack and why](#technology-stack-and-why)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [Authentication and RLS ownership](#authentication-and-rls-ownership)
- [Secrets: publishable versus server-only](#secrets-publishable-versus-server-only)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Tests](#tests)
- [Grading evidence](#grading-evidence)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

---

## Features

- Email sign-up, sign-in, and sign-out via Neon Managed Better Auth
- A private contact list per user — name, company, role, where you met, notes, priority
- Create, view, edit, and delete contacts; data persists in Neon Postgres and survives refresh
- Sort by name, company, priority, or recently added; filter by priority; search across all text
- Priority accepts only `high`, `medium`, or `low`, enforced in the database
- Loading, empty, error, and success states, all distinct and legible
- Responsive: a single-column list on desktop, a touch-sized card list on phones
- Light and dark themes

_Detail and screenshots: pending Phase 4._

## Screenshots

_Pending Phase 4-6: sign-in/sign-out, create/edit/delete/refresh, the two-account privacy
test, and one invalid input failing safely._

---

## Technology stack and why

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript | Separate deployable from the backend, as required. Vite over Next.js because this is a client-rendered private app with no SEO or SSR need — the Next.js runtime would be weight with no payoff. |
| Styling | Tailwind CSS v4 + Radix UI primitives | A real design system with tokens rather than ad-hoc classes. Radix supplies accessible dialog, toggle, and menu behaviour so keyboard and screen-reader support is not hand-rolled. |
| Backend | Express 5 + TypeScript (ESM) | A small, explicit HTTP layer. Deployed as its own Vercel project so the frontend/backend separation is physical, not just a folder convention. |
| Validation | Zod, in a shared workspace package | One schema imported by both the API and the browser form, so the client and server cannot drift apart on what counts as valid. |
| Database | Neon Postgres | Real Postgres, so RLS, CHECK constraints, and triggers do the enforcement work. |
| Auth | Neon Managed Better Auth | Issues the Ed25519 JWT whose `sub` claim RLS reads through `auth.user_id()`. |
| Data access | Neon Data API (PostgREST) | Reached with the end user's own token, which is what allows the API server to hold no privileged database credential at all. |
| Hosting | Vercel (two projects, one repo) | Separate build, separate environment variables, one repository to submit. |
| Tests | Vitest + Supertest | Fast hermetic suite plus a live two-account RLS proof. |

---

## Architecture

```
┌─ apps/web ─ React + Vite ──────────────────┐   Vercel project A (static)
│  Neon Auth SDK: sign in / out, session     │   public env only
│  fresh token per request                   │   never talks to the Data API directly
│  all CRUD → apps/api                       │
└────────────┬───────────────────────────────┘
             │  Authorization: Bearer <user's JWT>
             ▼
┌─ apps/api ─ Express 5 ─────────────────────┐   Vercel project B
│  CORS → JWT verify (JWKS) → Zod validate   │   server-only env
│  builds every upstream request itself      │   no Postgres driver, no DATABASE_URL
└────────────┬───────────────────────────────┘
             │  the SAME user token, forwarded
             ▼
      Neon Data API (PostgREST)
             │  RLS: auth.user_id() = user_id     ← ownership is enforced HERE
             ▼
         Neon Postgres                            ← CHECK constraints
```

**Request flow for "add a contact":** the browser asks the Neon Auth SDK for a current
token, and `POST /api/contacts` carries it. Express checks the signature against Neon's
JWKS, parses the body with the shared Zod schema (rejecting with a 400 and field-level
messages if it fails), strips any client-supplied `id`, `user_id`, or timestamp, sets
`user_id` from the verified `sub`, and calls the Data API with the user's own token. RLS
evaluates the INSERT policy's `WITH CHECK`, and Postgres evaluates the CHECK constraints.
The written row comes back and is rendered.

### The design decision worth explaining

**The database, not the API server, enforces ownership. No component in the request path
holds a credential that bypasses RLS.**

The Express layer never connects to Postgres. It has no connection string and no Postgres
driver — `npm test` asserts both. It forwards the caller's own token, so every query it
makes is already scoped to that caller by RLS. Even a serious bug in the API — a missing
filter, a wrong id — cannot return another user's row, because the credential required to
do so does not exist anywhere in the deployment.

Being precise about what that does *not* claim, because overclaiming here would be worse
than not claiming it:

- **The API is not the security boundary, and is not intended to be.** The Data API is
  reachable by any signed-in user with their own token. Every control in Express is
  fail-fast and UX; the enforceable guarantees live in RLS and in CHECK constraints, which
  is why the input limits are stated in both places.
- **RLS bounds a request to the caller's own rows; it does not bound what they may do to
  those rows.** An unfiltered `DELETE` would wipe all of the caller's own contacts, so the
  API offers no route that accepts a filter from the client — ids come from path
  parameters and every upstream URL is built server-side.
- **`id` is a `uuid`, not a sequential integer.** Constraint checks run outside RLS, so a
  duplicate-key error on a client-chosen integer id would reveal that a row exists no
  matter who owns it, and probing a range would recover the global row census.

---

## Database schema

_Full column table and the RLS narrative: see [`db/migrations/001_contacts.sql`](db/migrations/001_contacts.sql), summarised here in Phase 6._

## Authentication and RLS ownership

_Pending Phase 2 — including the decoded-token evidence for which claims are pinned._

## Secrets: publishable versus server-only

_Pending Phase 6._

## Local setup

```bash
git clone <this repo>
cd assign1
npm install
cp .env.example .env.local     # fill in real values

npm run migrate                # applies db/migrations/*.sql
npm test                       # hermetic suite — no credentials needed

npm run dev:api                # http://localhost:3001
npm run dev:web                # http://localhost:5173
```

## Environment variables

Names and placeholders are in [`.env.example`](.env.example), which explains the
public / server-only / local-tooling split. No real values are committed.

## Tests

```bash
npm test           # hermetic: schema, routes, and architectural invariants
npm run test:rls   # live two-account RLS proof (needs two test accounts)
```

`npm test` needs no credentials and no database, so it runs immediately after a clone.
The two-account proof is a **separate command on purpose**: it needs real accounts, and a
security test that silently skips is worse than no test, because its skip prints as a
pass. `test:rls` fails loudly when its configuration is missing rather than reporting
green.

_Output pasted in Phase 5-6._

## Grading evidence

_Pending Phases 4-6._

## Deployment

_Pending Phase 6._

## Known limitations

_Pending Phase 6._
