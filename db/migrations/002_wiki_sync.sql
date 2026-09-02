-- Strada — optional wiki sync support.
--
-- Additive and nullable. The ten columns the assignment specifies are untouched: this
-- migration only adds the bookkeeping an optional local sync needs, and the app works
-- exactly as before if the sync is never run.
--
-- No new policies. The four per-verb policies from 001 already cover every column of
-- this table, and FORCE ROW LEVEL SECURITY still applies, so these columns are subject
-- to the same ownership rule as everything else.
--
-- Deliberately NOT a second table: a foreign key to `contacts` would open a PostgREST
-- resource-embedding path (`select=*,wiki_links(*)`). Columns add no such surface.

-- Which wiki entity this contact came from, e.g. "rosa-delgado". Null for contacts
-- created by hand in the app, which is the normal case.
alter table contacts add column if not exists wiki_slug text;

-- Field names a human edited in the app. Sync must never overwrite a field listed here.
--
-- Without this, an automated pass silently reverts hand-written notes — the failure
-- mode that bit the Rubrica OCR wiring, where an automated result clobbered operator
-- corrections and the fix was exactly this per-field flag.
alter table contacts add column if not exists operator_set text[] not null default '{}';

-- When sync last touched this row. Drives the "synced 2 hours ago" line in the UI.
alter table contacts add column if not exists wiki_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_wiki_slug_len'
  ) then
    alter table contacts
      add constraint contacts_wiki_slug_len check (length(wiki_slug) <= 200);
  end if;
end
$$;

-- One contact per wiki entity, per user.
--
-- Scoped to user_id, so a uniqueness violation can only ever reveal something about the
-- caller's OWN rows. That is the distinction that made a sequential integer primary key
-- unacceptable in 001: a globally unique client-suppliable key leaks cross-user row
-- existence through constraint errors, which are raised outside RLS. This one does not.
create unique index if not exists contacts_user_wiki_slug_idx
  on contacts (user_id, wiki_slug)
  where wiki_slug is not null;

-- Sync looks rows up by slug on every run.
create index if not exists contacts_wiki_slug_lookup_idx
  on contacts (user_id, wiki_slug);
