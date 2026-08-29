/**
 * The state-mapping seam: config-driven, so the future Jira adapter
 * (MIL-178, not in scope here) plugs into the same shape instead of forking
 * detection/transition logic. See lib/lifecycle.ts for the vocabulary this
 * maps from, and adapters/types.ts for the interface it feeds.
 *
 * Loaded from a repo-committed JSON file (default `.em-tracker-bridge.json`
 * at the repo root; override with `--config`) -- deliberately a committed
 * file, not a pile of CLI flags, mirroring em-sdd-bridge's
 * `.specify/em-sdd.json` precedent (docs/README.md there): which tracker
 * and which state names a repo's transitions map to is repo policy decided
 * in review, not a per-invocation choice. Malformed JSON or an invalid
 * shape is a fail-closed BridgeError, never a silent fallback -- there is
 * no built-in default `stateMap`, since tracker workflow-state names are
 * always workspace-specific.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import { LIFECYCLE_STATES, type LifecycleState } from "./lifecycle.js";

export const DEFAULT_CONFIG_FILENAME = ".em-tracker-bridge.json";

/** Known adapter names. Only "linear" ships in 0.1.0; "jira" is reserved so
 *  a malformed/forward-referencing config fails with a clear "not
 *  implemented yet" message instead of "unknown tracker". */
export type TrackerName = "linear" | "jira";

/**
 * `stateMap[lifecycleState]` is the target tracker workflow-state NAME
 * (e.g. a Linear team's own "In Review" state) to move an issue to when a
 * slice reaches that lifecycle state. Two special values:
 *
 * - Absent key: fail-closed. A lifecycle state this bridge might need to
 *   transition to (including "in-progress" specifically, if
 *   branchDetection is enabled) MUST be mapped explicitly -- there is no
 *   guessed or default tracker state name.
 * - `null`: an explicit, deliberate no-op -- "never touch the tracker when
 *   a slice reaches this lifecycle state" (e.g. a team that doesn't want
 *   `draft` slices cluttering the tracker board at all).
 */
export type StateMap = Partial<Record<LifecycleState, string | null>>;

export interface BranchDetectionConfig {
  /** Whether to derive the bridge-only "in-progress" lifecycle state from a
   *  live `NNN-<slice-key>` feature branch. Default true. */
  enabled: boolean;
  /** Also check remote-tracking branches (`git branch -r`), not just local
   *  ones -- relevant when the bridge runs in CI, where the feature branch
   *  was never checked out locally. Default true. */
  includeRemote: boolean;
}

export interface BridgeConfig {
  tracker: TrackerName;
  stateMap: StateMap;
  branchDetection: BranchDetectionConfig;
}

const DEFAULT_BRANCH_DETECTION: BranchDetectionConfig = { enabled: true, includeRemote: true };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parses and validates raw JSON into a BridgeConfig, fail-closed on any
 *  structural problem. Exported separately from loadConfig so tests can
 *  exercise validation without touching the filesystem. */
export function parseConfig(raw: unknown, sourceLabel: string): BridgeConfig {
  if (!isPlainObject(raw)) {
    throw new BridgeError(`${sourceLabel}: expected a JSON object at the top level.`);
  }

  const tracker = raw["tracker"];
  if (tracker !== "linear" && tracker !== "jira") {
    throw new BridgeError(
      `${sourceLabel}: "tracker" must be "linear" (the only adapter implemented in 0.1.0) or ` +
        `"jira" (reserved, not implemented yet) -- got ${JSON.stringify(tracker)}.`
    );
  }
  if (tracker === "jira") {
    throw new BridgeError(
      `${sourceLabel}: tracker "jira" is reserved for a future adapter (MIL-178) and is not implemented ` +
        `in em-tracker-bridge 0.1.0. Use "linear".`
    );
  }

  const stateMapRaw = raw["stateMap"];
  if (!isPlainObject(stateMapRaw)) {
    throw new BridgeError(`${sourceLabel}: "stateMap" must be an object mapping lifecycle states to tracker state names.`);
  }
  const stateMap: StateMap = {};
  for (const [key, value] of Object.entries(stateMapRaw)) {
    if (!(LIFECYCLE_STATES as readonly string[]).includes(key)) {
      throw new BridgeError(
        `${sourceLabel}: "stateMap" has unknown lifecycle state ${JSON.stringify(key)}. Valid states: ` +
          LIFECYCLE_STATES.join(", ") +
          "."
      );
    }
    if (value !== null && typeof value !== "string") {
      throw new BridgeError(
        `${sourceLabel}: "stateMap.${key}" must be a string (a tracker state name) or null (explicit no-op), ` +
          `got ${JSON.stringify(value)}.`
      );
    }
    stateMap[key as LifecycleState] = value;
  }

  let branchDetection = DEFAULT_BRANCH_DETECTION;
  const bdRaw = raw["branchDetection"];
  if (bdRaw !== undefined) {
    if (!isPlainObject(bdRaw)) {
      throw new BridgeError(`${sourceLabel}: "branchDetection" must be an object.`);
    }
    const enabled = bdRaw["enabled"];
    const includeRemote = bdRaw["includeRemote"];
    if (enabled !== undefined && typeof enabled !== "boolean") {
      throw new BridgeError(`${sourceLabel}: "branchDetection.enabled" must be a boolean.`);
    }
    if (includeRemote !== undefined && typeof includeRemote !== "boolean") {
      throw new BridgeError(`${sourceLabel}: "branchDetection.includeRemote" must be a boolean.`);
    }
    branchDetection = {
      enabled: enabled ?? DEFAULT_BRANCH_DETECTION.enabled,
      includeRemote: includeRemote ?? DEFAULT_BRANCH_DETECTION.includeRemote,
    };
  }

  return { tracker, stateMap, branchDetection };
}

/** Loads config from `configPath` (default `<repoRoot>/.em-tracker-bridge.json`).
 *  Fail-closed: a missing file is a BridgeError (no built-in default
 *  stateMap exists to fall back to), as is malformed JSON or a shape
 *  parseConfig rejects. */
export function loadConfig(repoRoot: string, configPath?: string): BridgeConfig {
  const resolvedPath = configPath
    ? path.isAbsolute(configPath)
      ? configPath
      : path.resolve(repoRoot, configPath)
    : path.join(repoRoot, DEFAULT_CONFIG_FILENAME);

  if (!existsSync(resolvedPath)) {
    throw new BridgeError(
      `No config file found at ${resolvedPath}. em-tracker-bridge requires an explicit state-mapping config ` +
        `(no built-in default -- tracker workflow-state names are always workspace-specific). ` +
        `Create ${DEFAULT_CONFIG_FILENAME} at your repo root, or pass --config.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BridgeError(`${resolvedPath}: could not parse as JSON: ${message}`);
  }

  return parseConfig(raw, resolvedPath);
}
