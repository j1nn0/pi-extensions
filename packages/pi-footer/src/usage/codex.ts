import { getCodexToken } from "../auth.ts";
import { clampPercent, getWindowLabel } from "../format.ts";
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

function parseCodexWindow(window: CodexUsageWindow, fallbackLabel: string): RateWindow {
  const durationMs =
    typeof window.limit_window_seconds === "number" ? window.limit_window_seconds * 1000 : undefined;
  return {
    label: getWindowLabel(durationMs, fallbackLabel),
    usedPercent: clampPercent(window.used_percent || 0),
    resetsAt: window.reset_at ? window.reset_at * 1000 : undefined,
  };
}

export function parseCodexUsage(body: unknown): UsageSnapshot {
  const data = body as CodexUsageResponse;
  const windows: RateWindow[] = [];

  // Codex documents the primary window as the 5-hour limit and the secondary as weekly.
  if (data.rate_limit?.primary_window) windows.push(parseCodexWindow(data.rate_limit.primary_window, "5h"));
  if (data.rate_limit?.secondary_window) windows.push(parseCodexWindow(data.rate_limit.secondary_window, "7d"));

  return { provider: "Codex", windows, fetchedAt: Date.now() };
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
