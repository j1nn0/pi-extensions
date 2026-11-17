import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";
import { resetCommandCodeOrgCache } from "../src/usage/commandcode.ts";
import {
  COMMAND_CODE_BASE_URL,
  DUMMY_TOKENS,
  ENDPOINTS,
  FROZEN_NOW,
  createFooterHarness,
  createGitRepo,
  createTestEnvironment,
  settleAsync,
} from "./harness.ts";

type Environment = Awaited<ReturnType<typeof createTestEnvironment>>;

const CODEX = { provider: "openai-codex", id: "gpt-6-luna", reasoning: true };
const OPENCODE = { provider: "opencode-go", id: "glm-5", reasoning: false };
const COMMAND_CODE = { provider: "command-code", id: "deepseek/deepseek-v4.1-flash", reasoning: true, baseUrl: COMMAND_CODE_BASE_URL };
const LINE1_TAIL = "ctx ████░░░░░░ 41% · 161.0k/384.0k │ cache R424.0k/W2.1k";

let environment: Environment;

beforeEach(async () => {
  resetCommandCodeOrgCache();
  environment = await createTestEnvironment();
});

afterEach(async () => {
  await environment.cleanup();
});

describe("provider footers", () => {
  it("renders OpenAI Codex usage", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();

    expect(footer.plain(120)).toEqual([
      `gpt-6-luna · high · think ON │ ${LINE1_TAIL}`,
      "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m",
    ]);
    expect(environment.requestSummary()).toEqual([
      {
        url: ENDPOINTS.codex,
        method: "GET",
        authorizationPresent: true,
        nonAuthHeaders: { accept: "application/json", "chatgpt-account-id": "test-account", "user-agent": "pi-agent" },
      },
    ]);
    footer.dispose();
  });

  it.each([
    [401, { type: "error", error: { type: "AuthError", message: "Invalid API key." } }],
    [403, { type: "error", error: { type: "EntitlementError", message: "OpenCode Go subscription required." } }],
  ])("hides OpenCode Go quota and error details for HTTP %i", async (status, body) => {
    environment.setResponse(ENDPOINTS.opencode, { status, body });
    const footer = createFooterHarness(extension, { model: OPENCODE });
    await footer.start();
    await settleAsync();

    const secondLine = footer.plain(120)[1] ?? "";
    expect(secondLine).toBe("6h29m");
    for (const text of ["5h", "7d", "mo", "0%", "AuthError", "EntitlementError", "Invalid API key.", "OpenCode Go subscription required.", DUMMY_TOKENS.opencode]) {
      expect(secondLine).not.toContain(text);
    }
    footer.dispose();
  });

  it("renders OpenCode Go usage for a non-reasoning model", async () => {
    const footer = createFooterHarness(extension, { model: OPENCODE });
    await footer.start();
    await settleAsync();

    expect(footer.plain(120)).toEqual([
      `glm-5 │ ${LINE1_TAIL}`,
      "5h 56% ↻ 14:38 │ 7d 87% ↻ 10/07 12:00 │ mo 9% ↻ 11/01 12:00 │ 6h29m",
    ]);
    expect(environment.authorizationFor(ENDPOINTS.opencode)).toBe(`Bearer ${DUMMY_TOKENS.opencode}`);
    footer.dispose();
  });

  it("renders fractional OpenCode Go percentages floored to whole percentages", async () => {
    environment.setResponse(ENDPOINTS.opencode, {
      status: 200,
      body: { usage: { rolling: { status: "ok", percent: 12.8, resetsAt: "2026-10-02T14:38:00.000Z" } } },
    });
    const footer = createFooterHarness(extension, { model: OPENCODE });
    await footer.start();
    await settleAsync();

    expect(footer.plain(120)[1]).toBe("5h 12% ↻ 14:38 │ 6h29m");
    footer.dispose();
  });

  it("renders Command Code usage using the CLI credential, only against Command Code endpoints", async () => {
    const footer = createFooterHarness(extension, { model: COMMAND_CODE, thinkingLevel: "max" });
    await footer.start();
    await settleAsync();

    expect(footer.plain(120)).toEqual([
      `deepseek-v4.1-flash · max · think ON │ ${LINE1_TAIL}`,
      "5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00 │ 6h29m",
    ]);
    expect(environment.requestSummary()).toEqual([
      { url: ENDPOINTS.commandCodeWhoami, method: "GET", authorizationPresent: true, nonAuthHeaders: { accept: "application/json", "user-agent": "pi-footer" } },
      { url: ENDPOINTS.commandCodeCredits, method: "GET", authorizationPresent: true, nonAuthHeaders: { accept: "application/json", "user-agent": "pi-footer" } },
    ]);
    expect(environment.authorizationFor(ENDPOINTS.commandCodeCredits)).toBe(`Bearer ${DUMMY_TOKENS.commandCode}`);
    footer.dispose();
  });

  it("passes the organization id from whoami and looks it up only once", async () => {
    const orgCredits = `${ENDPOINTS.commandCodeCredits}?orgId=org_123`;
    environment.setResponse(ENDPOINTS.commandCodeWhoami, { status: 200, body: { success: true, org: { id: "org_123" } } });
    environment.setResponse(orgCredits, {
      status: 200,
      body: { windowLimits: { fiveHour: { used: 7, cap: 14, resetAt: FROZEN_NOW + 60 * 60 * 1000 } } },
    });

    const footer = createFooterHarness(extension, { model: COMMAND_CODE });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe("5h 50% ↻ 13:00 │ 6h29m");

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settleAsync();
    expect(environment.requests.map((request) => request.url)).toEqual([ENDPOINTS.commandCodeWhoami, orgCredits, orgCredits]);
    footer.dispose();
  });

  it("isolates cache entries per token and re-fetches whoami after a token switch", async () => {
    const first = createFooterHarness(extension, { model: COMMAND_CODE });
    await first.start();
    await settleAsync();
    first.dispose();

    process.env.COMMAND_CODE_API_KEY = "test-token-command-code-2";
    try {
      const second = createFooterHarness(extension, { model: COMMAND_CODE });
      await second.start();
      await settleAsync();
      second.dispose();
    } finally {
      delete process.env.COMMAND_CODE_API_KEY;
    }

    expect(environment.requests.filter((request) => request.url === ENDPOINTS.commandCodeWhoami)).toHaveLength(2);
  });

  it("re-fetches whoami for the same token after resetCommandCodeOrgCache", async () => {
    const first = createFooterHarness(extension, { model: COMMAND_CODE });
    await first.start();
    await settleAsync();
    first.dispose();

    resetCommandCodeOrgCache();

    const second = createFooterHarness(extension, { model: COMMAND_CODE });
    await second.start();
    await settleAsync();
    second.dispose();

    expect(environment.requests.filter((request) => request.url === ENDPOINTS.commandCodeWhoami)).toHaveLength(2);
  });

  it("does not cache whoami failures and retries on the next fetch", async () => {
    environment.setResponse(ENDPOINTS.commandCodeWhoami, { status: 401, body: { error: "unauthorized" } });

    const first = createFooterHarness(extension, { model: COMMAND_CODE });
    await first.start();
    await settleAsync();
    first.dispose();

    const orgCredits = `${ENDPOINTS.commandCodeCredits}?orgId=org_123`;
    environment.setResponse(ENDPOINTS.commandCodeWhoami, { status: 200, body: { success: true, org: { id: "org_123" } } });
    environment.setResponse(orgCredits, {
      status: 200,
      body: { windowLimits: { fiveHour: { used: 7, cap: 14, resetAt: FROZEN_NOW + 60 * 60 * 1000 } } },
    });

    const second = createFooterHarness(extension, { model: COMMAND_CODE });
    await second.start();
    await settleAsync();
    second.dispose();

    expect(environment.requests.filter((request) => request.url === ENDPOINTS.commandCodeWhoami)).toHaveLength(2);
    expect(environment.requests.map((request) => request.url)).toContain(orgCredits);
  });

  it("shows no quota and makes no request for unsupported providers", async () => {
    const footer = createFooterHarness(extension, { model: { provider: "anthropic", id: "claude-opus-5", reasoning: true } });
    await footer.start();
    await settleAsync();

    expect(footer.plain(120)).toEqual([`claude-opus-5 · high · think ON │ ${LINE1_TAIL}`, "6h29m"]);
    expect(environment.requests).toEqual([]);
    footer.dispose();
  });

  it("never exposes credentials in footer output", async () => {
    for (const model of [CODEX, OPENCODE, COMMAND_CODE]) {
      const footer = createFooterHarness(extension, { model });
      await footer.start();
      await settleAsync();
      const output = [40, 80, 200].flatMap((width) => footer.render(width)).join("\n");
      for (const token of Object.values(DUMMY_TOKENS)) expect(output).not.toContain(token);
      footer.dispose();
    }
  });
});

