// `nikos team`: a team repo's identity and members. `init` makes a code repo a team repo, `join`
// takes work from a group repo, `member` edits who is on the team, and `show` says where the team
// stands. A team's stories are its own maps, which its delivery.yaml files say how far along they are.
import { basename, join, resolve } from "node:path";
import { isSeq, parse, stringify, type Document, type YAMLSeq } from "yaml";
import { REPO_PATH } from "../lib/bets.js";
import { ownMapsOf } from "../lib/maps.js";
import { ownRepo } from "../lib/git.js";
import { read } from "../lib/project.js";
import { store } from "../lib/store.js";
import { isTeamRepo, openTeam, parseTeam, saveTeam, teamDocument, TEAM_FILE, clashingGroups, type TeamMember } from "../lib/team.js";
import { repoEntry } from "../planning/upstream.js";
import { KEY } from "../lib/keys.js";

/** The team commands that change or read nikos.team.yaml need one. Named once, so each refuses alike. */
const NO_TEAM = "run nikos team init first";
const requireTeam = (root: string) => {
  if (!isTeamRepo(root)) throw new Error(NO_TEAM);
};

/** A block-style node: a list entry is written as a block, never [ ] or { }, so the file stays easy to read and edit. */
const block = <T>(node: T): T => {
  (node as { flow?: boolean }).flow = false;
  return node;
};

const NOT_A_REPO = "not a repo path (owner/repo, or group/subgroup/project on GitLab)";

/** The team key's shape: the same one group keys have (planning/plan.yaml key). */
export const TEAM_KEY = KEY;

/** `nikos team init`: write nikos.team.yaml here, naming the team, its repo path and (optionally) its key. */
export function teamInit(dir: string, opts: { repo?: string; name?: string; key?: string }): { repo: string; name: string; keyAdded?: boolean } {
  const root = resolve(dir);
  // A team made before it had a key can take one now: its file gains the key and format 2. A key already set is kept.
  if (isTeamRepo(root)) {
    if (opts.key === undefined) throw new Error(`${TEAM_FILE} already exists here`);
    return addTeamKey(root, opts.key);
  }
  // intent/ is a 0.3.0 group's story map; a team keeps its own maps in maps/<key>/ (after 0.3.0), so only intent/ is refused.
  if (store().isDir(join(root, "intent"))) {
    throw new Error("this repo has its own story map (intent/), and a team repo can't hold one. Move it with nikos migrate maps (a group repo, or a team repo with a key), then nikos team join");
  }
  // A keyless team stays format 1, so a group repo with planning/plan.yaml can still be given one (as in 0.3.0).
  if (opts.key !== undefined && store().exists(join(root, "planning", "plan.yaml"))) throw new Error("this repo has planning/plan.yaml: a plan repo can't also be a team repo. Make the team in its own repo");
  const repo = opts.repo ?? ownRepo(root);
  if (!repo) throw new Error("no origin remote to take the team's repo path from: pass --repo owner/repo");
  if (!REPO_PATH.test(repo)) throw new Error(`'${repo}' is ${NOT_A_REPO}`);
  if (opts.key !== undefined && !TEAM_KEY.test(opts.key)) throw new Error(`'${opts.key}' is not a team key: capital letters and digits, starting with a letter, up to 10 (e.g. WEB)`);
  const name = (opts.name ?? basename(root)).trim();
  // A key is the one thing that makes this file 0.3.0-incompatible, so a keyless team keeps format 1.
  const key = opts.key ? { key: opts.key } : {};
  const version = opts.key ? 2 : 1;
  const text = `# The team: who is on it, its key, and the repos it takes work from. Edit with nikos team.\n${stringify({ format_version: version, name, repo, ...key, groups: [], members: [] })}`;
  parseTeam(text); // refuses a bad name before anything is written
  store().write(join(root, TEAM_FILE), text, { create: true });
  return { repo, name };
}

/** Give a team its key on an existing team file (format 2). A team that has one keeps it. */
function addTeamKey(root: string, key: string): { repo: string; name: string; keyAdded: boolean } {
  const team = openTeam(root);
  if (team.key) throw new Error(`this team's key is already ${team.key}: edit ${TEAM_FILE} to change it`);
  if (!TEAM_KEY.test(key)) throw new Error(`'${key}' is not a team key: capital letters and digits, starting with a letter, up to 10 (e.g. WEB)`);
  const doc = teamDocument(root);
  doc.set("format_version", 2);
  doc.set("key", key);
  saveTeam(root, doc);
  return { repo: team.repo, name: team.name, keyAdded: true };
}

/** The sequence under a key in a team document, made if it isn't there yet, in block style. */
function listIn(doc: Document, key: string): YAMLSeq {
  if (!isSeq(doc.get(key, true))) doc.set(key, doc.createNode([]));
  return block(doc.get(key, true) as YAMLSeq);
}

/**
 * `nikos team join <repo>`: add a source the team takes work from. Nothing is fetched: a team's
 * stories come from its own maps.
 */
export function teamJoin(dir: string, repo: string, opts: { ref?: string; host?: string; url?: string } = {}): { repo: string } {
  const root = resolve(dir);
  requireTeam(root);
  if (!REPO_PATH.test(repo)) throw new Error(`'${repo}' is ${NOT_A_REPO}`);
  const team = openTeam(root);
  if (repo === team.repo) throw new Error(`this team is ${repo}: a team takes stories from another repo`);
  if (team.groups.some((g) => g.repo === repo)) throw new Error(`this team already takes work from ${repo}`);
  const clash = clashingGroups([...team.groups.map((g) => g.repo), repo]);
  if (clash) throw new Error(`${clash[0]} and ${clash[1]} can't both be groups: one path sits inside the other`);
  const entry = { repo, ...(opts.ref ? { ref: opts.ref } : {}), ...(opts.host ? { host: opts.host } : {}), ...(opts.url ? { url: opts.url } : {}) };
  repoEntry(entry, TEAM_FILE); // throws with the reason, before the file changes
  const doc = teamDocument(root);
  listIn(doc, "groups").add(block(doc.createNode(entry)));
  saveTeam(root, doc);
  return { repo };
}

