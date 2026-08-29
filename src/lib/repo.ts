import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Resolve the git repository root containing `startDir`, via
 * `git rev-parse --show-toplevel`. Unlike em-sdd-bridge (which walks up
 * looking for a `.specify/` directory, a spec-kit convention),
 * em-tracker-bridge has no framework-specific marker to look for -- it
 * shells out to `git show <rev>:<path>` to read prior revisions of the
 * model file, so the repo root it needs is git's own idea of one.
 *
 * Returns undefined (never throws) when `startDir` is not inside a git
 * working tree -- callers decide how to fail on that.
 */
export function findRepoRoot(startDir: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", path.resolve(startDir), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
