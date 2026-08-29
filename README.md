# em-tracker-bridge

A deterministic `em`-slice → issue-tracker bridge: mirrors an
[`em`](https://github.com/milehimikey/em) slice's lifecycle transitions
(`draft` → `reviewed` → `ready-to-implement` → `implemented`) into an issue
tracker's own workflow states. **One-way only** — `em`'s model is the
source of truth; this package never writes to a `.em` model or a slice doc.
Linear is the first (0.1.0) adapter; the seam is designed so a future Jira
adapter (0.2.0) is an adapter, not a fork.

Built in the mold of
[`em-sdd-bridge`](https://github.com/milehimikey/em-sdd-bridge): fail-closed
gates, a minimum-`em`-version check that runs before anything else, every
model read delegated to `em export` (never a slice doc or `.em` file parsed
directly by this package), `em`'s own diagnostics relayed verbatim, and
deterministic, injectable-for-testing internals throughout.

## Status: scaffold (MIL-176)

This is the kickoff scaffold. It establishes the package skeleton and the
**state-mapping seam** the actual mirroring logic (MIL-177, next) plugs
into — but does not yet detect or apply any lifecycle transition. Running
the CLI today just proves the scaffold's preconditions all wire together:

```sh
$ npx em-tracker-bridge
em-tracker-bridge: scaffold OK (repo root ..., model ..., tracker "linear") -- lifecycle-transition detection and the Linear adapter ship in MIL-177; nothing was synced.
```

## What's here

- **Minimum-`em`-version check** (`src/lib/check-em-version.ts`): shells out
  to `em --version` and fails closed if `em` is missing or below the floor.
  Runs before any other precondition, mirroring em-sdd-bridge's discipline.
- **Repo/model resolution** (`src/lib/repo.ts`, `src/lib/em-runner.ts`):
  finds the git repository root and the sole `*.em` model file, exactly the
  same conventions em-sdd-bridge uses (an explicit `--model` override
  resolves against `--repo-root`, never `process.cwd()`).
- **`em export` types** (`src/lib/export-model.ts`): all model reads in
  this package are delegated to `em export`'s JSON — never a slice doc or
  `.em` file parsed directly. Includes a `tracking: string | null` field on
  `slice.doc` for em's MIL-171 (surfacing the slice doc's `tracking:`
  frontmatter key, a ticket URL) — **not yet in any `em` branch, PR, or
  release** as of this scaffold (confirmed against `em` main, 2026-08-28).
  See "Building against em MIL-171" below.
- **The lifecycle vocabulary** (`src/lib/lifecycle.ts`): the closed set of
  states this bridge mirrors --- `em`'s own four (`draft`/`reviewed`/
  `ready-to-implement`/`implemented`) plus a fifth, bridge-only
  `in-progress`, derived (in MIL-177) from a live feature branch rather than
  from `em` itself.
- **The state-mapping seam** (`src/lib/config.ts`): loads and validates a
  repo-committed `.em-tracker-bridge.json` mapping each lifecycle state to
  a target tracker workflow-state *name* (or an explicit `null` no-op).
  Fail-closed on any missing/malformed shape; no built-in default state
  map, since tracker state names are always workspace-specific. Already
  distinguishes `"linear"` (this 0.1.0 line) from a reserved `"jira"` name
  (rejected with a clear "not implemented yet" message), so a config
  written ahead of the 0.2.0 Jira adapter fails loudly instead of silently
  resolving to nothing.
- **The adapter interface** (`src/lib/adapters/types.ts`): the seam a
  concrete tracker adapter implements — `resolveIssue`/`listStates`/
  `applyState` — kept deliberately narrow (a target state *name* in, an
  idempotent apply-or-no-op result out) so nothing above it needs to know
  which tracker it's talking to.

## Install

```sh
npm install --save-dev @milehimikey/em-tracker-bridge
npx em-tracker-bridge
```

Pin an explicit version rather than floating on `latest` — this bridge
enforces a minimum `em` version, and consuming projects should upgrade
deliberately, not implicitly on every run.

## Usage (scaffold)

```sh
em-tracker-bridge [--repo-root <path>] [--model <path.em>] [--config <path.json>]
```

- `--repo-root`: defaults to the git repository root found upward from
  `cwd` (`git rev-parse --show-toplevel`).
- `--model`: defaults to the sole `*.em` file at the repo root.
- `--config`: defaults to `.em-tracker-bridge.json` at the repo root.

## The state-mapping seam

```json
{
  "tracker": "linear",
  "stateMap": {
    "draft": null,
    "reviewed": "Backlog",
    "ready-to-implement": "Todo",
    "in-progress": "In Progress",
    "implemented": "Done"
  },
  "branchDetection": {
    "enabled": true,
    "includeRemote": true
  }
}
```

- `tracker`: which adapter to use. Only `"linear"` is planned for 0.1.0.
- `stateMap[lifecycleState]`: the target tracker workflow-state name to
  move an issue to when a slice reaches that lifecycle state. An absent key
  is a fail-closed error at sync time (no guessed default); an explicit
  `null` is a deliberate no-op.
- `branchDetection`: governs the (MIL-177) `in-progress` derivation from a
  live feature branch.

## Building against em MIL-171

The heart of this bridge — matching a slice to a tracker issue — depends on
`em export` surfacing a slice doc's `tracking:` frontmatter key as
`slice.doc.tracking`. That field **does not exist in any `em` branch, PR,
or tagged release** as of this scaffold. `MINIMUM_EM_VERSION`
(`src/lib/check-em-version.ts`) currently points at the last `em` release
this package's own development verified against (`1.8.0`), which does
**not** carry `tracking` — MIL-177 will build and test against fixture JSON
in the documented shape until a real `em` release ships MIL-171, then
regenerate the fixtures from the real CLI and bump this floor.

## Tests

```sh
npm test        # vitest
npm run build
npm run typecheck
```

- `src/test/check-em-version.test.ts`: pure parsing/comparison tests via
  dependency injection, plus a real-`em`-gated integration check (skips
  when `em` isn't on `PATH`).
- `src/test/repo.test.ts`, `src/test/em-runner.test.ts`: repo-root and
  model-path resolution against scratch git repos / temp directories.
- `src/test/config.test.ts`: state-mapping config validation — valid
  shapes, every rejected malformed shape, the reserved-`jira` message.
- `src/test/cli-args.test.ts`: the flag parser.
- `src/test/bridge.scaffold.test.ts`: the scaffold CLI's precondition
  wiring end to end, gated on a real installed `em`.

CI (`.github/workflows/test.yml`) runs `npm run build && npm run typecheck
&& npx vitest run` on every push/PR. `em` is deliberately not installed in
CI — every `em`-dependent test gates on a `hasEm()` check and skips
gracefully, the same pattern em-sdd-bridge established.

## What's next (MIL-177)

Lifecycle-transition detection (comparing two `em export` snapshots across
git revisions — **not** `em diff`, which is a purely structural DSL diff
with no concept of slice-doc status) and the Linear adapter itself, wired
into a real sync command with `--dry-run` support. See MIL-177 in Linear.
