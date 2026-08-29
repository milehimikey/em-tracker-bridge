import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeTransitions } from "../lib/transitions.js";
import type { ExportedModel } from "../lib/export-model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../fixtures");

function loadFixture(name: string): ExportedModel {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8")) as ExportedModel;
}

const ready = loadFixture("export-record-ping-ready.json");
const implemented = loadFixture("export-record-ping-implemented.json");

describe("computeTransitions", () => {
  it("reports a status transition for a tracked slice whose status changed", () => {
    const { transitions, untrackedChanges } = computeTransitions(ready, implemented);
    expect(untrackedChanges).toEqual([]);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      key: "record-ping",
      fromLifecycle: "ready-to-implement",
      toLifecycle: "implemented",
      derivedFromBranch: false,
    });
  });

  it("reports no transitions when both sides are identical", () => {
    const { transitions } = computeTransitions(ready, ready);
    expect(transitions).toEqual([]);
  });

  it("treats an absent 'from' side as fromLifecycle: null (new tracking binding)", () => {
    const { transitions } = computeTransitions(undefined, ready);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromLifecycle).toBeNull();
    expect(transitions[0].toLifecycle).toBe("ready-to-implement");
  });

  it("is a visible no-op (not an error) for a slice with a status change but no tracking URL", () => {
    const untracked: ExportedModel = structuredClone(implemented);
    untracked.model.slices[0].doc.tracking = null;
    const { transitions, untrackedChanges } = computeTransitions(ready, untracked);
    expect(transitions).toEqual([]);
    expect(untrackedChanges).toEqual(["record-ping"]);
  });

  it("silently skips a slice with no tracking URL and no status change", () => {
    const untracked: ExportedModel = structuredClone(ready);
    untracked.model.slices[0].doc.tracking = null;
    const { transitions, untrackedChanges } = computeTransitions(ready, untracked);
    expect(transitions).toEqual([]);
    expect(untrackedChanges).toEqual([]);
  });

  it("derives 'in-progress' from a live feature branch while status is still ready-to-implement", () => {
    const { transitions } = computeTransitions(ready, ready, { branchDetector: (key) => key === "record-ping" });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      fromLifecycle: "ready-to-implement",
      toLifecycle: "in-progress",
      derivedFromBranch: true,
    });
  });

  it("does not derive in-progress once the slice is already implemented", () => {
    const { transitions } = computeTransitions(implemented, implemented, { branchDetector: () => true });
    expect(transitions).toEqual([]);
  });

  it("ignores an unrecognized status on the 'to' side rather than guessing", () => {
    const weird: ExportedModel = structuredClone(ready);
    (weird.model.slices[0].doc as { status: string | null }).status = "some-future-em-status";
    const { transitions, untrackedChanges } = computeTransitions(ready, weird);
    expect(transitions).toEqual([]);
    expect(untrackedChanges).toEqual([]);
  });
});
