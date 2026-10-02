import { getCodexToken } from "../auth.ts";
import { clampPercent, formatResetTime, getWindowLabel } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface CodexUsageWindow {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}

interface CodexUsageResponse {
  rate_limit?: {
    primary_window?: CodexUsageWindow;
    secondary_window?: CodexUsageWindow;
  };
}

export function parseCodexUsage(body: unknown): UsageSnapshot {
  const data = body as CodexUsageResponse;
  const providerLabel = "Codex";
  const windows: RateWindow[] = [];

  if (data.rate_limit?.primary_window) {
    const pw = data.rate_limit.primary_window;
    const resetDate = pw.reset_at ? new Date(pw.reset_at * 1000) : undefined;
    const durationMs = typeof pw.limit_window_seconds === "number" ? pw.limit_window_seconds * 1000 : undefined;
    windows.push({
      label: getWindowLabel(durationMs, "5h"),
      usedPercent: clampPercent(pw.used_percent || 0),
      resetsIn: resetDate ? formatResetTime(resetDate) : undefined,
    });
  }

  if (data.rate_limit?.secondary_window) {
    const sw = data.rate_limit.secondary_window;
    const resetDate = sw.reset_at ? new Date(sw.reset_at * 1000) : undefined;
    const durationMs = typeof sw.limit_window_seconds === "number" ? sw.limit_window_seconds * 1000 : undefined;
    windows.push({
      label: getWindowLabel(durationMs, "Week"),
      usedPercent: clampPercent(sw.used_percent || 0),
      resetsIn: resetDate ? formatResetTime(resetDate) : undefined,
    });
  }

  return { provider: providerLabel, windows, fetchedAt: Date.now() };
}

export async function fetchCodexUsage(): Promise<UsageSnapshot> {
  const creds = getCodexToken();
  if (!creds) {
    return { provider: "Codex", windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  const providerLabel = "Codex";

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.token}`,
      "User-Agent": "pi-agent",
      Accept: "application/json",
    };

    if (creds.accountId) {
      headers["ChatGPT-Account-Id"] = creds.accountId;
    }

    const res = await fetchWithTimeout("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      return { provider: providerLabel, windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseCodexUsage(await res.json());
  } catch (e) {
    return { provider: providerLabel, windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
