import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_CODE_BASE_URL,
  ENDPOINTS,
  createFooterHarness,
  createTestEnvironment,
  settleAsync,
} from "./harness.ts";

type Environment = Awaited<ReturnType<typeof createTestEnvironment>>;

const CODEX = { provider: "openai-codex", id: "gpt-6-luna", reasoning: true };
const OPENCODE = { provider: "opencode-go", id: "glm-5", reasoning: false };
const COMMAND_CODE = { provider: "command-code", id: "deepseek/deepseek-v4.1-flash", reasoning: true, baseUrl: COMMAND_CODE_BASE_URL };
const UNSUPPORTED = { provider: "openrouter", id: "deepseek/deepseek-v4.1-flash", reasoning: true };

const CODEX_QUOTA = "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m";
const COMMAND_CODE_QUOTA = "5h 22% ↻ 15:03 │ 7d 66% ↻ 10/08 10:00 │ 6h29m";
const OPENCODE_QUOTA = "5h 56% ↻ 14:38 │ 7d 87% ↻ 10/07 12:00 │ mo 9% ↻ 11/01 12:00 │ 6h29m";
const NO_QUOTA = "6h29m";

// The footer clock timer runs while the footer is mounted; the quota refresh timer is the second one.
const CLOCK_ONLY = 1;
const CLOCK_AND_REFRESH = 2;

let environment: Environment;
let extension: (pi: never) => void;

beforeEach(async () => {
  // Fresh modules so the process-wide usage cache starts empty in every test.
  vi.resetModules();
  extension = (await import("../index.ts")).default;
  environment = await createTestEnvironment();
});

afterEach(async () => {
  await environment.cleanup();
});

describe("provider switches", () => {
  it("clears the previous provider's quota while a provider without cache loads", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(CODEX_QUOTA);

    const release = environment.holdResponse(ENDPOINTS.commandCodeCredits);
    await footer.selectModel(COMMAND_CODE);
    await settleAsync();
    expect(environment.requests.map((request) => request.url)).toContain(ENDPOINTS.commandCodeCredits);
    expect(footer.plain(120)[1]).toBe(NO_QUOTA);

    release();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(COMMAND_CODE_QUOTA);
    footer.dispose();
  });

  it("shows the cached quota immediately when switching back to a provider with cache", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();
    await footer.selectModel(COMMAND_CODE);
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(COMMAND_CODE_QUOTA);

    const release = environment.holdResponse(ENDPOINTS.codex);
    await footer.selectModel(CODEX);
    expect(footer.plain(120)[1]).toBe(CODEX_QUOTA);

    release();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(CODEX_QUOTA);
    expect(environment.requests.filter((request) => request.url === ENDPOINTS.codex)).toHaveLength(2);
    footer.dispose();
  });

  it("keeps cached quota when the same provider fails to refresh", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();
    environment.setResponse(ENDPOINTS.codex, { status: 503, body: { error: "outage" } });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(CODEX_QUOTA.replace("6h29m", "6h34m"));

    await footer.selectModel({ ...CODEX, id: "gpt-6-luna-mini" });
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(CODEX_QUOTA.replace("6h29m", "6h34m"));
    expect(environment.requests.filter((request) => request.url === ENDPOINTS.codex)).toHaveLength(3);
    footer.dispose();
  });
});

describe("refresh timer ownership", () => {
  it("clears quota and stops the refresh timer when switching to an unsupported provider", async () => {
    const footer = createFooterHarness(extension, { model: CODEX });
    await footer.start();
    await settleAsync();
    expect(vi.getTimerCount()).toBe(CLOCK_AND_REFRESH);

    await footer.selectModel(UNSUPPORTED);
    expect(footer.plain(120)[1]).toBe(NO_QUOTA);
    expect(vi.getTimerCount()).toBe(CLOCK_ONLY);

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(environment.requests).toHaveLength(1);
    footer.dispose();
  });

  it("creates no refresh timer for an unsupported provider at session start", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();
    expect(vi.getTimerCount()).toBe(CLOCK_ONLY);
    expect(environment.requests).toEqual([]);
    footer.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts fetching and refreshing normally when switching from unsupported to supported", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();

    await footer.selectModel(OPENCODE);
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(OPENCODE_QUOTA);
    expect(vi.getTimerCount()).toBe(CLOCK_AND_REFRESH);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settleAsync();
    expect(environment.requests.map((request) => request.url)).toEqual([ENDPOINTS.opencode, ENDPOINTS.opencode]);
    footer.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