/** `nikos team member add`: a name, and optionally a role and a handle. Names only: no email addresses. */
export function memberAdd(dir: string, name: string, opts: { role?: string; handle?: string } = {}): TeamMember {
  const root = resolve(dir);
  requireTeam(root);
  const n = name.trim();
  if (!n) throw new Error("Give the member's name");
  if (n.includes("@")) throw new Error("the member list is names, roles and handles only: no email addresses");
  const team = openTeam(root);
  if (team.members.some((m) => m.name === n)) throw new Error(`${n} is already on the team`);
  const member: TeamMember = { name: n, ...(opts.role ? { role: opts.role.trim() } : {}), ...(opts.handle ? { handle: opts.handle.trim() } : {}) };
  const doc = teamDocument(root);
  listIn(doc, "members").add(block(doc.createNode(member)));
  saveTeam(root, doc);
  return member;
}

/** `nikos team member remove`. */
export function memberRemove(dir: string, name: string): void {
  const root = resolve(dir);
  requireTeam(root);
  const team = openTeam(root);
  const at = team.members.findIndex((m) => m.name === name.trim());
  if (at < 0) throw new Error(`${name} isn't on the team`);
  const doc = teamDocument(root);
  doc.deleteIn(["members", at]);
  saveTeam(root, doc);
}

/** `nikos team show`: the team, its members, the repos it takes work from, and its own maps. */
export function teamShow(dir: string): string[] {
  const root = resolve(dir);
  requireTeam(root);
  const team = openTeam(root);
  const out = [`${team.name} (${team.repo})${team.key ? `, key ${team.key}` : ""}${team.home ? `, home ${team.home}` : ""}`];
  out.push(team.members.length ? "Members:" : "Members: none yet (nikos team member add)");
  for (const m of team.members) out.push(`  ${m.name}${m.role ? `, ${m.role}` : ""}${m.handle ? ` (@${m.handle})` : ""}`);
  out.push(team.groups.length ? "Takes work from:" : ownMapsOf(root).length ? "Takes work from: no other repo" : "Takes work from: none yet (nikos team join <group or team repo>)");
  for (const g of team.groups) out.push(`  ${g.repo}`);
  const own = ownMapsOf(root);
  if (own.length) {
    out.push("Own maps:");
    for (const m of own) {
      const map = (parse(read(join(m.dir, "storymap.yaml"))) ?? {}) as { key?: string; releases?: { stories?: string[] }[] };
      const count = (map.releases ?? []).reduce((n, r) => n + (r.stories?.length ?? 0), 0);
      out.push(`  ${team.key}-${map.key ?? m.id}: ${count} ${count === 1 ? "story" : "stories"}`);
    }
  }
  return out;
}

const USAGE = `Usage:
  nikos team init [--repo owner/repo] [--name "<team>"] [--key WEB] [--dir <path>]
  nikos team join <group repo> [--ref <branch>] [--host <host> | --url <git url>] [--dir <path>]
  nikos team member add "<name>" [--role "<role>"] [--handle <username>] [--dir <path>]
  nikos team member remove "<name>" [--dir <path>]
  nikos team show [--dir <path>]`;

export function runTeam(args: string[]): number {
  const [sub, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  const dir = flag("dir") ?? process.cwd();
  try {
    if (sub === "init") {
      const r = teamInit(dir, { repo: flag("repo"), name: flag("name"), key: flag("key") });
      const key = flag("key");
      // A team with a key can own maps once it has a home; any team can take work from a group or another team.
      const nextSteps = key
        ? `Next steps:\n  1. Give it a home plan, the plan its own maps belong to: nikos join and that plan's repo path with --home, like nikos join acme/payments-plan --home\n  2. Make a story map for one of its bets: nikos map new --bet and the bet's id, with --key and a short map key\n  Or take work from a group or another team instead: nikos team join and that repo's path, like nikos team join acme/checkout-group`
        : `Next step: take work from a group, with nikos team join and the group repo's path, like nikos team join acme/checkout-group`;
      console.log(`${r.keyAdded ? `✓ ${r.name} now has key ${key}` : `✓ Created ${TEAM_FILE} for ${r.name} (${r.repo})`}\n${nextSteps}`);
    } else if (sub === "join" && positional[0]) {
      if (rest.includes("--home")) throw new Error("a team's home is set with nikos join <plan> --home: nikos team join takes work from a group, and doesn't set one");
      const r = teamJoin(dir, positional[0], { ref: flag("ref"), host: flag("host"), url: flag("url") });
      console.log(`✓ Joined ${r.repo}`);
    } else if (sub === "member" && positional[0] === "add" && positional[1]) {
      const m = memberAdd(dir, positional[1], { role: flag("role"), handle: flag("handle") });
      console.log(`✓ ${m.name} added${m.role ? ` as ${m.role}` : ""}`);
    } else if (sub === "member" && positional[0] === "remove" && positional[1]) {
      memberRemove(dir, positional[1]);
      console.log(`✓ ${positional[1]} removed`);
    } else if (sub === "show") {
      console.log(teamShow(dir).join("\n"));
    } else {
      console.error(USAGE);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
