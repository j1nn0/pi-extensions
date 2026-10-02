import { getCopilotToken } from "../auth.ts";
import { clampPercent, formatResetTime } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface CopilotUsageResponse {
  quota_reset_date_utc?: string;
  quota_snapshots?: {
    premium_interactions?: {
      percent_remaining?: number;
    };
    chat?: {
      percent_remaining?: number;
      unlimited?: boolean;
    };
  };
}

export function parseCopilotUsage(body: unknown): UsageSnapshot {
  const data = body as CopilotUsageResponse;
  const windows: RateWindow[] = [];

  const resetDate = data.quota_reset_date_utc ? new Date(data.quota_reset_date_utc) : undefined;
  const resetsIn = resetDate ? formatResetTime(resetDate) : undefined;

  if (data.quota_snapshots?.premium_interactions) {
    const pi = data.quota_snapshots.premium_interactions;
    const usedPercent = clampPercent(100 - (pi.percent_remaining || 0));
    windows.push({ label: "Premium", usedPercent, resetsIn });
  }

  if (data.quota_snapshots?.chat && !data.quota_snapshots.chat.unlimited) {
    const chat = data.quota_snapshots.chat;
    windows.push({
      label: "Chat",
      usedPercent: clampPercent(100 - (chat.percent_remaining || 0)),
      resetsIn,
    });
  }

  return { provider: "Copilot", windows, fetchedAt: Date.now() };
}

export async function fetchCopilotUsage(): Promise<UsageSnapshot> {
  const token = getCopilotToken();
  if (!token) {
    return { provider: "Copilot", windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  try {
    const res = await fetchWithTimeout("https://api.github.com/copilot_internal/user", {
      headers: {
        "Editor-Version": "vscode/1.96.2",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
        Accept: "application/json",
        Authorization: `token ${token}`,
      },
    });

    if (!res.ok) {
      return { provider: "Copilot", windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseCopilotUsage(await res.json());
  } catch (e) {
    return { provider: "Copilot", windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
