// Fetch one branch of a repo into a folder as a plain copy: no history, nothing to push back.
// Planning sync and team sync both read other repos this way, read-only. With paths, only those
// paths are checked out (a sparse clone, which needs git's partial clone support); any failure of
// that falls back to the full shallow clone.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Why a url can't be fetched from, or undefined. Plain https and ssh urls, and local paths, are
 * fine. A url can't start with a dash (git would read it as an option), name a transport helper
 * (ext::, fd::), or carry a password. A user name is allowed on ssh only.
 */
export function urlProblem(url: string): string | undefined {
  if (typeof url !== "string" || !url.trim()) return "a url is needed";
  if (url.startsWith("-")) return `'${url}' isn't a repo url`;
  if (/^[a-z][a-z0-9+.-]*::/i.test(url)) return `'${url}' names a git transport helper, which isn't allowed`;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return undefined; // git@host:path, or a local path
  if (!["https", "ssh", "file"].includes(scheme)) return `'${url}' uses ${scheme}, which isn't allowed: use https or ssh`;
  const authority = url.slice(url.indexOf("//") + 2).split("/")[0];
  if (authority.includes("@") && (scheme !== "ssh" || /:[^@]*@/.test(authority))) return "a url can't carry a user name or password";
  return undefined;
}

/** The line of git's error that says why, e.g. "Permission denied" over the advice that follows it. */
export function errorLine(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => l && !/^warning:/i.test(l));
  const why = lines.find((l) => /permission denied|could not resolve|does not exist|not found|^(fatal|error):/i.test(l)) ?? lines[0] ?? "clone failed";
  return why.replace(/^(fatal|error):\s*/i, "");
}

/** The commit read, or the line of git's error when the branch can't be fetched. */
export function fetchCopy(url: string, ref: string, dir: string, paths?: string[]): { commit: string } | { error: string } {
  const bad = urlProblem(url);
  if (bad) return { error: bad };
  rmSync(dir, { recursive: true, force: true });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  // "--" ends the options, so a url or folder can never be read as one.
  const attempt = (sparse: boolean) =>
    spawnSync("git", ["clone", "--quiet", "--depth", "1", ...(sparse ? ["--filter=blob:none", "--sparse"] : []), "--branch", ref, "--", url, dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  let clone = attempt(!!paths);
  if (paths && clone.status === 0) {
    const sparse = spawnSync("git", ["sparse-checkout", "set", ...paths], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
    if (sparse.status !== 0) {
      rmSync(dir, { recursive: true, force: true });
      clone = attempt(false);
    }
  } else if (paths) {
    rmSync(dir, { recursive: true, force: true });
    clone = attempt(false);
  }
  if (clone.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return { error: errorLine(clone.stderr || "") };
  }
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  rmSync(join(dir, ".git"), { recursive: true, force: true }); // a plain copy: nothing to push back
  return { commit };
}
