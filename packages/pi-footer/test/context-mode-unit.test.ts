import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ContextModeTracker,
  contextModeSessionId,
  parseThisChatAmount,
  runStatusline,
  type StatuslineRunner,
} from "../src/context-mode.ts";

const ACTIVE_OUTPUT =
  "\u001b[1;36mcontext-mode\u001b[0m  \u001b[32m●\u001b[0m  \u001b[1m426 KB\u001b[0m \u001b[2mthis chat\u001b[0m  ·  \u001b[1m23.2 MB\u001b[0m \u001b[2mlifetime\u001b[0m  ·  72% kept out";

describe("parseThisChatAmount", () => {
  it("extracts only the this-chat amount, ignoring ANSI and lifetime stats", () => {
    expect(parseThisChatAmount(ACTIVE_OUTPUT)).toBe("426KB");
    expect(parseThisChatAmount("context-mode  ●  20.6 KB this chat  ·  23.2 MB lifetime")).toBe("20.6KB");
    expect(parseThisChatAmount("context-mode ● 660KB this chat")).toBe("660KB");
    expect(parseThisChatAmount("context-mode ● 1.5 MB this chat")).toBe("1.5MB");
  });

  it.each([
    ["fresh session", "context-mode  ●  23.2 MB kept out  ·  222 KB/day  ·  preserved across compact, restart & upgrade"],
    ["brand-new install", "context-mode  ●  saves ~98% of context window"],
    ["garbage", "\u0000\u0001 nonsense"],
    ["empty", ""],
    ["unknown unit", "context-mode ● 12 TB this chat"],
  ])("returns undefined for %s output", (_name, output) => {
    expect(parseThisChatAmount(output)).toBeUndefined();
  });
});

describe("contextModeSessionId", () => {
  it("matches context-mode's Pi adapter: sha256 of the session file, 16 hex chars", () => {
    expect(contextModeSessionId("/sessions/session-1.jsonl")).toBe("e1b4608e31f04e21");
    expect(contextModeSessionId("/a")).not.toBe(contextModeSessionId("/b"));
  });
});

function deferredRunner() {
  const calls: { stdin: string; env: NodeJS.ProcessEnv; resolve: (value: string | undefined) => void }[] = [];
  const run: StatuslineRunner = (stdin, env) => new Promise((resolve) => calls.push({ stdin, env, resolve }));
  return { run, calls };
}

async function flush() {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

describe("ContextModeTracker", () => {
  it("queries the Pi session via the statusline and caches the parsed amount", async () => {
    const { run, calls } = deferredRunner();
    const onChange = vi.fn();
    const tracker = new ContextModeTracker(run, onChange);
    tracker.setSession("/sessions/session-1.jsonl");
    tracker.refresh();

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.stdin)).toEqual({ session_id: contextModeSessionId("/sessions/session-1.jsonl") });
    expect(calls[0]!.env.CLAUDE_CONFIG_DIR).toBe(join(homedir(), ".pi"));

    calls[0]!.resolve(ACTIVE_OUTPUT);
    await flush();
    expect(tracker.amount).toBe("426KB");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("never overlaps refreshes", async () => {
    const { run, calls } = deferredRunner();
    const tracker = new ContextModeTracker(run);
    tracker.setSession("/s.jsonl");
    tracker.refresh();
    tracker.refresh();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(undefined);
    await flush();
    tracker.refresh();
    expect(calls).toHaveLength(2);
  });

  it("stays empty when Context Mode is unavailable or its output is malformed", async () => {
    const { run, calls } = deferredRunner();
    const tracker = new ContextModeTracker(run);
    tracker.setSession("/s.jsonl");
    tracker.refresh();
    calls[0]!.resolve(undefined);
    await flush();
    expect(tracker.amount).toBeUndefined();
    tracker.refresh();
    calls[1]!.resolve("context-mode ● saves ~98% of context window");
    await flush();
    expect(tracker.amount).toBeUndefined();
  });

  it("keeps the last value through a failed refresh and clears it on session change", async () => {
    const { run, calls } = deferredRunner();
    const onChange = vi.fn();
    const tracker = new ContextModeTracker(run, onChange);
    tracker.setSession("/s.jsonl");
    tracker.refresh();
    calls[0]!.resolve(ACTIVE_OUTPUT);
    await flush();
    tracker.refresh();
    calls[1]!.resolve(undefined);
    await flush();
    expect(tracker.amount).toBe("426KB");

    tracker.setSession("/other.jsonl");
    expect(tracker.amount).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a session file and drops results for a stale session", async () => {
    const { run, calls } = deferredRunner();
    const tracker = new ContextModeTracker(run);
    tracker.setSession(undefined);
    tracker.refresh();
    expect(calls).toHaveLength(0);

    tracker.setSession("/s.jsonl");
    tracker.refresh();
    tracker.setSession("/t.jsonl");
    calls[0]!.resolve(ACTIVE_OUTPUT);
    await flush();
    expect(tracker.amount).toBeUndefined();
  });

  it("survives a runner that rejects", async () => {
    const tracker = new ContextModeTracker(() => Promise.reject(new Error("boom")));
    tracker.setSession("/s.jsonl");
    tracker.refresh();
    await flush();
    expect(tracker.amount).toBeUndefined();
  });
});

describe("runStatusline", () => {
  it("runs `context-mode statusline` with a timeout, passes stdin, and resolves stdout", async () => {
    const end = vi.fn();
    vi.mocked(execFile).mockImplementationOnce(((file: string, args: string[], options: Record<string, unknown>, callback: Function) => {
      expect(file).toBe("context-mode");
      expect(args).toEqual(["statusline"]);
      expect(options).toMatchObject({ timeout: 3000 });
      queueMicrotask(() => callback(null, ACTIVE_OUTPUT));
      return { stdin: { on() {}, end } };
    }) as never);

    await expect(runStatusline('{"session_id":"x"}', {})).resolves.toBe(ACTIVE_OUTPUT);
    expect(end).toHaveBeenCalledWith('{"session_id":"x"}');
  });

  it("resolves undefined when the command is missing, fails, or throws", async () => {
    await expect(runStatusline("{}", {})).resolves.toBeUndefined();

    vi.mocked(execFile).mockImplementationOnce((() => {
      throw new Error("spawn failed");
    }) as never);
    await expect(runStatusline("{}", {})).resolves.toBeUndefined();
  });
});
