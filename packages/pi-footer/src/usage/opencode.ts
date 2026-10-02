import { getOpencodeToken } from "../auth.ts";
import { clampPercent } from "../format.ts";
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

function parseOpencodeWindow(window: OpenCodeUsageWindow, label: string): RateWindow {
  return {
    label,
    usedPercent: clampPercent(window.usagePercent ?? 0),
    resetsAt: Number.isFinite(window.resetInSec) ? Date.now() + (window.resetInSec as number) * 1000 : undefined,
  };
}

export function parseOpencodeUsage(body: unknown): UsageSnapshot {
  const data = body as OpenCodeUsageResponse;
  const windows: RateWindow[] = [];

  if (data.rollingUsage) windows.push(parseOpencodeWindow(data.rollingUsage, "5h"));
  if (data.weeklyUsage) windows.push(parseOpencodeWindow(data.weeklyUsage, "7d"));
  if (data.monthlyUsage) windows.push(parseOpencodeWindow(data.monthlyUsage, "mo"));

  return { provider: "OpenCode Go", windows, fetchedAt: Date.now() };
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
