import { BridgeError } from "../bridge-error.js";
import type { TrackerName } from "../config.js";
import type { TrackerAdapter } from "./types.js";
import { createLinearAdapter } from "./linear.js";

/** Resolves a configured tracker name to its adapter implementation.
 *  config.ts already rejects "jira" at load time (reserved, not
 *  implemented), so the only name that can reach here is "linear" -- the
 *  `default` branch below is defensive, not a real runtime path. */
export function getAdapter(tracker: TrackerName): TrackerAdapter {
  switch (tracker) {
    case "linear":
      return createLinearAdapter();
    default:
      throw new BridgeError(`No adapter implemented for tracker "${tracker}".`);
  }
}
