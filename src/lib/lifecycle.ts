/**
 * The lifecycle vocabulary this bridge mirrors into a tracker's own
 * workflow states.
 *
 * The first four are exactly em's own slice-doc `status:` values (see
 * export-model.ts's `EmSliceStatus`) -- this package never invents new em
 * statuses. `"in-progress"` is a fifth, BRIDGE-ONLY state: em has no such
 * status (a slice is `ready-to-implement` for its entire implementation
 * window), so this bridge derives it itself from a live `NNN-<slice-key>`
 * feature-branch existing in the repo (the em-sdd-bridge allocation
 * convention -- see lib/branch-detection.ts), per MIL-177's "derive
 * in-progress for free" requirement. It is never read from `em export`,
 * and never fed back into it -- purely a bridge-side enrichment on top of
 * the em-sourced status, applied only while the underlying em status is
 * still `ready-to-implement`.
 *
 * This is the seam a future adapter (Jira, MIL-178) maps FROM -- adapters
 * only ever see this closed vocabulary, never em's raw status string or
 * tracker-specific state names directly, so adding a tracker is "write an
 * adapter" (config.ts + adapters/<name>.ts), never "fork the detection or
 * state-mapping logic".
 */
export const LIFECYCLE_STATES = ["draft", "reviewed", "ready-to-implement", "in-progress", "implemented"] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}
