import { getOpencodeToken } from "../auth.ts";
import { clampPercent } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface OpenCodeUsageWindow {
  percent?: unknown;
  resetsAt?: unknown;
}

interface OpenCodeUsageResponse {
  usage?: {
    rolling?: OpenCodeUsageWindow | null;
    weekly?: OpenCodeUsageWindow | null;
    monthly?: OpenCodeUsageWindow | null;
  } | null;
}

function parseOpencodeWindow(window: unknown, label: string): RateWindow | undefined {
  if (!window || typeof window !== "object") return undefined;

  const data = window as OpenCodeUsageWindow;
  if (typeof data.percent !== "number" || !Number.isFinite(data.percent)) return undefined;

  const parsedReset = typeof data.resetsAt === "string" ? Date.parse(data.resetsAt) : Number.NaN;
  return {
    label,
    usedPercent: clampPercent(data.percent),
    resetsAt: Number.isFinite(parsedReset) ? parsedReset : undefined,
  };
}

export function parseOpencodeUsage(body: unknown): UsageSnapshot {
  const data = body !== null && typeof body === "object" ? (body as OpenCodeUsageResponse) : undefined;
  const usage = data?.usage !== null && typeof data?.usage === "object" ? data.usage : undefined;
  const windows: RateWindow[] = [];

  const rolling = parseOpencodeWindow(usage?.rolling, "5h");
  if (rolling) windows.push(rolling);
  const weekly = parseOpencodeWindow(usage?.weekly, "7d");
  if (weekly) windows.push(weekly);
  const monthly = parseOpencodeWindow(usage?.monthly, "mo");
  if (monthly) windows.push(monthly);

  if (windows.length === 0) {
    return { provider: "OpenCode Go", windows: [], error: "no-usage-data", fetchedAt: Date.now() };
  }
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
