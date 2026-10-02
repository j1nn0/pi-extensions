import { getMinimaxToken } from "../auth.ts";
import { clampPercent, formatResetTime, getWindowLabel } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface MiniMaxBucket {
  model_name?: unknown;
  current_interval_status?: unknown;
  current_interval_remaining_percent?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  current_weekly_remaining_percent?: unknown;
  weekly_start_time?: unknown;
  weekly_end_time?: unknown;
}

interface MiniMaxResponse {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  } | null;
  model_remains?: unknown;
}

export function parseMinimaxUsage(body: unknown, provider: "minimax" | "minimax-cn"): UsageSnapshot {
  const data = body as MiniMaxResponse | null | undefined;
  const providerLabel = provider === "minimax-cn" ? "MiniMax CN" : "MiniMax";
  const baseResp = data?.base_resp;
  if (baseResp?.status_code && baseResp.status_code !== 0) {
    return {
      provider: providerLabel,
      windows: [],
      error: baseResp.status_msg || `API ${baseResp.status_code}`,
      fetchedAt: Date.now(),
    };
  }

  const remains = Array.isArray(data?.model_remains) ? (data.model_remains as MiniMaxBucket[]) : [];
  // Token Plan returns one bucket per capability (general = text/code, video, etc.).
  // Prefer the active "general" bucket since M-series chat models land there.
  // status === 1 = window is active/limiting, 3 = inactive (no usage). Fall back
  // to the first active bucket, then the first bucket of any kind.
  const textBucket =
    remains.find((entry) => entry?.model_name === "general" && Number(entry?.current_interval_status) === 1) ||
    remains.find((entry) => entry?.model_name === "general") ||
    remains.find((entry) => Number(entry?.current_interval_status) === 1) ||
    remains[0];

  if (!textBucket) {
    return { provider: providerLabel, windows: [], error: "no-usage-data", fetchedAt: Date.now() };
  }

  const windows: RateWindow[] = [];

  // Source of truth: *_remaining_percent (the *_total_count / *_usage_count
  // fields are zeroed in the credit-based model and cannot be used to compute
  // a fraction). The UI usage bar maps 100 - remainingPercent -> used.
  const intervalRemaining = Number(textBucket.current_interval_remaining_percent);
  if (Number.isFinite(intervalRemaining)) {
    const usedPercent = clampPercent(100 - intervalRemaining);
    const resetDate = textBucket.end_time ? new Date(Number(textBucket.end_time)) : undefined;
    const durationMs =
      textBucket.start_time && textBucket.end_time
        ? Number(textBucket.end_time) - Number(textBucket.start_time)
        : undefined;
    windows.push({
      label: getWindowLabel(durationMs, "5h"),
      usedPercent,
      resetsIn: resetDate ? formatResetTime(resetDate) : undefined,
    });
  }

  const weeklyRemaining = Number(textBucket.current_weekly_remaining_percent);
  if (Number.isFinite(weeklyRemaining)) {
    const usedPercent = clampPercent(100 - weeklyRemaining);
    const resetDate = textBucket.weekly_end_time
      ? new Date(Number(textBucket.weekly_end_time))
      : undefined;
    const durationMs =
      textBucket.weekly_start_time && textBucket.weekly_end_time
        ? Number(textBucket.weekly_end_time) - Number(textBucket.weekly_start_time)
        : undefined;
    windows.push({
      label: getWindowLabel(durationMs, "Week"),
      usedPercent,
      resetsIn: resetDate ? formatResetTime(resetDate) : undefined,
    });
  }

  if (windows.length === 0) {
    return { provider: providerLabel, windows: [], error: "no-usage-data", fetchedAt: Date.now() };
  }

  return { provider: providerLabel, windows, fetchedAt: Date.now() };
}

export async function fetchMinimaxUsage(provider: "minimax" | "minimax-cn"): Promise<UsageSnapshot> {
  const token = getMinimaxToken(provider);
  const providerLabel = provider === "minimax-cn" ? "MiniMax CN" : "MiniMax";
  // Docs-recommended Token Plan endpoint. The legacy /coding_plan/remains path
  // still works but the response field names differ from the current UI.
  const endpoint =
    provider === "minimax-cn"
      ? "https://api.minimaxi.com/v1/token_plan/remains"
      : "https://api.minimax.io/v1/token_plan/remains";

  if (!token) {
    return { provider: providerLabel, windows: [], error: "no-auth", fetchedAt: Date.now() };
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
      return { provider: providerLabel, windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseMinimaxUsage(await res.json(), provider);
  } catch (e) {
    return { provider: providerLabel, windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
