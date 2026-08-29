/**
 * Derives the bridge-only "in-progress" lifecycle state (lib/lifecycle.ts)
 * from a live feature branch, per MIL-177: "Derive 'in progress' for free
 * from a live NNN-slug sdd-bridge feature branch."
 *
 * em-sdd-bridge's `allocateFeature()` (src/lib/allocate-feature.ts there)
 * creates spec-kit feature branches named `NNN-<shortName>`, where
 * `shortName` is the slice key itself (em-sdd-bridge's bridge.ts passes
 * `shortName = primary.key`). So a slice's implementation being under way
 * shows up as a branch matching `<digits>-<slice-key>` existing in the
 * repo -- checked here, live, against the CURRENT repo state (this is
 * NOT something diffable between two `em export` snapshots; branch
 * existence has no representation in export JSON at all).
 */

import { execFileSync } from "node:child_process";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `NNN-<sliceKey>` as a full branch-name path segment, optionally
 *  prefixed by a remote name (`origin/003-record-ping`) or preceded by other
 *  path segments -- anchored at the end so `003-record-ping-extra` (a
 *  different, longer slug) does not falsely match `record-ping`. */
function branchPattern(sliceKey: string): RegExp {
  return new RegExp(`(^|/)\\d+-${escapeRegExp(sliceKey)}$`);
}

function listBranches(repoRootGit: string, args: string[]): string[] {
  try {
    const out = execFileSync("git", ["-C", repoRootGit, "branch", ...args, "--format=%(refname:short)"], {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    // A repo with zero branches (e.g. a fresh scratch clone) or a `git
    // branch` invocation failure is treated as "nothing found" -- this is
    // an enrichment signal, never a hard gate, so it fails open to "no
    // branch detected" rather than aborting the whole sync.
    return [];
  }
}

/**
 * Returns the matching branch name (local or, if `includeRemote`, a
 * remote-tracking ref) for `sliceKey`, or undefined if none exists.
 */
export function findLiveFeatureBranch(repoRootGit: string, sliceKey: string, includeRemote: boolean): string | undefined {
  const pattern = branchPattern(sliceKey);
  const local = listBranches(repoRootGit, []);
  const localMatch = local.find((b) => pattern.test(b));
  if (localMatch) return localMatch;

  if (includeRemote) {
    const remote = listBranches(repoRootGit, ["-r"]);
    const remoteMatch = remote.find((b) => pattern.test(b));
    if (remoteMatch) return remoteMatch;
  }

  return undefined;
}
