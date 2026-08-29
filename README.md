# em-tracker-bridge

A deterministic `em`-slice → issue-tracker bridge: mirrors an
[`em`](https://github.com/milehimikey/em) slice's lifecycle transitions
(`draft` → `reviewed` → `ready-to-implement` → `implemented`, plus a
bridge-derived `in-progress`) into an issue tracker's own workflow states.
**One-way only** — `em`'s model is the source of truth; this package never
writes to a `.em` model or a slice doc. Linear is the first (0.1.0) adapter;
the seam is designed so a future Jira adapter (0.2.0) is an adapter, not a
fork.

Built in the mold of
[`em-sdd-bridge`](https://github.com/milehimikey/em-sdd-bridge): fail-closed
gates, a minimum-`em`-version check that runs before anything else, every
model read delegated to `em export` (never a slice doc or `.em` file parsed
directly by this package), `em`'s own diagnostics relayed verbatim, and
deterministic, injectable-for-testing internals throughout.

## Install

```sh
npm install --save-dev @milehimikey/em-tracker-bridge
npx em-tracker-bridge [--dry-run]
```

Pin an explicit version rather than floating on `latest` — this bridge
enforces a minimum `em` version (see below), and consuming projects should
upgrade deliberately, not implicitly on every run.

## Usage

```sh
em-tracker-bridge
  [--repo-root <path>] [--model <path.em>] [--config <path.json>]
  [--from <git-rev>] [--to <git-rev>] [--dry-run]
```

There is no slice-key argument: one invocation syncs every `tracking`-linked
slice in the model in one pass.

- `--repo-root`: defaults to the git repository root found upward from
  `cwd` (`git rev-parse --show-toplevel`).
- `--model`: defaults to the sole `*.em` file at the repo root; a relative
  path is resolved against `--repo-root`, not `process.cwd()`.
- `--config`: defaults to `.em-tracker-bridge.json` at the repo root. See
  "The state-mapping seam" below — there is deliberately no built-in default
  state map, so a missing config file is a fail-closed error, not a silent
  no-op.
- `--from` / `--to`: git revisions to diff the model between (see
  "How transition detection works" below). `--from` defaults to `HEAD`;
  `--to` defaults to the current working-tree file (no revision). Running
  with no flags at all — the common local/dev invocation — answers "what
  lifecycle transitions has my uncommitted or just-committed work made
  since `HEAD`?". A CI-on-merge step instead passes both explicitly, e.g.
  `--from <base-sha> --to <head-sha>`.
- `--dry-run`: prints the transitions that *would* be applied and exits.
  **Structurally guaranteed to never call the tracker's API** — the adapter
  is never even constructed in dry-run mode (see `src/lib/sync.ts`), so
  there is no code path from `--dry-run` to the network. No `LINEAR_API_KEY`
  is required to dry-run.

Example:

```sh
$ LINEAR_API_KEY=... npx em-tracker-bridge --from HEAD~5
record-ping: ready-to-implement -> in-progress [derived from a live feature branch] => would set Linear state to "In Progress" (https://linear.app/.../issue/MIL-177/...)
record-ping: moved "In Progress" (was "Todo") -- https://linear.app/.../issue/MIL-177/...
```

## Minimum `em` version

Shells out to `em --version` and fails closed if `em` is missing or below
the floor in `src/lib/check-em-version.ts` — the very first thing either
code path does, before any other precondition, since an unsupported `em`
invalidates everything downstream (export shape, doc-join fields). It fails
with a plain, actionable message; it never tries to auto-install or
auto-upgrade `em`.

### Building against em MIL-171

The heart of this bridge — matching a slice to a tracker issue — depends on
`em export` surfacing a slice doc's `tracking:` frontmatter key (a ticket
URL) as `slice.doc.tracking`. **Update, 2026-08-28: MIL-171 has merged to
`em` main** (PR #126 — schemaVersion bumped to `"1.9"`, `tracking`/`owner`
now real fields on `slice.doc`) **but has not shipped in a tagged `em`
release yet.**

`fixtures/export-record-ping-ready.json` /
`-implemented.json` are no longer hand-authored: they were regenerated
against a real pre-release build (`cd em && git pull && npm install &&
npm run build && npm pack`, installed globally, then `em export` run for
real against a small model + slice doc carrying `tracking:` frontmatter).
The `tracking` field's actual shape matched what this package was built
against exactly — `string | null`, sitting alongside `status`/`ratifiedBy`
on `slice.doc`, no surprises. The real export also carries fields this
package doesn't consume and doesn't model (a slice-level `source`,
`model.types`, several new per-element/per-field fields) — see
`src/lib/export-model.ts`'s doc comment for the full list; none of them
affect lifecycle-transition detection or the Linear adapter.

`MINIMUM_EM_VERSION` (`src/lib/check-em-version.ts`) **stays at `1.8.0`**
— the last tagged release — on purpose: bumping it to `1.9.0`/whatever
version ships MIL-171 before that version actually exists would make every
consumer's version-floor check pass against an `em` that doesn't exist yet.
**Every slice's `tracking` field still reads as `null` against any
currently-installable `em`**, which this bridge treats as a visible no-op
(see "Unlinked slices" below), never an error — so running this package
against a real model today is safe, just inert.

Once `em` actually ships a tagged release carrying MIL-171:

1. Bump `MINIMUM_EM_VERSION` in `src/lib/check-em-version.ts` to that
   release (not before).
2. Re-regenerate the fixtures against that release's real, published `em`
   (rather than a locally-built pre-release tarball) if anything in the
   shape changed between the pre-release build and the actual release.
3. Delete this section's caveats once they're no longer true.

## The state-mapping seam

`src/lib/lifecycle.ts` defines a closed, tracker-agnostic vocabulary:

```ts
type LifecycleState = "draft" | "reviewed" | "ready-to-implement" | "in-progress" | "implemented";
```

The first four are exactly `em`'s own slice-doc `status:` values. The fifth,
`in-progress`, is **bridge-only** — `em` has no such status (a slice stays
`ready-to-implement` for its whole implementation window); this bridge
derives it itself (see "Deriving in-progress" below).

Everything on the tracker side of this vocabulary is config, not code —
`.em-tracker-bridge.json` at the repo root (override with `--config`):

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

- `tracker`: which adapter to use. Only `"linear"` is implemented in 0.1.0;
  `"jira"` is reserved (rejected with a "not implemented yet, use linear"
  message) so a config written ahead of the 0.2.0 Jira adapter fails
  clearly instead of silently resolving to nothing.
- `stateMap[lifecycleState]`: the target tracker workflow-state **name**
  (Linear states are per-team and named by the team, not by this package)
  to move an issue to when a slice reaches that lifecycle state.
  - An **absent** key is a fail-closed error at sync time — every
    lifecycle state this bridge might need to transition to (including
    `in-progress`, if branch detection is enabled) must be mapped
    explicitly. There is no guessed or default state name, because tracker
    state names are always workspace-specific.
  - An explicit **`null`** value is a deliberate no-op — "never touch the
    tracker when a slice reaches this state" (the example above uses this
    for `draft`, so draft slices don't clutter the board).
- `branchDetection`: see below. `enabled` defaults to `true`,
  `includeRemote` (also check `git branch -r`, relevant when this bridge
  runs in CI against a branch never checked out locally) defaults to `true`.

This is the seam a future adapter maps **from** — an adapter (see
`src/lib/adapters/types.ts`) only ever sees this closed lifecycle
vocabulary and a target state *name*, never `em`'s raw status string or a
tracker-specific concept directly. Adding Jira support means writing
`adapters/jira.ts` and registering it in `adapters/registry.ts` — no change
to `config.ts`, `transitions.ts`, or `sync.ts`.

## How transition detection works

**Not** via `em diff`. `em diff` (confirmed against `em` main) is a purely
*structural* diff over `.em` DSL source — slices, elements, fields, notes,
arrows — and never reads or reports a slice doc's `status:` frontmatter;
there is no `ChangeType` for a status transition. Detecting a lifecycle
transition instead means running `em export` **twice** — once per git
revision — and diffing `slice.doc.status` client-side. That's exactly what
`src/lib/export-at-revision.ts` and `src/lib/transitions.ts` do:

1. `exportAtRevision` reconstructs the **full repo tree** at a given git
   revision (`git archive <rev> | tar -x`, mirroring, at the shell level,
   the same git plumbing `em diff`'s own `--from`/`--to` flags use
   internally — `em export` itself has no revision flags, only `--slice`)
   into a throwaway temp directory, then runs the real `em export` against
   the model file at its correct relative path within it. **Not** just the
   model file in isolation — a real bug caught during MIL-177's own
   integration testing: `em`'s doc-join resolves a slice's bound doc (the
   `note "slices/<key>.md"` convention) relative to the model file's own
   directory, so a project keeping slice docs in a sibling directory (the
   norm — confirmed against a real meridian-goods-shaped repo) needs that
   directory reconstructed too, or every slice's doc-join silently reads
   as "no such file exists" and every status/tracking read comes back
   null. See `src/test/export-at-revision.test.ts`'s regression test.
   `readFileAtRevision` still answers the cheap "did the model file exist
   at this revision at all" / "is this even a valid revision" question
   before paying for a full-tree archive.
2. `computeTransitions` compares each tracked slice's `status` between the
   "from" and "to" snapshots. A status that didn't change produces no
   transition (not a reported no-op); a slice with no `tracking` URL that
   *did* change status is reported separately as `untrackedChanges` — a
   **visible no-op, never an error** (MIL-177's "Done when" requirement).

### Deriving `in-progress`

Per MIL-177 ("derive 'in progress' for free from a live NNN-slug sdd-bridge
feature branch"): `em-sdd-bridge`'s `allocateFeature()` creates spec-kit
feature branches named `NNN-<sliceKey>` (its `shortName` is the slice key
itself). `src/lib/branch-detection.ts` checks the **current** repo state —
this has no representation in export JSON and can't be diffed between two
snapshots — for a local or remote-tracking branch matching that pattern. If
one exists and the slice's em-sourced status is still `ready-to-implement`,
the *effective* target lifecycle state for that slice becomes
`in-progress` instead. Re-running the sync while the branch remains live
re-derives the same `in-progress` transition every time — safe, because
adapters are required to be idempotent (see below), not because this
package tracks "already mirrored" state anywhere itself. It stays purely
additive and stateless: no local state file, no write-back to `em`.

### Unlinked slices are a visible no-op

A slice with no `tracking:` URL bound (`doc.tracking === null`) never
produces a transition and is never an error — `computeTransitions` reports
it (if its status also changed) in a separate `untrackedChanges` list so
the CLI can print it, distinct from actual transitions.

## Adapters

`src/lib/adapters/types.ts` is the whole seam:

```ts
interface TrackerAdapter {
  resolveIssue(trackingUrl: string): Promise<ResolvedIssue>;
  listStates(issue: ResolvedIssue): Promise<TrackerState[]>;
  applyState(issue: ResolvedIssue, targetStateName: string): Promise<ApplyStateResult>;
}
```

Adapters **must be idempotent**: applying a state the issue is already in
is a safe no-op (`changed: false`), never an error — required both by the
branch-derived `in-progress` re-derivation above and by general
CI-retry-safety.

### Linear (`src/lib/adapters/linear.ts`)

- Auth: the `LINEAR_API_KEY` env var, read **lazily** — only when an issue
  is actually resolved or a state actually applied, never at adapter
  construction time. This is what makes `--dry-run`'s "never calls the API"
  guarantee trivial: dry-run mode never constructs the adapter at all (see
  `src/lib/sync.ts`).
- Resolves a `tracking` URL shaped like
  `https://linear.app/<workspace>/issue/<IDENTIFIER>/<slug>` to a Linear
  issue by its human identifier (e.g. `MIL-177`) via Linear's GraphQL API
  (`https://api.linear.app/graphql`).
- `applyState` reads the issue's current state and its team's full list of
  workflow states, no-ops if already at the target, and otherwise sends an
  `issueUpdate` mutation. An unrecognized target state name fails with a
  message naming the states that *do* exist on that team — never a bare
  API error.
- Uses Node's built-in global `fetch` (Node ≥20) — no HTTP client
  dependency.

**Nothing in this package's test suite makes a live API call.** The Linear
adapter's HTTP transport (`request`) and API-key lookup (`getApiKey`) are
both injectable; `src/test/adapters/linear.test.ts` mocks them entirely.

### What still needs a live `LINEAR_API_KEY` to validate

This 0.1.0 scaffold has **not** been run against the real Linear API. Left
for a later integration phase:

- That `issue(id: "<IDENTIFIER>")` actually resolves by human identifier
  (not just UUID) the way this adapter assumes.
- The exact shape of Linear's `issueUpdate` response and any
  scope/permission requirements on the API key used.
- Whether Linear's per-team workflow-state names are stable enough in
  practice for `stateMap`'s name-based matching to be robust, or whether a
  future revision should match by state *type* (`backlog`/`unstarted`/
  `started`/`completed`/`canceled`) as a fallback.
- Rate-limit behavior for a sync run touching many slices at once.

## Tests

```sh
npm test        # vitest
npm run build
npm run typecheck
```

`fixtures/export-record-ping-ready.json` /
`-implemented.json` model one tracked slice moving `ready-to-implement` →
`implemented`, in the fixture `tracking`-carrying shape described above —
used by `src/test/transitions.test.ts` and `src/test/sync.test.ts`.
`fixtures/.em-tracker-bridge.json` is an example config.

- `src/test/check-em-version.test.ts`: pure parsing/comparison tests via
  dependency injection, plus a real-`em`-gated integration check (skips
  when `em` isn't on `PATH`, same `hasEm()` pattern as em-sdd-bridge).
- `src/test/export-at-revision.test.ts`: `readFileAtRevision` runs
  unconditionally against scratch git repos (no `em` needed); the
  `exportAtRevision`/`exportAtSide` real-`em`-export half is `hasEm()`-
  gated.
- `src/test/branch-detection.test.ts`: scratch git repos, asserting the
  `NNN-<slice-key>` branch pattern matches exactly (and does not
  over-match a longer slug sharing the same prefix).
- `src/test/transitions.test.ts`: pure functions over fixture JSON — no
  filesystem or subprocess at all.
- `src/test/sync.test.ts`: exercises the whole orchestration (dry-run vs.
  apply, fail-closed on a missing `stateMap` entry, `skippedAsNoOp`,
  `untrackedChanges`) via `exportSideOverride`/`adapterOverride` — the same
  dependency-injection style `check-em-version.ts` uses, so this suite
  needs neither a real `em` install nor a real git repo nor a real Linear
  API key to cover the orchestration logic itself.
- `src/test/adapters/linear.test.ts`: the Linear adapter against a mocked
  `request` transport — resolve, list states, apply (both the no-op and
  the real-mutation branches), and the "no such state" / "no such issue"
  refusal messages.

CI (`.github/workflows/test.yml`) runs `npm run build && npm run typecheck
&& npx vitest run` on every push/PR. `em` is deliberately not installed in
CI — every `em`-dependent test gates on `hasEm()` and skips gracefully, the
same pattern em-sdd-bridge established. No `LINEAR_API_KEY` secret is
configured for CI, and none is needed: the whole Linear adapter test suite
runs against a mock.

## Contract

Implements a strictly one-way sync: `em`'s model is authoritative, and
nothing in this package writes to a `.em` model file or a slice doc — not
even a status this bridge fails to map or an issue this bridge fails to
resolve. A misconfigured `stateMap` entry aborts the **whole** sync run
before anything is applied (resolved eagerly in `src/lib/sync.ts`, before
any adapter call) — deterministic and all-or-nothing, never a partial
mirror caused by config drift.
