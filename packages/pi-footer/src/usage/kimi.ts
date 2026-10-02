import { getKimiToken } from "../auth.ts";
import { clampPercent, formatResetTime, getWindowLabel } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface KimiUsageLimit {
  detail?: {
    limit?: unknown;
    remaining?: unknown;
    resetTime?: string | number;
  };
  window?: {
    duration?: number;
    timeUnit?: string;
  };
}

interface KimiUsageResponse {
  limits?: KimiUsageLimit[];
  usage?: {
    limit?: unknown;
    remaining?: unknown;
    resetTime?: string | number;
  };
}

export function parseKimiUsage(body: unknown): UsageSnapshot {
  const data = body as KimiUsageResponse;
  const windows: RateWindow[] = [];

  for (const limit of data.limits || []) {
    const windowLimit = Number(limit.detail?.limit) || 0;
    const windowRemaining = Number(limit.detail?.remaining) || 0;
    if (windowLimit > 0) {
      const used = windowLimit - windowRemaining;
      const usedPercent = clampPercent((used / windowLimit) * 100);
      const resetDate = limit.detail?.resetTime ? new Date(limit.detail.resetTime) : undefined;
      const durationMs =
        limit.window?.duration && limit.window?.timeUnit === "TIME_UNIT_MINUTE"
          ? limit.window.duration * 60 * 1000
          : undefined;

      windows.push({
        label: getWindowLabel(durationMs, "5h"),
        usedPercent,
        resetsIn: resetDate ? formatResetTime(resetDate) : undefined,
      });
    }
  }

  const weeklyLimit = Number(data.usage?.limit) || 0;
  const weeklyRemaining = Number(data.usage?.remaining) || 0;
  const weeklyResetTime = data.usage?.resetTime;

  if (weeklyLimit > 0) {
    const used = weeklyLimit - weeklyRemaining;
    const usedPercent = clampPercent((used / weeklyLimit) * 100);
    windows.push({
      label: "Weekly",
      usedPercent,
      resetsIn: weeklyResetTime ? formatResetTime(new Date(weeklyResetTime)) : undefined,
    });
  }

  return { provider: "Kimi Coding", windows, fetchedAt: Date.now() };
}

export async function fetchKimiUsage(): Promise<UsageSnapshot> {
  const token = getKimiToken();
  const endpoint = "https://api.kimi.com/coding/v1/usages";
  if (!token) {
    return { provider: "Kimi Coding", windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      return { provider: "Kimi Coding", windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseKimiUsage(await res.json());
  } catch (e) {
    return { provider: "Kimi Coding", windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
