/**
 * Minimum-`em`-version check. Shells out to `em --version`, parses the
 * semver, and compares it against a supported floor. Runs before any other
 * precondition -- an unsupported `em` invalidates everything downstream
 * (export shape, doc-join fields), so failing here first keeps later error
 * messages honest about what actually went wrong.
 *
 * Structure and fail-closed discipline copied from em-sdd-bridge's
 * src/lib/check-em-version.ts (the mold this package follows).
 *
 * The floor tracks the `em` version this bridge was last verified against.
 * Bump MINIMUM_EM_VERSION deliberately when a newer `em` feature this bridge
 * starts depending on ships -- it is not derived automatically from
 * anything at build or run time.
 */

import { execFileSync } from "node:child_process";
import { BridgeError } from "./bridge-error.js";

/** `em` version this bridge was last verified against -- the last *tagged*
 *  `em` release. Deliberately NOT bumped to track em's MIL-171
 *  (`tracking:`/`owner:` on `slice.doc`, this bridge's transition
 *  detection depends on it): MIL-171 merged to `em` main (PR #126,
 *  2026-08-28, schemaVersion "1.9") but has not shipped in a tagged
 *  release yet. This package's fixtures were regenerated from a real
 *  pre-release build (see README.md's "Building against em MIL-171"
 *  section) to confirm the shape, but the version floor stays at the last
 *  real release until consumers can actually install one that carries it --
 *  bump it then, not now. */
export const MINIMUM_EM_VERSION = "1.8.0";

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Extracts the first `X.Y.Z` run of digits from a version string --
 *  tolerant of `em`'s output carrying extra text (e.g. a leading "em " or
 *  trailing build metadata). Returns undefined if none is found. */
export function parseSemver(raw: string): Semver | undefined {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Standard three-way semver comparison: negative if `a` < `b`, zero if
 *  equal, positive if `a` > `b`. Ignores anything beyond major.minor.patch. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** Runs `em --version` and returns its raw stdout, trimmed, or undefined if
 *  `em` isn't on PATH or exits non-zero. Never throws itself -- fail-closed
 *  handling is the caller's job, per assertMinimumEmVersion below. */
export function getEmVersionRaw(): string | undefined {
  try {
    return execFileSync("em", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Fail-closed: throws a BridgeError (never a raw Error, so the CLI
 * entrypoint's top-level catch pretty-prints it like any other refusal)
 * when `em` is missing, its version output is unparseable, or it's below
 * `minVersion`. Returns silently when the installed `em` satisfies the
 * floor.
 *
 * `getVersionRaw` is injectable so the version-comparison branches are
 * unit-testable without needing an actual `em` binary at a specific version
 * on PATH.
 */
export function assertMinimumEmVersion(
  minVersion: string = MINIMUM_EM_VERSION,
  getVersionRaw: () => string | undefined = getEmVersionRaw
): void {
  const raw = getVersionRaw();
  if (raw === undefined) {
    throw new BridgeError(
      `\`em\` was not found on PATH (or \`em --version\` failed to run). em-tracker-bridge requires ` +
        `\`em\` >=${minVersion} -- install it before running the bridge.`
    );
  }

  const found = parseSemver(raw);
  if (!found) {
    throw new BridgeError(
      `Could not parse a semver from \`em --version\` output ("${raw}"). em-tracker-bridge requires ` +
        `\`em\` >=${minVersion} -- verify your \`em\` install.`
    );
  }

  const floor = parseSemver(minVersion);
  if (!floor) {
    // Defensive only -- MINIMUM_EM_VERSION and any caller-supplied
    // minVersion are expected to always be well-formed semver literals.
    throw new BridgeError(`Internal error: minVersion "${minVersion}" is not a valid semver.`);
  }

  if (compareSemver(found, floor) < 0) {
    throw new BridgeError(
      `\`em\` ${raw} is below the minimum supported version ${minVersion}. em-tracker-bridge requires ` +
        `\`em\` >=${minVersion} -- upgrade \`em\` before running the bridge.`
    );
  }
}
