import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { vi } from "vitest";

export const FROZEN_NOW = Date.parse("2026-10-02T12:00:00.000Z");
export const ENDPOINTS = {
  anthropic: "https://api.anthropic.com/api/oauth/usage",
  codex: "https://chatgpt.com/backend-api/wham/usage",
  copilot: "https://api.github.com/copilot_internal/user",
  gemini: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
  minimax: "https://api.minimax.io/v1/token_plan/remains",
  minimaxCn: "https://api.minimaxi.com/v1/token_plan/remains",
  kimi: "https://api.kimi.com/coding/v1/usages",
  opencode: "https://opencode.ai/zen/go/v1/usage",
} as const;

type ResponseFixture = { status: number; body: unknown };
type RecordedRequest = { url: string; method: string; headers: Headers; body?: string };

const dummyAuth = {
  anthropic: { access: "test-token-anthropic" },
  "openai-codex": { access: "test-token-codex", accountId: "test-account" },
  "github-copilot": { refresh: "test-token-copilot" },
  "google-gemini-cli": { access: "test-token-gemini" },
  minimax: { key: "test-token-minimax" },
  "minimax-cn": { key: "test-token-minimax-cn" },
  "kimi-coding": { key: "test-token-kimi" },
  "opencode-go": { key: "test-token-opencode" },
};

const apiKeyEnvVars = [
  "ANTHROPIC_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "KIMI_API_KEY",
  "OPENCODE_API_KEY",
];

function after(ms: number): string {
  return new Date(FROZEN_NOW + ms).toISOString();
}

function minimaxBody(intervalRemaining = 65, intervalDuration = 5 * 60 * 60 * 1000): unknown {
  const intervalStart = FROZEN_NOW - 2 * 60 * 60 * 1000;
  const intervalEnd = intervalStart + intervalDuration;
  const weeklyStart = FROZEN_NOW - 2 * 24 * 60 * 60 * 1000;
  const weeklyEnd = weeklyStart + 7 * 24 * 60 * 60 * 1000;
  return {
    base_resp: { status_code: 0, status_msg: "success" },
    model_remains: [
      {
        model_name: "video",
        current_interval_status: 1,
        current_interval_remaining_percent: 5,
        start_time: String(intervalStart),
        end_time: String(intervalEnd),
      },
      {
        model_name: "general",
        current_interval_status: 3,
        current_interval_remaining_percent: 90,
        start_time: String(intervalStart),
        end_time: String(intervalEnd),
      },
      {
        model_name: "general",
        current_interval_status: 1,
        current_interval_remaining_percent: intervalRemaining,
        start_time: String(intervalStart),
        end_time: String(intervalEnd),
        current_weekly_remaining_percent: 12,
        weekly_start_time: String(weeklyStart),
        weekly_end_time: String(weeklyEnd),
      },
    ],
  };
}

export function defaultFixtures(): Map<string, ResponseFixture> {
  return new Map([
    [
      ENDPOINTS.anthropic,
      {
        status: 200,
        body: {
          five_hour: { utilization: 0.375, resets_at: after(2 * 60 * 60 * 1000 + 38 * 60 * 1000) },
          seven_day: { utilization: 83.4, resets_at: after(6 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000) },
        },
      },
    ],
    [
      ENDPOINTS.codex,
      {
        status: 200,
        body: {
          rate_limit: {
            primary_window: {
              used_percent: 71.5,
              reset_at: (FROZEN_NOW + 3 * 60 * 60 * 1000) / 1000,
              limit_window_seconds: 5 * 60 * 60,
            },
            secondary_window: {
              used_percent: 14,
              reset_at: (FROZEN_NOW + 4 * 24 * 60 * 60 * 1000) / 1000,
              limit_window_seconds: 7 * 24 * 60 * 60,
            },
          },
        },
      },
    ],
    [
      ENDPOINTS.copilot,
      {
        status: 200,
        body: {
          quota_reset_date_utc: after(65 * 60 * 1000),
          quota_snapshots: {
            premium_interactions: { percent_remaining: 5.4 },
            chat: { percent_remaining: 75, unlimited: false },
          },
        },
      },
    ],
    [
      ENDPOINTS.gemini,
      {
        status: 200,
        body: {
          buckets: [
            { modelId: "gemini-pro", remainingFraction: 0.7 },
            { modelId: "gemini-pro-preview", remainingFraction: 0.425 },
            { modelId: "gemini-flash", remainingFraction: 0.125 },
          ],
        },
      },
    ],
    [ENDPOINTS.minimax, { status: 200, body: minimaxBody() }],
    [ENDPOINTS.minimaxCn, { status: 200, body: minimaxBody(37.4, 8 * 60 * 60 * 1000) }],
    [
      ENDPOINTS.kimi,
      {
        status: 200,
        body: {
          limits: [
            {
              detail: { limit: 100, remaining: 62.5, resetTime: after(2 * 60 * 60 * 1000 + 38 * 60 * 1000) },
              window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
            },
            {
              detail: { limit: 100, remaining: 25, resetTime: after(65 * 60 * 1000) },
              window: { duration: 1440, timeUnit: "TIME_UNIT_MINUTE" },
            },
            {
              detail: { limit: 100, remaining: 42, resetTime: after(8 * 60 * 60 * 1000) },
              window: { duration: 480, timeUnit: "TIME_UNIT_MINUTE" },
            },
          ],
          usage: { limit: 200, remaining: 84, resetTime: after(6 * 24 * 60 * 60 * 1000) },
        },
      },
    ],
    [
      ENDPOINTS.opencode,
      {
        status: 200,
        body: {
          rollingUsage: { usagePercent: 56.4, resetInSec: 2 * 60 * 60 + 38 * 60 },
          weeklyUsage: { usagePercent: 87.5, resetInSec: 5 * 24 * 60 * 60 },
          monthlyUsage: { usagePercent: 9, resetInSec: 30 * 24 * 60 * 60 },
        },
      },
    ],
  ]);
}

