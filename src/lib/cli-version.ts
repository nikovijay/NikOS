// Which nikos a bare `nikos` runs, and whether it's older than this one. A global install from
// npm or Homebrew stays on its version until someone updates it, while `npx -y nikos@latest`
// moves on, so an agent can read an old command set without knowing. Nothing here touches the
// network: it asks the `nikos` on PATH for its version and compares.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** This copy's version, from its package.json. */
export function ownVersion(): string {
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")).version;
    } catch {
      // the other layout: src/lib in development, dist/ once built
    }
  }
  return "0.0.0";
}

/** -1, 0 or 1, comparing x.y.z versions by number. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

/**
 * The `nikos` on PATH: undefined when there's none, version undefined when it's too old to
 * answer --version (before 0.2).
 */
export function pathCli(): { version?: string } | undefined {
  if (process.env.NIKOS_NO_VERSION_CHECK) return undefined;
  const r = spawnSync("nikos", ["--version"], { encoding: "utf8", timeout: 5000, env: { ...process.env, NIKOS_NO_VERSION_CHECK: "1" } });
  if (r.error) return undefined;
  const v = /^(\d+\.\d+\.\d+)/.exec((r.stdout ?? "").trim())?.[1];
  return { ...(v ? { version: v } : {}) };
}

/** The command that runs this version: `nikos` when the one on PATH is current, else npx. */
export function cliCommand(): string {
  const cli = pathCli();
  return cli?.version && compareVersions(cli.version, ownVersion()) >= 0 ? "nikos" : "npx -y nikos@latest";
}

/** What to tell the person when the `nikos` on PATH is older than this one, or nothing. */
export function staleCliWarning(): string | undefined {
  const cli = pathCli();
  if (!cli) return undefined;
  const mine = ownVersion();
  if (cli.version && compareVersions(cli.version, mine) >= 0) return undefined;
  return `The nikos command on your PATH is ${cli.version ?? "an old version (before 0.2)"}, older than ${mine}, so it doesn't have every command the skills use. Update it with: npm install -g nikos@latest (or run npx -y nikos@latest).`;
}