describe("refresh behavior", () => {
  it("fetches for the new provider on model_select and refreshes every five minutes", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();

    await footer.selectModel(COMMAND_CODE);
    await settleAsync();
    expect(footer.plain(120)[1]).toBe("5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00 │ 6h29m");

    await vi.advanceTimersByTimeAsync(299_999);
    expect(environment.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    await settleAsync();
    expect(environment.requests.map((request) => request.url)).toEqual([
      ENDPOINTS.codex,
      ENDPOINTS.commandCodeWhoami,
      ENDPOINTS.commandCodeCredits,
      ENDPOINTS.commandCodeCredits,
    ]);

    footer.dispose();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(environment.requests).toHaveLength(4);
  });

  it("keeps cached Command Code usage when a refresh fails transiently", async () => {
    const footer = createFooterHarness(extension, { model: COMMAND_CODE });
    await footer.start();
    await settleAsync();
    const before = footer.plain(120);

    const quota = (lines: string[]) => lines[1]?.replace(/ │ \d+h\d+m$/, "");
    expect(quota(before)).toBe("5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00");

    environment.setResponse(ENDPOINTS.commandCodeCredits, { status: 503, body: { error: "outage" } });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settleAsync();
    expect(quota(footer.plain(120))).toBe(quota(before));

    environment.setResponse(ENDPOINTS.commandCodeCredits, { status: 200, body: { windowLimits: null } });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settleAsync();
    expect(quota(footer.plain(120))).toBe(quota(before));
    expect(environment.requests.filter((request) => request.url === ENDPOINTS.commandCodeCredits)).toHaveLength(3);
    footer.dispose();
  });

  it("clears the quota line when switching to a provider without quota data", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();
    await footer.selectModel({ provider: "openrouter", id: "deepseek/deepseek-v4.1-flash", reasoning: true });
    expect(footer.plain(120)[1]).toBe("6h29m");
    footer.dispose();
  });
});