export async function createTestEnvironment(fixtures = defaultFixtures()) {
  const originalCwd = process.cwd();
  const originalEnvironment = new Map<string, string | undefined>();
  const envKeys = new Set([
    ...apiKeyEnvVars,
    "CODEX_HOME",
    "HOME",
    "USERPROFILE",
    ...Object.keys(process.env).filter((key) => key.startsWith("PI_MINIMAL_FOOTER_")),
  ]);
  for (const key of envKeys) originalEnvironment.set(key, process.env[key]);
  for (const key of apiKeyEnvVars) delete process.env[key];
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PI_MINIMAL_FOOTER_")) delete process.env[key];
  }

  const root = await mkdtemp(join(tmpdir(), "pi-footer-characterization-"));
  const home = join(root, "home");
  const project = join(home, "work");
  const authDir = join(home, ".pi", "agent");
  const codexHome = join(root, "codex-home");
  await mkdir(project, { recursive: true });
  await mkdir(authDir, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(authDir, "auth.json"), JSON.stringify(dummyAuth));
  await writeFile(join(codexHome, "auth.json"), "{}");

  process.env.HOME = home;
  process.env.CODEX_HOME = codexHome;
  delete process.env.USERPROFILE;
  process.chdir(project);

  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));

  const requests: RecordedRequest[] = [];
  const unexpectedUrls: string[] = [];
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const fixture = fixtures.get(url);
    requests.push({
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers: new Headers(init.headers),
      ...(typeof init.body === "string" ? { body: init.body } : {}),
    });
    if (!fixture) {
      unexpectedUrls.push(url);
      throw new Error(`Unexpected test fetch URL: ${url}`);
    }
    return {
      ok: fixture.status >= 200 && fixture.status < 300,
      status: fixture.status,
      json: async () => structuredClone(fixture.body),
    } as Response;
  }) as typeof fetch);

  let cleaned = false;
  return {
    root,
    home,
    project,
    codexHome,
    fixtures,
    requests,
    setResponse(url: string, response: ResponseFixture) {
      fixtures.set(url, response);
    },
    requestSummary() {
      return requests.map(({ url, method, headers, body }) => ({
        url,
        method,
        authorizationPresent: headers.has("authorization"),
        nonAuthHeaders: Object.fromEntries([...headers.entries()].filter(([name]) => name !== "authorization")),
        ...(body === undefined ? {} : { body }),
      }));
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        if (unexpectedUrls.length > 0) {
          throw new Error(`Unexpected network URL(s): ${unexpectedUrls.join(", ")}`);
        }
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        process.chdir(originalCwd);
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("PI_MINIMAL_FOOTER_")) delete process.env[key];
        }
        for (const [key, value] of originalEnvironment) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

const ansiColors: Record<string, number> = {
  error: 31,
  warning: 33,
  accent: 36,
  success: 32,
  dim: 2,
  muted: 90,
};
const ansiTagNames = new Map(Object.entries(ansiColors).map(([name, code]) => [String(code), name]));

export function makeTheme() {
  return {
    fg(color: string, text: string) {
      const code = ansiColors[color];
      if (code === undefined) throw new Error(`Unexpected theme color: ${color}`);
      return `\u001b[${code}m${text}\u001b[0m`;
    },
  };
}

