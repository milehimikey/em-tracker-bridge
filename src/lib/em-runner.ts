import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import type { ExportedModel } from "./export-model.js";

/** Resolve the `.em` model to run `em export` against. Explicit `override`
 *  wins; otherwise the sole `*.em` file at the repo root. An absolute
 *  `override` is used as-is; a relative one is resolved against `repoRoot`,
 *  NOT `process.cwd()`. Copied from em-sdd-bridge's resolveModelPath (same
 *  convention, same rationale). */
export function resolveModelPath(repoRoot: string, override?: string): string {
  if (override) return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
  const candidates = readdirSync(repoRoot).filter((f) => f.endsWith(".em"));
  if (candidates.length === 1) return path.join(repoRoot, candidates[0]);
  throw new BridgeError(
    `Could not find a unique .em model at repo root ${repoRoot} (found ${candidates.length} ` +
      `\`*.em\` files). Pass --model explicitly.`
  );
}

/** Run `em export <modelPath>` and parse its JSON. All model reads in this
 *  package go through this one function (or exportAtRevision.ts, which
 *  calls it against a temp copy) -- em-tracker-bridge never parses slice
 *  docs or .em source itself. */
export function runEmExport(modelPath: string): ExportedModel {
  let stdout: string;
  try {
    stdout = execFileSync("em", ["export", modelPath], { encoding: "utf8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BridgeError(`\`em export ${modelPath}\` failed: ${message}`);
  }
  try {
    return JSON.parse(stdout) as ExportedModel;
  } catch {
    throw new BridgeError(`\`em export ${modelPath}\` did not produce valid JSON.`);
  }
}
