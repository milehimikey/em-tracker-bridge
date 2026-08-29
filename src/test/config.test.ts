import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, parseConfig } from "../lib/config.js";
import { BridgeError } from "../lib/bridge-error.js";

describe("parseConfig", () => {
  it("accepts a minimal valid linear config", () => {
    const config = parseConfig(
      { tracker: "linear", stateMap: { "ready-to-implement": "Todo", implemented: "Done" } },
      "test"
    );
    expect(config.tracker).toBe("linear");
    expect(config.stateMap["ready-to-implement"]).toBe("Todo");
    expect(config.branchDetection).toEqual({ enabled: true, includeRemote: true });
  });

  it("accepts an explicit null stateMap entry as a deliberate no-op", () => {
    const config = parseConfig({ tracker: "linear", stateMap: { draft: null } }, "test");
    expect(config.stateMap.draft).toBeNull();
  });

  it("accepts a branchDetection override", () => {
    const config = parseConfig(
      { tracker: "linear", stateMap: {}, branchDetection: { enabled: false, includeRemote: false } },
      "test"
    );
    expect(config.branchDetection).toEqual({ enabled: false, includeRemote: false });
  });

  it("rejects a non-object top level", () => {
    expect(() => parseConfig([], "test")).toThrow(BridgeError);
    expect(() => parseConfig("nope", "test")).toThrow(BridgeError);
  });

  it("rejects an unknown tracker", () => {
    expect(() => parseConfig({ tracker: "asana", stateMap: {} }, "test")).toThrow(/must be "linear"/);
  });

  it("rejects the reserved jira tracker with a clear not-implemented message", () => {
    expect(() => parseConfig({ tracker: "jira", stateMap: {} }, "test")).toThrow(/reserved for a future adapter/);
  });

  it("rejects an unknown lifecycle state key in stateMap", () => {
    expect(() => parseConfig({ tracker: "linear", stateMap: { bogus: "X" } }, "test")).toThrow(
      /unknown lifecycle state/
    );
  });

  it("rejects a non-string, non-null stateMap value", () => {
    expect(() => parseConfig({ tracker: "linear", stateMap: { draft: 42 } }, "test")).toThrow(
      /must be a string.*or null/
    );
  });

  it("rejects a non-object branchDetection", () => {
    expect(() => parseConfig({ tracker: "linear", stateMap: {}, branchDetection: "yes" }, "test")).toThrow(
      /"branchDetection" must be an object/
    );
  });
});

describe("loadConfig", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  function mkTmp(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "em-tracker-bridge-config-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("throws a BridgeError when no config file exists at the default path", () => {
    const repoRoot = mkTmp();
    expect(() => loadConfig(repoRoot)).toThrow(BridgeError);
    expect(() => loadConfig(repoRoot)).toThrow(/No config file found/);
  });

  it("loads the default .em-tracker-bridge.json at repo root", () => {
    const repoRoot = mkTmp();
    writeFileSync(
      path.join(repoRoot, ".em-tracker-bridge.json"),
      JSON.stringify({ tracker: "linear", stateMap: { implemented: "Done" } })
    );
    const config = loadConfig(repoRoot);
    expect(config.stateMap.implemented).toBe("Done");
  });

  it("honors an explicit --config path, relative to repoRoot", () => {
    const repoRoot = mkTmp();
    writeFileSync(path.join(repoRoot, "custom.json"), JSON.stringify({ tracker: "linear", stateMap: {} }));
    const config = loadConfig(repoRoot, "custom.json");
    expect(config.tracker).toBe("linear");
  });

  it("throws a BridgeError on malformed JSON", () => {
    const repoRoot = mkTmp();
    writeFileSync(path.join(repoRoot, ".em-tracker-bridge.json"), "{not json");
    expect(() => loadConfig(repoRoot)).toThrow(/could not parse as JSON/);
  });
});
