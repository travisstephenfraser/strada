import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

/**
 * Where the sync password comes from.
 *
 * Three sources, in order, and the ordering is the point: the convenient one is also
 * the safest, and the plaintext one is last and loud.
 *
 *   1. macOS Keychain  — encrypted at rest, unlocked with the login session
 *   2. an interactive prompt — nothing is stored at all
 *   3. STRADA_SYNC_PASSWORD — plaintext on disk; supported for automation, warned about
 *
 * A sync password is a real account credential: it can read and change every contact
 * the account owns. Keeping it out of a dotfile costs one keychain entry.
 */

const KEYCHAIN_SERVICE = "strada-sync";

export function readKeychain(account: string): string | null {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).replace(/\n$/, "");
  } catch {
    // Not found, or not macOS. Both mean "try the next source".
    return null;
  }
}

/** Store a password in the login keychain, replacing any existing entry. */
export function writeKeychain(account: string, password: string): void {
  execFileSync(
    "security",
    ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", password],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Suppress echo so the password is not left on screen or in a scrollback buffer.
  const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown };
  const write = process.stdout.write.bind(process.stdout);
  let muted = false;
  (process.stdout as unknown as { write: typeof write }).write = ((chunk: string, ...rest: unknown[]) =>
    muted ? true : write(chunk, ...(rest as []))) as typeof write;

  const answer = rl.question(question);
  muted = true;
  const value = await answer;
  muted = false;
  (process.stdout as unknown as { write: typeof write }).write = write;
  void output;
  rl.close();
  process.stdout.write("\n");
  return value.trim();
}

export interface ResolvedCredentials {
  email: string;
  password: string;
  source: "keychain" | "prompt" | "environment";
}

export async function resolvePassword(email: string): Promise<ResolvedCredentials> {
  const fromKeychain = readKeychain(email);
  if (fromKeychain) return { email, password: fromKeychain, source: "keychain" };

  const fromEnv = process.env.STRADA_SYNC_PASSWORD;
  if (fromEnv) {
    console.warn(
      "  ! Using STRADA_SYNC_PASSWORD from the environment. That is a real account\n" +
        "    password sitting in plaintext on disk. Run `npm run sync:login` to move it\n" +
        "    into the keychain and delete the line from .env.local.\n",
    );
    return { email, password: fromEnv, source: "environment" };
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      `No password for ${email}. Run \`npm run sync:login\` once to store it in the ` +
        `macOS keychain, or set STRADA_SYNC_PASSWORD for non-interactive use.`,
    );
  }

  const password = await promptHidden(`Password for ${email}: `);
  if (!password) throw new Error("No password entered.");
  return { email, password, source: "prompt" };
}
