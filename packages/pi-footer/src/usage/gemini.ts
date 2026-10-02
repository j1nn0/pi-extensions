import { getGeminiToken } from "../auth.ts";
import { clampPercent } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

interface GeminiUsageResponse {
  buckets?: Array<{
    modelId?: string;
    remainingFraction?: number;
  }>;
}

export function parseGeminiUsage(body: unknown): UsageSnapshot {
  const data = body as GeminiUsageResponse;
  const quotas: Record<string, number> = {};

  for (const bucket of data.buckets || []) {
    const model = bucket.modelId || "unknown";
    const frac = bucket.remainingFraction ?? 1;
    const current = quotas[model];
    if (!current || frac < current) quotas[model] = frac;
  }

  const windows: RateWindow[] = [];
  let proMin = 1,
    flashMin = 1;
  let hasProModel = false,
    hasFlashModel = false;

  for (const [model, frac] of Object.entries(quotas)) {
    if (model.toLowerCase().includes("pro")) {
      hasProModel = true;
      if (frac < proMin) proMin = frac;
    }
    if (model.toLowerCase().includes("flash")) {
      hasFlashModel = true;
      if (frac < flashMin) flashMin = frac;
    }
  }

  if (hasProModel) windows.push({ label: "Pro", usedPercent: clampPercent((1 - proMin) * 100) });
  if (hasFlashModel) windows.push({ label: "Flash", usedPercent: clampPercent((1 - flashMin) * 100) });

  return { provider: "Gemini", windows, fetchedAt: Date.now() };
}

export async function fetchGeminiUsage(): Promise<UsageSnapshot> {
  const token = getGeminiToken();
  if (!token) {
    return { provider: "Gemini", windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  try {
    const res = await fetchWithTimeout("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });

    if (!res.ok) {
      return { provider: "Gemini", windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseGeminiUsage(await res.json());
  } catch (e) {
    return { provider: "Gemini", windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
