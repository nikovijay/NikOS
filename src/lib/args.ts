// Command-line flags: the words after a command, split into flags and the words that aren't flags.

/** Flags and positional words. A flag takes the next word as its value, unless it's a flag in `bools`, which never takes one. */
export function parseArgs(args: string[], bools: string[] = []) {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = args[i + 1];
      const takes = next !== undefined && !next.startsWith("--") && !bools.includes(name);
      const value = takes ? (i++, next) : "true";
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else positional.push(a);
  }
  return { positional, all: (n: string) => flags.get(n) ?? [], opt: (n: string) => flags.get(n)?.[0], has: (n: string) => flags.has(n) };
}
