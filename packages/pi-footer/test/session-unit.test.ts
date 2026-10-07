import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createCacheUsageReader, findLatestCacheUsage, getSessionStartTime } from "../src/session.ts";
import { assistantMessage, FROZEN_NOW, messageEntry } from "./harness.ts";

function reader(branch: SessionEntry[]) {
  return { getBranch: vi.fn(() => branch), getLeafId: vi.fn(() => branch.at(-1)?.id ?? null) };
}

const compaction: SessionEntry = {
  type: "compaction",
  id: "compaction",
  parentId: "a1",
  timestamp: new Date(FROZEN_NOW).toISOString(),
  summary: "summary",
  firstKeptEntryId: "a1",
  tokensBefore: 100_000,
};

describe("findLatestCacheUsage", () => {
  it("returns cache read/write of the latest completed assistant response", () => {
    const branch = [
      messageEntry("a1", null, assistantMessage({}, { cacheRead: 1, cacheWrite: 2 })),
      messageEntry("a2", "a1", assistantMessage({}, { cacheRead: 424_000, cacheWrite: 2_100 })),
    ];
    expect(findLatestCacheUsage(reader(branch))).toEqual({ read: 424_000, write: 2_100 });
  });

  it("skips aborted and errored responses", () => {
    const branch = [
      messageEntry("a1", null, assistantMessage({}, { cacheRead: 5_000, cacheWrite: 0 })),
      messageEntry("a2", "a1", assistantMessage({ stopReason: "aborted" }, { cacheRead: 9 })),
      messageEntry("a3", "a2", assistantMessage({ stopReason: "error" }, { cacheRead: 9 })),
    ];
    expect(findLatestCacheUsage(reader(branch))).toEqual({ read: 5_000, write: 0 });
  });

  it("returns undefined after a compaction or without assistant responses", () => {
    expect(findLatestCacheUsage(reader([messageEntry("a1", null, assistantMessage()), compaction]))).toBeUndefined();
    expect(findLatestCacheUsage(reader([]))).toBeUndefined();
  });
});

describe("createCacheUsageReader", () => {
  it("scans the branch only when the leaf changes", () => {
    const branch = [messageEntry("a1", null, assistantMessage())];
    const session = reader(branch);
    const read = createCacheUsageReader();
    expect(read(session)).toEqual({ read: 424_000, write: 2_100 });
    expect(read(session)).toEqual({ read: 424_000, write: 2_100 });
    expect(session.getBranch).toHaveBeenCalledTimes(1);

    branch.push(messageEntry("a2", "a1", assistantMessage({}, { cacheRead: 7, cacheWrite: 0 })));
    expect(read(session)).toEqual({ read: 7, write: 0 });
    expect(session.getBranch).toHaveBeenCalledTimes(2);
  });
});

describe("getSessionStartTime", () => {
  it("uses the session header timestamp, which survives resume", () => {
    const timestamp = "2026-10-02T05:31:00.000Z";
    expect(getSessionStartTime({ getHeader: () => ({ type: "session", id: "s", cwd: "/", timestamp }) })).toBe(Date.parse(timestamp));
  });

  it("returns undefined without a valid header", () => {
    expect(getSessionStartTime({ getHeader: () => null })).toBeUndefined();
    expect(getSessionStartTime({ getHeader: () => ({ type: "session", id: "s", cwd: "/", timestamp: "not a date" }) })).toBeUndefined();
  });
});
