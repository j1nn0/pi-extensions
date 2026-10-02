import { fetchAnthropicUsage } from "./anthropic.ts";
import { fetchCodexUsage } from "./codex.ts";
import { fetchCopilotUsage } from "./copilot.ts";
import { fetchGeminiUsage } from "./gemini.ts";
import { fetchKimiUsage } from "./kimi.ts";
import { fetchMinimaxUsage } from "./minimax.ts";
import { fetchOpencodeUsage } from "./opencode.ts";
import type { UsageSnapshot } from "../types.ts";

export const USAGE_REFRESH_INTERVAL = 5 * 60_000;

const usageCache = new Map<string, UsageSnapshot>();

// Map pi provider names to our internal usage provider keys.
const PROVIDER_MAP: Record<string, string> = {
  anthropic: "claude", // Claude Max subscription
  "openai-codex": "codex", // Codex subscription
  "github-copilot": "copilot", // Copilot subscription
  "google-gemini-cli": "gemini", // Gemini CLI subscription
  minimax: "minimax", // MiniMax Token Plan / Coding Plan
  "minimax-cn": "minimax-cn", // MiniMax China plan
  "kimi-coding": "kimi-coding", // Kimi plan
  "opencode-go": "opencode-go", // OpenCode Go plan
};

export function detectProvider(modelProvider: string): string | null {
  return PROVIDER_MAP[modelProvider] || null;
}

export function getCachedUsage(provider: string): UsageSnapshot | undefined {
  return usageCache.get(provider);
}

export function cacheUsage(provider: string, usage: UsageSnapshot): void {
  usageCache.set(provider, usage);
}

export async function fetchUsageForProvider(provider: string): Promise<UsageSnapshot> {
  switch (provider) {
    case "claude":
      return fetchAnthropicUsage();
    case "codex":
      return fetchCodexUsage();
    case "copilot":
      return fetchCopilotUsage();
    case "gemini":
      return fetchGeminiUsage();
    case "minimax":
      return fetchMinimaxUsage("minimax");
    case "minimax-cn":
      return fetchMinimaxUsage("minimax-cn");
    case "kimi-coding":
      return fetchKimiUsage();
    case "opencode-go":
      return fetchOpencodeUsage();
    default:
      return { provider: "Unknown", windows: [], error: "unknown-provider", fetchedAt: Date.now() };
  }
}
