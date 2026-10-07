import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CacheUsage } from "./types.ts";

type ReadonlySessionManager = ExtensionContext["sessionManager"];
type SessionReader = Pick<ReadonlySessionManager, "getBranch" | "getLeafId">;

/**
 * Prompt-cache usage of the latest completed assistant response on the current branch.
 * Returns undefined when there is none, or when a compaction happened after it
 * (that usage no longer describes the current context).
 */
export function findLatestCacheUsage(sessionManager: SessionReader): CacheUsage | undefined {
  const branch = sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (!entry) continue;
    if (entry.type === "compaction") return undefined;
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;

    const message = entry.message;
    if (message.stopReason === "aborted" || message.stopReason === "error") continue;
    return { read: message.usage?.cacheRead ?? 0, write: message.usage?.cacheWrite ?? 0 };
  }
  return undefined;
}

/** Memoize cache usage by leaf id; the branch only changes when the leaf changes. */
export function createCacheUsageReader(): (sessionManager: SessionReader) => CacheUsage | undefined {
  let lastLeafId: string | null | undefined;
  let lastValue: CacheUsage | undefined;
  return (sessionManager) => {
    const leafId = sessionManager.getLeafId();
    if (leafId !== lastLeafId) {
      lastValue = findLatestCacheUsage(sessionManager);
      lastLeafId = leafId;
    }
    return lastValue;
  };
}

/**
 * Wall-clock start of the logical session: the session header timestamp, which
 * is kept when a session is resumed.
 */
export function getSessionStartTime(sessionManager: Pick<ReadonlySessionManager, "getHeader">): number | undefined {
  const timestamp = sessionManager.getHeader()?.timestamp;
  if (!timestamp) return undefined;
  const startedAt = Date.parse(timestamp);
  return Number.isFinite(startedAt) ? startedAt : undefined;
}
