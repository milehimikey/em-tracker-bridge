/**
 * Types for `em export` JSON. Verified against em main (schema 1.8,
 * MIL-165's `ratifiedBy`/`ratifiedOn` fields) as of 2026-08-28 -- see
 * README.md's "Building against em MIL-171" section.
 *
 * `tracking` on `ExportedSliceDoc` is the one field NOT yet on any tagged
 * `em` release: it's the export-side surface of em's MIL-171 (surfacing the
 * slice doc's `tracking:` frontmatter key, a ticket URL), which had no
 * branch, PR, or source trace in the `em` repo as of this package's 0.1.0
 * scaffold. This package is built against the field's documented SHAPE
 * (`string | null`, sitting alongside `status`/`ratifiedBy` on `slice.doc`)
 * using fixture JSON (fixtures/export-with-tracking.json) rather than a
 * real `em` release. Once MIL-171 merges and ships, regenerate the fixture
 * from the real CLI and delete this comment's caveat.
 */

export interface ExportedField {
  name: string;
  type: string;
}

export interface ExportedElementRef {
  name: string;
  ref: string;
}

export interface ExportedElement {
  ref: string;
  kind: "ui" | "command" | "view" | "event" | "processor" | "translation" | string;
  name: string;
  line: number;
  fields: ExportedField[] | null;
  note: string | null;
  issue: string | null;
  from: ExportedElementRef[] | null;
  persona: string | null;
  context: string | null;
  again: boolean;
  logicalRef: string | null;
}

/** A slice's Event Modeling pattern, as em itself classifies it. */
export type SlicePattern = "translation" | "automation" | "state-change" | "state-view" | "unclassified";

/** Why `doc.found` is false, or why a found doc's fields are still empty.
 *  Null exactly when `found` is true and the frontmatter parsed cleanly. */
export type SliceDocJoinReason = "no-doc-bound" | "binding-missing-file" | "frontmatter-invalid" | null;

/** Implementation-drift classification from `status`+`implementedIn` alone. */
export type SliceDocDriftSignal =
  | "in-sync"
  | "never-implemented"
  | "unpropagated-delta"
  | "implemented-without-link"
  | null;

/** A parsed `<slice-key>@v<N>` lineage reference (split-from/merged-from/superseded-by). */
export interface SliceDocRef {
  raw: string;
  sliceKey: string | null;
  version: number | null;
}

/**
 * The slice lifecycle status em's own doc-schema recognizes, as a bare
 * string in `em export` JSON (em does not enum-type this field). This
 * package's own lifecycle vocabulary (src/lib/lifecycle.ts) is the closed
 * set of these four values PLUS a bridge-synthesized "in-progress" state
 * that em itself never emits -- see lifecycle.ts's module doc.
 */
export type EmSliceStatus = "draft" | "reviewed" | "ready-to-implement" | "implemented";

/** The slice-doc frontmatter join for one slice -- always a non-null object
 *  (never JSON `null`), matching every other optional field in `em export`'s
 *  style. */
export interface ExportedSliceDoc {
  found: boolean;
  /** Always `slices/<key>.md` (the convention path), regardless of `found`. */
  path: string;
  reason: SliceDocJoinReason;
  status: string | null;
  version: number | null;
  implementedIn: string | null;
  splitFrom: SliceDocRef | null;
  mergedFrom: SliceDocRef[];
  supersededBy: SliceDocRef[];
  driftSignal: SliceDocDriftSignal;
  ratifiedBy: string | null;
  ratifiedOn: string | null;
  /** The slice doc's `tracking:` frontmatter value (a ticket URL), or null
   *  when absent -- em's MIL-171 field. See this module's doc comment. */
  tracking: string | null;
}

export interface ExportedSlice {
  key: string;
  name: string;
  index: number;
  line: number;
  pattern: SlicePattern;
  doc: ExportedSliceDoc;
  elements: ExportedElement[];
}

export interface ExportedModel {
  schemaVersion: string;
  generator: { name: string; version: string };
  source: { path: string; sha256: string };
  model: {
    name: string;
    personas: string[];
    contexts: string[];
    hasAutomation: boolean;
    slices: ExportedSlice[];
    arrows: unknown[];
  };
  diagnostics: unknown[];
}

export function findSliceByKey(model: ExportedModel, key: string): ExportedSlice | undefined {
  return model.model.slices.find((s) => s.key === key);
}
