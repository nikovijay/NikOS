// Renaming story ids for `nikos migrate maps --rename-ids`: KEY-n becomes GROUP-KEY-n. Only whole
// tokens change, so HT-1 never touches HT-12, and a tag is rewritten only above `Feature:`, where
// the spec hash doesn't look. A body's mention of an id is left alone: it would change the spec
// hash and lapse the approval, so migrate reports it instead.

/** Old id to new id. */
export type IdTable = Map<string, string>;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace each whole-token id in text. Returns the text and how many were replaced. */
export function renameIds(text: string, table: IdTable): { text: string; count: number } {
  if (!table.size) return { text, count: 0 };
  // Longest first, so an alternative never stops short of a longer id.
  const ids = [...table.keys()].sort((a, b) => b.length - a.length).map(escape);
  const re = new RegExp(`(?<![A-Za-z0-9-])(${ids.join("|")})(?![A-Za-z0-9-])`, "g");
  let count = 0;
  const out = text.replace(re, (id) => {
    count++;
    return table.get(id) ?? id;
  });
  return { text: out, count };
}

/** Rewrite the story ids in a feature's tags (@ID and @depends-ID) above `Feature:`. */
export function retagFeature(text: string, table: IdTable): { text: string; count: number } {
  let count = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("Feature:")) break;
    if (!t.startsWith("@")) continue;
    lines[i] = lines[i].replace(/@(depends-)?([A-Za-z0-9-]+)(?=\s|$)/g, (tag, depends: string | undefined, id: string) => {
      const next = table.get(id);
      if (next === undefined) return tag;
      count++;
      return `@${depends ?? ""}${next}`;
    });
  }
  return { text: lines.join("\n"), count };
}

/** Rewrite the ids in a decision's heading: `## <date> — <title> (ID)`. Other lines are left alone. */
export function renameDecisionHeadings(text: string, table: IdTable): { text: string; count: number } {
  let count = 0;
  const out = text.split("\n").map((line) => {
    if (!line.startsWith("## ")) return line;
    const r = renameIds(line, table);
    count += r.count;
    return r.text;
  });
  return { text: out.join("\n"), count };
}

/** The id a story has after migration: its number kept, its prefix replaced by GROUP-KEY. Undefined when the id isn't KEY-n. */
export function newIdFor(id: string, oldKey: string, group: string, key: string): string | undefined {
  const m = id.match(/^(.+)-(\d+)$/);
  if (!m || m[1] !== oldKey) return undefined;
  return `${group}-${key}-${m[2]}`;
}
