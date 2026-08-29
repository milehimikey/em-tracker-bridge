/**
 * Computes the lifecycle transitions to mirror into the tracker, given two
 * `em export` snapshots (an older "from" side, possibly absent, and a
 * newer "to" side) plus a live branch-detection signal.
 *
 * A slice with no `tracking:` URL bound (`doc.tracking === null`) is a
 * visible no-op here -- it never reaches `transitions`, and callers should
 * report it as skipped, never as an error (MIL-177's "Done when" clause).
 */

import type { ExportedModel, ExportedSlice } from "./export-model.js";
import { isLifecycleState, type LifecycleState } from "./lifecycle.js";

export interface Transition {
  key: string;
  sliceName: string;
  tracking: string;
  /** null when the slice had no prior export (new tracking binding, or the
   *  "from" side predates the model file existing at all). */
  fromLifecycle: LifecycleState | null;
  toLifecycle: LifecycleState;
  /** True when `toLifecycle` is the bridge-synthesized "in-progress" state
   *  (derived from a live feature branch, not from em's own status field) --
   *  surfaced so callers/tests can distinguish em-sourced transitions from
   *  bridge-enriched ones without re-deriving it. */
  derivedFromBranch: boolean;
}

function findSlice(model: ExportedModel | undefined, key: string): ExportedSlice | undefined {
  return model?.model.slices.find((s) => s.key === key);
}

/** Narrows em's raw (untyped) status string to the lifecycle vocabulary.
 *  A status em itself would never emit (e.g. a typo'd doc, or a future em
 *  status this package doesn't know about yet) is treated as unrecognized
 *  and skipped rather than guessed at -- see computeTransitions's use. */
function toLifecycleState(status: string | null): LifecycleState | null {
  if (status === null) return null;
  return isLifecycleState(status) ? status : null;
}

export interface ComputeTransitionsOptions {
  /** Returns true if a live `NNN-<sliceKey>` feature branch currently
   *  exists for the given slice key. Omit to disable branch-derived
   *  "in-progress" detection entirely (equivalent to config's
   *  `branchDetection.enabled: false`). */
  branchDetector?: (sliceKey: string) => boolean;
}

export interface ComputeTransitionsResult {
  /** One entry per slice that (a) has a `tracking` URL bound in the "to"
   *  snapshot, and (b) has a lifecycle-relevant change to report. A slice
   *  unchanged is silently excluded from this list, not reported as a
   *  no-op transition. */
  transitions: Transition[];
  /** Slice keys that changed em-sourced lifecycle status between the two
   *  snapshots but carry NO `tracking` URL -- per MIL-177's "Done when": an
   *  unlinked slice is a VISIBLE no-op, never an error, so callers (the CLI)
   *  should report these explicitly rather than let them vanish silently. */
  untrackedChanges: string[];
}

/**
 * See ComputeTransitionsResult for what's returned and why.
 */
export function computeTransitions(
  fromExport: ExportedModel | undefined,
  toExport: ExportedModel,
  options: ComputeTransitionsOptions = {}
): ComputeTransitionsResult {
  const transitions: Transition[] = [];
  const untrackedChanges: string[] = [];

  for (const toSlice of toExport.model.slices) {
    const fromSlice = findSlice(fromExport, toSlice.key);
    const fromStatus = toLifecycleState(fromSlice?.doc.status ?? null);
    const toStatus = toLifecycleState(toSlice.doc.status);
    if (toStatus === null) continue; // unrecognized/absent status on the "to" side: nothing to mirror.

    const tracking = toSlice.doc.tracking;
    if (!tracking) {
      if (fromStatus !== toStatus) untrackedChanges.push(toSlice.key);
      continue; // unlinked slice: visible no-op (reported above), never an error.
    }

    const liveOnBranch = toStatus === "ready-to-implement" && (options.branchDetector?.(toSlice.key) ?? false);
    const effectiveToStatus: LifecycleState = liveOnBranch ? "in-progress" : toStatus;

    // The "from" side's effective state applies the same branch-derived
    // overlay would-be-applicable retroactively is deliberately NOT
    // computed -- branch existence is a live, current-repo-state fact with
    // no representation in a historical export snapshot, so the only
    // meaningful comparison is against the from side's raw em status.
    // This means: once a branch appears, effectiveToStatus becomes
    // "in-progress" and differs from fromStatus even when the underlying
    // em status did not change across the two revisions -- which is
    // exactly the "derive in-progress for free" signal MIL-177 asks for.
    if (fromStatus === effectiveToStatus) continue;

    transitions.push({
      key: toSlice.key,
      sliceName: toSlice.name,
      tracking,
      fromLifecycle: fromStatus,
      toLifecycle: effectiveToStatus,
      derivedFromBranch: liveOnBranch,
    });
  }

  return { transitions, untrackedChanges };
}
