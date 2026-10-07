import { describe, expect, it } from "vitest";
import { parseGitStatus, sameGitCache } from "../src/git.ts";

describe("parseGitStatus", () => {
  it("parses a clean branch and ahead/behind counts", () => {
    expect(
      parseGitStatus(
        [
          "# branch.oid 0123456789abcdef",
          "# branch.head main",
          "# branch.upstream origin/main",
          "# branch.ab +2 -3",
        ].join("\n")
      )
    ).toEqual({ branch: "main", dirty: false, ahead: 2, behind: 3 });
  });

  it("marks tracked and untracked changes as dirty", () => {
    expect(
      parseGitStatus(
        [
          "# branch.head feature/footer",
          "# branch.ab +0 -0",
          "1 .M N... 100644 100644 100644 abc def tracked.txt",
          "? new.txt",
        ].join("\n")
      )
    ).toEqual({ branch: "feature/footer", dirty: true, ahead: 0, behind: 0 });
  });

  it("shows a detached head as its short commit id", () => {
    expect(parseGitStatus("# branch.oid 0123456789abcdef0123\n# branch.head (detached)\n? new.txt")).toEqual({
      branch: "0123456",
      dirty: true,
      ahead: 0,
      behind: 0,
    });
  });

  it("represents an unborn detached head and missing upstream with null/zero defaults", () => {
    expect(parseGitStatus("# branch.oid (initial)\n# branch.head (detached)")).toEqual({
      branch: null,
      dirty: false,
      ahead: 0,
      behind: 0,
    });
  });
});

describe("sameGitCache", () => {
  const main = { branch: "main", dirty: false, ahead: 1, behind: 0 };

  it("compares nulls, identity, and all cache fields", () => {
    expect(sameGitCache(null, null)).toBe(true);
    expect(sameGitCache(null, main)).toBe(false);
    expect(sameGitCache(main, main)).toBe(true);
    expect(sameGitCache(main, { ...main })).toBe(true);
    expect(sameGitCache(main, { ...main, branch: "next" })).toBe(false);
    expect(sameGitCache(main, { ...main, dirty: true })).toBe(false);
    expect(sameGitCache(main, { ...main, ahead: 0 })).toBe(false);
    expect(sameGitCache(main, { ...main, behind: 1 })).toBe(false);
  });
});
