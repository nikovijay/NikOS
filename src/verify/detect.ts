import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Stack = "js" | "ts" | "python";

const PYTHON_MARKERS = ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"];

/** Pick the Cucumber runner's stack from the files at the repo root. Undefined means ask the person. */
export function detectStack(root: string): Stack | undefined {
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    let pkg: any = {};
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      // An unreadable package.json is still a JS project.
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return existsSync(join(root, "tsconfig.json")) || "typescript" in deps ? "ts" : "js";
  }
  if (PYTHON_MARKERS.some((f) => existsSync(join(root, f)))) return "python";
  return undefined;
}
