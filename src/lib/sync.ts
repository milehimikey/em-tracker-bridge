/**
 * Orchestrates one sync run: export both sides -> compute transitions ->
 * resolve each transition's target tracker-state name via config -> (unless
 * --dry-run) apply each one through the configured adapter.
 *
 * `--dry-run` is enforced structurally here, not just by convention: the
 * adapter is never even constructed (getAdapter is never called) when
 * `dryRun` is true, so there is no code path in dry-run mode that can reach
 * the network -- matching MIL-177/the task brief's "dry-run prints planned
 * transitions without calling the API".
 */

import { BridgeError } from "./bridge-error.js";
import type { BridgeConfig } from "./config.js";
import { findLiveFeatureBranch } from "./branch-detection.js";
import { exportAtSide } from "./export-at-revision.js";
import { computeTransitions, type Transition } from "./transitions.js";
import { getAdapter } from "./adapters/registry.js";
import type { ApplyStateResult, TrackerAdapter } from "./adapters/types.js";
import type { ExportedModel } from "./export-model.js";

export interface SyncOptions {
  repoRootGit: string;
  modelPath: string;
  config: BridgeConfig;
  /** Git revision for the "from" (older) snapshot. */
  from: string;
  /** Git revision for the "to" (newer) snapshot, or undefined for the
   *  current working-tree file. */
  to?: string;
  dryRun: boolean;
  /** Test-only seam: bypasses adapters/registry.ts's tracker-name lookup
   *  with a caller-supplied adapter (e.g. one backed by a mocked HTTP
   *  transport). Never set by the CLI -- production always resolves the
   *  adapter from `config.tracker` via getAdapter. */
  adapterOverride?: TrackerAdapter;
  /** Test-only seam: bypasses export-at-revision.ts's git+`em export`
   *  shell-outs entirely. Given the resolved `from`/`to` revision (or
   *  undefined for the working tree) and expected to return the same shape
   *  `exportAtSide` would. Never set by the CLI. */
  exportSideOverride?: (rev: string | undefined) => ExportedModel | undefined;
}

export interface PlannedTransition extends Transition {
  /** The tracker state name to move this slice's issue to, resolved via
   *  config.stateMap. Null means the config deliberately maps this
   *  lifecycle state to a no-op (see config.ts's StateMap doc). */
  targetStateName: string | null;
}

export interface SyncResult {
  planned: PlannedTransition[];
  /** Present only when dryRun is false -- the outcome of actually applying
   *  each non-null-mapped planned transition. */
  applied: Array<ApplyStateResult & { key: string }>;
  /** Slice keys with a targetStateName of null (deliberate stateMap no-op) --
   *  a subset of `planned`, surfaced separately for reporting. */
  skippedAsNoOp: string[];
  /** Slice keys whose em-sourced status changed but carry no `tracking`
   *  URL -- a visible no-op, never an error (MIL-177's "Done when"). */
  untrackedChanges: string[];
}

function resolveTargetStateName(config: BridgeConfig, transition: Transition): string | null {
  if (!(transition.toLifecycle in config.stateMap)) {
    throw new BridgeError(
      `No stateMap entry for lifecycle state "${transition.toLifecycle}" (slice "${transition.key}", tracking ` +
        `${transition.tracking}). Add "${transition.toLifecycle}" to stateMap in your config, or map it to ` +
        `null to skip it deliberately.`
    );
  }
  return config.stateMap[transition.toLifecycle] ?? null;
}

export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const exportSide = options.exportSideOverride ?? ((rev: string | undefined) => exportAtSide(options.repoRootGit, options.modelPath, rev));
  const fromExport = exportSide(options.from);
  const toExport = exportSide(options.to);
  if (!toExport) {
    throw new BridgeError(
      `The model file does not exist at the "to" side (${options.to ?? "working tree"}). Nothing to sync.`
    );
  }

  const branchDetection = options.config.branchDetection;
  const branchDetector = branchDetection.enabled
    ? (key: string) => Boolean(findLiveFeatureBranch(options.repoRootGit, key, branchDetection.includeRemote))
    : undefined;

  const { transitions, untrackedChanges } = computeTransitions(fromExport, toExport, { branchDetector });

  // Resolved eagerly (before any adapter call) so a misconfigured stateMap
  // aborts the WHOLE run before anything is applied -- deterministic,
  // all-or-nothing, never a partial mirror caused by config drift.
  const planned: PlannedTransition[] = transitions.map((t) => ({
    ...t,
    targetStateName: resolveTargetStateName(options.config, t),
  }));

  const skippedAsNoOp = planned.filter((p) => p.targetStateName === null).map((p) => p.key);

  const applied: Array<ApplyStateResult & { key: string }> = [];
  if (!options.dryRun) {
    const toApply = planned.filter((p) => p.targetStateName !== null);
    if (toApply.length > 0) {
      const adapter = options.adapterOverride ?? getAdapter(options.config.tracker);
      for (const p of toApply) {
        const issue = await adapter.resolveIssue(p.tracking);
        const result = await adapter.applyState(issue, p.targetStateName!);
        applied.push({ ...result, key: p.key });
      }
    }
  }

  return { planned, applied, skippedAsNoOp, untrackedChanges };
}
