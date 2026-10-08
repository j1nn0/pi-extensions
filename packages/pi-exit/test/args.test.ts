import { describe, expect, it } from "vitest";
import { parseExitArgs } from "../src/args.ts";

describe("parseExitArgs", () => {
  it("uses the default behavior for an empty argument string", () => {
    expect(parseExitArgs("")).toEqual({ kind: "run", force: false, wait: false });
  });

  it("parses the long and short force flags", () => {
    expect(parseExitArgs("--force")).toEqual({ kind: "run", force: true, wait: false });
    expect(parseExitArgs("-f")).toEqual({ kind: "run", force: true, wait: false });
  });

  it("parses the long and short wait flags", () => {
    expect(parseExitArgs("--wait")).toEqual({ kind: "run", force: false, wait: true });
    expect(parseExitArgs("-w")).toEqual({ kind: "run", force: false, wait: true });
  });

  it("parses the long and short help flags", () => {
    expect(parseExitArgs("--help")).toEqual({ kind: "help" });
    expect(parseExitArgs("-h")).toEqual({ kind: "help" });
  });

  it("parses accepted flags independently of their order", () => {
    expect(parseExitArgs("--force -f")).toEqual({ kind: "run", force: true, wait: false });
    expect(parseExitArgs("-f --force")).toEqual({ kind: "run", force: true, wait: false });
    expect(parseExitArgs("--help --force")).toEqual({ kind: "help" });
    expect(parseExitArgs("--force --help")).toEqual({ kind: "help" });
  });

  it("rejects mutually exclusive force and wait flags in either order", () => {
    const expected = { kind: "error", message: "--force and --wait are mutually exclusive" };

    expect(parseExitArgs("--force --wait")).toEqual(expected);
    expect(parseExitArgs("--wait --force")).toEqual(expected);
  });

  it("rejects unknown options", () => {
    expect(parseExitArgs("--other")).toEqual({ kind: "error", message: "Unknown option: --other" });
  });

  it("returns help when help appears alongside other recognized flags", () => {
    expect(parseExitArgs("--force --wait --help")).toEqual({ kind: "help" });
    expect(parseExitArgs("--help --wait --force")).toEqual({ kind: "help" });
  });

  it("lets an unknown option take precedence over help", () => {
    expect(parseExitArgs("--help --other")).toEqual({ kind: "error", message: "Unknown option: --other" });
    expect(parseExitArgs("--other --help")).toEqual({ kind: "error", message: "Unknown option: --other" });
  });
});
