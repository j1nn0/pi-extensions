import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const STATUSLINE_TIMEOUT_MS = 3000;
const STATUSLINE_MAX_OUTPUT = 64 * 1024;

/** Runs `context-mode statusline` and resolves its stdout, or undefined on any failure. */
export type StatuslineRunner = (stdin: string, env: NodeJS.ProcessEnv) => Promise<string | undefined>;

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;
const THIS_CHAT_PATTERN = /(?:^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB)\s+this chat/;

/** Extract the "<number><unit> this chat" amount, e.g. "426KB"; undefined when absent. */
export function parseThisChatAmount(output: string): string | undefined {
  const match = output.replace(ANSI_PATTERN, "").match(THIS_CHAT_PATTERN);
  return match ? `${match[1]}${match[2]}` : undefined;
}

/** Session id used by context-mode's Pi adapter: sha256 of the session file path, 16 hex chars. */
export function contextModeSessionId(sessionFile: string): string {
  return createHash("sha256").update(sessionFile).digest("hex").slice(0, 16);
}

export const runStatusline: StatuslineRunner = (stdin, env) =>
  new Promise((resolve) => {
    try {
      const child = execFile(
        "context-mode",
        ["statusline"],
        { env, timeout: STATUSLINE_TIMEOUT_MS, maxBuffer: STATUSLINE_MAX_OUTPUT, windowsHide: true },
        (error, stdout) => resolve(error ? undefined : String(stdout)),
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(stdin);
    } catch {
      resolve(undefined);
    }
  });

/**
 * Cached Context Mode "this chat" amount for one Pi session. Refreshes run in the
 * background, never overlap, and keep the last parsed value when a refresh fails.
 */
export class ContextModeTracker {
  private value: string | undefined;
  private sessionId: string | undefined;
  private inFlight = false;
  private readonly run: StatuslineRunner;
  private readonly onChange: () => void;

  constructor(run: StatuslineRunner = runStatusline, onChange: () => void = () => {}) {
    this.run = run;
    this.onChange = onChange;
  }

  get amount(): string | undefined {
    return this.value;
  }

  setSession(sessionFile: string | undefined): void {
    const next = sessionFile ? contextModeSessionId(sessionFile) : undefined;
    if (next === this.sessionId) return;
    this.sessionId = next;
    if (this.value !== undefined) {
      this.value = undefined;
      this.onChange();
    }
  }

  refresh(): void {
    const sessionId = this.sessionId;
    if (!sessionId || this.inFlight) return;
    this.inFlight = true;

    // context-mode's Claude statusline reads `<CLAUDE_CONFIG_DIR>/context-mode/sessions`;
    // its Pi adapter stores sessions under ~/.pi/context-mode/sessions.
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(homedir(), ".pi") };
    this.run(JSON.stringify({ session_id: sessionId }), env)
      .then((output) => {
        if (this.sessionId !== sessionId || output === undefined) return;
        const amount = parseThisChatAmount(output);
        if (amount === undefined || amount === this.value) return;
        this.value = amount;
        this.onChange();
      })
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
      });
  }
}
