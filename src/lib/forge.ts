// Which forge a repo is on, and the command that opens its pull request (GitHub) or merge request
// (GitLab). nikOS runs gh only when it's installed and the person clicked Open pull request; glab
// is never assumed, so anywhere else the command is shown to copy.
import { realRun, type Runner } from "./git.js";

export type Host = "github" | "gitlab";

/** github or gitlab, from a remote's url; undefined when it's neither. */
export function hostOf(url: string): Host | undefined {
  if (/github\.com[:/]/.test(url)) return "github";
  if (/gitlab/i.test(url)) return "gitlab";
  return undefined;
}

/** The host name in a remote url: https or ssh, or git@host:path. Undefined for a local path or a file:// url. */
export function hostNameOf(url: string): string | undefined {
  if (/^file:/i.test(url)) return undefined;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(url) ?? /^(?:[^@\s/]+@)?([^:\s/]+):/.exec(url);
  return m?.[1]?.toLowerCase();
}

/** The forge a host name is, for a planning repo's host or a url's host. */
export function kindOfHost(host: string): Host | undefined {
  if (host === "github.com") return "github";
  if (/gitlab/i.test(host)) return "gitlab";
  return undefined;
}

/** The argv that opens the request for a pushed branch, or undefined for a forge nikOS doesn't know. */
export function requestArgv(kind: Host | undefined, base: string, branch: string): string[] | undefined {
  if (kind === "github") return ["gh", "pr", "create", "--base", base, "--head", branch, "--fill"];
  if (kind === "gitlab") return ["glab", "mr", "create", "--source-branch", branch, "--target-branch", base, "--fill", "--yes"];
  return undefined;
}

/** The tool for the forge, when it's installed here. */
export function toolFor(kind: Host | undefined, run: Runner = realRun, cwd = process.cwd()): "gh" | "glab" | null {
  const tool = kind === "github" ? "gh" : kind === "gitlab" ? "glab" : undefined;
  if (!tool) return null;
  return run(tool, ["--version"], cwd).status === 0 ? tool : null;
}

/** Run the request command. Only called after a click that asks for it. */
export function runForge(argv: string[], run: Runner = realRun, cwd = process.cwd()): { ok: boolean; output: string } {
  const [cmd, ...args] = argv;
  const r = run(cmd, args, cwd);
  return { ok: r.status === 0, output: (r.stdout || r.stderr).trim() };
}

/** The command as one line to copy, with arguments that need no quoting (branch names are safe). */
export const asLine = (argv: string[] | undefined) => (argv ? argv.join(" ") : undefined);
