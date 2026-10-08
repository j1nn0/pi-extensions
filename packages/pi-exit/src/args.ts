export type ExitArgs =
  | { kind: "run"; force: boolean; wait: boolean }
  | { kind: "help" }
  | { kind: "error"; message: string };

export const EXIT_USAGE = `/exit - exit Pi cleanly

  /exit           exit now; asks for confirmation while the agent is running
  /exit --force   exit without confirmation
  /exit --wait    wait for the agent to finish, then exit
  /exit --help    show this message`;

export function parseExitArgs(raw: string): ExitArgs {
  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  let force = false;
  let wait = false;
  let help = false;

  for (const token of tokens) {
    switch (token) {
      case "-f":
      case "--force":
        force = true;
        break;
      case "-w":
      case "--wait":
        wait = true;
        break;
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        return { kind: "error", message: `Unknown option: ${token}` };
    }
  }

  if (help) return { kind: "help" };
  if (force && wait) {
    return { kind: "error", message: "--force and --wait are mutually exclusive" };
  }

  return { kind: "run", force, wait };
}
