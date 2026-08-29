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
 * lib/transitions.ts do. Reconstructing a revision's tree ourselves (via
 * `git archive`, see exportAtRevision below) is the same kind of git
 * plumbing em's own `--from`/`--to` do internally for `em diff` (per em's
 * src/cli/diff-inputs.ts), applied here to a real `em export` invocation
 * instead.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
 * Runs `em export` against the model as it existed at `rev`.
 *
 * Reconstructs the FULL repo tree at `rev` into a throwaway temp directory
 * via `git archive | tar -x`, preserving every file's path relative to the
 * repo root -- not just the model file in isolation. This matters: `em`'s
 * doc-join resolves a slice's bound doc (the `note "slices/<key>.md"`
 * convention) relative to the model file's own directory, so any real
 * project keeping slice docs in a sibling directory (the norm -- confirmed
 * against a real meridian-goods-shaped repo during MIL-177 integration
 * testing, where an earlier single-file-only version of this function
 * produced a silent "no such file exists" doc-join failure and reported
 * zero transitions) needs that sibling directory present too. Writing only
 * the model file to an empty temp dir looks like it works against a
 * fixture with no doc bindings, but is wrong for anything with slice docs.
 *
 * Returns `undefined` when the model file did not exist at `rev` (see
 * readFileAtRevision) -- a legitimate "no prior export", never an error.
 */
export function exportAtRevision(repoRootGit: string, absoluteModelPath: string, rev: string): ExportedModel | undefined {
  // Cheap existence/bad-revision check first (see readFileAtRevision's own
  // doc comment) before paying for a full-tree archive.
  const exists = readFileAtRevision(repoRootGit, absoluteModelPath, rev) !== undefined;
  if (!exists) return undefined;

  const relModelPath = path.relative(repoRootGit, absoluteModelPath);

  const tmpDir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-"));
  try {
    const archive = spawnSync("git", ["-C", repoRootGit, "archive", rev], { maxBuffer: 1024 * 1024 * 1024 });
    if (archive.status !== 0) {
      const stderr = archive.stderr?.toString("utf8") ?? "";
      throw new BridgeError(`\`git archive ${rev}\` failed: ${stderr || `exit code ${archive.status}`}`);
    }
    const extract = spawnSync("tar", ["-x", "-C", tmpDir], { input: archive.stdout });
    if (extract.status !== 0) {
      const stderr = extract.stderr?.toString("utf8") ?? "";
      throw new BridgeError(`Extracting the \`git archive ${rev}\` snapshot failed: ${stderr || `exit code ${extract.status}`}`);
    }

    const tmpModelPath = path.join(tmpDir, relModelPath);
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
