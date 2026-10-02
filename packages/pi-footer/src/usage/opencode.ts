import { getOpencodeToken } from "../auth.ts";
import { clampPercent, formatResetTime } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface OpenCodeUsageWindow {
  usagePercent?: number;
  resetInSec?: number;
}

interface OpenCodeUsageResponse {
  rollingUsage?: OpenCodeUsageWindow;
  weeklyUsage?: OpenCodeUsageWindow;
  monthlyUsage?: OpenCodeUsageWindow;
}

export function parseOpencodeUsage(body: unknown): UsageSnapshot {
  const data = body as OpenCodeUsageResponse;
  const providerLabel = "OpenCode Go";
  const windows: RateWindow[] = [];

  if (data.rollingUsage) {
    const usedPercent = clampPercent(data.rollingUsage.usagePercent ?? 0);
    const resetsIn = Number.isFinite(data.rollingUsage.resetInSec)
      ? formatResetTime(new Date(Date.now() + (data.rollingUsage.resetInSec as number) * 1000))
      : undefined;
    windows.push({ label: "5h", usedPercent, resetsIn });
  }

  if (data.weeklyUsage) {
    const usedPercent = clampPercent(data.weeklyUsage.usagePercent ?? 0);
    const resetsIn = Number.isFinite(data.weeklyUsage.resetInSec)
      ? formatResetTime(new Date(Date.now() + (data.weeklyUsage.resetInSec as number) * 1000))
      : undefined;
    windows.push({ label: "Week", usedPercent, resetsIn });
  }

  if (data.monthlyUsage) {
    const usedPercent = clampPercent(data.monthlyUsage.usagePercent ?? 0);
    const resetsIn = Number.isFinite(data.monthlyUsage.resetInSec)
      ? formatResetTime(new Date(Date.now() + (data.monthlyUsage.resetInSec as number) * 1000))
      : undefined;
    windows.push({ label: "Month", usedPercent, resetsIn });
  }

  return { provider: providerLabel, windows, fetchedAt: Date.now() };
}

export async function fetchOpencodeUsage(): Promise<UsageSnapshot> {
  const providerLabel = "OpenCode Go";
  const token = getOpencodeToken();
  if (!token) {
    return { provider: providerLabel, windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  try {
    const res = await fetchWithTimeout("https://opencode.ai/zen/go/v1/usage", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return { provider: providerLabel, windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseOpencodeUsage(await res.json());
  } catch (e) {
    return { provider: providerLabel, windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
