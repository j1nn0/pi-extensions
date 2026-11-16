import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../index.ts";
import { createFooterHarness, createTestEnvironment, settleAsync } from "./harness.ts";

type Environment = Awaited<ReturnType<typeof createTestEnvironment>>;

// No quota provider, no Git repository, no Context Mode: line 2 is duration plus the Goal.
const UNSUPPORTED = { provider: "openrouter", id: "glm-5", reasoning: false };
const DURATION_ONLY = "6h29m";
const ACTIVE = "active 12m · automatic 12/100";
const ACTIVE_LINE = "6h29m │ 🎯 goal 12/100";
// The footer runs one timer: the minute clock that keeps the session duration fresh.
const CLOCK_ONLY = 1;

let environment: Environment;

beforeEach(async () => {
  environment = await createTestEnvironment();
});

afterEach(async () => {
  await environment.cleanup();
});

describe("Goal status wiring", () => {
  it("reads the `goal` extension status and shows it on line 2", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(DURATION_ONLY);

    footer.setExtensionStatus("goal", ACTIVE);
    expect(footer.plain(120)).toHaveLength(2);
    expect(footer.plain(120)[1]).toBe(ACTIVE_LINE);
    footer.dispose();
  });

  it("ignores extension statuses published under other keys", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();

    footer.setExtensionStatus("todo", ACTIVE);
    footer.setExtensionStatus("goal-extra", ACTIVE);
    expect(footer.plain(120)[1]).toBe(DURATION_ONLY);
    footer.dispose();
  });

  it("leaves the first line and the rest of line 2 untouched", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();
    const baseline = footer.plain(120);

    footer.setExtensionStatus("goal", ACTIVE);
    const withGoal = footer.plain(120);
    expect(withGoal[0]).toBe(baseline[0]);
    expect(withGoal[1]).toBe(ACTIVE_LINE);
    footer.dispose();
  });

  it("starts no timer and makes no request for the Goal segment", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();
    expect(vi.getTimerCount()).toBe(CLOCK_ONLY);
    expect(environment.requestSummary()).toEqual([]);

    footer.setExtensionStatus("goal", ACTIVE);
    expect(footer.plain(120)[1]).toBe(ACTIVE_LINE);
    expect(vi.getTimerCount()).toBe(CLOCK_ONLY);
    expect(environment.requestSummary()).toEqual([]);
    footer.dispose();
  });

  it("omits an unrecognized or empty status instead of guessing", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();

    for (const status of ["planning the next step", "", "   "]) {
      footer.setExtensionStatus("goal", status);
      expect(footer.plain(120)[1]).toBe(DURATION_ONLY);
    }
    footer.dispose();
  });
});

describe("Goal state transitions", () => {
  it("follows none → active → paused → active → complete → cleared", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(DURATION_ONLY);

    footer.setExtensionStatus("goal", ACTIVE);
    expect(footer.plain(120)[1]).toBe("6h29m │ 🎯 goal 12/100");

    footer.setExtensionStatus("goal", "paused · automatic 12/100");
    expect(footer.plain(120)[1]).toBe("6h29m │ 🎯 paused");

    footer.setExtensionStatus("goal", "active 13m · automatic 13/100");
    expect(footer.plain(120)[1]).toBe("6h29m │ 🎯 goal 13/100");

    footer.setExtensionStatus("goal", "complete");
    expect(footer.plain(120)[1]).toBe("6h29m │ 🎯 complete");

    // pi-goal clears the status on its own completion timer; the footer adds none.
    footer.setExtensionStatus("goal", undefined);
    expect(footer.plain(120)[1]).toBe(DURATION_ONLY);
    expect(vi.getTimerCount()).toBe(CLOCK_ONLY);
    footer.dispose();
  });

  it.each([
    ["waiting", "6h29m │ 🎯 waiting"],
    ["blocked · automatic 2/10", "6h29m │ 🎯 blocked"],
    ["usage · automatic 2/10", "6h29m │ 🎯 usage limit"],
    ["budget 1.2k/50.0k · automatic 2/10", "6h29m │ 🎯 budget limit"],
    ["active 12m · automatic Unlimited", "6h29m │ 🎯 goal"],
  ])("renders %j", async (status, line) => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();

    footer.setExtensionStatus("goal", status);
    expect(footer.plain(120)[1]).toBe(line);
    footer.dispose();
  });
});

describe("Goal status across sessions", () => {
  it("does not carry a previous session's Goal into the next one", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();
    footer.setExtensionStatus("goal", ACTIVE);
    expect(footer.plain(120)[1]).toBe(ACTIVE_LINE);

    // Pi's resetExtensionUI() clears every extension status on a session switch;
    // pi-goal then republishes the new session's own state from its session_start.
    footer.clearExtensionStatuses();
    await footer.start("/sessions/session-2.jsonl");
    await settleAsync();
    expect(footer.plain(120)[1]).toBe(DURATION_ONLY);

    footer.setExtensionStatus("goal", "active 1m · automatic 1/5");
    expect(footer.plain(120)[1]).toBe("6h29m │ 🎯 goal 1/5");
    footer.dispose();
  });
});

describe("PI_FOOTER_SHOW_GOAL", () => {
  it("never reads or renders the status when disabled", async () => {
    process.env.PI_FOOTER_SHOW_GOAL = "0";
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();

    footer.setExtensionStatus("goal", ACTIVE);
    expect(footer.plain(120)[1]).toBe(DURATION_ONLY);
    expect(footer.getExtensionStatuses).not.toHaveBeenCalled();
    footer.dispose();
  });

  it("stays enabled by default", async () => {
    const footer = createFooterHarness(extension, { model: UNSUPPORTED });
    await footer.start();
    await settleAsync();

    footer.setExtensionStatus("goal", ACTIVE);
    expect(footer.plain(120)[1]).toBe(ACTIVE_LINE);
    expect(footer.getExtensionStatuses).toHaveBeenCalled();
    footer.dispose();
  });
});
