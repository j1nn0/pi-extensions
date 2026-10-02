import { describe, expect, it, vi } from "vitest";
import extension from "../index.ts";
import {
  ENDPOINTS,
  createFooterHarness,
  createTestEnvironment,
  settleAsync,
  toTags,
} from "./harness.ts";

describe("footer refresh events", () => {
  it("fetches after model_select and refreshes again at exactly five minutes", async () => {
    const environment = await createTestEnvironment();
    try {
      const footer = createFooterHarness(extension, { provider: "anthropic" });
      await footer.start();
      await settleAsync();
      expect(environment.requestSummary().map((request) => request.url)).toEqual([ENDPOINTS.anthropic]);

      await vi.advanceTimersByTimeAsync(120_000);
      await footer.selectModel("openai-codex");
      await settleAsync();
      expect(environment.requestSummary().map((request) => request.url)).toEqual([
        ENDPOINTS.anthropic,
        ENDPOINTS.codex,
      ]);

      await vi.advanceTimersByTimeAsync(299_999);
      await settleAsync();
      expect(environment.requests).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      await settleAsync();
      expect(environment.requestSummary().map((request) => request.url)).toEqual([
        ENDPOINTS.anthropic,
        ENDPOINTS.codex,
        ENDPOINTS.codex,
      ]);
      expect(environment.requestSummary().every((request) => request.authorizationPresent)).toBe(true);

      footer.dispose();
      await vi.advanceTimersByTimeAsync(300_000);
      await settleAsync();
      expect(environment.requests).toHaveLength(3);
    } finally {
      await environment.cleanup();
    }
  });

  it("keeps cached quota output when a refresh receives an HTTP error", async () => {
    const environment = await createTestEnvironment();
    try {
      const footer = createFooterHarness(extension, { provider: "minimax" });
      await footer.start();
      await settleAsync();
      const cachedOutput = footer.render(200).map(toTags);
      expect(cachedOutput.some((line) => line.includes("<dim>35%</dim>"))).toBe(true);

      environment.setResponse(ENDPOINTS.minimax, { status: 503, body: { error: "fixture outage" } });
      await footer.selectModel("minimax");
      await settleAsync();

      expect(footer.render(200).map(toTags)).toEqual(cachedOutput);
      expect(environment.requestSummary().map((request) => request.url)).toEqual([
        ENDPOINTS.minimax,
        ENDPOINTS.minimax,
      ]);
      footer.dispose();
    } finally {
      await environment.cleanup();
    }
  });
});
