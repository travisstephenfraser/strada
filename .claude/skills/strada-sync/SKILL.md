---
name: strada-sync
description: Sync Strada contacts from the Obsidian vault. Use when Travis says "strada sync", "sync my contacts", "update strada from the wiki", or asks to refresh the networking tracker from his notes.
---

# Strada wiki sync

Populate Strada from the vault's `entities/` pages. Local-only: it reads the vault on
this machine, extracts with a local model, and pushes derived fields to Strada's API.

## Run it

```bash
cd /Users/travis/Developer/pepeclass/assign1
npm run sync -- --dry-run   # report only, writes nothing
npm run sync                # apply
```

Useful flags: `--limit N` (try a few pages first), `--include-pii`,
`--exclude-internal`, `--model <id>`.

## First time only

```bash
npm run sync:login
```

Stores the password in the macOS keychain after verifying it. Never ask Travis to paste
a password into the chat, and never write one into `.env.local`.

## Before running

LM Studio must be running with a model loaded, or the CLI stops rather than writing a
degraded sync:

```bash
~/.lmstudio/bin/lms ps        # is a model loaded?
~/.lmstudio/bin/lms load gemma-4-31b-it-mlx --identifier strada-extract --yes
```

## Reading the report

Report every section back to Travis, not a total. `14 synced` is the flattering
failure this feature is prone to.

- **kept your edits ✋** — the wiki wanted to change a field he owns. Not an error;
  it is the safety rule working. If he wants the wiki to take that field back, the
  contact needs its claim cleared (`POST /api/contacts/:id/reclaim`).
- **excluded by visibility** — always name these. A silent exclusion is
  indistinguishable from a page that was never found.
- **skipped (not a person)** — expected for machines and projects in `entities/`.
- **no longer in the wiki** — kept, never deleted.
- **failed** — surface verbatim; the run exits non-zero.

## What this never does

Never writes to the vault. Never sends vault text anywhere: extraction is local, and
only derived fields (name, company, role, where met, priority, a generated talking
point) reach the database. If asked to push Strada edits *back* to the wiki, say that
path deliberately does not exist and would need its own design.
