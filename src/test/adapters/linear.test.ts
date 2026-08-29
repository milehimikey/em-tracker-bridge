import { describe, expect, it, vi } from "vitest";
import { createLinearAdapter, parseLinearIssueUrl } from "../../lib/adapters/linear.js";
import { BridgeError } from "../../lib/bridge-error.js";

const TRACKING_URL = "https://linear.app/milehimikey/issue/MIL-177/mirror-slice-lifecycle-transitions-to-linear-issue-states";

const STATES = [
  { id: "state-backlog", name: "Backlog" },
  { id: "state-todo", name: "Todo" },
  { id: "state-in-progress", name: "In Progress" },
  { id: "state-done", name: "Done" },
];

function issuePayload(stateName: string | null) {
  return {
    issue: {
      id: "issue-uuid-1",
      identifier: "MIL-177",
      url: TRACKING_URL,
      state: stateName ? { id: `state-${stateName}`, name: stateName } : null,
      team: { id: "team-uuid-1", states: { nodes: STATES } },
    },
  };
}

describe("parseLinearIssueUrl", () => {
  it("extracts the identifier from a Linear issue URL", () => {
    expect(parseLinearIssueUrl(TRACKING_URL)).toBe("MIL-177");
  });

  it("throws a BridgeError for a URL that isn't a Linear issue URL", () => {
    expect(() => parseLinearIssueUrl("https://example.com/not-linear")).toThrow(BridgeError);
  });
});

describe("createLinearAdapter", () => {
  it("resolveIssue parses the tracking URL and queries by identifier", async () => {
    const request = vi.fn().mockResolvedValue(issuePayload("Todo"));
    const adapter = createLinearAdapter({ getApiKey: () => "fake-key", request });

    const issue = await adapter.resolveIssue(TRACKING_URL);

    expect(issue).toEqual({ id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL });
    expect(request).toHaveBeenCalledWith(expect.stringContaining("query IssueByIdentifier"), { id: "MIL-177" }, "fake-key");
  });

  it("throws when LINEAR_API_KEY is unavailable, without making a request", async () => {
    const request = vi.fn();
    const adapter = createLinearAdapter({ getApiKey: () => undefined, request });

    await expect(adapter.resolveIssue(TRACKING_URL)).rejects.toThrow(/LINEAR_API_KEY is not set/);
    expect(request).not.toHaveBeenCalled();
  });

  it("listStates returns the issue's team's workflow states", async () => {
    const request = vi.fn().mockResolvedValue(issuePayload("Todo"));
    const adapter = createLinearAdapter({ getApiKey: () => "fake-key", request });

    const states = await adapter.listStates({ id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL });
    expect(states).toEqual(STATES);
  });

  it("applyState is a no-op (changed: false) when the issue is already in the target state", async () => {
    const request = vi.fn().mockResolvedValue(issuePayload("In Progress"));
    const adapter = createLinearAdapter({ getApiKey: () => "fake-key", request });

    const result = await adapter.applyState(
      { id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL },
      "In Progress"
    );

    expect(result).toEqual({
      issue: { id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL },
      fromStateName: "In Progress",
      toStateName: "In Progress",
      changed: false,
    });
    // Only the read query ran -- no mutation was sent for a no-op.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("applyState moves the issue and reports changed: true", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(issuePayload("Todo")) // the read inside applyState
      .mockResolvedValueOnce({ issueUpdate: { success: true, issue: { id: "issue-uuid-1", state: { id: "state-done", name: "Done" } } } });
    const adapter = createLinearAdapter({ getApiKey: () => "fake-key", request });

    const result = await adapter.applyState(
      { id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL },
      "Done"
    );

    expect(result).toEqual({
      issue: { id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL },
      fromStateName: "Todo",
      toStateName: "Done",
      changed: true,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      expect.stringContaining("mutation UpdateIssueState"),
      { id: "issue-uuid-1", stateId: "state-done" },
      "fake-key"
    );
  });

  it("applyState throws a BridgeError naming available states when the target state name doesn't exist", async () => {
    const request = vi.fn().mockResolvedValue(issuePayload("Todo"));
    const adapter = createLinearAdapter({ getApiKey: () => "fake-key", request });

    await expect(
      adapter.applyState({ id: "issue-uuid-1", identifier: "MIL-177", url: TRACKING_URL }, "Nonexistent State")
    ).rejects.toThrow(/no workflow state named "Nonexistent State".*Backlog, Todo, In Progress, Done/s);
  });

  it("throws when Linear has no issue matching the identifier", async () => {
    const request = vi.fn().mockResolvedValue({ issue: null });
    const adapter = createLinearAdapter({ getApiKey: () => "fake-key", request });

    await expect(adapter.resolveIssue(TRACKING_URL)).rejects.toThrow(/no issue matching identifier "MIL-177"/);
  });
});
