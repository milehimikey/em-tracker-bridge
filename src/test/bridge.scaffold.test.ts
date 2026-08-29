import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runScaffoldCheck } from "../bridge.js";
import { BridgeError } from "../lib/bridge-error.js";

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

function mkRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-scaffold-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(path.join(dir, "model.em"), 'model "Scaffold Test"\n');
  writeFileSync(
    path.join(dir, ".em-tracker-bridge.json"),
    JSON.stringify({ tracker: "linear", stateMap: { implemented: "Done" } })
  );
  return dir;
}

describe.skipIf(!hasEm())("runScaffoldCheck (real em on PATH)", () => {
  it("resolves repo root, model path, and config together", () => {
    const repoRoot = mkRepo();
    const result = runScaffoldCheck(["--repo-root", repoRoot]);
    expect(result.repoRoot).toBe(repoRoot);
    expect(result.modelPath).toBe(path.join(repoRoot, "model.em"));
    expect(result.config.tracker).toBe("linear");
  });

  it("fails closed when no config file exists", () => {
    const repoRoot = mkRepo();
    rmSync(path.join(repoRoot, ".em-tracker-bridge.json"));
    expect(() => runScaffoldCheck(["--repo-root", repoRoot])).toThrow(BridgeError);
  });

  it("rejects positional arguments", () => {
    const repoRoot = mkRepo();
    expect(() => runScaffoldCheck(["some-slice-key", "--repo-root", repoRoot])).toThrow(
      /takes no positional arguments/
    );
  });
});
