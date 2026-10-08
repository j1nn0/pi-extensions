import type { ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { EXIT_USAGE, parseExitArgs } from "./args.ts";

type ArgumentCompletions = NonNullable<RegisteredCommand["getArgumentCompletions"]>;
type AutocompleteItem = NonNullable<Awaited<ReturnType<ArgumentCompletions>>>[number];

export const EXIT_COMMAND_NAME = "exit";

export const EXIT_FLAG_COMPLETIONS: readonly AutocompleteItem[] = [
  { value: "--force", label: "--force", description: "Exit without confirmation." },
  { value: "--wait", label: "--wait", description: "Wait for the agent to finish, then exit." },
  { value: "--help", label: "--help", description: "Show this message." },
];

export interface ExitContext {
  isIdle(): boolean;
  hasUI: boolean;
  ui: {
    confirm(title: string, message: string): Promise<boolean>;
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
  waitForIdle(): Promise<void>;
  shutdown(): void;
}

export type ExitOutcome = "shutdown" | "cancelled" | "help" | "error";

export function createExitContext(ctx: ExtensionCommandContext): ExitContext {
  return {
    isIdle: () => ctx.isIdle(),
    hasUI: ctx.hasUI,
    ui: {
      confirm: (title, message) => ctx.ui.confirm(title, message),
      notify: (message, type) => ctx.ui.notify(message, type),
    },
    waitForIdle: () => ctx.waitForIdle(),
    shutdown: () => ctx.shutdown(),
  };
}

export async function runExitCommand(raw: string, ctx: ExitContext): Promise<ExitOutcome> {
  const parsed = parseExitArgs(raw);

  if (parsed.kind === "help") {
    ctx.ui.notify(EXIT_USAGE, "info");
    return "help";
  }

  if (parsed.kind === "error") {
    ctx.ui.notify(parsed.message, "error");
    return "error";
  }

  if (parsed.wait) {
    try {
      await ctx.waitForIdle();
    } catch {
      ctx.ui.notify("Could not wait for the agent to finish; exiting anyway.", "warning");
    }
    ctx.shutdown();
    return "shutdown";
  }

  if (parsed.force) {
    ctx.shutdown();
    return "shutdown";
  }

  if (ctx.isIdle()) {
    ctx.shutdown();
    return "shutdown";
  }

  if (!ctx.hasUI) {
    ctx.shutdown();
    return "shutdown";
  }

  let proceed = true;
  try {
    proceed = await ctx.ui.confirm("Exit Pi", "An agent run is still in progress. Exit anyway?");
  } catch {
    proceed = true;
  }

  if (proceed) {
    ctx.shutdown();
    return "shutdown";
  }

  ctx.ui.notify("Exit cancelled.", "info");
  return "cancelled";
}
