import { describe, expect, it } from "vitest";
import { parseBooleanEnv, readFlag, readFooterVisibility } from "../src/env.ts";

describe("parseBooleanEnv", () => {
  it.each(["1", "true", "YES", " on "])("treats %j as true", (value) => {
    expect(parseBooleanEnv(value, false)).toBe(true);
  });

  it.each(["0", "FALSE", "no", " off "])("treats %j as false", (value) => {
    expect(parseBooleanEnv(value, true)).toBe(false);
  });

  it.each([undefined, "", "   ", "maybe"])("falls back for %j", (value) => {
    expect(parseBooleanEnv(value, true)).toBe(true);
    expect(parseBooleanEnv(value, false)).toBe(false);
  });
});

describe("readFlag", () => {
  it("prefers PI_FOOTER_* over the legacy PI_MINIMAL_FOOTER_* name", () => {
    expect(readFlag("SHOW_CWD", false, { PI_FOOTER_SHOW_CWD: "0", PI_MINIMAL_FOOTER_SHOW_CWD: "1" })).toBe(false);
    expect(readFlag("SHOW_CWD", false, { PI_FOOTER_SHOW_CWD: "1", PI_MINIMAL_FOOTER_SHOW_CWD: "0" })).toBe(true);
  });

  it("falls back to the legacy name when the new one is unset, empty, or invalid", () => {
    expect(readFlag("SHOW_CWD", false, { PI_MINIMAL_FOOTER_SHOW_CWD: "1" })).toBe(true);
    expect(readFlag("SHOW_CWD", false, { PI_FOOTER_SHOW_CWD: "", PI_MINIMAL_FOOTER_SHOW_CWD: "yes" })).toBe(true);
    expect(readFlag("SHOW_CWD", false, { PI_FOOTER_SHOW_CWD: "maybe", PI_MINIMAL_FOOTER_SHOW_CWD: "on" })).toBe(true);
  });

  it("uses the default when neither name is set", () => {
    expect(readFlag("SHOW_BRANCH", true, {})).toBe(true);
    expect(readFlag("SHOW_BRANCH", false, {})).toBe(false);
  });
});

describe("readFooterVisibility", () => {
  it("hides cwd by default and shows branch and Context Mode", () => {
    expect(readFooterVisibility({})).toEqual({
      showCwd: false,
      showBranch: true,
      showProvider: false,
      showContextMode: true,
    });
  });

  it("reads every flag", () => {
    expect(
      readFooterVisibility({
        PI_FOOTER_SHOW_CWD: "1",
        PI_MINIMAL_FOOTER_SHOW_BRANCH: "0",
        PI_FOOTER_SHOW_PROVIDER: "true",
        PI_FOOTER_SHOW_CONTEXT_MODE: "off",
      })
    ).toEqual({ showCwd: true, showBranch: false, showProvider: true, showContextMode: false });
  });
});
