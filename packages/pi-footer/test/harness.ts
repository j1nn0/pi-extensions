import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextUsage, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { vi } from "vitest";

export const FROZEN_NOW = Date.parse("2026-10-02T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const ENDPOINTS = {
  codex: "https://chatgpt.com/backend-api/wham/usage",
  opencode: "https://opencode.ai/zen/go/v1/usage",
  commandCodeWhoami: "https://api.commandcode.ai/alpha/whoami",
  commandCodeCredits: "https://api.commandcode.ai/alpha/billing/credits",
} as const;

export const COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1";

// Obvious dummies; tests assert none of them ever reaches rendered output.
export const DUMMY_TOKENS = {
  codex: "test-token-codex",
  opencode: "test-token-opencode",
  commandCode: "test-token-command-code",
} as const;

type ResponseFixture = { status: number; body: unknown };
type RecordedRequest = { url: string; method: string; headers: Headers };

const apiKeyEnvVars = ["OPENCODE_API_KEY", "COMMAND_CODE_API_KEY"];

export function defaultFixtures(): Map<string, ResponseFixture> {
  return new Map<string, ResponseFixture>([
    [
      ENDPOINTS.codex,
      {
        status: 200,
        body: {
          rate_limit: {
            primary_window: { used_percent: 71.5, reset_at: (FROZEN_NOW + 3 * HOUR) / 1000, limit_window_seconds: 5 * 3600 },
            secondary_window: { used_percent: 14, reset_at: (FROZEN_NOW + 4 * DAY) / 1000, limit_window_seconds: 7 * 24 * 3600 },
          },
        },
      },
    ],
    [
      ENDPOINTS.opencode,
      {
        status: 200,
        body: {
          usage: {
            rolling: { status: "ok", percent: 56.4, resetsAt: new Date(FROZEN_NOW + 2 * HOUR + 38 * 60 * 1000).toISOString() },
            weekly: { status: "ok", percent: 87.5, resetsAt: new Date(FROZEN_NOW + 5 * DAY).toISOString() },
            monthly: { status: "ok", percent: 9, resetsAt: new Date(FROZEN_NOW + 30 * DAY).toISOString() },
          },
        },
      },
    ],
    [ENDPOINTS.commandCodeWhoami, { status: 200, body: { success: true, user: { id: "user" }, org: null } }],
    [
      ENDPOINTS.commandCodeCredits,
      {
        status: 200,
        body: {
          credits: { monthlyCredits: 5, purchasedCredits: 0, freeCredits: 0 },
          windowLimits: {
            limited: true,
            exceeded: null,
            fiveHour: { used: 3.15, cap: 14, exceeded: false, resetAt: FROZEN_NOW + 3 * HOUR + 3 * 60 * 1000 },
            weekly: { used: 23.1, cap: 35, exceeded: false, resetAt: FROZEN_NOW + 5 * DAY + 22 * HOUR },
          },
        },
      },
    ],
  ]);
}

export async function createTestEnvironment(fixtures = defaultFixtures()) {
  const originalCwd = process.cwd();
  const originalEnvironment = new Map<string, string | undefined>();
  const isFooterFlag = (key: string) => key.startsWith("PI_FOOTER_") || key.startsWith("PI_MINIMAL_FOOTER_");
  const envKeys = new Set([...apiKeyEnvVars, "CODEX_HOME", "HOME", "USERPROFILE", ...Object.keys(process.env).filter(isFooterFlag)]);
  for (const key of envKeys) originalEnvironment.set(key, process.env[key]);
  for (const key of apiKeyEnvVars) delete process.env[key];
  for (const key of Object.keys(process.env)) if (isFooterFlag(key)) delete process.env[key];

  const root = await mkdtemp(join(tmpdir(), "pi-footer-test-"));
  const home = join(root, "home");
  const project = join(home, "work");
  const codexHome = join(root, "codex-home");
  await mkdir(project, { recursive: true });
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await mkdir(join(home, ".commandcode"), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    join(home, ".pi", "agent", "auth.json"),
    JSON.stringify({
      "openai-codex": { access: DUMMY_TOKENS.codex, accountId: "test-account" },
      "opencode-go": { key: DUMMY_TOKENS.opencode },
    })
  );
  await writeFile(join(home, ".commandcode", "auth.json"), JSON.stringify({ apiKey: DUMMY_TOKENS.commandCode }));
  await writeFile(join(codexHome, "auth.json"), "{}");

  process.env.HOME = home;
  process.env.CODEX_HOME = codexHome;
  delete process.env.USERPROFILE;
  process.chdir(project);

  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));

  const requests: RecordedRequest[] = [];
  const unexpectedUrls: string[] = [];
  const gates = new Map<string, Promise<void>>();
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, method: (init.method ?? "GET").toUpperCase(), headers: new Headers(init.headers) });
    const gate = gates.get(url);
    if (gate) await gate;
    const fixture = fixtures.get(url);
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
    requests,
    setResponse(url: string, response: ResponseFixture) {
      fixtures.set(url, response);
    },
    /** Hold responses for a URL until the returned release function is called. */
    holdResponse(url: string): () => void {
      let release = () => {};
      gates.set(url, new Promise<void>((resolve) => (release = resolve)));
      return () => {
        gates.delete(url);
        release();
      };
    },
    requestSummary() {
      return requests.map(({ url, method, headers }) => ({
        url,
        method,
        authorizationPresent: headers.has("authorization"),
        nonAuthHeaders: Object.fromEntries([...headers.entries()].filter(([name]) => name !== "authorization")),
      }));
    },
    authorizationFor(url: string) {
      return requests.find((request) => request.url === url)?.headers.get("authorization") ?? null;
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        if (unexpectedUrls.length > 0) throw new Error(`Unexpected network URL(s): ${unexpectedUrls.join(", ")}`);
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        process.chdir(originalCwd);
        for (const key of Object.keys(process.env)) if (isFooterFlag(key)) delete process.env[key];
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
  let cursor = 0;
  for (const match of line.matchAll(/\u001b\[([\d;]*)m/g)) {
    const index = match.index ?? 0;
    output += line.slice(cursor, index);
    const params = match[1] ?? "";
    if (active) output += `</${active}>`;
    active = params === "0" ? undefined : ansiTagNames.get(params);
    if (active) output += `<${active}>`;
    cursor = index + match[0].length;
  }
  output += line.slice(cursor);
  if (active) output += `</${active}>`;
  return output;
}

export function toPlain(line: string): string {
  return line.replace(/\u001b\[[\d;]*m/g, "");
}

export async function settleAsync() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

export function assistantMessage(
  overrides: Partial<AssistantMessage> = {},
  usage: Partial<AssistantMessage["usage"]> = {}
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "answer" }],
    api: "openai-completions",
    provider: "test",
    model: "test-model",
    usage: {
      input: 1000,
      output: 200,
      cacheRead: 424_000,
      cacheWrite: 2_100,
      totalTokens: 427_300,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      ...usage,
    },
    stopReason: "stop",
    timestamp: FROZEN_NOW,
    ...overrides,
  };
}

