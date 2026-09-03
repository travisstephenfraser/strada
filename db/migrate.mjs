#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in filename order, once each.
 *
 * Deliberately uses `pg` rather than `psql` so the project has no system dependency:
 * `npm run migrate` works on any machine that can run the app.
 *
 * DATABASE_URL is read from the environment or from .env.local at the repo root. It is
 * used HERE ONLY. It is never added to either Vercel project and the deployed code never
 * reads it — ownership is enforced by RLS against the end user's own JWT, not by a
 * privileged connection.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const migrationsDir = join(here, "migrations");

function loadEnvLocal() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

// Prefer the unpooled endpoint for DDL: PgBouncer transaction pooling and multi-
// statement DDL transactions do not mix reliably. Falls back to the pooled URL.
const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "\n  DATABASE_URL is not set.\n" +
      "  Copy .env.example to .env.local and paste your Neon connection string.\n" +
      "  (.env.local is gitignored; DATABASE_URL is used by migrations only.)\n",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  // The migration ledger lives OUTSIDE `public` on purpose.
  //
  // Enabling the Neon Data API installs `ALTER DEFAULT PRIVILEGES IN SCHEMA public
  // GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated`, so *every* table
  // created in `public` is fully writable by every signed-in user unless RLS says
  // otherwise. A bookkeeping table is not something to defend with policies — it
  // should not be reachable from the API at all, and only `public` is exposed.
  await client.query("create schema if not exists strada_meta");
  await client.query(`
    create table if not exists strada_meta.schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query("revoke all on schema strada_meta from public");
  await client.query("revoke all on all tables in schema strada_meta from public");

  // One-time move of a ledger created by an earlier version of this script.
  await client.query(`
    do $$
    begin
      if to_regclass('public.schema_migrations') is not null then
        insert into strada_meta.schema_migrations (filename, applied_at)
          select filename, applied_at from public.schema_migrations
          on conflict (filename) do nothing;
        drop table public.schema_migrations;
      end if;
    end
    $$;
  `);

  const { rows } = await client.query(
    "select filename from strada_meta.schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.filename));

  const pending = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("Up to date — no pending migrations.");
  }

  for (const filename of pending) {
    const sql = readFileSync(join(migrationsDir, filename), "utf8");
    process.stdout.write(`Applying ${filename} ... `);
    // Each migration is one transaction: a failure leaves nothing half-applied.
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into strada_meta.schema_migrations (filename) values ($1)",
        [filename],
      );
      await client.query("commit");
      console.log("ok");
    } catch (error) {
      await client.query("rollback");
      console.log("FAILED");
      throw error;
    }
  }

  if (pending.length > 0) {
    console.log(
      "\n  Done. Now refresh the Data API schema cache:\n" +
        "    neon data-api refresh-schema --project-id <id> --branch <branch> --database <db>\n" +
        "  (or Neon Console -> your project -> Data API -> Refresh schema cache)\n" +
        "\n  Do NOT skip this after a migration that DROPS or RENAMES a column.\n" +
        "  PostgREST caches the column list and keeps SELECTing the old one, so live\n" +
        "  reads fail with 42703 until the cache is refreshed. `notify pgrst,\n" +
        "  'reload schema'` is not a reliable substitute — it reached only some\n" +
        "  instances and reads flapped between 200 and 502 for several minutes.\n" +
        "  Until you do, PostgREST answers PGRST205 'table not found'.\n",
    );
  }
} catch (error) {
  console.error(`\nMigration failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
