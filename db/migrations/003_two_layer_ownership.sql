-- Strada — two layers of ownership, instead of one column with two owners.
--
-- Before this migration, sync wrote the wiki's extracted line into `notes` and the app
-- also edited `notes`. Two writers on one column needs an arbitrator, so 002 added
-- `operator_set`: a per-field claim list sync consulted before every write, plus a
-- `reclaim` endpoint to release a claim, plus a `protected` section in the run report to
-- announce refusals.
--
-- That machinery managed a collision. This migration removes the collision:
--
--   wiki layer      name, company, role, met_where, bio   — sync writes, app cannot
--   operator layer  notes, priority                       — app writes, sync cannot
--
-- The lesson `operator_set` encoded is kept, not discarded. Automation must never
-- clobber what a human wrote (the Rubrica OCR incident, where an automated result
-- overwrote operator corrections). It is now guaranteed by which columns each party can
-- write, rather than by a rule sync has to remember to consult.

-- ---------------------------------------------------------------------------
-- 1. The wiki's narrative gets its own column
-- ---------------------------------------------------------------------------

alter table contacts add column if not exists bio text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_bio_len') then
    alter table contacts add constraint contacts_bio_len check (length(bio) <= 2000);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Move the extracted text out of the operator's column
-- ---------------------------------------------------------------------------
--
-- One-way, so it is guarded three ways rather than trusted:
--   * only rows that came from the wiki (`wiki_slug is not null`)
--   * only where `bio` is still empty, so a re-run cannot overwrite a real bio
--   * only where `notes` has something to move, so nothing is nulled for free
--
-- A hand-made contact is untouched: it has no wiki layer, and its notes are its own.

do $$
declare
  moved integer;
begin
  with promoted as (
    update contacts
       set bio = notes, notes = null
     where wiki_slug is not null
       and bio is null
       and notes is not null
    returning 1
  )
  select count(*) into moved from promoted;
  raise notice 'migration 003: moved notes -> bio on % wiki-linked row(s)', moved;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Retire the arbitrator
-- ---------------------------------------------------------------------------
--
-- Announce any claim before dropping it. A claim on a now-operator-owned field (`notes`,
-- `priority`) loses nothing: those columns became unconditionally the operator's. A
-- claim on a now-wiki-owned field DOES change behaviour — that field starts being
-- refreshed on the next run — so it is printed rather than assumed absent.

do $$
declare
  claim record;
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'contacts' and column_name = 'operator_set'
  ) then
    for claim in
      select name, operator_set from contacts
       where operator_set is not null and cardinality(operator_set) > 0
    loop
      raise notice 'migration 003: dropping claim on % -> %', claim.name, claim.operator_set;
    end loop;
  end if;
end
$$;

alter table contacts drop column if exists operator_set;

-- ---------------------------------------------------------------------------
-- 4. The lock
-- ---------------------------------------------------------------------------
--
-- WHAT THIS IS: a correctness guarantee. It makes the two layers real rather than a
-- convention the application remembers, and it catches the bug where a UI change starts
-- sending a wiki-owned field on an ordinary edit.
--
-- WHAT THIS IS NOT: a security boundary, and it cannot be one. Sync and the app reach
-- this table through the same Data API with the same end-user JWT, so the database has
-- no way to tell them apart by role. The only thing distinguishing them is that sync
-- stamps `wiki_synced_at` and the app never does — and a client holding its own token
-- can set that column itself. RLS defends a row against OTHER users, which is a
-- different and much stronger claim; this defends a row's structure against its own
-- application's bugs. The README says so in those words.
--
-- The comparison is IS DISTINCT FROM, not a presence check. The edit form submits every
-- field, so an ordinary edit of a wiki-linked contact necessarily restates `name`,
-- `company`, `role` and `met_where`. Rejecting a restatement would reject every edit;
-- only an actual change is refused.

create or replace function reject_wiki_field_edit() returns trigger
  language plpgsql
as $$
declare
  synced boolean := new.wiki_synced_at is distinct from old.wiki_synced_at;
  changed text[] := '{}';
begin
  -- Only wiki-linked rows have a wiki layer. A hand-made contact is fully the
  -- operator's, which is the path the assignment's CRUD requirements exercise.
  if old.wiki_slug is null then
    return new;
  end if;

  -- array_append, not `||`: `text[] || 'name'` makes Postgres parse the right operand as
  -- an array literal and fail with "malformed array literal". That error still aborts
  -- the UPDATE, so a test asserting only "this throws" goes green on a trigger that is
  -- broken. The live test asserts on the sqlstate and the message for that reason.
  if new.name      is distinct from old.name      then changed := array_append(changed, 'name');      end if;
  if new.company   is distinct from old.company   then changed := array_append(changed, 'company');   end if;
  if new.role      is distinct from old.role      then changed := array_append(changed, 'role');      end if;
  if new.met_where is distinct from old.met_where then changed := array_append(changed, 'met_where'); end if;
  if new.bio       is distinct from old.bio       then changed := array_append(changed, 'bio');       end if;

  if cardinality(changed) > 0 and not synced then
    raise exception
      'wiki-owned field(s) % cannot be edited here; they come from wiki page "%"',
      array_to_string(changed, ', '), old.wiki_slug
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists contacts_reject_wiki_field_edit on contacts;
create trigger contacts_reject_wiki_field_edit
  before update on contacts
  for each row execute function reject_wiki_field_edit();
