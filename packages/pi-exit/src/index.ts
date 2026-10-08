import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createExitContext,
  EXIT_COMMAND_NAME,
  EXIT_FLAG_COMPLETIONS,
  runExitCommand,
} from "./exit.ts";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand(EXIT_COMMAND_NAME, {
    description: "Exit Pi cleanly",
    getArgumentCompletions: (argumentPrefix) => {
      const matches = EXIT_FLAG_COMPLETIONS.filter(({ value }) => value.startsWith(argumentPrefix));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      await runExitCommand(args, createExitContext(ctx));
    },
  });
}
