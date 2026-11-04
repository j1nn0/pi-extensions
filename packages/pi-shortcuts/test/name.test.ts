import { describe, expect, it } from "vitest";
import { MAX_SHORTCUT_NAME_LENGTH, normalizeShortcutName } from "../src/name.ts";

function accepted(raw: unknown): string {
  const result = normalizeShortcutName(raw);
  if (!result.ok) throw new Error(`expected "${String(raw)}" to be accepted, got ${result.code}: ${result.message}`);
  return result.name;
}

function rejected(raw: unknown): string {
  const result = normalizeShortcutName(raw);
  expect(result.ok).toBe(false);
  return result.ok ? "unreachable" : result.code;
}

describe("normalizeShortcutName", () => {
  it("keeps an already canonical slug unchanged", () => {
    expect(accepted("review-diff")).toBe("review-diff");
    expect(accepted("v2")).toBe("v2");
    expect(accepted("a1-b2-c3")).toBe("a1-b2-c3");
  });

  it("lowercases, trims, and NFKC-normalizes", () => {
    expect(accepted("  Review Diff  ")).toBe("review-diff");
    expect(accepted("REVIEW")).toBe("review");
    // Fullwidth letters normalize to ASCII under NFKC.
    expect(accepted("ＲＥＶＩＥＷ")).toBe("review");
  });

  it("collapses whitespace and underscores into single hyphens", () => {
    expect(accepted("review    diff")).toBe("review-diff");
    expect(accepted("review_diff")).toBe("review-diff");
    expect(accepted("review_-_diff")).toBe("review-diff");
  });

  it("rejects empty and non-string names", () => {
    expect(rejected("")).toBe("empty");
    expect(rejected("   ")).toBe("empty");
    expect(rejected(undefined)).toBe("empty");
    expect(rejected(null)).toBe("empty");
    expect(rejected(42)).toBe("empty");
    expect(rejected({ name: "x" })).toBe("empty");
  });

  it("rejects path separators and traversal", () => {
    expect(rejected("../escape")).toBe("path-separator");
    expect(rejected("nested/name")).toBe("path-separator");
    expect(rejected("nested\\name")).toBe("path-separator");
    expect(rejected("..")).toBe("traversal");
    expect(rejected("a..b")).toBe("traversal");
  });

  it("rejects dotfiles", () => {
    expect(rejected(".hidden")).toBe("dotfile");
    expect(rejected(" ..hidden")).toBe("traversal");
  });

  it("rejects overlong names", () => {
    expect(accepted("a".repeat(MAX_SHORTCUT_NAME_LENGTH))).toBe("a".repeat(MAX_SHORTCUT_NAME_LENGTH));
    expect(rejected("a".repeat(MAX_SHORTCUT_NAME_LENGTH + 1))).toBe("too-long");
  });

  it("rejects names that still carry unsupported characters", () => {
    expect(rejected("review.diff")).toBe("invalid-characters");
    expect(rejected("café")).toBe("invalid-characters");
    expect(rejected("日本語")).toBe("invalid-characters");
    expect(rejected("review,diff")).toBe("invalid-characters");
    expect(rejected("review-diff!")).toBe("invalid-characters");
  });

  it("rejects leading and trailing hyphens", () => {
    expect(rejected("-review")).toBe("leading-or-trailing-hyphen");
    expect(rejected("review-")).toBe("leading-or-trailing-hyphen");
  });

  it("is idempotent for accepted names", () => {
    const once = accepted("Review  Diff");
    expect(once).toBe("review-diff");
    expect(accepted(once)).toBe(once);
  });
});
