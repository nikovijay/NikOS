import { parse } from "yaml";

/** Split a Markdown file into its YAML front matter and body. */
export function parseFrontMatter(text: string): { meta: any; body: string } | undefined {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return undefined;
  return { meta: parse(m[1]), body: text.slice(m[0].length) };
}
