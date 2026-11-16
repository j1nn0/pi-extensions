import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseGoalStatus } from "../src/goal.ts";
import { renderFooter, renderGoalVariants, type FooterRenderInput } from "../src/render.ts";
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
    goal: undefined,
    contextMode: "426KB",
    ...overrides,
  };
}

function plain(overrides: Partial<FooterRenderInput> = {}): string[] {
  return renderFooter(input(overrides)).map(toPlain);
}

function line2(overrides: Partial<FooterRenderInput> = {}): string {
  return plain(overrides)[1] ?? "";
}

function goal(overrides: Partial<FooterRenderInput> = {}): string {
  return toPlain(renderGoalVariants(input(overrides).goal, theme)[0] ?? "");
}

describe("parseGoalStatus", () => {
  // Every status string pi-goal 0.55.x can publish through ctx.ui.setStatus("goal", …).
  it.each([
    ["active 12m · automatic 12/100", { state: "active", turns: { used: 12, limit: 100 } }],
    ["active 1.2k/50.0k · automatic 3/10", { state: "active", turns: { used: 3, limit: 10 } }],
    ["active 12m · automatic Unlimited", { state: "active" }],
    ["waiting", { state: "waiting" }],
    ["paused · automatic 6/10", { state: "paused", turns: { used: 6, limit: 10 } }],
    ["paused · automatic limit 10/10", { state: "paused", turns: { used: 10, limit: 10 } }],
    ["paused · previous automatic limit at 10", { state: "paused" }],
    ["paused · automatic Unlimited", { state: "paused" }],
    ["blocked · automatic 2/10", { state: "blocked", turns: { used: 2, limit: 10 } }],
    ["usage · automatic 2/10", { state: "usage_limited", turns: { used: 2, limit: 10 } }],
    ["budget 1.2k/50.0k · automatic 2/10", { state: "budget_limited", turns: { used: 2, limit: 10 } }],
    ["complete", { state: "complete" }],
  ])("parses %j", (status, expected) => {
    expect(parseGoalStatus(status)).toEqual(expected);
  });

  it.each([undefined, "", "   ", "planning the next step", "Goal: ship it", "ACTIVE 12m", "complete-ish", "budget_limited"])(
    "ignores the unrecognized status %j",
    (status) => {
      expect(parseGoalStatus(status)).toBeUndefined();
    }
  );

  // Another extension could publish under the same "goal" key, so only pi-goal's
  // shapes are accepted: `waiting`/`complete` verbatim, the rest with a counter.
  it.each([
    "waiting for approval",
    "paused for review",
    "active investors",
    "blocked by CI",
    "budget 80% used",
    "usage report is ready",
    "complete all tasks",
  ])("rejects the pi-goal lookalike %j", (status) => {
    expect(parseGoalStatus(status)).toBeUndefined();
  });

  it.each(["active 12m · automatic 3/0", "active 12m · automatic 12/", "active · automatic x/y"])(
    "drops an unusable counter from %j but keeps the state",
    (status) => {
      expect(parseGoalStatus(status)).toEqual({ state: "active" });
    }
  );
});

describe("goal segment", () => {
  it("shows the automatic continuation counter while active", () => {
    expect(goal({ goal: "active 12m · automatic 12/100" })).toBe("🎯 goal 12/100");
  });

  it("drops the counter when pi-goal reports no limit", () => {
    expect(goal({ goal: "active 12m · automatic Unlimited" })).toBe("🎯 goal");
  });

  it.each([
    ["waiting", "🎯 waiting", "warning"],
    ["paused · automatic 6/10", "🎯 paused", "warning"],
    ["paused · automatic Unlimited", "🎯 paused", "warning"],
    ["blocked · automatic 2/10", "🎯 blocked", "error"],
    ["usage · automatic 2/10", "🎯 usage limit", "error"],
    ["budget 1.2k/50.0k · automatic 2/10", "🎯 budget limit", "error"],
    ["complete", "🎯 complete", "success"],
  ])("renders %j as %j in %s", (status, text, color) => {
    expect(goal({ goal: status })).toBe(text);
    expect(toTags(renderGoalVariants(status, theme)[0] ?? "")).toBe(`<${color}>${text}</${color}>`);
  });

  it("colors the active label as success", () => {
    expect(toTags(renderGoalVariants("active 12m · automatic 12/100", theme)[0] ?? "")).toBe(
      "<success>🎯 goal 12/100</success>"
    );
  });

  it("renders nothing for no goal or an unrecognized status", () => {
    expect(renderGoalVariants(undefined, theme)).toEqual([]);
    expect(renderGoalVariants("", theme)).toEqual([]);
    expect(renderGoalVariants("planning the next step", theme)).toEqual([]);
  });

  it("offers a counter-free fallback only when a counter is shown", () => {
    expect(renderGoalVariants("active 12m · automatic 12/100", theme)).toHaveLength(2);
    expect(renderGoalVariants("waiting", theme)).toHaveLength(1);
  });
});

