import { describe, expect, it } from "vitest";
import { parseArgs } from "../lib/cli-args.js";
import { BridgeError } from "../lib/bridge-error.js";

describe("parseArgs", () => {
  it("separates value flags, boolean flags, and positionals", () => {
    const result = parseArgs(
      ["--repo-root", "/tmp/x", "--dry-run", "extra"],
      ["--repo-root", "--model"],
      ["--dry-run"]
    );
    expect(result.flags["repo-root"]).toBe("/tmp/x");
    expect(result.booleans.has("dry-run")).toBe(true);
    expect(result.positional).toEqual(["extra"]);
  });

  it("throws a BridgeError when a value flag is missing its value", () => {
    expect(() => parseArgs(["--model"], ["--model"], [])).toThrow(BridgeError);
    expect(() => parseArgs(["--model"], ["--model"], [])).toThrow(/--model requires a value/);
  });

  it("returns empty structures for empty argv", () => {
    const result = parseArgs([], [], []);
    expect(result).toEqual({ positional: [], flags: {}, booleans: new Set() });
  });
});