describe("session state", () => {
  it("shows unknown context after compaction instead of 0%", async () => {
    const footer = createFooterHarness(extension, {
      model: OPENCODE,
      context: { tokens: null, contextWindow: 384_000, percent: null },
      branch: [],
    });
    await footer.start();
    expect(footer.plain(120)[0]).toBe("glm-5 │ ctx ░░░░░░░░░░ ?% · ?/384.0k");
    footer.dispose();
  });

  it("uses the live thinking level and shows think OFF when it is off", async () => {
    const footer = createFooterHarness(extension, { model: CODEX, thinkingLevel: "off" });
    await footer.start();
    expect(footer.plain(120)[0]).toMatch(/^gpt-6-luna · think OFF │ /);
    footer.state.thinkingLevel = "xhigh";
    expect(footer.plain(120)[0]).toMatch(/^gpt-6-luna · xhigh · think ON │ /);
    footer.dispose();
  });

  it("measures duration from the session header so resumed sessions keep their age", async () => {
    const footer = createFooterHarness(extension, {
      model: OPENCODE,
      sessionStartedAt: FROZEN_NOW - (30 * 60 + 5) * 60_000,
    });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toMatch(/│ 30h05m$/);

    footer.tui.requestRender.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(footer.tui.requestRender).toHaveBeenCalled();
    expect(footer.plain(120)[1]).toMatch(/│ 30h06m$/);
    footer.dispose();
  });

  it("renders the Git branch and refreshes it on branch changes", async () => {
    const repo = join(environment.root, "repo");
    await createGitRepo(repo, "footer-test");
    process.chdir(repo);

    const footer = createFooterHarness(extension, { model: { provider: "openrouter", id: "m", reasoning: false } });
    await footer.start();
    expect(footer.plain(120)[1]).toBe("6h29m │ footer-test");

    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(repo, "tracked.txt"), "dirty\n");
    footer.triggerBranchChange();
    expect(footer.plain(120)[1]).toBe("6h29m │ footer-test *");
    footer.dispose();
    expect(footer.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("visibility flags", () => {
  it("hides cwd by default and shows it with the new or legacy flag", async () => {
    const hidden = createFooterHarness(extension, { model: { provider: "openrouter", id: "m" } });
    await hidden.start();
    expect(hidden.plain(120)[1]).toBe("6h29m");
    hidden.dispose();

    for (const name of ["PI_FOOTER_SHOW_CWD", "PI_MINIMAL_FOOTER_SHOW_CWD"]) {
      process.env[name] = "1";
      const shown = createFooterHarness(extension, { model: { provider: "openrouter", id: "m" } });
      await shown.start();
      expect(shown.plain(120)[1]).toBe("6h29m │ ~/work");
      shown.dispose();
      delete process.env[name];
    }
  });

  it("hides Git with PI_FOOTER_SHOW_BRANCH=0", async () => {
    const repo = join(environment.root, "repo");
    await createGitRepo(repo);
    process.chdir(repo);
    process.env.PI_FOOTER_SHOW_BRANCH = "0";
    const footer = createFooterHarness(extension, { model: { provider: "openrouter", id: "m" } });
    await footer.start();
    expect(footer.plain(120)[1]).toBe("6h29m");
    footer.dispose();
  });
});

/** Verbatim from context-mode 2.2.0 (`src/core/store/schema.ts`); only `events` is read. */
const EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  worktree       TEXT NOT NULL,
  agent          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('prompt','edit','cmd','toolerr','index','cost','decision')),
  tool           TEXT,
  key            TEXT,
  path           TEXT,
  ok             INTEGER,
  exit_code      INTEGER,
  bytes          INTEGER,
  body           TEXT,
  turn           INTEGER NOT NULL,
  sandbox_bytes  INTEGER NOT NULL DEFAULT 0,
  returned_bytes INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  accessed_at    INTEGER NOT NULL
);
`;
/** Verbatim column order from context-mode 2.2.0 (`src/core/journal/append.ts`). */
const INSERT_EVENT =
  "INSERT INTO events(session_id, worktree, agent, kind, tool, key, path, ok, exit_code, bytes, body, turn, sandbox_bytes, returned_bytes, created_at, accessed_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const CONTEXT_MODE_SESSION = "01a1e320-57a2-7170-9e24-97c18523d7d8";
const QUOTA_LINE = "5h 56% ↻ 14:38 │ 7d 87% ↻ 10/07 12:00 │ mo 9% ↻ 11/01 12:00 │ 6h29m";

/** Context Mode's layout: `<data root>/projects/<sha256(project root)[0:16]>/context.db`. */
function contextModeDatabasePath(cwd: string): string {
  const key = createHash("sha256").update(realpathSync.native(cwd)).digest("hex").slice(0, 16);
  return join(environment.home, ".context-mode", "projects", key, "context.db");
}

/** Records Context Mode tool calls, each producing `produced` bytes in the current session. */
function appendContextModeCall(produced: number[], sessionId = CONTEXT_MODE_SESSION): void {
  const dbPath = contextModeDatabasePath(environment.project);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(EVENTS_DDL);
  const insert = db.prepare(INSERT_EVENT);
  for (const bytes of produced) {
    const now = Date.now();
    insert.run(sessionId, environment.project, "pi", "index", "ctx_index", null, null, null, null, null, null, 1, bytes, bytes, now, now);
  }
  db.close();
}

describe("Context Mode", () => {
  it("shows the current session's produced bytes and refreshes at turn end", async () => {
    appendContextModeCall([262_144, 174_080]);
    const footer = createFooterHarness(extension, { model: OPENCODE, sessionId: CONTEXT_MODE_SESSION });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(`${QUOTA_LINE} │ ctx-mode 426.0 KB`);

    appendContextModeCall([122_880]);
    await footer.turnEnd();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(`${QUOTA_LINE} │ ctx-mode 546.0 KB`);
    footer.dispose();
  });

  it("omits the segment silently when the project has no Context Mode database", async () => {
    const footer = createFooterHarness(extension, { model: OPENCODE, sessionId: CONTEXT_MODE_SESSION });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)).toHaveLength(2);
    expect(footer.plain(120)[1]).toBe(QUOTA_LINE);
    footer.dispose();
  });

  it("omits the segment for a session without calls and for an unreadable database", async () => {
    appendContextModeCall([4096], "01a1e36c-8a86-7170-9e24-97c2f92afab1");
    const otherSession = createFooterHarness(extension, { model: OPENCODE, sessionId: CONTEXT_MODE_SESSION });
    await otherSession.start();
    await settleAsync();
    expect(otherSession.plain(120)[1]).not.toContain("ctx-mode");
    otherSession.dispose();

    writeFileSync(contextModeDatabasePath(environment.project), "not a database");
    const broken = createFooterHarness(extension, { model: OPENCODE, sessionId: CONTEXT_MODE_SESSION });
    await broken.start();
    await settleAsync();
    expect(broken.plain(120)[1]).not.toContain("ctx-mode");
    broken.dispose();
  });

  it("never reads Context Mode when disabled or for a session without an id", async () => {
    appendContextModeCall([262_144, 174_080]);

    process.env.PI_FOOTER_SHOW_CONTEXT_MODE = "0";
    const disabled = createFooterHarness(extension, { model: OPENCODE, sessionId: CONTEXT_MODE_SESSION });
    await disabled.start();
    await settleAsync();
    await disabled.turnEnd();
    await settleAsync();
    expect(disabled.plain(120)[1]).not.toContain("ctx-mode");
    disabled.dispose();
    delete process.env.PI_FOOTER_SHOW_CONTEXT_MODE;

    const anonymous = createFooterHarness(extension, { model: OPENCODE, sessionId: undefined });
    await anonymous.start();
    await settleAsync();
    await anonymous.turnEnd();
    await settleAsync();
    expect(anonymous.plain(120)[1]).not.toContain("ctx-mode");
    anonymous.dispose();
  });

  it("shows the Goal segment next to Context Mode", async () => {
    appendContextModeCall([262_144, 174_080]);
    const footer = createFooterHarness(extension, {
      model: { provider: "openrouter", id: "glm-5", reasoning: false },
      sessionId: CONTEXT_MODE_SESSION,
    });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe("6h29m │ ctx-mode 426.0 KB");

    footer.setExtensionStatus("goal", "active 12m · automatic 12/100");
    expect(footer.plain(120)[1]).toBe("6h29m │ 🎯 goal 12/100 │ ctx-mode 426.0 KB");
    footer.dispose();
  });

  it("drops Context Mode before anything else when line 2 shrinks", async () => {
    appendContextModeCall([262_144, 174_080]);
    const footer = createFooterHarness(extension, { model: OPENCODE, sessionId: CONTEXT_MODE_SESSION });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toContain("ctx-mode 426.0 KB");

    // At 80 columns only the Context Mode segment has to go.
    const wide = footer.plain(80);
    expect(wide[1]).toBe(QUOTA_LINE);
    const narrow = footer.plain(40);
    expect(narrow).toHaveLength(2);
    expect(narrow[1]).not.toContain("ctx-mode");
    expect(visibleWidth(narrow[1] ?? "")).toBeLessThanOrEqual(40);
    footer.dispose();

    // Without any Context Mode data the same widths render identically.
    const plain = createFooterHarness(extension, { model: OPENCODE });
    await plain.start();
    await settleAsync();
    expect(plain.plain(80)).toEqual(wide);
    expect(plain.plain(40)).toEqual(narrow);
    plain.dispose();
  });
});
