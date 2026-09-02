#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { readKeychain, writeKeychain } from "./credentials.js";
import { signIn } from "./client.js";

/**
 * `npm run sync:login` — store the sync password in the macOS keychain, once.
 *
 * The password is verified against Neon Auth before it is stored, so a typo fails here
 * rather than silently at the next sync. It is never written to a file and never
 * printed.
 */
async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question("Strada email: ")).trim();
  rl.close();
  if (!email) throw new Error("No email entered.");

  const write = process.stdout.write.bind(process.stdout);
  const rl2 = createInterface({ input: process.stdin, output: process.stdout });
  let muted = false;
  (process.stdout as unknown as { write: typeof write }).write = ((c: string, ...r: unknown[]) =>
    muted ? true : write(c, ...(r as []))) as typeof write;
  const pending = rl2.question("Password (not echoed, not stored in any file): ");
  muted = true;
  const password = (await pending).trim();
  muted = false;
  (process.stdout as unknown as { write: typeof write }).write = write;
  rl2.close();
  process.stdout.write("\n");
  if (!password) throw new Error("No password entered.");

  const authUrl = process.env.NEON_AUTH_BASE_URL;
  if (!authUrl) throw new Error("NEON_AUTH_BASE_URL is not set.");

  process.stdout.write("Verifying with Neon Auth… ");
  await signIn({
    authUrl,
    apiUrl: process.env.STRADA_API_URL ?? "",
    email,
    password,
    origin: process.env.STRADA_SYNC_ORIGIN ?? "http://localhost:5177",
  });
  process.stdout.write("ok\n");

  writeKeychain(email, password);
  const stored = readKeychain(email);
  if (stored !== password) throw new Error("The keychain did not store the password.");

  console.log(`\nStored in the login keychain for ${email}.`);
  console.log(`Set STRADA_SYNC_EMAIL=${email} in .env.local, and delete any`);
  console.log("STRADA_SYNC_PASSWORD line — it is no longer needed.\n");
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