export function toTags(line: string): string {
  let active: string | undefined;
  let output = "";
  const ansiPattern = /\u001b\[([\d;]*)m/g;
  let cursor = 0;
  for (const match of line.matchAll(ansiPattern)) {
    const index = match.index ?? 0;
    output += line.slice(cursor, index);
    const params = match[1] ?? "";
    if (params === "0") {
      if (active) output += `</${active}>`;
      active = undefined;
    } else {
      const color = ansiTagNames.get(params);
      if (active) output += `</${active}>`;
      if (color) {
        output += `<${color}>`;
        active = color;
      } else {
        active = undefined;
      }
    }
    cursor = index + match[0].length;
  }
  output += line.slice(cursor);
  if (active) output += `</${active}>`;
  return output;
}


export async function settleAsync() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

export function makeSession(entriesOptions: { thinkingLevel?: string; contextUsage?: number } = {}) {
  const usageTotal = entriesOptions.contextUsage ?? 1_234_567;
  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "current answer" }],
    api: "openai-completions",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: usageTotal - Math.min(234_567, usageTotal),
      output: Math.min(234_567, usageTotal),
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usageTotal,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: FROZEN_NOW,
  };
  const abortedMessage: AssistantMessage = {
    ...assistantMessage,
    content: [{ type: "text", text: "aborted answer" }],
    usage: {
      ...assistantMessage.usage,
      input: 9_000_000,
      output: 9_000_000,
      totalTokens: 18_000_000,
    },
    stopReason: "aborted",
    timestamp: FROZEN_NOW + 1,
  };
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "assistant-complete",
      parentId: null,
      timestamp: new Date(FROZEN_NOW).toISOString(),
      message: assistantMessage,
    },
    {
      type: "message",
      id: "assistant-aborted",
      parentId: "assistant-complete",
      timestamp: new Date(FROZEN_NOW + 1).toISOString(),
      message: abortedMessage,
    },
  ];
  if (entriesOptions.thinkingLevel !== undefined) {
    entries.push({
      type: "thinking_level_change",
      id: "thinking-change",
      parentId: "assistant-aborted",
      timestamp: new Date(FROZEN_NOW + 2).toISOString(),
      thinkingLevel: entriesOptions.thinkingLevel,
    });
  }
  return { entries, leafId: entries.at(-1)?.id ?? null };
}

type FooterExtension = (pi: never) => void;
type GenericHandler = (...args: any[]) => unknown;

export function createFooterHarness(extension: FooterExtension, options: {
  provider?: string;
  modelId?: string;
  model?: Record<string, unknown> | null;
  reasoning?: boolean;
  contextWindow?: number;
  cwd?: string;
  hasUI?: boolean;
  entries?: SessionEntry[];
  leafId?: string | null;
  thinkingLevel?: string;
  contextUsage?: number;
} = {}) {
  const handlers = new Map<string, GenericHandler>();
  const pi = {
    on(event: string, handler: GenericHandler) {
      handlers.set(event, handler);
    },
  };
  extension(pi as never);

  const tui = { requestRender: vi.fn() };
  const theme = makeTheme();
  let footerFactory: ((tui: any, theme: any, footerData: any) => any) | undefined;
  const setFooter = vi.fn((factory: (tui: any, theme: any, footerData: any) => any) => {
    footerFactory = factory;
  });
  const onBranchChange = vi.fn((callback: () => void) => {
    branchChangeCallback = callback;
    return unsubscribe;
  });
  const unsubscribe = vi.fn();
  let branchChangeCallback: (() => void) | undefined;
  const footerData = { onBranchChange };
  const defaultSession = makeSession({
    thinkingLevel: options.thinkingLevel ?? "high",
    ...(options.contextUsage === undefined ? {} : { contextUsage: options.contextUsage }),
  });
  const model = options.model === undefined
    ? options.provider === undefined
      ? null
      : {
          provider: options.provider,
          id: options.modelId ?? "org/reasoner",
          contextWindow: options.contextWindow ?? 3_000_000,
          reasoning: options.reasoning ?? true,
        }
    : options.model;
  const ctx = {
    hasUI: options.hasUI ?? true,
    cwd: options.cwd ?? join(process.env.HOME ?? "", "work"),
    model,
    sessionManager: {
      getEntries: () => options.entries ?? defaultSession.entries,
      getLeafId: () => options.leafId === undefined ? defaultSession.leafId : options.leafId,
    },
    ui: { setFooter },
  };

  let component: any;
  return {
    handlers,
    tui,
    theme,
    ctx,
    footerData,
    setFooter,
    onBranchChange,
    unsubscribe,
    get component() {
      return component;
    },
    async start() {
      await handlers.get("session_start")?.({ type: "session_start" }, ctx);
      if (footerFactory) component = footerFactory(tui, theme, footerData);
    },
    render(width: number) {
      if (!component) throw new Error("Footer component was not initialized");
      return component.render(width) as string[];
    },
    dispose() {
      component?.dispose?.();
    },
    triggerBranchChange() {
      branchChangeCallback?.();
    },
    async selectModel(provider: string, id = "org/next-model") {
      await handlers.get("model_select")?.({ model: { provider, id } }, ctx);
    },
    async turnEnd() {
      await handlers.get("turn_end")?.({}, ctx);
    },
  };
}

export async function createGitRepo(directory: string, branch = "footer-test") {
  await mkdir(directory, { recursive: true });
  execFileSync("git", ["init", "--quiet", "--initial-branch", branch], { cwd: directory });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
  await writeFile(join(directory, "tracked.txt"), "committed\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: directory });
  await writeFile(join(directory, "tracked.txt"), "dirty\n");
}
