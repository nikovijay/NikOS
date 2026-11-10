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

/** The validator for one schema file in schemas/, e.g. "storymap.schema.json". */
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

/** A contract file written by a newer nikOS than this one reads. Readers catch it apart from a bad file. */
export class NewerContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewerContractError";
  }
}

/**
 * The refusal for a contract file whose version is newer than 1, or undefined when it is 1 or missing
 * (a missing version is the schema's problem, not this check's). `field` is the file's own name for its
 * version: delivery.yaml and repos.yaml say `version`, storymap.yaml says `format_version`. `side` names the
 * repo whose nikOS is too old: the one that runs the reader.
 */
export function contractVersion(file: string, data: unknown, field: "version" | "format_version", side: "planning" | "code"): string | undefined {
  const v = (data as Record<string, unknown> | null)?.[field];
  if (typeof v === "number" && v > 1) return `this ${file} was written by a newer nikOS: upgrade nikos in the ${side} repo`;
  return undefined;
}

/**
 * A contract file read the tolerant way: a newer version throws NewerContractError, otherwise the problems
 * against the reader's schema (unknown fields allowed). The writers still use their own strict schemas.
 */
export function contractProblems(file: string, data: unknown, field: "version" | "format_version", side: "planning" | "code", schema: string): string[] {
  const newer = contractVersion(file, data, field, side);
  if (newer) throw new NewerContractError(newer);
  return schemaProblems(schema, data);
}
