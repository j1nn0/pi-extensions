import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fitFooterSegment, wrapFooterSegments } from "../src/render.ts";

const red = "\u001b[31mred\u001b[0m";
const green = "\u001b[32mgreen\u001b[0m";

describe("fitFooterSegment", () => {
  it("selects the first ANSI-styled variant that fits by visible width", () => {
    expect(fitFooterSegment(5, ["\u001b[31mabcdef\u001b[0m", red])).toBe(red);
    expect(visibleWidth(fitFooterSegment(3, ["\u001b[31mabcdef\u001b[0m", red]))).toBe(3);
  });

  it("truncates the final variant when none fit", () => {
    const fitted = fitFooterSegment(4, ["\u001b[31mabcdef\u001b[0m"]);
    expect(visibleWidth(fitted)).toBeLessThanOrEqual(4);
    expect(fitted).not.toBe("\u001b[31mabcdef\u001b[0m");
  });
});

describe("wrapFooterSegments", () => {
  it("keeps ANSI segments together when their visible width fits", () => {
    const lines = wrapFooterSegments([red, green], 11, " | ");
    expect(lines).toEqual([`${red} | ${green}`]);
    expect(lines.every((line) => visibleWidth(line) <= 11)).toBe(true);
  });

  it("wraps segments at width limits, filters empty segments, and truncates long entries", () => {
    const wrapped = wrapFooterSegments(["", red, green], 10, " | ");
    expect(wrapped).toEqual([red, green]);

    const truncated = wrapFooterSegments(["abcdefgh"], 4, " | ");
    expect(truncated).toHaveLength(1);
    expect(visibleWidth(truncated[0]!)).toBeLessThanOrEqual(4);
  });
});
