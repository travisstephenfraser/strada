#!/usr/bin/env node
import type { WikiRecord } from "@strada/shared";
import { DEFAULT_POLICY, applyVisibility, readEntities } from "./vault.js";
import { ExtractionError, extractOne, toRecord } from "./extract.js";
import { pushRecords, signIn, type StradaConfig } from "./client.js";
import { resolvePassword } from "./credentials.js";
import { renderReport } from "./report.js";

/**
 * `strada-sync` — read the vault, derive contacts, push them to Strada.
 *
 * Local-only. This never runs on Vercel: the vault is on this machine, and giving a
 * hosted server a path to it would invert the architecture the rest of the app defends.
 *
 * The vault is opened read-only. Nothing here writes, moves, or commits anything in it.
 */

interface Options {
  dryRun: boolean;
  includePii: boolean;
  includeInternal: boolean;
  limit: number | null;
  model: string;
}

function parseArgs(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };
  const limit = value("--limit");
  return {
    dryRun: has("--dry-run"),
    includePii: has("--include-pii"),
    includeInternal: !has("--exclude-internal"),
    limit: limit ? Number(limit) : null,
    model: value("--model") ?? process.env.STRADA_SYNC_MODEL ?? "gemma-4-31b-it-mlx",
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `\n  ${name} is not set.\n` +
        `  strada-sync reads it from .env.local at the repository root.\n` +
        `  See the README section "Wiki sync".\n`,
    );
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const vaultPath = required("STRADA_VAULT_PATH");
  const email = required("STRADA_SYNC_EMAIL");
  // Keychain first, then a prompt, then the environment. See credentials.ts.
  const { password, source } = await resolvePassword(email);
  const strada: StradaConfig = {
    authUrl: required("NEON_AUTH_BASE_URL"),
    apiUrl: required("STRADA_API_URL"),
    email,
    password,
    origin: process.env.STRADA_SYNC_ORIGIN ?? "http://localhost:5177",
  };
  console.log(`Signing in as ${email} (password from ${source}).`);
  const lmBaseUrl = process.env.STRADA_LMSTUDIO_URL ?? "http://localhost:1234/v1";

  console.log(`Reading ${vaultPath} (read-only)…`);
  const entities = readEntities(vaultPath);
  const { included, excluded } = applyVisibility(entities, {
    includePii: opts.includePii,
    includeInternal: opts.includeInternal,
  });

  const considered = opts.limit ? included.slice(0, opts.limit) : included;
  console.log(
    `  ${entities.length} entities · ${considered.length} to read · ` +
      `${excluded.length} excluded by visibility`,
  );
  console.log(`Extracting locally with ${opts.model} (nothing leaves this machine)…`);

  const records: WikiRecord[] = [];
  const skipped: { slug: string; reason: string }[] = [];

  for (const [i, entity] of considered.entries()) {
    process.stdout.write(`  [${i + 1}/${considered.length}] ${entity.slug} … `);
    try {
      const extraction = await extractOne(entity, {
        baseUrl: lmBaseUrl,
        model: opts.model,
      });
      const record = toRecord(entity, extraction);
      if (!record) {
        skipped.push({ slug: entity.slug, reason: "not a person" });
        console.log("not a person");
        continue;
      }
      records.push(record);
      console.log(`${record.name} (${record.priority})`);
    } catch (error) {
      if (error instanceof ExtractionError && /Cannot reach the local model/.test(error.message)) {
        // Unreachable model is fatal: continuing would write a partial sync that looks
        // like a complete one.
        console.log("unreachable");
        console.error(`\n${error.message}\n`);
        process.exit(1);
      }
      skipped.push({
        slug: entity.slug,
        reason: error instanceof Error ? error.message : String(error),
      });
      console.log("skipped");
    }
  }

  if (records.length === 0) {
    console.log("\nNothing to send.");
    console.log(renderReport(
      { dryRun: opts.dryRun, created: [], updated: [], unchanged: [], protected: [], orphaned: [], failed: [] },
      excluded,
      skipped,
    ));
    return;
  }

  console.log(`\nSending ${records.length} records to Strada…`);
  const token = await signIn(strada);
  const report = await pushRecords(token, records, opts.dryRun, strada);
  console.log(renderReport(report, excluded, skipped));

  if (report.failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

export { DEFAULT_POLICY };
