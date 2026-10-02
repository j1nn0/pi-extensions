import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { parseBooleanEnv } from "../src/env.ts";
import { clampPercent, formatResetTime, formatTokenCount, getWindowLabel, normalizePercent } from "../src/format.ts";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const week = 7 * day;

describe("parseBooleanEnv", () => {
  it.each(["1", "true", "yes", "on", " TRUE ", " YeS ", "On"])("parses true spelling %j", (value) => {
    expect(parseBooleanEnv(value, false)).toBe(true);
  });

  it.each(["0", "false", "no", "off", " FALSE ", " No ", "Off"])("parses false spelling %j", (value) => {
    expect(parseBooleanEnv(value, true)).toBe(false);
  });

  it.each([
    [undefined, false],
    [undefined, true],
    ["", false],
    ["   ", true],
    ["sometimes", false],
    ["maybe", true],
  ] as const)("uses fallback for %j", (value, fallback) => {
    expect(parseBooleanEnv(value, fallback)).toBe(fallback);
  });
});

describe("formatResetTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it("formats past, minute, hour, and day boundaries", () => {
    expect(formatResetTime(new Date(NOW - 1))).toBe("now");
    expect(formatResetTime(new Date(NOW + 42 * 60_000 + 59_000))).toBe("42m");
    expect(formatResetTime(new Date(NOW + 2 * hour + 38 * 60_000))).toBe("2h38m");
    expect(formatResetTime(new Date(NOW + 3 * hour))).toBe("3h");
    expect(formatResetTime(new Date(NOW + day + 3 * hour))).toBe("1d3h");
    expect(formatResetTime(new Date(NOW + 2 * day))).toBe("2d");
  });
});

describe("getWindowLabel", () => {
  it("recognizes week, day, and five-hour window proximity", () => {
    expect(getWindowLabel(week + hour, "other")).toBe("Week");
    expect(getWindowLabel(day - hour, "other")).toBe("Day");
    expect(getWindowLabel(6 * hour, "rolling")).toBe("rolling");
  });

  it("preserves fallback precedence and current five-hour behavior", () => {
    expect(getWindowLabel(week + hour, "Day")).toBe("Week");
    expect(getWindowLabel(23 * hour, "Week")).toBe("Week");
    expect(getWindowLabel(23 * hour, "5h")).toBe("Day");
    // Because fallback === "5h" is checked before hour rounding, N-hour labels cannot win.
    expect(getWindowLabel(12 * hour, "5h")).toBe("5h");
  });

  it("uses fallback for invalid and missing durations, otherwise rounds", () => {
    expect(getWindowLabel(undefined, "default")).toBe("default");
    expect(getWindowLabel(0, "default")).toBe("default");
    expect(getWindowLabel(Number.NaN, "default")).toBe("default");
    expect(getWindowLabel(12 * hour, "other")).toBe("12h");
    expect(getWindowLabel(48 * hour, "other")).toBe("2d");
  });
});

describe("percentage and token formatting", () => {
  it("clamps percentages without interpreting fractions", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(50.5)).toBe(50.5);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("normalizes fractions, preserves percentages, and clamps non-finite values", () => {
    expect(normalizePercent(0)).toBe(0);
    expect(normalizePercent(0.5)).toBe(50);
    expect(normalizePercent(1)).toBe(100);
    expect(normalizePercent(1.5)).toBe(1.5);
    expect(normalizePercent(-0.5)).toBe(0);
    expect(normalizePercent(200)).toBe(100);
    expect(normalizePercent(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalizePercent(Number.NaN)).toBe(0);
  });

  it("formats token counts with the existing rounding", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_000)).toBe("1k");
    expect(formatTokenCount(10_500)).toBe("11k");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatTokenCount(1_050_000)).toBe("1.1M");
  });
});
