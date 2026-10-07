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
  it("parses the current rolling, weekly, and monthly response with reset timestamps", () => {
    expect(
      parseOpencodeUsage({
        usage: {
          rolling: { status: "ok", percent: 12.8, resetsAt: "2026-10-05T04:20:00.000Z" },
          weekly: { status: "ok", percent: 45.6, resetsAt: "2026-10-09T03:00:00.000Z" },
          monthly: { status: "ok", percent: 7.8, resetsAt: "2026-11-01T03:00:00.000Z" },
        },
      }).windows
    ).toEqual([
      { label: "5h", usedPercent: 12.8, resetsAt: Date.parse("2026-10-05T04:20:00.000Z") },
      { label: "7d", usedPercent: 45.6, resetsAt: Date.parse("2026-10-09T03:00:00.000Z") },
      { label: "mo", usedPercent: 7.8, resetsAt: Date.parse("2026-11-01T03:00:00.000Z") },
    ]);
  });

  it("omits missing windows without synthesizing them", () => {
    expect(parseOpencodeUsage({ usage: { rolling: { percent: 4 } } }).windows).toEqual([
      { label: "5h", usedPercent: 4, resetsAt: undefined },
    ]);
    expect(parseOpencodeUsage({ usage: { weekly: { percent: 25 }, monthly: { percent: 75 } } }).windows).toEqual([
      { label: "7d", usedPercent: 25, resetsAt: undefined },
      { label: "mo", usedPercent: 75, resetsAt: undefined },
    ]);

    expect(parseOpencodeUsage({ usage: { rolling: null, weekly: { percent: 25 }, monthly: null } }).windows).toEqual([
      { label: "7d", usedPercent: 25, resetsAt: undefined },
    ]);
  });

  it("keeps valid percentages when reset timestamps are missing or invalid", () => {
    expect(
      parseOpencodeUsage({
        usage: {
          rolling: { percent: 10 },
          weekly: { percent: 20, resetsAt: null },
          monthly: { percent: 30, resetsAt: "soon" },
        },
      }).windows
    ).toEqual([
      { label: "5h", usedPercent: 10, resetsAt: undefined },
      { label: "7d", usedPercent: 20, resetsAt: undefined },
      { label: "mo", usedPercent: 30, resetsAt: undefined },
    ]);
  });

  it.each([
    ["missing", {}],
    ["null", { percent: null }],
    ["string", { percent: "12" }],
    ["boolean", { percent: true }],
    ["NaN", { percent: Number.NaN }],
  ])("skips a window with a %s percentage instead of reporting 0%%", (_name, window) => {
    const result = parseOpencodeUsage({ usage: { rolling: window } });
    expect(result.windows).toEqual([]);
    expect(result.error).toBe("no-usage-data");
  });

  it("keeps explicit zero and clamps out-of-range percentages", () => {
    expect(
      parseOpencodeUsage({
        usage: {
          rolling: { percent: 0 },
          weekly: { percent: -25 },
          monthly: { percent: 150 },
        },
      }).windows.map(({ label, usedPercent }) => [label, usedPercent])
    ).toEqual([
      ["5h", 0],
      ["7d", 0],
      ["mo", 100],
    ]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty object", {}],
    ["null usage", { usage: null }],
    ["obsolete flat response", { rollingUsage: { usagePercent: 50, resetInSec: 30 } }],
  ])("reports no-usage-data for a %s body", (_name, body) => {
    expect(parseOpencodeUsage(body)).toEqual({
      provider: "OpenCode Go",
      windows: [],
      error: "no-usage-data",
      fetchedAt: NOW,
    });
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
