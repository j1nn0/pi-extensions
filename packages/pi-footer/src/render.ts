import type { ContextUsage, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration, formatResetClock, formatTokenCount } from "./format.ts";
import { parseGoalStatus, type GoalState } from "./goal.ts";
import type { CacheUsage, GitCache, RateWindow, UsageSnapshot } from "./types.ts";

export const CONTEXT_BAR_WIDTH = 10;
export const BAR_FILLED = "█";
export const BAR_EMPTY = "░";

export interface FooterModel {
  provider: string;
  id: string;
  reasoning?: boolean;
}

export interface FooterRenderInput {
  width: number;
  theme: Theme;
  model: FooterModel | null | undefined;
  showProvider: boolean;
  thinkingLevel: string | undefined;
  context: ContextUsage | undefined;
  cache: CacheUsage | undefined;
  usage: UsageSnapshot | null;
  durationMs: number | undefined;
  /** Already shortened working directory, or undefined when hidden. */
  cwd: string | undefined;
  /** Git state, or null when hidden or unavailable. */
  git: GitCache | null;
  /** Raw `goal` extension status published by pi-goal, when enabled. */
  goal: string | undefined;
  contextMode: string | undefined;
}

function separator(theme: Theme): string {
  return " " + theme.fg("dim", "│") + " ";
}

function dot(theme: Theme): string {
  return " " + theme.fg("dim", "·") + " ";
}

/** The first variant that fits, otherwise the last one truncated. */
function fitVariants(width: number, variants: string[]): string {
  for (const variant of variants) {
    if (visibleWidth(variant) <= width) return variant;
  }
  return truncateToWidth(variants[variants.length - 1] ?? "", width);
}

// ============ Line 1: model, thinking, context, cache ============

export function contextWarning(percent: number): string {
  if (percent >= 95) return "COMPACT";
  if (percent >= 85) return "⚠";
  if (percent >= 70) return "!";
  return "";
}

function contextColor(percent: number): ThemeColor {
  if (percent >= 85) return "error";
  if (percent >= 70) return "warning";
  return "success";
}

export function renderContextBar(percent: number | null, theme: Theme): string {
  const filled = percent === null ? 0 : Math.max(0, Math.min(CONTEXT_BAR_WIDTH, Math.floor((percent * CONTEXT_BAR_WIDTH) / 100)));
  const color = percent === null ? "dim" : contextColor(percent);
  return theme.fg(color, BAR_FILLED.repeat(filled)) + theme.fg("dim", BAR_EMPTY.repeat(CONTEXT_BAR_WIDTH - filled));
}

/** Context segment variants from most to least detailed. */
export function renderContextVariants(context: ContextUsage | undefined, theme: Theme): string[] {
  const label = theme.fg("dim", "ctx");
  const known = context?.percent !== null && context?.percent !== undefined;
  const percent = known ? Math.max(0, Math.floor(context!.percent!)) : null;
  const percentText = theme.fg("muted", percent === null ? "?%" : `${percent}%`);
  const warningText = percent === null ? "" : contextWarning(percent);
  const warning = warningText ? " " + theme.fg(percent! >= 95 ? "error" : "warning", warningText) : "";

  let counts = "";
  if (context && context.contextWindow > 0) {
    const used = context.tokens === null ? "?" : formatTokenCount(context.tokens);
    counts = dot(theme) + theme.fg("muted", `${used}/${formatTokenCount(context.contextWindow)}`);
  }

  const bar = renderContextBar(percent, theme);
  const full = `${label} ${bar} ${percentText}${counts}${warning}`;
  const withBar = `${label} ${bar} ${percentText}${warning}`;
  const compact = `${label} ${percentText}${warning}`;
  return counts ? [full, withBar, compact] : [withBar, compact];
}

export function renderModelName(model: FooterModel | null | undefined, showProvider: boolean): string {
  if (!model) return "no-model";
  return showProvider ? `${model.provider}/${model.id}` : model.id.split("/").pop() || "no-model";
}

/** Model segment variants: with level and think state, with level only, model only. */
export function renderModelVariants(
  model: FooterModel | null | undefined,
  showProvider: boolean,
  thinkingLevel: string | undefined,
  theme: Theme
): string[] {
  const name = theme.fg("accent", renderModelName(model, showProvider));
  if (!model?.reasoning) return [name];

  const level = thinkingLevel ?? "off";
  if (level === "off") return [name + dot(theme) + theme.fg("dim", "think OFF"), name];

  const withLevel = name + dot(theme) + theme.fg("muted", level);
  return [withLevel + dot(theme) + theme.fg("muted", "think ON"), withLevel, name];
}

export function renderCache(cache: CacheUsage | undefined, theme: Theme): string {
  if (!cache) return "";
  const showRead = cache.read > 0;
  const showWrite = cache.write >= 1000;
  if (!showRead && !showWrite) return "";

  let value = "";
  if (showRead) value += `R${formatTokenCount(cache.read)}`;
  if (showWrite) value += `${showRead ? "/" : ""}W${formatTokenCount(cache.write)}`;
  return theme.fg("dim", "cache") + " " + theme.fg("muted", value);
}

