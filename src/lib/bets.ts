// Bet links: releases (and, as an override, single stories) in storymap.yaml name
// the bets they deliver. The bets themselves live in planning/, outside maps/.

/** A bet in this repo: lowercase words joined by hyphens. */
export const BET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** One part of a repo path; "." and ".." are never allowed, so a path can't leave .nikos/upstream/. */
const SEGMENT = String.raw`(?!\.{1,2}(?:/|#|$))[A-Za-z0-9_.-]+`;
/**
 * Another repo, as its path on the host: owner/repo on GitHub, or group/subgroup/project on
 * GitLab, with as many groups as it has.
 */
export const REPO_PATH = new RegExp(`^${SEGMENT}(?:/${SEGMENT})+$`);
/** A bet or key result in another repo: <repo path>#id, e.g. acme/company-plan#d30-retention. */
export const CROSS_REF = new RegExp(`^${SEGMENT}(?:/${SEGMENT})+#[a-z0-9]+(-[a-z0-9]+)*$`);

export const isBetRef = (ref: string) => BET_ID.test(ref) || CROSS_REF.test(ref);

export interface StoryBets {
  bets: string[];
  from: "story" | "release" | "map" | "none";
  release?: number;
}

/** The bets a story delivers: its own `story_bets` entry, or else its release's `bets`. */
export function betsFor(map: any, story: string): StoryBets {
  // A map names one bet, in bet:; its releases and stories name none.
  if (typeof map?.bet === "string") return { bets: [map.bet], from: "map" };
  const release = (map?.releases ?? []).find((r: any) => (r?.stories ?? []).includes(story));
  const own = map?.story_bets?.[story];
  if (Array.isArray(own)) return { bets: own, from: "story", release: release?.number };
  if (release && Array.isArray(release.bets) && release.bets.length) return { bets: release.bets, from: "release", release: release.number };
  return { bets: [], from: "none", release: release?.number };
}

/**
 * A bet's canonical name, <repo>#<id>, so a bet named in its own repo and the same bet named from another
 * repo match (amendment, section 4). A name already canonical is returned as it is.
 */
export function canonicalBet(value: string, ownerRepo: string): string {
  return CROSS_REF.test(value) ? value : `${ownerRepo}#${value}`;
}

/**
 * Every story that delivers a bet, after story overrides. With ownerRepo (the repo the map sits in), a bare
 * bet id and a <repo>#<id> name are compared in canonical form, so a map that names the company's bet matches.
 */
export function storiesFor(map: any, bet: string, ownerRepo?: string): string[] {
  const all: string[] = (map?.releases ?? []).flatMap((r: any) => r?.stories ?? []);
  const canon = (b: string) => (ownerRepo ? canonicalBet(b, ownerRepo) : b);
  const want = canon(bet);
  return all.filter((s) => betsFor(map, s).bets.some((b) => canon(b) === want));
}
