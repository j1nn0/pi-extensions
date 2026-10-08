import { describe, expect, it, vi } from "vitest";
import { runExitCommand, type ExitContext } from "../src/exit.ts";

interface ContextOptions {
  isIdle?: boolean;
  hasUI?: boolean;
  confirm?: (title: string, message: string) => Promise<boolean>;
  waitForIdle?: () => Promise<void>;
}

function createContext(options: ContextOptions = {}) {
  const confirm = vi.fn(options.confirm ?? (async () => true));
  const notify = vi.fn();
  const waitForIdle = vi.fn(options.waitForIdle ?? (async () => undefined));
  const shutdown = vi.fn();
  const ctx: ExitContext = {
    isIdle: () => options.isIdle ?? true,
    hasUI: options.hasUI ?? true,
    ui: { confirm, notify },
    waitForIdle,
    shutdown,
  };

  return { ctx, confirm, notify, waitForIdle, shutdown };
}

describe("runExitCommand", () => {
  it("shuts down immediately when the agent is idle", async () => {
    const { ctx, shutdown } = createContext({ isIdle: true });

    await expect(runExitCommand("", ctx)).resolves.toBe("shutdown");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("shuts down when confirmation is accepted during a running agent", async () => {
    const { ctx, confirm, shutdown } = createContext({ isIdle: false, confirm: async () => true });

    await expect(runExitCommand("", ctx)).resolves.toBe("shutdown");
    expect(confirm).toHaveBeenCalledWith("Exit Pi", "An agent run is still in progress. Exit anyway?");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("cancels shutdown when confirmation is declined", async () => {
    const { ctx, shutdown, notify } = createContext({ isIdle: false, confirm: async () => false });

    await expect(runExitCommand("", ctx)).resolves.toBe("cancelled");
    expect(shutdown).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Exit cancelled.", "info");
  });

  it("shuts down without confirmation when UI is unavailable", async () => {
    const { ctx, confirm, shutdown } = createContext({ isIdle: false, hasUI: false });

    await expect(runExitCommand("", ctx)).resolves.toBe("shutdown");
    expect(confirm).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("force exits a busy agent without confirmation", async () => {
    const { ctx, confirm, shutdown } = createContext({ isIdle: false });

    await expect(runExitCommand("--force", ctx)).resolves.toBe("shutdown");
    expect(confirm).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("waits for the agent to finish before shutting down", async () => {
    const events: string[] = [];
    const { ctx, shutdown, waitForIdle } = createContext({
      isIdle: false,
      waitForIdle: async () => {
        events.push("wait");
      },
    });
    shutdown.mockImplementation(() => {
      events.push("shutdown");
    });

    await expect(runExitCommand("--wait", ctx)).resolves.toBe("shutdown");
    expect(events).toEqual(["wait", "shutdown"]);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("shuts down if waiting for the agent rejects", async () => {
    const { ctx, shutdown, notify } = createContext({
      isIdle: false,
      waitForIdle: async () => {
        throw new Error("wait failed");
      },
    });

    await expect(runExitCommand("--wait", ctx)).resolves.toBe("shutdown");
    expect(notify).toHaveBeenCalledWith("Could not wait for the agent to finish; exiting anyway.", "warning");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("shows help without shutting down", async () => {
    const { ctx, shutdown, notify } = createContext();

    await expect(runExitCommand("--help", ctx)).resolves.toBe("help");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("/exit - exit Pi cleanly"), "info");
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("reports an unknown option without shutting down", async () => {
    const { ctx, shutdown, notify } = createContext();

    await expect(runExitCommand("--unknown", ctx)).resolves.toBe("error");
    expect(notify).toHaveBeenCalledWith("Unknown option: --unknown", "error");
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("rejects conflicting flags without shutting down", async () => {
    const { ctx, shutdown, notify } = createContext();

    await expect(runExitCommand("--force --wait", ctx)).resolves.toBe("error");
    expect(notify).toHaveBeenCalledWith("--force and --wait are mutually exclusive", "error");
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("shuts down if confirmation rejects", async () => {
    const { ctx, shutdown } = createContext({
      isIdle: false,
      confirm: async () => {
        throw new Error("confirmation failed");
      },
    });

    await expect(runExitCommand("", ctx)).resolves.toBe("shutdown");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
