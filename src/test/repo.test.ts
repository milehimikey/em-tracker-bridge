import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findRepoRoot } from "../lib/repo.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function mkTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-repo-"));
  tmpDirs.push(dir);
  return dir;
}

describe("findRepoRoot", () => {
  it("returns the git root for a directory inside a git working tree", () => {
    const dir = mkTmp();
    execFileSync("git", ["-C", dir, "init", "-q"]);
    const nested = path.join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    const found = findRepoRoot(nested);
    // Resolve both sides through realpath-equivalent (macOS temp dirs can be
    // symlinked, e.g. /tmp -> /private/tmp) via a second `git rev-parse` on
    // the expected dir, so this assertion doesn't depend on symlink
    // resolution behaving identically to `path.resolve`.
    const expected = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    expect(found).toBe(expected);
  });

  it("returns undefined outside any git working tree", () => {
    // A tmp dir with no git init anywhere above it in this environment's
    // tmp root is not guaranteed in general, but our own mkTmp() dirs are
    // never git repos unless a test initializes one -- this one doesn't.
    // If the OS temp root itself happens to be inside a git repo (unusual),
    // this assertion would need HOME-relative isolation; not the case here.
    const dir = mkTmp();
    expect(findRepoRoot(dir)).toBeUndefined();
  });
});
