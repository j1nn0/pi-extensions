import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ContextUsage } from "@earendil-works/pi-coding-agent";
import { contextWarning, renderCache, renderFooter, type FooterRenderInput } from "../src/render.ts";
import { FROZEN_NOW, makeTheme, toPlain, toTags } from "./harness.ts";

const HOUR = 60 * 60 * 1000;
const theme = makeTheme() as unknown as FooterRenderInput["theme"];

function input(overrides: Partial<FooterRenderInput> = {}): FooterRenderInput {
  return {
    width: 200,
    theme,
    model: { provider: "openai-codex", id: "gpt-6-luna", reasoning: true },
    showProvider: false,
    thinkingLevel: "high",
    context: { tokens: 161_000, contextWindow: 384_000, percent: 41.9 },
    cache: { read: 424_000, write: 2_100 },
    usage: {
      provider: "Codex",
      fetchedAt: FROZEN_NOW,
      windows: [
        { label: "5h", usedPercent: 71.5, resetsAt: FROZEN_NOW + 3 * HOUR },
        { label: "7d", usedPercent: 14, resetsAt: FROZEN_NOW + 4 * 24 * HOUR },
      ],
    },
    durationMs: (6 * 60 + 29) * 60_000,
    cwd: undefined,
    git: { branch: "main", dirty: true, ahead: 2, behind: 0 },
    contextMode: "426KB",
    ...overrides,
  };
}

function plain(overrides: Partial<FooterRenderInput> = {}): string[] {
  return renderFooter(input(overrides)).map(toPlain);
}

function line1(overrides: Partial<FooterRenderInput> = {}): string {
  return plain(overrides)[0] ?? "";
}

function line2(overrides: Partial<FooterRenderInput> = {}): string {
  return plain(overrides)[1] ?? "";
}

describe("model and thinking", () => {
  it("shows level and think ON for reasoning models", () => {
    expect(line1()).toMatch(/^gpt-6-luna · high · think ON │ /);
  });

  it("shows think OFF without a level when thinking is off", () => {
    expect(line1({ thinkingLevel: "off" })).toMatch(/^gpt-6-luna · think OFF │ /);
    expect(line1({ thinkingLevel: undefined })).toMatch(/^gpt-6-luna · think OFF │ /);
  });

  it("shows only the model for non-reasoning models", () => {
    expect(line1({ model: { provider: "opencode-go", id: "glm-5", reasoning: false } })).toMatch(/^glm-5 │ ctx /);
  });

  it("keeps the provider prefix option and the no-model fallback", () => {
    expect(line1({ showProvider: true })).toMatch(/^openai-codex\/gpt-6-luna · high/);
    expect(line1({ model: { provider: "command-code", id: "deepseek/deepseek-v4.1-flash", reasoning: true } })).toMatch(
      /^deepseek-v4\.1-flash · high/
    );
    expect(line1({ model: null, context: undefined, cache: undefined })).toBe("no-model │ ctx ░░░░░░░░░░ ?%");
  });
});

describe("context gauge", () => {
  it("renders a 10-cell bar, floored percent, and one-decimal token counts", () => {
    expect(line1({ cache: undefined })).toBe("gpt-6-luna · high · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k");
    expect(line1({ cache: undefined, context: { tokens: 424_500, contextWindow: 1_000_000, percent: 42.45 } })).toBe(
      "gpt-6-luna · high · think ON │ ctx ████░░░░░░ 42% · 424.5k/1.0M"
    );
  });

  it.each([
    [69.9, "", "success"],
    [70, " !", "warning"],
    [84.9, " !", "warning"],
    [85, " ⚠", "error"],
    [94.9, " ⚠", "error"],
    [95, " COMPACT", "error"],
    [100, " COMPACT", "error"],
  ])("marks %s%% with %j", (percent, marker, color) => {
    const context: ContextUsage = { tokens: Math.round(percent * 1000), contextWindow: 100_000, percent };
    const text = line1({ cache: undefined, context });
    expect(text.endsWith(`/100.0k${marker}`)).toBe(true);
    const tagged = toTags(renderFooter(input({ context }))[0] ?? "");
    expect(tagged).toContain(`<dim>ctx</dim> <${color}>`);
  });

  it("thresholds match the Claude StatusLine", () => {
    expect([0, 69, 70, 84, 85, 94, 95].map(contextWarning)).toEqual(["", "", "!", "!", "⚠", "⚠", "COMPACT"]);
  });

  it("renders unknown usage after compaction instead of 0%", () => {
    const text = line1({ cache: undefined, context: { tokens: null, contextWindow: 384_000, percent: null } });
    expect(text).toBe("gpt-6-luna · high · think ON │ ctx ░░░░░░░░░░ ?% · ?/384.0k");
    expect(text).not.toContain("0%");
  });

  it("renders unknown usage without counts when Pi reports no context window", () => {
    expect(line1({ cache: undefined, context: undefined })).toBe("gpt-6-luna · high · think ON │ ctx ░░░░░░░░░░ ?%");
  });
});

