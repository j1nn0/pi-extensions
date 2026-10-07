import { fetchCodexUsage } from "./codex.ts";
import { fetchCommandCodeUsage } from "./commandcode.ts";
import { fetchOpencodeUsage } from "./opencode.ts";
import type { UsageSnapshot } from "../types.ts";

export const USAGE_REFRESH_INTERVAL = 5 * 60_000;

export type UsageProvider = "codex" | "opencode-go" | "command-code";

export interface ProviderModel {
  provider: string;
  baseUrl?: string;
}

const usageCache = new Map<string, UsageSnapshot>();

// Map Pi provider ids to internal usage provider keys.
const PROVIDER_MAP: Record<string, UsageProvider> = {
  "openai-codex": "codex", // Built-in Codex subscription provider
  "opencode-go": "opencode-go", // Built-in OpenCode Go provider
};

const COMMAND_CODE_API_HOST = "api.commandcode.ai";

function hostOf(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Detect the usage provider from Pi's provider configuration. Model ids are never used:
 * the same model can be served by several providers.
 */
export function detectProvider(model: ProviderModel): UsageProvider | null {
  // Command Code is configured as a custom provider in models.json, so its id is
  // user-chosen; the configured API host is the reliable signal.
  if (hostOf(model.baseUrl) === COMMAND_CODE_API_HOST) return "command-code";
  return PROVIDER_MAP[model.provider] ?? null;
}

export function getCachedUsage(provider: string): UsageSnapshot | undefined {
  return usageCache.get(provider);
}

export function cacheUsage(provider: string, usage: UsageSnapshot): void {
  usageCache.set(provider, usage);
}

export async function fetchUsageForProvider(provider: string): Promise<UsageSnapshot> {
  switch (provider) {
    case "codex":
      return fetchCodexUsage();
    case "opencode-go":
      return fetchOpencodeUsage();
    case "command-code":
      return fetchCommandCodeUsage();
    default:
      return { provider: "Unknown", windows: [], error: "unknown-provider", fetchedAt: Date.now() };
  }
}
