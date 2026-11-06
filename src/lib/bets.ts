// Bet links: releases (and, as an override, single stories) in storymap.yaml name
// the bets they deliver. The bets themselves live in planning/, outside intent/.
import { dirname, join } from "node:path";

/** A bet in this repo: lowercase words joined by hyphens. */
export const BET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A bet or key result in another repo: owner/repo#id. */
export const CROSS_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[a-z0-9]+(-[a-z0-9]+)*$/;

export const isBetRef = (ref: string) => BET_ID.test(ref) || CROSS_REF.test(ref);

/** The repo's planning/ folder, next to intent/. */
export const planningDir = (intentDir: string) => join(dirname(intentDir), "planning");

export interface StoryBets {
  bets: string[];
  from: "story" | "release" | "none";
  release?: number;
}

/** The bets a story delivers: its own `story_bets` entry, or else its release's `bets`. */
export function betsFor(map: any, story: string): StoryBets {
  const release = (map?.releases ?? []).find((r: any) => (r?.stories ?? []).includes(story));
  const own = map?.story_bets?.[story];
  if (Array.isArray(own)) return { bets: own, from: "story", release: release?.number };
  if (release && Array.isArray(release.bets) && release.bets.length) return { bets: release.bets, from: "release", release: release.number };
  return { bets: [], from: "none", release: release?.number };
}

/** Every story that delivers a bet, after story overrides. */
export function storiesFor(map: any, bet: string): string[] {
  const all: string[] = (map?.releases ?? []).flatMap((r: any) => r?.stories ?? []);
  return all.filter((s) => betsFor(map, s).bets.includes(bet));
}
