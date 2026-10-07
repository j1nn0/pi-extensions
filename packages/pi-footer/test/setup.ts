import { execFile } from "node:child_process";
import { beforeEach, vi } from "vitest";

// Reset clocks render in local time; pin it so expectations are deterministic.
process.env.TZ = "UTC";

// Never run the real `context-mode` CLI from tests. By default it behaves as if
// it were not installed; individual tests override the implementation.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
      const error = Object.assign(new Error("spawn context-mode ENOENT"), { code: "ENOENT" });
      queueMicrotask(() => callback(error, ""));
      return { stdin: { on() {}, end() {} } };
    }),
  };
});

beforeEach(() => {
  // Restore the "not installed" default and clear call history between tests.
  vi.mocked(execFile).mockReset();
});
