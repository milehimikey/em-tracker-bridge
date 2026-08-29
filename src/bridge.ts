#!/usr/bin/env node
/**
 * em-tracker-bridge -- mirrors em slice lifecycle transitions into an issue
 * tracker's own workflow states. One-way: em -> tracker only.
 *
 * SCAFFOLD ONLY (MIL-176): this entrypoint currently runs every
 * precondition a real sync will need -- the minimum-em-version check,
 * repo-root/model resolution, and state-mapping config load (see
 * lib/check-em-version.ts, lib/repo.ts, lib/em-runner.ts, lib/config.ts) --
 * and then stops. Lifecycle-transition detection and the Linear adapter
 * that actually perform the mirror ship in MIL-177, on top of this
 * scaffold's seam (lib/lifecycle.ts, lib/adapters/types.ts).
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath } from "./lib/em-runner.js";
import { loadConfig, type BridgeConfig } from "./lib/config.js";
import { BridgeError } from "./lib/bridge-error.js";

export interface ScaffoldCheckResult {
  repoRoot: string;
  modelPath: string;
  config: BridgeConfig;
}

/** Runs every MIL-176 precondition without performing a sync (there is
 *  nothing to sync yet -- see this file's module doc). Exported so tests
 *  can exercise the scaffold wiring end to end. */
export function runScaffoldCheck(argv: string[]): ScaffoldCheckResult {
  assertMinimumEmVersion();

  const { positional, flags } = parseArgs(argv, ["--repo-root", "--model", "--config"], ["--dry-run"]);
  if (positional.length > 0) {
    throw new BridgeError(`em-tracker-bridge takes no positional arguments (got: ${positional.join(", ")}).`);
  }

  const repoRoot = flags["repo-root"] ?? findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new BridgeError(
      "Could not locate a git repository (`git rev-parse --show-toplevel` failed upward from cwd). " +
        "Pass --repo-root explicitly."
    );
  }

  const modelPath = resolveModelPath(repoRoot, flags["model"]);
  const config = loadConfig(repoRoot, flags["config"]);

  return { repoRoot, modelPath, config };
}

const isMain =
  !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = runScaffoldCheck(process.argv.slice(2));
    console.log(
      `em-tracker-bridge: scaffold OK (repo root ${result.repoRoot}, model ${result.modelPath}, ` +
        `tracker "${result.config.tracker}") -- lifecycle-transition detection and the Linear adapter ` +
        `ship in MIL-177; nothing was synced.`
    );
  } catch (err) {
    if (err instanceof BridgeError) {
      console.error(`em-tracker-bridge: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
