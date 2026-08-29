/** Minimal flag parser: pulls known `--flag value` pairs and `--boolean-flag`
 *  switches out of argv, leaving the rest as positional args. No dependency
 *  needed for a CLI this small. Copied verbatim from em-sdd-bridge (the mold
 *  this package follows) -- see that repo's src/lib/cli-args.ts. */

import { BridgeError } from "./bridge-error.js";

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
  booleans: Set<string>;
}

export function parseArgs(argv: string[], valueFlags: string[], booleanFlags: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valueFlags.includes(arg)) {
      const name = arg.replace(/^--/, "");
      const value = argv[i + 1];
      // BridgeError (not a raw Error): the CLI entrypoint only pretty-prints
      // BridgeError and rethrows everything else as an uncaught stack trace --
      // a missing flag value is an ordinary user mistake, not a bug, and
      // should get the same clean `em-tracker-bridge: ...` message as any
      // other refusal.
      if (value === undefined) throw new BridgeError(`${arg} requires a value`);
      flags[name] = value;
      i++;
    } else if (booleanFlags.includes(arg)) {
      booleans.add(arg.replace(/^--/, ""));
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags, booleans };
}
