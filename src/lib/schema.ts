// The JSON schemas that ship in schemas/, compiled once per file. Errors come back as plain text.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

const Ajv2020 = (Ajv2020Module as any).default ?? Ajv2020Module;
const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = [join(here, "../../schemas"), join(here, "../schemas")].find((d) => existsSync(d))!;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const compiled = new Map<string, ValidateFunction>();

/** The validator for one schema file in schemas/, e.g. "team.schema.json". */
export function checkerFor(name: string): ValidateFunction {
  const cached = compiled.get(name);
  if (cached) return cached;
  const check = ajv.compile(JSON.parse(readFileSync(join(schemaDir, name), "utf8")));
  compiled.set(name, check);
  return check;
}

/** Each schema error as "field: what's wrong", with the field named from the data's own keys. */
export function schemaErrors(check: ValidateFunction): string[] {
  return (check.errors ?? []).map((e: ErrorObject) => {
    const at = e.instancePath.replace(/^\//, "").split("/").filter(Boolean).join(".");
    if (e.keyword === "additionalProperties") return `${at ? `${at}: ` : ""}unknown field '${(e.params as any).additionalProperty}'`;
    if (e.keyword === "required") return `${at ? `${at}: ` : ""}missing required field '${(e.params as any).missingProperty}'`;
    return `${at || "(root)"} ${e.message}`;
  });
}

/** The problems with some data against a schema file: none when it's valid. */
export function schemaProblems(name: string, data: unknown): string[] {
  const check = checkerFor(name);
  return check(data) ? [] : schemaErrors(check);
}
