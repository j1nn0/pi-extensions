import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectProvider, fetchUsageForProvider } from "../src/usage/index.ts";
import { parseCodexUsage } from "../src/usage/codex.ts";
import { parseCommandCodeUsage } from "../src/usage/commandcode.ts";
import { parseOpencodeUsage } from "../src/usage/opencode.ts";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const hour = 60 * 60 * 1000;
const day = 24 * hour;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("provider detection", () => {
  it("maps the built-in Codex and OpenCode Go providers by Pi provider id", () => {
    expect(detectProvider({ provider: "openai-codex" })).toBe("codex");
    expect(detectProvider({ provider: "opencode-go" })).toBe("opencode-go");
  });

  it("detects Command Code from the configured API host, whatever the provider id", () => {
    expect(detectProvider({ provider: "command-code", baseUrl: "https://api.commandcode.ai/provider/v1" })).toBe("command-code");
    expect(detectProvider({ provider: "my-cmd", baseUrl: "https://API.commandcode.ai/provider/v1" })).toBe("command-code");
  });

  it("never infers a provider from a model id or a look-alike host", () => {
    expect(detectProvider({ provider: "command-code" })).toBeNull();
    expect(detectProvider({ provider: "command-code", baseUrl: "https://api.commandcode.ai.example.com/v1" })).toBeNull();
    expect(detectProvider({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" })).toBeNull();
    expect(detectProvider({ provider: "custom", baseUrl: "not a url" })).toBeNull();
  });

  it("no longer supports the removed providers", () => {
    for (const provider of ["anthropic", "github-copilot", "google-gemini-cli", "minimax", "minimax-cn", "kimi-coding"]) {
      expect(detectProvider({ provider })).toBeNull();
    }
  });

  it("returns an unknown-provider snapshot for unmapped keys", async () => {
    await expect(fetchUsageForProvider("claude")).resolves.toEqual({
      provider: "Unknown",
      windows: [],
      error: "unknown-provider",
      fetchedAt: NOW,
    });
  });
});

describe("Codex", () => {
  it("labels windows from limit_window_seconds and keeps reset timestamps", () => {
    expect(
      parseCodexUsage({
        rate_limit: {
          primary_window: { used_percent: 71.5, reset_at: (NOW + 3 * hour) / 1000, limit_window_seconds: 5 * 3600 },
          secondary_window: { used_percent: 14, reset_at: (NOW + 4 * day) / 1000, limit_window_seconds: 7 * 24 * 3600 },
        },
      }).windows
    ).toEqual([
      { label: "5h", usedPercent: 71.5, resetsAt: NOW + 3 * hour },
      { label: "7d", usedPercent: 14, resetsAt: NOW + 4 * day },
    ]);
  });

  it("uses the reported length instead of assuming 5h", () => {
    expect(parseCodexUsage({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 8 * 3600 } } }).windows).toEqual([
      { label: "8h", usedPercent: 1, resetsAt: undefined },
    ]);
  });

  it("falls back to the documented 5h/7d labels and handles missing fields", () => {
    expect(parseCodexUsage({ rate_limit: { primary_window: {}, secondary_window: { used_percent: 140 } } }).windows).toEqual([
      { label: "5h", usedPercent: 0, resetsAt: undefined },
      { label: "7d", usedPercent: 100, resetsAt: undefined },
    ]);
    expect(parseCodexUsage({}).windows).toEqual([]);
  });
});

describe("OpenCode Go", () => {
  it("parses rolling, weekly, and monthly windows with reset timestamps", () => {
    expect(
      parseOpencodeUsage({
        rollingUsage: { usagePercent: 56.4, resetInSec: 9480 },
        weeklyUsage: { usagePercent: 87.5, resetInSec: 5 * 24 * 3600 },
        monthlyUsage: { usagePercent: 9, resetInSec: 30 * 24 * 3600 },
      }).windows
    ).toEqual([
      { label: "5h", usedPercent: 56.4, resetsAt: NOW + 9480 * 1000 },
      { label: "7d", usedPercent: 87.5, resetsAt: NOW + 5 * day },
      { label: "mo", usedPercent: 9, resetsAt: NOW + 30 * day },
    ]);
  });

  it("omits resets it does not report", () => {
    expect(parseOpencodeUsage({ rollingUsage: { usagePercent: 4 }, monthlyUsage: {} }).windows).toEqual([
      { label: "5h", usedPercent: 4, resetsAt: undefined },
      { label: "mo", usedPercent: 0, resetsAt: undefined },
    ]);
  });
});

describe("Command Code", () => {
  const body = {
    credits: { monthlyCredits: 5, purchasedCredits: 0, freeCredits: 0 },
    windowLimits: {
      limited: true,
      exceeded: null,
      fiveHour: { used: 3.15, cap: 14, exceeded: false, resetAt: NOW + 3 * hour },
      weekly: { used: 23.1, cap: 35, exceeded: false, resetAt: NOW + 6 * day },
    },
  };

  it("parses the 5-hour and weekly window limits as used / cap", () => {
    const usage = parseCommandCodeUsage(body);
    expect(usage.provider).toBe("Command Code");
    expect(usage.error).toBeUndefined();
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toEqual({ label: "5h", usedPercent: (3.15 / 14) * 100, resetsAt: NOW + 3 * hour });
    expect(usage.windows[1]).toEqual({ label: "7d", usedPercent: (23.1 / 35) * 100, resetsAt: NOW + 6 * day });
  });

  it("caps at 100% and uses 0% without a cap, like the CLI", () => {
    const windows = parseCommandCodeUsage({
      windowLimits: { fiveHour: { used: 20, cap: 14, resetAt: NOW }, weekly: { used: 5, cap: 0 } },
    }).windows;
    expect(windows.map((window) => window.usedPercent)).toEqual([100, 0]);
    expect(windows[1]?.resetsAt).toBeUndefined();
  });

  it("returns one window when only one is reported", () => {
    expect(parseCommandCodeUsage({ windowLimits: { weekly: { used: 1, cap: 4, resetAt: NOW + day } } }).windows).toEqual([
      { label: "7d", usedPercent: 25, resetsAt: NOW + day },
    ]);
  });

  it.each([
    ["missing body", undefined],
    ["null body", null],
    ["no window limits", { credits: { monthlyCredits: 5 } }],
    ["null window limits", { windowLimits: null }],
    ["non-numeric values", { windowLimits: { fiveHour: { used: "a lot", cap: "x" }, weekly: null } }],
  ])("reports no-usage-data for %s", (_name, value) => {
    expect(parseCommandCodeUsage(value)).toEqual({
      provider: "Command Code",
      windows: [],
      error: "no-usage-data",
      fetchedAt: NOW,
    });
  });

  it("ignores invalid reset timestamps", () => {
    expect(
      parseCommandCodeUsage({ windowLimits: { fiveHour: { used: 1, cap: 2, resetAt: "soon" } } }).windows[0]?.resetsAt
    ).toBeUndefined();
  });
});