describe("second line with a goal", () => {
  it("appends the goal after the Git branch", () => {
    expect(line2({ goal: "active 12m · automatic 12/100" })).toBe(
      "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ 🎯 goal 12/100 │ ctx-mode 426KB"
    );
  });

  it("keeps the second line unchanged when there is no goal", () => {
    expect(line2()).toBe("5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ ctx-mode 426KB");
    expect(line2({ goal: undefined })).toBe(line2());
  });

  it("keeps the first line unchanged when a goal is shown", () => {
    expect(plain({ goal: "active 12m · automatic 12/100" })[0]).toBe(plain()[0]);
    expect(plain({ goal: "active 12m · automatic 12/100" })).toHaveLength(2);
  });

  it("shows a goal without Git or quota", () => {
    expect(line2({ usage: null, durationMs: undefined, git: null, contextMode: undefined, goal: "complete" })).toBe(
      "🎯 complete"
    );
  });

  it("does not add a third line", () => {
    expect(plain({ width: 200, goal: "blocked · automatic 2/10" })).toHaveLength(2);
  });
});

describe("goal priority on narrow terminals", () => {
  it.each([
    [80, "5h 71% ↻ 15:00 │ 7d 14% ↻ 10/06 12:00 │ 6h29m │ main * ↑2 │ 🎯 goal 12/100"],
    [60, "5h 71% │ 7d 14% │ main * ↑2 │ 🎯 goal 12/100"],
    [40, "5h 71% │ main * ↑2 │ 🎯 goal 12/100"],
    [30, "main * ↑2 │ 🎯 goal 12/100"],
    [20, "main * ↑2 │ 🎯 goal"],
  ])("keeps Git and the Goal ahead of the other line-2 segments at %i columns", (width, second) => {
    expect(line2({ width, goal: "active 12m · automatic 12/100" })).toBe(second);
  });

  it("shortens the active counter only after quota windows are gone", () => {
    // 40 and 30 columns drop quota windows but still fit the counter; 20 cannot.
    expect(line2({ width: 40, goal: "active 12m · automatic 12/100" })).toBe("5h 71% │ main * ↑2 │ 🎯 goal 12/100");
    expect(line2({ width: 30, goal: "active 12m · automatic 12/100" })).toBe("main * ↑2 │ 🎯 goal 12/100");
    expect(line2({ width: 20, goal: "active 12m · automatic 12/100" })).toContain("🎯 goal");
    expect(line2({ width: 20, goal: "active 12m · automatic 12/100" })).not.toContain("12/100");
  });

  it("keeps a paused goal visible without a counter", () => {
    expect(line2({ width: 22, goal: "paused · automatic 6/10" })).toBe("main * ↑2 │ 🎯 paused");
  });

  it("never exceeds the terminal width and leaves no dangling escape sequence", () => {
    for (const status of ["active 12m · automatic 12/100", "waiting", "budget 1.2k/50.0k · automatic 2/10"]) {
      for (let width = 1; width <= 160; width++) {
        for (const line of renderFooter(input({ width, goal: status }))) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
          expect(line).not.toMatch(/\u001b\[[\d;]*$/);
        }
      }
    }
  });

  it("measures the emoji as two columns", () => {
    expect(visibleWidth("🎯 goal 12/100")).toBe(14);
    expect(visibleWidth(renderGoalVariants("active 12m · automatic 12/100", theme)[0] ?? "")).toBe(14);
  });
});
