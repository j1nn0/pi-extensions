import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import extension from "../index.ts";
import {
  ENDPOINTS,
  createFooterHarness,
  createTestEnvironment,
  settleAsync,
  toTags,
} from "./harness.ts";

const widths = [200, 80, 40, 24] as const;
const providers = [
  { id: "anthropic", endpoint: ENDPOINTS.anthropic },
  { id: "openai-codex", endpoint: ENDPOINTS.codex },
  { id: "github-copilot", endpoint: ENDPOINTS.copilot },
  { id: "google-gemini-cli", endpoint: ENDPOINTS.gemini },
  { id: "minimax", endpoint: ENDPOINTS.minimax },
  { id: "minimax-cn", endpoint: ENDPOINTS.minimaxCn },
  { id: "kimi-coding", endpoint: ENDPOINTS.kimi },
  { id: "opencode-go", endpoint: ENDPOINTS.opencode },
] as const;

const wideStatus = [
  "<accent>~/work</accent> <dim>></dim> <muted>reasoner</muted> <dim>></dim> <accent>high</accent> <dim>></dim> <dim>ctx </dim><success>━━━━━</success><dim>───────</dim> <dim>41% 1.2M/3M</dim>",
];
const status40 = [
  "<accent>~/work</accent> <dim>></dim> <muted>reasoner</muted> <dim>></dim> <accent>high</accent>",
  "<dim>ctx </dim><success>━━━━━</success><dim>───────</dim> <dim>41% 1.2M/3M</dim>",
];
const status24 = [
  "<accent>~/work</accent> <dim>></dim> <muted>reasoner</muted> <dim>></dim> <accent>high</accent>",
  "<dim>ctx </dim><success>━━━━</success><dim>──────</dim> <dim>41%</dim>",
];

