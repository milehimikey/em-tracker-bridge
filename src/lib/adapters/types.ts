/**
 * The tracker-adapter seam. Everything above this file (config.ts,
 * transitions.ts, lifecycle.ts) knows only about em's own lifecycle
 * vocabulary and the configured target STATE NAME to move an issue to --
 * never about a specific tracker's API shape. Everything below this file
 * (adapters/linear.ts) knows only how to resolve one tracking URL to one
 * issue and move it to a named workflow state for ONE tracker.
 *
 * Adding a second tracker (Jira, MIL-178, not in scope here) means writing
 * a new file that implements this interface and registering it in
 * registry.ts -- no change to config.ts, transitions.ts, or sync.ts.
 */

export interface ResolvedIssue {
  /** Tracker-internal id, opaque to callers. */
  id: string;
  /** Human-readable identifier (e.g. "MIL-177"), for logging only. */
  identifier: string;
  /** The tracking URL this issue was resolved from. */
  url: string;
}

export interface TrackerState {
  id: string;
  name: string;
}

export interface ApplyStateResult {
  issue: ResolvedIssue;
  /** The state the issue was in before this call (by name), or null if it
   *  could not be determined. */
  fromStateName: string | null;
  toStateName: string;
  /** False when the issue was already in the target state -- adapters MUST
   *  be idempotent: applying the same target state twice is a safe no-op,
   *  never an error, since em-tracker-bridge may re-derive the same
   *  branch-based "in-progress" transition on every run while a feature
   *  branch remains live (see lib/transitions.ts). */
  changed: boolean;
}

export interface TrackerAdapter {
  readonly name: string;

  /** Resolves a `tracking:` URL to a concrete issue. Throws (a
   *  BridgeError-wrapped adapter error) if the URL doesn't parse as this
   *  tracker's issue-URL shape, or the API can't find it -- a resolution
   *  failure is always a hard error, never silently skipped, since a
   *  slice's tracking URL pointing at nothing is a real misconfiguration
   *  worth surfacing. */
  resolveIssue(trackingUrl: string): Promise<ResolvedIssue>;

  /** Lists the workflow states available to move `issue` to (e.g. a
   *  Linear team's own states). Used by callers to validate a configured
   *  target state NAME actually exists before attempting to apply it, so a
   *  typo'd `stateMap` entry fails with "no such state, did you mean X"
   *  rather than an opaque API error. */
  listStates(issue: ResolvedIssue): Promise<TrackerState[]>;

  /** Moves `issue` to the workflow state named `targetStateName`. Never
   *  called in --dry-run mode -- callers gate that themselves so this
   *  method can assume it is always live. */
  applyState(issue: ResolvedIssue, targetStateName: string): Promise<ApplyStateResult>;
}
