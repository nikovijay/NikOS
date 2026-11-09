// The nearest word to a typo, for "Did you mean …?" when a command is misspelled.

/** How many single-letter edits turn a into b: an added, missing or changed letter, or two letters swapped. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The word a typo most likely meant: a close spelling, or the start of one. Undefined when nothing is close. */
export function closest(typed: string, names: string[]): string | undefined {
  const t = typed.toLowerCase().replace(/^-+/, "");
  if (!t) return undefined;
  const scored = names
    .map((n) => ({ n, d: n.startsWith(t) && t.length >= 3 ? 0.5 : editDistance(t, n) }))
    .filter((x) => x.d <= (t.length <= 4 ? 1 : 2))
    .sort((x, y) => x.d - y.d || x.n.localeCompare(y.n));
  return scored[0]?.n;
}