describe("cache", () => {
  it("shows read, and write only from 1k", () => {
    expect(toPlain(renderCache({ read: 424_000, write: 0 }, theme))).toBe("cache R424.0k");
    expect(toPlain(renderCache({ read: 424_000, write: 999 }, theme))).toBe("cache R424.0k");
    expect(toPlain(renderCache({ read: 424_000, write: 1_000 }, theme))).toBe("cache R424.0k/W1.0k");
    expect(toPlain(renderCache({ read: 0, write: 2_100 }, theme))).toBe("cache W2.1k");
  });

  it("omits the segment when there is nothing meaningful", () => {
    expect(renderCache({ read: 0, write: 999 }, theme)).toBe("");
    expect(renderCache(undefined, theme)).toBe("");
    expect(line1({ cache: { read: 0, write: 0 } })).not.toContain("cache");
  });
});

describe("second line", () => {
  it("renders quota windows with reset clocks, duration, git, and Context Mode", () => {
    expect(line2()).toBe("5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB");
  });

  it("omits reset clocks the provider does not report", () => {
    const usage = { provider: "OpenCode Go", fetchedAt: 0, windows: [{ label: "mo", usedPercent: 9 }] };
    expect(line2({ usage })).toBe("mo 9% │ 6h29m │ main * ↑2 │ ctx-mode 426KB");
  });

  it("omits quota and Context Mode cleanly when unavailable", () => {
    expect(line2({ usage: null, contextMode: undefined })).toBe("6h29m │ main * ↑2");
    expect(line2({ usage: { provider: "Codex", fetchedAt: 0, windows: [] }, contextMode: undefined })).toBe("6h29m │ main * ↑2");
  });

  it("colors quota percentages by threshold", () => {
    const usage = {
      provider: "Codex",
      fetchedAt: 0,
      windows: [
        { label: "5h", usedPercent: 84.9 },
        { label: "7d", usedPercent: 85 },
        { label: "mo", usedPercent: 92 },
      ],
    };
    const tagged = toTags(renderFooter(input({ usage }))[1] ?? "");
    expect(tagged).toContain("<dim>5h</dim> <muted>84%</muted>");
    expect(tagged).toContain("<dim>7d</dim> <warning>85%</warning>");
    expect(tagged).toContain("<dim>mo</dim> <error>92%</error>");
  });

  it.each([
    [{ branch: "main", dirty: false, ahead: 0, behind: 0 }, "main", "<success>main</success>"],
    [{ branch: "main", dirty: true, ahead: 0, behind: 0 }, "main *", "<warning>main</warning><warning> *</warning>"],
    [{ branch: "main", dirty: false, ahead: 2, behind: 0 }, "main ↑2", "<success>main</success><success> ↑2</success>"],
    [{ branch: "main", dirty: false, ahead: 0, behind: 1 }, "main ↓1", "<success>main</success><error> ↓1</error>"],
  ])("renders git state %j", (git, text, tagged) => {
    expect(line2({ usage: null, durationMs: undefined, contextMode: undefined, git })).toBe(text);
    expect(toTags(renderFooter(input({ usage: null, durationMs: undefined, contextMode: undefined, git }))[1] ?? "")).toBe(tagged);
  });

  it("shows the optional cwd before git", () => {
    expect(line2({ usage: null, contextMode: undefined, cwd: "~/work" })).toBe("6h29m │ ~/work │ main * ↑2");
  });

  it("drops the second line when it has nothing to show", () => {
    expect(plain({ usage: null, durationMs: undefined, git: null, contextMode: undefined })).toHaveLength(1);
  });
});

describe("narrow terminals", () => {
  it.each([
    [
      120,
      "gpt-6-luna · high · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k │ cache R424.0k/W2.1k",
      "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB",
    ],
    [
      100,
      "gpt-6-luna · high · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k │ cache R424.0k/W2.1k",
      "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB",
    ],
    [80, "gpt-6-luna · high · think ON │ ctx ████░░░░░░ 41% · 161.0k/384.0k", "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB"],
    [60, "gpt-6-luna · high │ ctx ████░░░░░░ 41% · 161.0k/384.0k", "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2"],
    [40, "gpt-6-luna · high │ ctx ████░░░░░░ 41%", "5h 71% │ 7d 14% │ main * ↑2"],
    [30, "gpt-6-luna │ ctx 41%", "5h 71% │ 7d 14% │ main * ↑2"],
    [20, "gpt-6-luna │ ctx 41%", "5h 71% │ main * ↑2"],
  ])("degrades by priority at %i columns", (width, first, second) => {
    expect(plain({ width })).toEqual([first, second]);
  });

  it("keeps the context percentage by shortening a long model name", () => {
    const model = { provider: "command-code", id: "moonshotai/kimi-k2.7-code-preview-extended", reasoning: true };
    const [first] = plain({ width: 24, model });
    expect(first).toMatch(/│ ctx 41%$/);
    expect(visibleWidth(first ?? "")).toBeLessThanOrEqual(24);
  });

  it("never exceeds the terminal width and keeps ANSI sequences balanced", () => {
    for (let width = 1; width <= 160; width++) {
      for (const line of renderFooter(input({ width, cwd: "~/a/very/long/working/directory/path" }))) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        expect(line).not.toMatch(/\u001b\[[\d;]*$/);
      }
    }
  });
});