const usageByProvider: Record<string, Record<number, string[]>> = {
  anthropic: {
    200: ["<accent>Claude</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim> <dim>></dim> <dim>Week</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>83%</dim> <dim>6d3h</dim>"],
    80: ["<accent>Claude</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim> <dim>></dim> <dim>Week</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>83%</dim> <dim>6d3h</dim>"],
    40: ["<accent>Claude</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim>", "<dim>Week</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>83%</dim> <dim>6d3h</dim>"],
    24: ["<accent>Claude</accent>", "<dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim>", "<dim>Week</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>83%</dim> <dim>6d3h</dim>"],
  },
  "openai-codex": {
    200: ["<accent>Codex</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━━</success><dim>───</dim> <dim>72%</dim> <dim>3h</dim> <dim>></dim> <dim>Week</dim> <success>━</success><dim>─────────</dim> <dim>14%</dim> <dim>4d</dim>"],
    80: ["<accent>Codex</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━━</success><dim>───</dim> <dim>72%</dim> <dim>3h</dim> <dim>></dim> <dim>Week</dim> <success>━</success><dim>─────────</dim> <dim>14%</dim> <dim>4d</dim>"],
    40: ["<accent>Codex</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━━</success><dim>───</dim> <dim>72%</dim> <dim>3h</dim>", "<dim>Week</dim> <success>━</success><dim>─────────</dim> <dim>14%</dim> <dim>4d</dim>"],
    24: ["<accent>Codex</accent>", "<dim>5h</dim> <success>━━━━━━━</success><dim>───</dim> <dim>72%</dim> <dim>3h</dim>", "<dim>Week</dim> <success>━</success><dim>─────────</dim> <dim>14%</dim> <dim>4d</dim>"],
  },
  "github-copilot": {
    200: ["<accent>Copilot</accent> <dim>></dim> <dim>Premium</dim> <error>━━━━━━━━━</error><dim>─</dim> <dim>95%</dim> <dim>1h5m</dim> <dim>></dim> <dim>Chat</dim> <success>━━━</success><dim>───────</dim> <dim>25%</dim> <dim>1h5m</dim>"],
    80: ["<accent>Copilot</accent> <dim>></dim> <dim>Premium</dim> <error>━━━━━━━━━</error><dim>─</dim> <dim>95%</dim> <dim>1h5m</dim> <dim>></dim> <dim>Chat</dim> <success>━━━</success><dim>───────</dim> <dim>25%</dim> <dim>1h5m</dim>"],
    40: ["<accent>Copilot</accent> <dim>></dim> <dim>Premium</dim> <error>━━━━━━━━━</error><dim>─</dim> <dim>95%</dim> <dim>1h5m</dim>", "<dim>Chat</dim> <success>━━━</success><dim>───────</dim> <dim>25%</dim> <dim>1h5m</dim>"],
    24: ["<accent>Copilot</accent>", "<dim>Premium</dim> <error>━━━━━━━━</error><dim></dim> <dim>95%</dim>", "<dim>Chat</dim> <success>━━━</success><dim>───────</dim> <dim>25%</dim> <dim>1h5m</dim>"],
  },
  "google-gemini-cli": {
    200: ["<accent>Gemini</accent> <dim>></dim> <dim>Pro</dim> <success>━━━━━━</success><dim>────</dim> <dim>57%</dim> <dim>></dim> <dim>Flash</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim>"],
    80: ["<accent>Gemini</accent> <dim>></dim> <dim>Pro</dim> <success>━━━━━━</success><dim>────</dim> <dim>57%</dim> <dim>></dim> <dim>Flash</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim>"],
    40: ["<accent>Gemini</accent> <dim>></dim> <dim>Pro</dim> <success>━━━━━━</success><dim>────</dim> <dim>57%</dim>", "<dim>Flash</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim>"],
    24: ["<accent>Gemini</accent>", "<dim>Pro</dim> <success>━━━━━━</success><dim>────</dim> <dim>57%</dim>", "<dim>Flash</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim>"],
  },
  minimax: {
    200: ["<accent>MiniMax</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>35%</dim> <dim>3h</dim> <dim>></dim> <dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
    80: ["<accent>MiniMax</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>35%</dim> <dim>3h</dim> <dim>></dim> <dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
    40: ["<accent>MiniMax</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>35%</dim> <dim>3h</dim>", "<dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
    24: ["<accent>MiniMax</accent>", "<dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>35%</dim> <dim>3h</dim>", "<dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
  },
  "minimax-cn": {
    200: ["<accent>MiniMax CN</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>63%</dim> <dim>6h</dim> <dim>></dim> <dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
    80: ["<accent>MiniMax CN</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>63%</dim> <dim>6h</dim> <dim>></dim> <dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
    40: ["<accent>MiniMax CN</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>63%</dim> <dim>6h</dim>", "<dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
    24: ["<accent>MiniMax CN</accent>", "<dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>63%</dim> <dim>6h</dim>", "<dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>"],
  },
  "kimi-coding": {
    200: ["<accent>Kimi Coding</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim> <dim>></dim> <dim>Day</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>75%</dim> <dim>1h5m</dim> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>8h</dim> <dim>></dim> <dim>Weekly</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>6d</dim>"],
    80: ["<accent>Kimi Coding</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim> <dim>></dim> <dim>Day</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>75%</dim> <dim>1h5m</dim>", "<dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>8h</dim> <dim>></dim> <dim>Weekly</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>6d</dim>"],
    40: ["<accent>Kimi Coding</accent> <dim>></dim> <dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim>", "<dim>Day</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>75%</dim> <dim>1h5m</dim>", "<dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>8h</dim>", "<dim>Weekly</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>6d</dim>"],
    24: ["<accent>Kimi Coding</accent>", "<dim>5h</dim> <success>━━━━</success><dim>──────</dim> <dim>38%</dim> <dim>2h38m</dim>", "<dim>Day</dim> <success>━━━━━━━━</success><dim>──</dim> <dim>75%</dim> <dim>1h5m</dim>", "<dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>8h</dim>", "<dim>Weekly</dim> <success>━━━━━━</success><dim>────</dim> <dim>58%</dim> <dim>6d</dim>"],
  },
  "opencode-go": {
    200: ["<accent>OpenCode Go</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>56%</dim> <dim>2h38m</dim> <dim>></dim> <dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim> <dim>></dim> <dim>Month</dim> <success>━</success><dim>─────────</dim> <dim>9%</dim> <dim>30d</dim>"],
    80: ["<accent>OpenCode Go</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>56%</dim> <dim>2h38m</dim> <dim>></dim> <dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>", "<dim>Month</dim> <success>━</success><dim>─────────</dim> <dim>9%</dim> <dim>30d</dim>"],
    40: ["<accent>OpenCode Go</accent> <dim>></dim> <dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>56%</dim> <dim>2h38m</dim>", "<dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>", "<dim>Month</dim> <success>━</success><dim>─────────</dim> <dim>9%</dim> <dim>30d</dim>"],
    24: ["<accent>OpenCode Go</accent>", "<dim>5h</dim> <success>━━━━━━</success><dim>────</dim> <dim>56%</dim> <dim>2h38m</dim>", "<dim>Week</dim> <warning>━━━━━━━━━</warning><dim>─</dim> <dim>88%</dim> <dim>5d</dim>", "<dim>Month</dim> <success>━</success><dim>─────────</dim> <dim>9%</dim> <dim>30d</dim>"],
  },
};

describe("footer provider behavior", () => {
  it("pins exact ANSI-aware output for all providers at 200, 80, 40, and 24 columns", async () => {
    const environment = await createTestEnvironment();
    try {
      for (const provider of providers) {
        const footer = createFooterHarness(extension, { provider: provider.id });
        expect([...footer.handlers.keys()].sort()).toEqual(["model_select", "session_start", "turn_end"]);
        await footer.start();
        await settleAsync();
        expect(footer.setFooter).toHaveBeenCalledTimes(1);
        expect(footer.onBranchChange).toHaveBeenCalledTimes(1);

        for (const width of widths) {
          const rendered = footer.render(width);
          expect(rendered.every((line) => visibleWidth(line) <= width)).toBe(true);
          const status = width >= 80 ? wideStatus : width === 40 ? status40 : status24;
          expect(rendered.map(toTags)).toEqual([...status, ...usageByProvider[provider.id]![width]!]);
        }
        footer.dispose();
        expect(footer.unsubscribe).toHaveBeenCalledTimes(1);
      }

      expect(environment.requestSummary()).toEqual([
        {
          url: ENDPOINTS.anthropic,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: { "anthropic-beta": "oauth-2025-04-20", "user-agent": "claude-code/2.1.282" },
        },
        {
          url: ENDPOINTS.codex,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: { accept: "application/json", "chatgpt-account-id": "test-account", "user-agent": "pi-agent" },
        },
        {
          url: ENDPOINTS.copilot,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: { accept: "application/json", "editor-version": "vscode/1.96.2", "user-agent": "GitHubCopilotChat/0.26.7", "x-github-api-version": "2025-04-01" },
        },
        {
          url: ENDPOINTS.gemini,
          method: "POST",
          authorizationPresent: true,
          nonAuthHeaders: { "content-type": "application/json" },
          body: "{}",
        },
        {
          url: ENDPOINTS.minimax,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: { "content-type": "application/json" },
        },
        {
          url: ENDPOINTS.minimaxCn,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: { "content-type": "application/json" },
        },
        {
          url: ENDPOINTS.kimi,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: { "content-type": "application/json" },
        },
        {
          url: ENDPOINTS.opencode,
          method: "GET",
          authorizationPresent: true,
          nonAuthHeaders: {},
        },
      ]);
    } finally {
      await environment.cleanup();
    }
  });
});
