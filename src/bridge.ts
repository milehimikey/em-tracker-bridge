#!/usr/bin/env node
/**
 * em-tracker-bridge -- mirrors em slice lifecycle transitions
 * (draft/reviewed/ready-to-implement/[in-progress]/implemented) into an
 * issue tracker's own workflow states.
 *
 * Usage:
 *   em-tracker-bridge
 *     [--repo-root <path>] [--model <path.em>] [--config <path.json>]
 *     [--from <git-rev>] [--to <git-rev>] [--dry-run]
 *
 * Pipeline: minimum-em-version check -> resolve repo root (git) and model
 * path -> load the state-mapping config (fail-closed if missing/invalid,
 * see lib/config.ts) -> export the model at both the "from" (default HEAD)
 * and "to" (default: current working-tree file) sides -> compute lifecycle
 * transitions (lib/transitions.ts) -> resolve each transition's target
 * tracker state name via config -> (unless --dry-run) apply each one
 * through the configured adapter (lib/sync.ts).
 *
 * One-way: em -> tracker only. Nothing in this package ever writes to the
 * `.em` model or a slice doc.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertMinimumEmVersion } from "./lib/check-em-version.js";
import { parseArgs } from "./lib/cli-args.js";
import { findRepoRoot } from "./lib/repo.js";
import { resolveModelPath } from "./lib/em-runner.js";
import { loadConfig } from "./lib/config.js";
import { runSync, type SyncResult } from "./lib/sync.js";
import { BridgeError } from "./lib/bridge-error.js";

export async function runBridge(argv: string[]): Promise<SyncResult> {
  // Minimum-em-version check runs before any other precondition -- an
  // unsupported `em` invalidates everything downstream (export shape,
  // doc-join fields), so failing here first keeps later error messages
  // honest about what actually went wrong.
  assertMinimumEmVersion();

  const { positional, flags, booleans } = parseArgs(
    argv,
    ["--repo-root", "--model", "--config", "--from", "--to"],
    ["--dry-run"]
  );

  if (positional.length > 0) {
    throw new BridgeError(
      `em-tracker-bridge takes no positional arguments (got: ${positional.join(", ")}). ` +
        `It syncs every tracked slice in the model in one run -- see README.md for flags.`
    );
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
  const dryRun = booleans.has("dry-run");

  return runSync({
    repoRootGit: repoRoot,
    modelPath,
    config,
    from: flags["from"] ?? "HEAD",
    to: flags["to"],
    dryRun,
  });
}

function printResult(result: SyncResult, dryRun: boolean): void {
  const prefix = dryRun ? "[dry-run] " : "";

  if (result.untrackedChanges.length > 0) {
    console.log(`${prefix}Unlinked slices with a status change (no tracking: URL, skipped):`);
    for (const key of result.untrackedChanges) console.log(`  - ${key}`);
  }

  if (result.planned.length === 0) {
    console.log(`${prefix}No lifecycle transitions to mirror.`);
  }

  for (const p of result.planned) {
    const from = p.fromLifecycle ?? "(none)";
    const branchNote = p.derivedFromBranch ? " [derived from a live feature branch]" : "";
    if (p.targetStateName === null) {
      console.log(
        `${prefix}${p.key}: ${from} -> ${p.toLifecycle}${branchNote} -- stateMap maps this to null (no-op), skipping.`
      );
    } else if (dryRun) {
      console.log(`${prefix}${p.key}: ${from} -> ${p.toLifecycle}${branchNote} => would set Linear state to "${p.targetStateName}" (${p.tracking})`);
    }
  }

  for (const a of result.applied) {
    const verb = a.changed ? "moved" : "already at";
    console.log(`${a.key}: ${verb} "${a.toStateName}" (was "${a.fromStateName ?? "(unknown)"}") -- ${a.issue.url}`);
  }
}

// realpathSync on both sides -- npm installs `bin` entries as symlinks, so a
// plain path.resolve() comparison of argv[1] vs. import.meta.url never
// matches when run the way every real npx/npm-installed consumer runs this.
const isMain =
  !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  runBridge(process.argv.slice(2))
    .then((result) => printResult(result, dryRun))
    .catch((err) => {
      if (err instanceof BridgeError) {
        console.error(`em-tracker-bridge: ${err.message}`);
        process.exit(1);
      }
      throw err;
    });
}