export function messageEntry(id: string, parentId: string | null, message: AssistantMessage): SessionEntry {
  return { type: "message", id, parentId, timestamp: new Date(FROZEN_NOW).toISOString(), message };
}

type FooterExtension = (pi: never) => void;
type GenericHandler = (...args: any[]) => unknown;

export interface HarnessModel {
  provider: string;
  id: string;
  reasoning?: boolean;
  baseUrl?: string;
}

export function createFooterHarness(
  extension: FooterExtension,
  options: {
    model?: HarnessModel | null;
    thinkingLevel?: string;
    context?: ContextUsage | undefined;
    branch?: SessionEntry[];
    sessionStartedAt?: number;
    sessionFile?: string | undefined;
    hasUI?: boolean;
    cwd?: string;
  } = {}
) {
  const handlers = new Map<string, GenericHandler>();
  const pi = {
    on(event: string, handler: GenericHandler) {
      handlers.set(event, handler);
    },
  };
  extension(pi as never);

  const tui = { requestRender: vi.fn() };
  const theme = makeTheme();
  let footerFactory: ((tui: unknown, theme: unknown, footerData: unknown) => unknown) | undefined;
  const setFooter = vi.fn((factory: typeof footerFactory) => {
    footerFactory = factory;
  });
  let branchChangeCallback: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const onBranchChange = vi.fn((callback: () => void) => {
    branchChangeCallback = callback;
    return unsubscribe;
  });

  const branch = options.branch ?? [messageEntry("assistant-1", null, assistantMessage())];
  const state: { model: HarnessModel | null; thinkingLevel: string | undefined; context: ContextUsage | undefined } = {
    model: options.model === undefined ? { provider: "openai-codex", id: "gpt-6-luna", reasoning: true } : options.model,
    thinkingLevel: "thinkingLevel" in options ? options.thinkingLevel : "high",
    context: "context" in options ? options.context : { tokens: 161_000, contextWindow: 384_000, percent: 41.9 },
  };
  const sessionFile = "sessionFile" in options ? options.sessionFile : "/sessions/session-1.jsonl";
  const ctx = {
    hasUI: options.hasUI ?? true,
    cwd: options.cwd ?? join(process.env.HOME ?? "", "work"),
    get model() {
      return state.model;
    },
    get thinkingLevel() {
      return state.thinkingLevel;
    },
    getContextUsage: () => state.context,
    sessionManager: {
      getBranch: () => branch,
      getLeafId: () => branch.at(-1)?.id ?? null,
      getEntries: () => branch,
      getHeader: () => ({
        type: "session",
        id: "session-1",
        cwd: process.cwd(),
        timestamp: new Date(options.sessionStartedAt ?? FROZEN_NOW - (6 * HOUR + 29 * 60 * 1000)).toISOString(),
      }),
      getSessionFile: () => sessionFile,
    },
    ui: { setFooter },
  };

  let component: { render(width: number): string[]; dispose?(): void } | undefined;
  return {
    handlers,
    tui,
    ctx,
    state,
    setFooter,
    onBranchChange,
    unsubscribe,
    async start() {
      await handlers.get("session_start")?.({ type: "session_start" }, ctx);
      if (footerFactory) component = footerFactory(tui, theme, { onBranchChange }) as typeof component;
    },
    render(width: number): string[] {
      if (!component) throw new Error("Footer component was not initialized");
      return component.render(width);
    },
    plain(width: number): string[] {
      return this.render(width).map(toPlain);
    },
    dispose() {
      component?.dispose?.();
    },
    triggerBranchChange() {
      branchChangeCallback?.();
    },
    async selectModel(model: HarnessModel) {
      state.model = model;
      await handlers.get("model_select")?.({ type: "model_select", model, previousModel: undefined, source: "set" }, ctx);
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
}
