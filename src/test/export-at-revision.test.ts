import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileAtRevision, exportAtRevision, exportAtSide } from "../lib/export-at-revision.js";

function hasEm(): boolean {
  try {
    execFileSync("em", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
}

/** Sets up a repo with two commits of model.em: v1 has one slice with
 *  status "ready-to-implement", v2 has moved it to "implemented" -- so a
 *  revision-diff test has real content to compare. Content itself doesn't
 *  need to be valid `em` DSL for readFileAtRevision tests (those never
 *  shell out to `em`); it only needs to be for exportAtRevision tests
 *  (hasEm()-gated below). */
function initRepoWithTwoRevisions(): { repoRoot: string; v1Sha: string; v2Sha: string; modelPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-export-rev-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);

  const modelPath = path.join(dir, "model.em");
  writeFileSync(modelPath, "model v1\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "v1"]);
  const v1Sha = git(dir, ["rev-parse", "HEAD"]).trim();

  writeFileSync(modelPath, "model v2\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "v2"]);
  const v2Sha = git(dir, ["rev-parse", "HEAD"]).trim();

  return { repoRoot: dir, v1Sha, v2Sha, modelPath };
}

describe("readFileAtRevision", () => {
  it("reads a file's content as it existed at an older revision", () => {
    const { repoRoot, v1Sha, modelPath } = initRepoWithTwoRevisions();
    expect(readFileAtRevision(repoRoot, modelPath, v1Sha)).toBe("model v1\n");
  });

  it("reads the current committed content at HEAD", () => {
    const { repoRoot, modelPath } = initRepoWithTwoRevisions();
    expect(readFileAtRevision(repoRoot, modelPath, "HEAD")).toBe("model v2\n");
  });

  it("returns undefined (not an error) when the path did not exist at that revision", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-export-rev-"));
    tmpDirs.push(dir);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    writeFileSync(path.join(dir, "README.md"), "no model yet\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "before model existed"]);
    const beforeSha = git(dir, ["rev-parse", "HEAD"]).trim();

    expect(readFileAtRevision(dir, path.join(dir, "model.em"), beforeSha)).toBeUndefined();
  });

  it("throws a BridgeError for a revision that does not resolve at all", () => {
    const { repoRoot, modelPath } = initRepoWithTwoRevisions();
    expect(() => readFileAtRevision(repoRoot, modelPath, "not-a-real-rev")).toThrow(/git show/);
  });
});

describe.skipIf(!hasEm())("exportAtRevision / exportAtSide (real em)", () => {
  it("exports the model as it existed at an older revision, distinct from the current export", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-export-rev-real-"));
    tmpDirs.push(dir);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);

    const modelPath = path.join(dir, "model.em");
    writeFileSync(modelPath, 'model "Rev Test"\n');
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "v1"]);
    const v1Sha = git(dir, ["rev-parse", "HEAD"]).trim();

    const atV1 = exportAtRevision(dir, modelPath, v1Sha);
    expect(atV1?.model.name).toBe("Rev Test");

    const atWorkingTree = exportAtSide(dir, modelPath, undefined);
    expect(atWorkingTree?.model.name).toBe("Rev Test");
  });

  it("exportAtRevision returns undefined when the model did not exist at that revision", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-export-rev-real-"));
    tmpDirs.push(dir);
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    writeFileSync(path.join(dir, "README.md"), "placeholder\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "before model"]);
    const beforeSha = git(dir, ["rev-parse", "HEAD"]).trim();

    expect(exportAtRevision(dir, path.join(dir, "model.em"), beforeSha)).toBeUndefined();
  });
});
