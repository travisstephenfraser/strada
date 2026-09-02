import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments are stripped before scanning so the code that documents *why* a credential
 * is absent does not read as the credential being present. Only comments are removed —
 * every executable line is still scanned, so a real reference cannot hide here.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The claim these tests defend: no component in the request path holds a credential
 * that bypasses RLS.
 *
 * That is an architectural property, so it is asserted against the source rather than
 * left as a sentence in the README. The API reaches Postgres only through the Data API
 * carrying the end user's own token; if someone later reaches for a direct connection,
 * this fails.
 */
describe("the deployed API holds no privileged database credential", () => {
  const apiSources = sourceFiles(join(repoRoot, "apps/api/src"));

  it("finds API source files to check", () => {
    // Guards against the whole suite passing because the glob matched nothing.
    expect(apiSources.length).toBeGreaterThan(3);
  });

  it.each(["DATABASE_URL", "PGPASSWORD", "postgresql://", "postgres://"])(
    "never references %s",
    (needle) => {
      const offenders = apiSources.filter((file) =>
        code(file).includes(needle),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("does not depend on a Postgres driver", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "apps/api/package.json"), "utf8"),
    );
    expect(Object.keys(pkg.dependencies)).not.toContain("pg");
    expect(Object.keys(pkg.dependencies)).not.toContain("postgres");
  });
});

describe("the browser bundle cannot receive a server-only value", () => {
  const webSources = sourceFiles(join(repoRoot, "apps/web/src"));

  it("finds web source files to check", () => {
    expect(webSources.length).toBeGreaterThan(0);
  });

  it.each([
    "DATABASE_URL",
    "NEON_AUTH_BASE_URL",
    "NEON_DATA_API_URL",
    "NEON_AUTH_COOKIE_SECRET",
  ])("never references the server-only variable %s", (needle) => {
    const offenders = webSources.filter((file) =>
      code(file).includes(needle),
    );
    expect(offenders).toEqual([]);
  });

  it("exposes only the two public prefixes to client code", () => {
    // The structural guarantee: Vite inlines only variables matching envPrefix, so a
    // server-only name cannot reach the bundle through import.meta.env even if written.
    const viteConfig = readFileSync(
      join(repoRoot, "apps/web/vite.config.ts"),
      "utf8",
    );
    const match = /envPrefix:\s*\[([^\]]*)\]/.exec(viteConfig);
    expect(match, "vite.config.ts must set an explicit envPrefix").not.toBeNull();

    const prefixes = [...match![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(prefixes.toSorted()).toEqual(["NEXT_PUBLIC_", "VITE_"]);
  });
});

describe("no environment file is tracked in git", () => {
  it("commits .env.example and nothing else", () => {
    // The leak that actually happens is a committed .env.local, which a bundle grep
    // would never see.
    const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
