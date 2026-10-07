import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { createTestEnvironment } from "./harness.ts";

describe("Pi loader smoke test", () => {
  it("loads the extension through Pi 1.0 without errors or network calls", async () => {
    const environment = await createTestEnvironment();
    try {
      const cwd = join(environment.root, "neutral-cwd");
      const agentDir = join(environment.root, "neutral-agent-dir");
      await mkdir(cwd, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
      const result = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);

      expect(result.errors).toEqual([]);
      expect(result.extensions).toHaveLength(1);
      expect([...result.extensions[0]!.handlers.keys()].sort()).toEqual([
        "model_select",
        "session_start",
        "turn_end",
      ]);
      expect(environment.requestSummary()).toEqual([]);
    } finally {
      await environment.cleanup();
    }
  });
});