export function renderFirstLine(input: FooterRenderInput): string {
  const { width, theme } = input;
  const sep = separator(theme);
  const models = renderModelVariants(input.model, input.showProvider, input.thinkingLevel, theme);
  const contexts = renderContextVariants(input.context, theme);
  const cache = renderCache(input.cache, theme);

  const modelFull = models[0]!;
  const modelLevel = models[1] ?? modelFull;
  const modelOnly = models[models.length - 1]!;
  const contextFull = contexts[0]!;
  const contextBar = contexts[contexts.length - 2] ?? contextFull;
  const contextCompact = contexts[contexts.length - 1]!;

  // Drop detail in priority order: cache, think state, token counts, level, bar.
  const candidates = [
    ...(cache ? [modelFull + sep + contextFull + sep + cache] : []),
    modelFull + sep + contextFull,
    modelLevel + sep + contextFull,
    modelLevel + sep + contextBar,
    modelOnly + sep + contextBar,
    modelOnly + sep + contextCompact,
  ];
  for (const candidate of candidates) {
    if (visibleWidth(candidate) <= width) return candidate;
  }

  // Keep the context percentage visible by shortening the model name.
  const tail = sep + contextCompact;
  const room = width - visibleWidth(tail);
  if (room >= 4) return truncateToWidth(modelOnly, room) + tail;
  return truncateToWidth(modelOnly + tail, width);
}

// ============ Line 2: quota, duration, cwd, git, goal, Context Mode ============

function usageColor(percent: number): ThemeColor {
  if (percent >= 92) return "error";
  if (percent >= 85) return "warning";
  return "muted";
}

export function renderUsageWindow(window: RateWindow, theme: Theme, includeReset: boolean): string {
  const percent = Math.floor(window.usedPercent);
  let text = theme.fg("dim", window.label) + " " + theme.fg(usageColor(percent), `${percent}%`);
  if (includeReset && window.resetsAt !== undefined && Number.isFinite(window.resetsAt)) {
    text += " " + theme.fg("dim", `↻ ${formatResetClock(window.resetsAt, window.label)}`);
  }
  return text;
}

export function renderGit(git: GitCache | null, theme: Theme): string {
  if (!git?.branch) return "";
  let text = theme.fg(git.dirty ? "warning" : "success", git.branch);
  if (git.dirty) text += theme.fg("warning", " *");
  if (git.ahead) text += theme.fg("success", ` ↑${git.ahead}`);
  if (git.behind) text += theme.fg("error", ` ↓${git.behind}`);
  return text;
}

const GOAL_ICON = "🎯";

const GOAL_LABELS: Readonly<Record<GoalState, string>> = {
  active: "goal",
  waiting: "waiting",
  paused: "paused",
  blocked: "blocked",
  usage_limited: "usage limit",
  budget_limited: "budget limit",
  complete: "complete",
};

function goalColor(state: GoalState): ThemeColor {
  switch (state) {
    case "active":
    case "complete":
      return "success";
    case "waiting":
    case "paused":
      return "warning";
    default:
      return "error";
  }
}

/** Goal segment variants from most to least detailed. */
export function renderGoalVariants(status: string | undefined, theme: Theme): string[] {
  const goal = parseGoalStatus(status);
  if (!goal) return [];

  const color = goalColor(goal.state);
  const text = `${GOAL_ICON} ${GOAL_LABELS[goal.state]}`;
  const label = theme.fg(color, text);
  // Every pi-goal state but `waiting` and `complete` carries an `automatic …`
  // suffix; only `active` shows its counter, where progress is the useful signal.
  if (goal.state !== "active" || !goal.turns) return [label];

  // Keep the counter while it fits, then fall back to the bare state.
  return [theme.fg(color, `${text} ${goal.turns.used}/${goal.turns.limit}`), label];
}

export function renderSecondLine(input: FooterRenderInput): string {
  const { width, theme } = input;
  const sep = separator(theme);
  const windows = input.usage?.windows ?? [];
  const duration = input.durationMs === undefined ? "" : theme.fg("muted", formatDuration(input.durationMs));
  const cwd = input.cwd ? theme.fg("dim", input.cwd) : "";
  const git = renderGit(input.git, theme);
  const goals = renderGoalVariants(input.goal, theme);
  const goal = goals[0] ?? "";
  const contextMode = input.contextMode ? theme.fg("dim", "ctx-mode") + " " + theme.fg("muted", input.contextMode) : "";

  const build = (options: { windows: number; resets: boolean; duration: boolean; cwd: boolean; goal: string; contextMode: boolean }) =>
    [
      ...windows.slice(0, options.windows).map((window) => renderUsageWindow(window, theme, options.resets)),
      options.duration ? duration : "",
      options.cwd ? cwd : "",
      git,
      options.goal,
      options.contextMode ? contextMode : "",
    ]
      .filter(Boolean)
      .join(sep);

  const full = { windows: windows.length, resets: true, duration: true, cwd: true, goal, contextMode: true };
  // Drop detail in priority order: Context Mode, cwd, duration, reset times, then quota windows
  // from the last. Git and Goal survive the longest; the Goal counter goes before they do.
  const candidates = [
    build(full),
    build({ ...full, contextMode: false }),
    build({ ...full, contextMode: false, cwd: false }),
    build({ ...full, contextMode: false, cwd: false, duration: false }),
  ];
  for (let count = windows.length; count >= 0; count--) {
    candidates.push(build({ windows: count, resets: false, duration: false, cwd: false, goal, contextMode: false }));
  }
  const shortestGoal = goals[goals.length - 1] ?? "";
  if (shortestGoal !== goal) {
    candidates.push(build({ windows: 0, resets: false, duration: false, cwd: false, goal: shortestGoal, contextMode: false }));
  }
  return fitVariants(width, candidates);
}

export function renderFooter(input: FooterRenderInput): string[] {
  const width = Math.max(1, input.width);
  const lines = [renderFirstLine({ ...input, width })];
  const second = renderSecondLine({ ...input, width });
  if (second) lines.push(second);
  return lines.map((line) => truncateToWidth(line, width));
}
