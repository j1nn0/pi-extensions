import { getClaudeToken } from "../auth.ts";
import { formatResetTime, normalizePercent } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface AnthropicUsageResponse {
  five_hour?: {
    utilization?: number;
    resets_at?: string;
  };
  seven_day?: {
    utilization?: number;
    resets_at?: string;
  };
}

export function parseAnthropicUsage(body: unknown): UsageSnapshot {
  const data = body as AnthropicUsageResponse;
  const windows: RateWindow[] = [];

  if (data.five_hour?.utilization !== undefined) {
    windows.push({
      label: "5h",
      usedPercent: normalizePercent(data.five_hour.utilization),
      resetsIn: data.five_hour.resets_at ? formatResetTime(new Date(data.five_hour.resets_at)) : undefined,
    });
  }

  if (data.seven_day?.utilization !== undefined) {
    windows.push({
      label: "Week",
      usedPercent: normalizePercent(data.seven_day.utilization),
      resetsIn: data.seven_day.resets_at ? formatResetTime(new Date(data.seven_day.resets_at)) : undefined,
    });
  }

  return { provider: "Claude", windows, fetchedAt: Date.now() };
}

export async function fetchAnthropicUsage(): Promise<UsageSnapshot> {
  const token = getClaudeToken();
  if (!token) {
    return { provider: "Claude", windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        // Other user agents land in a much stricter rate-limit bucket (persistent 429s).
        "User-Agent": "claude-code/2.1.282",
      },
    });

    if (!res.ok) {
      return { provider: "Claude", windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseAnthropicUsage(await res.json());
  } catch (e) {
    return { provider: "Claude", windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
