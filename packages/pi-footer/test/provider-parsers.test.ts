import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectProvider, fetchUsageForProvider } from "../src/usage/index.ts";
import { parseAnthropicUsage } from "../src/usage/anthropic.ts";
import { parseCodexUsage } from "../src/usage/codex.ts";
import { parseCopilotUsage } from "../src/usage/copilot.ts";
import { parseGeminiUsage } from "../src/usage/gemini.ts";
import { parseKimiUsage } from "../src/usage/kimi.ts";
import { parseMinimaxUsage } from "../src/usage/minimax.ts";
import { parseOpencodeUsage } from "../src/usage/opencode.ts";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const after = (ms: number): string => new Date(NOW + ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("provider detection and dispatch", () => {
  it("detects every mapped provider id and returns null for unknown ids", () => {
    const providers = {
      anthropic: "claude",
      "openai-codex": "codex",
      "github-copilot": "copilot",
      "google-gemini-cli": "gemini",
      minimax: "minimax",
      "minimax-cn": "minimax-cn",
      "kimi-coding": "kimi-coding",
      "opencode-go": "opencode-go",
    };
    for (const [providerId, usageProvider] of Object.entries(providers)) {
      expect(detectProvider(providerId)).toBe(usageProvider);
    }
    expect(detectProvider("not-configured")).toBeNull();
  });

  it("returns the unknown-provider result for the dispatch default branch", async () => {
    await expect(fetchUsageForProvider("not-configured")).resolves.toEqual({
      provider: "Unknown",
      windows: [],
      error: "unknown-provider",
      fetchedAt: NOW,
    });
  });
});

describe("Anthropic parser", () => {
  it("parses available windows and tolerates missing windows", () => {
    expect(
      parseAnthropicUsage({
        five_hour: { utilization: 0.375, resets_at: after(2 * hour + 38 * 60_000) },
        seven_day: { utilization: 83.4, resets_at: after(6 * day + 3 * hour) },
      })
    ).toEqual({
      provider: "Claude",
      windows: [
        { label: "5h", usedPercent: 37.5, resetsIn: "2h38m" },
        { label: "Week", usedPercent: 83.4, resetsIn: "6d3h" },
      ],
      fetchedAt: NOW,
    });

    expect(parseAnthropicUsage({})).toEqual({ provider: "Claude", windows: [], fetchedAt: NOW });
  });
});

describe("Copilot parser", () => {
  it("omits unlimited chat while parsing premium quota", () => {
    expect(
      parseCopilotUsage({
        quota_reset_date_utc: after(65 * 60_000),
        quota_snapshots: {
          premium_interactions: { percent_remaining: 5.4 },
          chat: { percent_remaining: 75, unlimited: true },
        },
      })
    ).toEqual({
      provider: "Copilot",
      windows: [{ label: "Premium", usedPercent: 94.6, resetsIn: "1h5m" }],
      fetchedAt: NOW,
    });
  });

  it("uses the existing 100-percent-used result when percent_remaining is missing", () => {
    expect(parseCopilotUsage({ quota_snapshots: { premium_interactions: {}, chat: {} } }).windows).toEqual([
      { label: "Premium", usedPercent: 100, resetsIn: undefined },
      { label: "Chat", usedPercent: 100, resetsIn: undefined },
    ]);
  });
});

describe("Codex parser", () => {
  it("labels windows from their durations and leaves missing reset times absent", () => {
    expect(
      parseCodexUsage({
        rate_limit: {
          primary_window: { used_percent: 71.5, limit_window_seconds: 24 * 60 * 60 },
          secondary_window: { used_percent: 14, limit_window_seconds: 7 * 24 * 60 * 60 },
        },
      })
    ).toEqual({
      provider: "Codex",
      windows: [
        { label: "Day", usedPercent: 71.5, resetsIn: undefined },
        { label: "Week", usedPercent: 14, resetsIn: undefined },
      ],
      fetchedAt: NOW,
    });
  });
});

describe("Gemini parser", () => {
  it("takes the minimum remaining quota for pro and flash model families", () => {
    expect(
      parseGeminiUsage({
        buckets: [
          { modelId: "gemini-pro", remainingFraction: 0.7 },
          { modelId: "gemini-pro-preview", remainingFraction: 0.2 },
          { modelId: "gemini-flash", remainingFraction: 0.125 },
          { modelId: "other-model", remainingFraction: 0.01 },
        ],
      })
    ).toEqual({
      provider: "Gemini",
      windows: [
        { label: "Pro", usedPercent: 80 },
        { label: "Flash", usedPercent: 87.5 },
      ],
      fetchedAt: NOW,
    });
  });

  it("returns no windows when there are no quota buckets", () => {
    expect(parseGeminiUsage({ buckets: [] })).toEqual({ provider: "Gemini", windows: [], fetchedAt: NOW });
  });
});

describe("MiniMax parser", () => {
  it("prefers an active general bucket over other active or inactive buckets", () => {
    expect(
      parseMinimaxUsage(
        {
          model_remains: [
            { model_name: "video", current_interval_status: 1, current_interval_remaining_percent: 5 },
            { model_name: "general", current_interval_status: 3, current_interval_remaining_percent: 90 },
            { model_name: "general", current_interval_status: 1, current_interval_remaining_percent: 80 },
          ],
        },
        "minimax"
      )
    ).toEqual({ provider: "MiniMax", windows: [{ label: "5h", usedPercent: 20, resetsIn: undefined }], fetchedAt: NOW });
  });

  it("returns provider API errors, no-bucket errors, and no-usage-data for non-finite remaining values", () => {
    expect(parseMinimaxUsage({ base_resp: { status_code: 7, status_msg: "plan unavailable" } }, "minimax-cn")).toEqual({
      provider: "MiniMax CN",
      windows: [],
      error: "plan unavailable",
      fetchedAt: NOW,
    });
    expect(parseMinimaxUsage({ base_resp: { status_code: 9 } }, "minimax").error).toBe("API 9");
    expect(parseMinimaxUsage({ model_remains: [] }, "minimax").error).toBe("no-usage-data");
    expect(
      parseMinimaxUsage(
        {
          model_remains: [
            {
              model_name: "general",
              current_interval_status: 1,
              current_interval_remaining_percent: "not-a-number",
              current_weekly_remaining_percent: "not-a-number",
            },
          ],
        },
        "minimax"
      )
    ).toEqual({ provider: "MiniMax", windows: [], error: "no-usage-data", fetchedAt: NOW });
  });
});

describe("Kimi parser", () => {
  it("skips zero-limit windows, handles minute durations, and parses weekly usage", () => {
    expect(
      parseKimiUsage({
        limits: [
          { detail: { limit: 0, remaining: 0 } },
          {
            detail: { limit: 100, remaining: 75, resetTime: after(65 * 60_000) },
            window: { duration: 120, timeUnit: "TIME_UNIT_MINUTE" },
          },
        ],
        usage: { limit: 200, remaining: 50, resetTime: after(6 * day) },
      })
    ).toEqual({
      provider: "Kimi Coding",
      windows: [
        { label: "5h", usedPercent: 25, resetsIn: "1h5m" },
        { label: "Weekly", usedPercent: 75, resetsIn: "6d" },
      ],
      fetchedAt: NOW,
    });
  });
});

describe("OpenCode parser", () => {
  it("leaves missing resetInSec unset while parsing present windows", () => {
    expect(
      parseOpencodeUsage({
        rollingUsage: { usagePercent: 56.4 },
        weeklyUsage: { usagePercent: 87.5, resetInSec: hour / 1000 },
      })
    ).toEqual({
      provider: "OpenCode Go",
      windows: [
        { label: "5h", usedPercent: 56.4, resetsIn: undefined },
        { label: "Week", usedPercent: 87.5, resetsIn: "1h" },
      ],
      fetchedAt: NOW,
    });
  });
});
