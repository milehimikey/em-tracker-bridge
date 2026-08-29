/**
 * Reads `em export` output for a model file as it existed at a given git
 * revision, or the current working-tree content when no revision is given.
 *
 * `em export` itself has no `--from`/`--to`/`--rev` flag (confirmed against
 * em main, 2026-08-28) -- unlike `em diff`, which resolves git revisions
 * natively via its own `--from`/`--to`. This package does NOT use `em diff`
 * for lifecycle-transition detection: `em diff` is a purely structural diff
 * over `.em` DSL source (slices/elements/fields/notes/arrows) and never
 * reads or reports a slice doc's `status:` frontmatter -- there is no
 * `ChangeType` for a status transition. So detecting a status transition
 * means running `em export` twice (once per revision) and diffing
 * `slice.doc.status` client-side, which is exactly what this module and
 * lib/transitions.ts do. `git show <rev>:<path>` is done here, ourselves,
 * mirroring the internal approach em's own `--from`/`--to` uses for `em
 * diff` (per em's src/cli/diff-inputs.ts).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BridgeError } from "./bridge-error.js";
import { runEmExport } from "./em-runner.js";
import type { ExportedModel } from "./export-model.js";

/**
 * Returns the model file's content at `rev` (a git revision expression:
 * a commit SHA, tag, or ref like `HEAD~1`), or `undefined` if the path did
 * not exist at that revision (a genuinely absent prior state -- e.g. the
 * model was added after `rev` -- which callers must treat as "no prior
 * export", not as an error). A `rev` that doesn't resolve at all (a typo,
 * an unknown ref) is a hard BridgeError -- that's an operator mistake, not
 * a legitimate "nothing there yet".
 */
export function readFileAtRevision(repoRootGit: string, absoluteFilePath: string, rev: string): string | undefined {
  const relPath = path.relative(repoRootGit, absoluteFilePath);
  if (relPath.startsWith("..")) {
    throw new BridgeError(`${absoluteFilePath} is not inside git repo root ${repoRootGit}.`);
  }
  // Use forward slashes -- git's own path syntax inside `<rev>:<path>`,
  // even on Windows.
  const gitPath = relPath.split(path.sep).join("/");
  try {
    return execFileSync("git", ["-C", repoRootGit, "show", `${rev}:${gitPath}`], { encoding: "utf8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // git show's stderr distinguishes "bad revision" (operator typo, must
    // fail loud) from "path X does not exist in Y" (legitimate absence,
    // e.g. diffing against a revision before the model file was added).
    if (/exists on disk, but not in/.test(message) || /does not exist in/.test(message)) {
      return undefined;
    }
    throw new BridgeError(`\`git show ${rev}:${gitPath}\` failed: ${message}`);
  }
}

/**
 * Runs `em export` against the model as it existed at `rev`, by writing the
 * revision's content to a throwaway temp file (so `em`'s own file-reading
 * and repo-root-relative source-path logic runs unmodified) and cleaning up
 * afterward. Returns `undefined` when the model file did not exist at
 * `rev` (see readFileAtRevision) -- a legitimate "no prior export", never
 * an error.
 */
export function exportAtRevision(repoRootGit: string, absoluteModelPath: string, rev: string): ExportedModel | undefined {
  const content = readFileAtRevision(repoRootGit, absoluteModelPath, rev);
  if (content === undefined) return undefined;

  const tmpDir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-"));
  try {
    const tmpModelPath = path.join(tmpDir, path.basename(absoluteModelPath));
    writeFileSync(tmpModelPath, content, "utf8");
    return runEmExport(tmpModelPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Resolves one "side" of a sync (the `--from`/`--to` CLI flags): a git
 * revision string, or `undefined` meaning "the current working-tree file,
 * exported directly (no git involved)". Working-tree export goes through
 * the exact same `runEmExport` as every other export in this package --
 * only the *sourcing* of the model content differs (disk vs. git object).
 */
export function exportAtSide(
  repoRootGit: string,
  absoluteModelPath: string,
  rev: string | undefined
): ExportedModel | undefined {
  if (rev === undefined) return runEmExport(absoluteModelPath);
  return exportAtRevision(repoRootGit, absoluteModelPath, rev);
}
