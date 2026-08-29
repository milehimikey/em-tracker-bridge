import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "../lib/sync.js";
import type { BridgeConfig } from "../lib/config.js";
import type { ExportedModel } from "../lib/export-model.js";
import type { TrackerAdapter } from "../lib/adapters/types.js";
import { BridgeError } from "../lib/bridge-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");

function loadFixture(name: string): ExportedModel {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8")) as ExportedModel;
}

const ready = loadFixture("export-record-ping-ready.json");
const implemented = loadFixture("export-record-ping-implemented.json");

const baseConfig: BridgeConfig = {
  tracker: "linear",
  stateMap: {
    draft: null,
    reviewed: "Backlog",
    "ready-to-implement": "Todo",
    "in-progress": "In Progress",
    implemented: "Done",
  },
  branchDetection: { enabled: false, includeRemote: false },
};

function fakeAdapter(applyState = vi.fn()): TrackerAdapter {
  return {
    name: "fake",
    resolveIssue: vi.fn().mockResolvedValue({ id: "id-1", identifier: "MIL-177", url: "https://linear.app/x/issue/MIL-177/y" }),
    listStates: vi.fn().mockResolvedValue([]),
    applyState,
  };
}

describe("runSync", () => {
  it("dry-run reports planned transitions and never touches the adapter", async () => {
    const applyState = vi.fn();
    const result = await runSync({
      repoRootGit: "/unused",
      modelPath: "/unused/model.em",
      config: baseConfig,
      from: "HEAD",
      dryRun: true,
      exportSideOverride: (rev) => (rev === "HEAD" ? ready : implemented),
      adapterOverride: fakeAdapter(applyState),
    });

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]).toMatchObject({ key: "record-ping", targetStateName: "Done" });
    expect(result.applied).toEqual([]);
    expect(applyState).not.toHaveBeenCalled();
  });

  it("applies planned transitions through the adapter when not a dry run", async () => {
    const applyState = vi.fn().mockResolvedValue({
      issue: { id: "id-1", identifier: "MIL-177", url: "https://linear.app/x/issue/MIL-177/y" },
      fromStateName: "Todo",
      toStateName: "Done",
      changed: true,
    });
    const adapter = fakeAdapter(applyState);

    const result = await runSync({
      repoRootGit: "/unused",
      modelPath: "/unused/model.em",
      config: baseConfig,
      from: "HEAD",
      dryRun: false,
      exportSideOverride: (rev) => (rev === "HEAD" ? ready : implemented),
      adapterOverride: adapter,
    });

    expect(adapter.resolveIssue).toHaveBeenCalledWith(
      "https://linear.app/milehimikey/issue/MIL-177/mirror-slice-lifecycle-transitions-to-linear-issue-states"
    );
    expect(applyState).toHaveBeenCalledWith(expect.objectContaining({ identifier: "MIL-177" }), "Done");
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toMatchObject({ key: "record-ping", changed: true, toStateName: "Done" });
  });

  it("surfaces a slice mapped to null in stateMap as skippedAsNoOp, without calling the adapter for it", async () => {
    const configWithNoOpImplemented: BridgeConfig = {
      ...baseConfig,
      stateMap: { ...baseConfig.stateMap, implemented: null },
    };
    const applyState = vi.fn();

    const result = await runSync({
      repoRootGit: "/unused",
      modelPath: "/unused/model.em",
      config: configWithNoOpImplemented,
      from: "HEAD",
      dryRun: false,
      exportSideOverride: (rev) => (rev === "HEAD" ? ready : implemented),
      adapterOverride: fakeAdapter(applyState),
    });

    expect(result.skippedAsNoOp).toEqual(["record-ping"]);
    expect(result.applied).toEqual([]);
    expect(applyState).not.toHaveBeenCalled();
  });

  it("fails closed (before applying anything) when a lifecycle state has no stateMap entry", async () => {
    const incompleteConfig: BridgeConfig = { ...baseConfig, stateMap: { draft: null } };
    const applyState = vi.fn();

    await expect(
      runSync({
        repoRootGit: "/unused",
        modelPath: "/unused/model.em",
        config: incompleteConfig,
        from: "HEAD",
        dryRun: false,
        exportSideOverride: (rev) => (rev === "HEAD" ? ready : implemented),
        adapterOverride: fakeAdapter(applyState),
      })
    ).rejects.toThrow(BridgeError);
    expect(applyState).not.toHaveBeenCalled();
  });

  it("throws when the model does not exist at the 'to' side", async () => {
    await expect(
      runSync({
        repoRootGit: "/unused",
        modelPath: "/unused/model.em",
        config: baseConfig,
        from: "HEAD",
        dryRun: true,
        exportSideOverride: () => undefined,
      })
    ).rejects.toThrow(/does not exist at the "to" side/);
  });

  it("reports untracked lifecycle changes without erroring", async () => {
    const untracked: ExportedModel = structuredClone(implemented);
    untracked.model.slices[0].doc.tracking = null;

    const result = await runSync({
      repoRootGit: "/unused",
      modelPath: "/unused/model.em",
      config: baseConfig,
      from: "HEAD",
      dryRun: true,
      exportSideOverride: (rev) => (rev === "HEAD" ? ready : untracked),
    });

    expect(result.untrackedChanges).toEqual(["record-ping"]);
    expect(result.planned).toEqual([]);
  });
});
