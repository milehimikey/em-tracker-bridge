import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findLiveFeatureBranch } from "../lib/branch-detection.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-branch-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(path.join(dir, "README.md"), "hello\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

describe("findLiveFeatureBranch", () => {
  it("returns undefined when no matching branch exists", () => {
    const repo = initRepo();
    expect(findLiveFeatureBranch(repo, "record-ping", true)).toBeUndefined();
  });

  it("finds a local NNN-<slice-key> branch", () => {
    const repo = initRepo();
    git(repo, ["branch", "003-record-ping"]);
    expect(findLiveFeatureBranch(repo, "record-ping", true)).toBe("003-record-ping");
  });

  it("does not match a branch whose slug merely starts with the slice key", () => {
    const repo = initRepo();
    git(repo, ["branch", "003-record-ping-extra"]);
    expect(findLiveFeatureBranch(repo, "record-ping", true)).toBeUndefined();
  });

  it("does not match an unrelated branch name", () => {
    const repo = initRepo();
    git(repo, ["branch", "main-2"]);
    git(repo, ["branch", "feature/record-ping"]); // no leading digits -- not the convention
    expect(findLiveFeatureBranch(repo, "record-ping", true)).toBeUndefined();
  });
});
