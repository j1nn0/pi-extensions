import { createHash } from "node:crypto";
import { getCommandCodeToken } from "../auth.ts";
import { clampPercent } from "../format.ts";
import { fetchWithTimeout } from "./fetch.ts";
import type { RateWindow, UsageSnapshot } from "../types.ts";

// Same API host and routes the `cmd` CLI uses for its usage view.
const API_BASE_URL = "https://api.commandcode.ai";
const WHOAMI_PATH = "/alpha/whoami";
const CREDITS_PATH = "/alpha/billing/credits";

interface CommandCodeWindowLimit {
  used?: unknown;
  cap?: unknown;
  resetAt?: unknown;
}

interface CommandCodeCreditsResponse {
  windowLimits?: {
    fiveHour?: CommandCodeWindowLimit | null;
    weekly?: CommandCodeWindowLimit | null;
  } | null;
}

interface CommandCodeWhoamiResponse {
  org?: { id?: unknown } | null;
}

// Organization id per API key fingerprint; it does not change during a process.
const orgIdCache = new Map<string, string | null>();

function parseWindowLimit(limit: CommandCodeWindowLimit, label: string): RateWindow | undefined {
  const used = Number(limit.used);
  const cap = Number(limit.cap);
  if (!Number.isFinite(used) || !Number.isFinite(cap)) return undefined;

  const resetAt = Number(limit.resetAt);
  return {
    label,
    // Matches the CLI: used / cap, capped at 100%, 0% when there is no cap.
    usedPercent: cap > 0 ? clampPercent((used / cap) * 100) : 0,
    resetsAt: Number.isFinite(resetAt) && resetAt > 0 ? resetAt : undefined,
  };
}

export function parseCommandCodeUsage(body: unknown): UsageSnapshot {
  const data = body as CommandCodeCreditsResponse | null | undefined;
  const limits = data?.windowLimits;
  const windows: RateWindow[] = [];

  const fiveHour = limits?.fiveHour ? parseWindowLimit(limits.fiveHour, "5h") : undefined;
  if (fiveHour) windows.push(fiveHour);
  const weekly = limits?.weekly ? parseWindowLimit(limits.weekly, "7d") : undefined;
  if (weekly) windows.push(weekly);

  if (windows.length === 0) {
    return { provider: "Command Code", windows: [], error: "no-usage-data", fetchedAt: Date.now() };
  }
  return { provider: "Command Code", windows, fetchedAt: Date.now() };
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "pi-footer",
  };
}

async function resolveOrgId(token: string): Promise<string | null> {
  const fingerprint = createHash("sha256").update(token).digest("hex");
  const cached = orgIdCache.get(fingerprint);
  if (cached !== undefined) return cached;

  const res = await fetchWithTimeout(`${API_BASE_URL}${WHOAMI_PATH}`, {
    method: "GET",
    headers: requestHeaders(token),
  });
  // Like the CLI, continue without an organization when whoami fails, but do not cache it.
  if (!res.ok) return null;

  const data = (await res.json()) as CommandCodeWhoamiResponse | null;
  const orgId = typeof data?.org?.id === "string" && data.org.id ? data.org.id : null;
  orgIdCache.set(fingerprint, orgId);
  return orgId;
}

export function resetCommandCodeOrgCache(): void {
  orgIdCache.clear();
}

export async function fetchCommandCodeUsage(): Promise<UsageSnapshot> {
  const providerLabel = "Command Code";
  const token = getCommandCodeToken();
  if (!token) {
    return { provider: providerLabel, windows: [], error: "no-auth", fetchedAt: Date.now() };
  }

  try {
    const orgId = await resolveOrgId(token);
    const query = orgId ? `?${new URLSearchParams({ orgId }).toString()}` : "";
    const res = await fetchWithTimeout(`${API_BASE_URL}${CREDITS_PATH}${query}`, {
      method: "GET",
      headers: requestHeaders(token),
    });

    if (!res.ok) {
      return { provider: providerLabel, windows: [], error: `HTTP ${res.status}`, fetchedAt: Date.now() };
    }

    return parseCommandCodeUsage(await res.json());
  } catch (e) {
    return { provider: providerLabel, windows: [], error: String(e), fetchedAt: Date.now() };
  }
}
