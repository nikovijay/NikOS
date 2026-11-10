// `nikos migrate`: the one migration left is `nikos migrate maps`, which moves a 0.2.x intent/
// story map into maps/<key>/ (see migrate-maps.ts).
import { MIGRATE_MAPS_USAGE, runMigrateMaps } from "./migrate-maps.js";

export function runMigrate(args: string[]): number | Promise<number> {
  if (args[0] === "maps") return runMigrateMaps(args.slice(1));
  console.error(`Usage: nikos migrate maps [options]\n  maps  move intent/ into maps/<key>/ (${MIGRATE_MAPS_USAGE.replace("Usage: nikos migrate maps ", "")})`);
  return 1;
}
