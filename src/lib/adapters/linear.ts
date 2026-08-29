/**
 * Linear adapter -- the first (and, for 0.1.0, only) TrackerAdapter
 * implementation. See adapters/types.ts for the seam this implements.
 *
 * Auth: the `LINEAR_API_KEY` env var, read lazily (at call time, not at
 * adapter-construction time) so simply CREATING the adapter never requires
 * the key -- only actually resolving/applying a state does. This keeps
 * `--dry-run`'s "never calls the API" guarantee trivial: sync.ts never
 * constructs or calls this adapter at all in dry-run mode.
 *
 * The HTTP transport (`request`) is injectable for testing -- this
 * package's test suite mocks it entirely; no live Linear API call is made
 * by `npm test`. Live validation against the real Linear API happens in a
 * later integration phase, not here.
 */

import { BridgeError } from "../bridge-error.js";
import type { ApplyStateResult, ResolvedIssue, TrackerAdapter, TrackerState } from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

export type LinearRequestFn = (query: string, variables: Record<string, unknown>, apiKey: string) => Promise<unknown>;

export interface LinearAdapterOptions {
  /** Overridable for tests. Defaults to reading `LINEAR_API_KEY` from the
   *  environment at call time. */
  getApiKey?: () => string | undefined;
  /** Overridable transport for tests. Defaults to a real POST via the
   *  global `fetch` (Node >=20 ships one natively -- no HTTP dependency
   *  needed). Must return the GraphQL response's `data` object, or throw. */
  request?: LinearRequestFn;
}

function defaultGetApiKey(): string | undefined {
  return process.env.LINEAR_API_KEY;
}

async function defaultRequest(query: string, variables: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json().catch(() => undefined);
  if (!res.ok || json?.errors) {
    const message = json?.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`;
    throw new BridgeError(`Linear API request failed: ${message}`);
  }
  return json?.data;
}

/** Extracts a Linear issue identifier (e.g. "MIL-177") from a tracking URL
 *  shaped like `https://linear.app/<workspace>/issue/<IDENTIFIER>/<slug>`
 *  (the shape em-tracker-bridge's own tracking URLs use -- see the ticket
 *  URLs returned by Linear's own MCP/API). */
export function parseLinearIssueUrl(url: string): string {
  const m = url.match(/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/);
  if (!m) {
    throw new BridgeError(`"${url}" does not look like a Linear issue URL (expected .../issue/<IDENTIFIER>/...).`);
  }
  return m[1];
}

const ISSUE_QUERY = `
  query IssueByIdentifier($id: String!) {
    issue(id: $id) {
      id
      identifier
      url
      state { id name }
      team {
        id
        states { nodes { id name } }
      }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation UpdateIssueState($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { id state { id name } }
    }
  }
`;

interface LinearIssuePayload {
  id: string;
  identifier: string;
  url: string;
  state: { id: string; name: string } | null;
  team: { id: string; states: { nodes: TrackerState[] } };
}

export function createLinearAdapter(options: LinearAdapterOptions = {}): TrackerAdapter {
  const getApiKey = options.getApiKey ?? defaultGetApiKey;
  const request = options.request ?? defaultRequest;

  function requireApiKey(): string {
    const key = getApiKey();
    if (!key) {
      throw new BridgeError(
        "LINEAR_API_KEY is not set. em-tracker-bridge's Linear adapter requires it for any non-dry-run " +
          "sync (dry-run never reaches this check -- it never calls the Linear API at all)."
      );
    }
    return key;
  }

  async function fetchIssue(identifier: string): Promise<LinearIssuePayload> {
    const apiKey = requireApiKey();
    const data = (await request(ISSUE_QUERY, { id: identifier }, apiKey)) as { issue?: LinearIssuePayload } | undefined;
    if (!data?.issue) {
      throw new BridgeError(`Linear has no issue matching identifier "${identifier}".`);
    }
    return data.issue;
  }

  return {
    name: "linear",

    async resolveIssue(trackingUrl: string): Promise<ResolvedIssue> {
      const identifier = parseLinearIssueUrl(trackingUrl);
      const issue = await fetchIssue(identifier);
      return { id: issue.id, identifier: issue.identifier, url: issue.url };
    },

    async listStates(issue: ResolvedIssue): Promise<TrackerState[]> {
      const fetched = await fetchIssue(issue.identifier);
      return fetched.team.states.nodes;
    },

    async applyState(issue: ResolvedIssue, targetStateName: string): Promise<ApplyStateResult> {
      const apiKey = requireApiKey();
      const fetched = await fetchIssue(issue.identifier);
      const currentName = fetched.state?.name ?? null;
      if (currentName === targetStateName) {
        return { issue, fromStateName: currentName, toStateName: targetStateName, changed: false };
      }

      const target = fetched.team.states.nodes.find((s) => s.name === targetStateName);
      if (!target) {
        const available = fetched.team.states.nodes.map((s) => s.name).join(", ");
        throw new BridgeError(
          `Linear team for issue ${issue.identifier} has no workflow state named "${targetStateName}". ` +
            `Available states: ${available}.`
        );
      }

      await request(ISSUE_UPDATE_MUTATION, { id: fetched.id, stateId: target.id }, apiKey);
      return { issue, fromStateName: currentName, toStateName: targetStateName, changed: true };
    },
  };
}
