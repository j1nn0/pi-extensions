import { describe, expect, it } from "vitest";
import { clampPercent, formatDuration, formatResetClock, formatTokenCount, getWindowLabel } from "../src/format.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatTokenCount", () => {
  it("uses one decimal for k and M like the Claude StatusLine", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_000)).toBe("1.0k");
    expect(formatTokenCount(424_500)).toBe("424.5k");
    expect(formatTokenCount(161_000)).toBe("161.0k");
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
    expect(formatTokenCount(1_234_567)).toBe("1.2M");
  });
});

describe("formatDuration", () => {
  it("formats minutes, then hours with zero-padded minutes", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59 * 1000)).toBe("0m");
    expect(formatDuration(42 * MINUTE)).toBe("42m");
    expect(formatDuration(2 * HOUR + 3 * MINUTE)).toBe("2h03m");
    expect(formatDuration(6 * HOUR + 29 * MINUTE + 59 * 1000)).toBe("6h29m");
    expect(formatDuration(28 * HOUR + 4 * MINUTE)).toBe("28h04m");
    expect(formatDuration(-5 * MINUTE)).toBe("0m");
  });
});

describe("formatResetClock", () => {
  const at = Date.parse("2026-10-06T09:05:00.000Z");

  it("uses HH:MM for hour and minute windows and MM/DD HH:MM otherwise", () => {
    expect(formatResetClock(at, "5h")).toBe("09:05");
    expect(formatResetClock(at, "8h")).toBe("09:05");
    expect(formatResetClock(at, "30m")).toBe("09:05");
    expect(formatResetClock(at, "7d")).toBe("10/06 09:05");
    expect(formatResetClock(at, "1d")).toBe("10/06 09:05");
    expect(formatResetClock(at, "mo")).toBe("10/06 09:05");
  });
});

describe("getWindowLabel", () => {
  it("labels windows from their actual duration", () => {
    expect(getWindowLabel(5 * HOUR, "5h")).toBe("5h");
    expect(getWindowLabel(8 * HOUR, "5h")).toBe("8h");
    expect(getWindowLabel(3 * HOUR, "7d")).toBe("3h");
    expect(getWindowLabel(DAY + HOUR, "5h")).toBe("1d");
    expect(getWindowLabel(7 * DAY - 90 * MINUTE, "5h")).toBe("7d");
    expect(getWindowLabel(36 * HOUR, "5h")).toBe("36h");
    expect(getWindowLabel(3 * DAY, "5h")).toBe("3d");
    expect(getWindowLabel(20 * MINUTE, "5h")).toBe("20m");
  });

  it("uses the fallback only when the duration is unknown", () => {
    expect(getWindowLabel(undefined, "5h")).toBe("5h");
    expect(getWindowLabel(0, "7d")).toBe("7d");
    expect(getWindowLabel(Number.NaN, "7d")).toBe("7d");
  });
});

describe("clampPercent", () => {
  it("clamps to 0..100 and treats non-finite values as 0", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
