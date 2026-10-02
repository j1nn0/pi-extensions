import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokenCount } from "./format.ts";
import type { ContextInfo, GitCache, RateWindow, UsageSnapshot } from "./types.ts";

export const CTX_GAUGE_WIDTH = 12;
export const BAR_FILLED = "━";
export const BAR_EMPTY = "─";

export function fitFooterSegment(width: number, variants: string[]): string {
  const safeWidth = Math.max(1, width);

  for (const variant of variants) {
    if (visibleWidth(variant) <= safeWidth) return variant;
  }

  return truncateToWidth(variants[variants.length - 1] || "", safeWidth);
}

export function wrapFooterSegments(segments: string[], width: number, sep: string): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];
  let current = "";

  for (const segment of segments.filter(Boolean)) {
    const fitted = truncateToWidth(segment, safeWidth);

    if (!current) {
      current = fitted;
      continue;
    }

    const candidate = current + sep + fitted;
    if (visibleWidth(candidate) <= safeWidth) {
      current = candidate;
      continue;
    }

    lines.push(truncateToWidth(current, safeWidth));
    current = fitted;
  }

  if (current) lines.push(truncateToWidth(current, safeWidth));
  return lines;
}

export function renderContextGauge(
  percentage: number,
  theme: Theme,
  used?: number,
  total?: number,
  options?: { barWidth?: number; includeCounts?: boolean }
): string {
  const barWidth = Math.max(4, options?.barWidth ?? CTX_GAUGE_WIDTH);
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = barWidth - filled;

  let color: ThemeColor;
  if (clamped >= 90) color = "error";
  else if (clamped >= 70) color = "warning";
  else if (clamped >= 50) color = "accent";
  else color = "success";

  const bar = theme.fg(color, BAR_FILLED.repeat(filled)) + theme.fg("dim", BAR_EMPTY.repeat(empty));
  const pct = `${Math.round(clamped)}%`;
  const counts =
    options?.includeCounts === false || used === undefined || !total
      ? ""
      : ` ${formatTokenCount(used)}/${formatTokenCount(total)}`;

  return theme.fg("dim", "ctx ") + bar + " " + theme.fg("dim", pct + counts);
}

export function renderUsageBar(usedPercent: number, barWidth: number, theme: Theme): string {
  const clamped = Math.max(0, Math.min(100, usedPercent));
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = barWidth - filled;

  let color: ThemeColor;
  if (clamped >= 92) color = "error";
  else if (clamped >= 85) color = "warning";
  else color = "success";

  return theme.fg(color, BAR_FILLED.repeat(filled)) + theme.fg("dim", BAR_EMPTY.repeat(empty));
}

export function renderUsageWindow(
  window: RateWindow,
  theme: Theme,
  options?: { barWidth?: number; includeReset?: boolean }
): string {
  const dim = (s: string) => theme.fg("dim", s);
  const bar = renderUsageBar(window.usedPercent, Math.max(4, options?.barWidth ?? 10), theme);
  const pct = dim(`${Math.round(window.usedPercent)}%`);
  const timeStr = options?.includeReset === false || !window.resetsIn ? "" : " " + dim(window.resetsIn);
  return `${dim(window.label)} ${bar} ${pct}${timeStr}`;
}

export function renderUsageLine(usage: UsageSnapshot, width: number, theme: Theme): string[] {
  if (!usage.windows.length) return [];

  const dim = (s: string) => theme.fg("dim", s);
  const sep = " " + dim(">") + " ";
  const segments: string[] = [theme.fg("accent", usage.provider)];

  for (const w of usage.windows) {
    segments.push(
      fitFooterSegment(width, [
        renderUsageWindow(w, theme, { barWidth: 10, includeReset: true }),
        renderUsageWindow(w, theme, { barWidth: 8, includeReset: true }),
        renderUsageWindow(w, theme, { barWidth: 8, includeReset: false }),
        renderUsageWindow(w, theme, { barWidth: 6, includeReset: false }),
        renderUsageWindow(w, theme, { barWidth: 4, includeReset: false }),
      ])
    );
  }

  return wrapFooterSegments(segments, width, sep);
}

export interface FooterModel {
  provider: string;
  id: string;
  reasoning?: boolean;
}

export interface FooterRenderInput {
  width: number;
  cwd: string;
  home: string | undefined;
  gitCache: GitCache | null;
  showCwd: boolean;
  showBranch: boolean;
  showProvider: boolean;
  model: FooterModel | null | undefined;
  thinkingLevel: string;
  contextInfo: ContextInfo;
  latestUsage: UsageSnapshot | null;
  theme: Theme;
}

export function renderFooterStatusLine({
  width,
  cwd,
  home,
  gitCache,
  showCwd,
  showBranch,
  showProvider,
  model,
  thinkingLevel,
  contextInfo,
  latestUsage,
  theme,
}: FooterRenderInput): string[] {
  const { percentage, used: ctxUsed, total: ctxTotal } = contextInfo;

  // Build parts for status line
  let pwd = cwd;
  if (home && pwd.startsWith(home)) {
    pwd = `~${pwd.slice(home.length)}`;
  }

  let branchStr = "";
  if (showBranch && gitCache?.branch) {
    const branchColor: ThemeColor = gitCache.dirty ? "warning" : "success";
    branchStr = theme.fg(branchColor, gitCache.branch);
    if (gitCache.dirty) branchStr += theme.fg("warning", " *");
    if (gitCache.ahead) branchStr += theme.fg("success", ` ↑${gitCache.ahead}`);
    if (gitCache.behind) branchStr += theme.fg("error", ` ↓${gitCache.behind}`);
  }

  // Model + thinking
  const modelName = model
    ? showProvider
      ? `${model.provider}/${model.id}`
      : model.id.split("/").pop() || "no-model"
    : "no-model";
  const plainModelStr = theme.fg("muted", modelName);
  let modelStr = plainModelStr;
  if (model?.reasoning) {
    if (thinkingLevel !== "off") {
      modelStr += " " + theme.fg("dim", ">") + " " + theme.fg("accent", thinkingLevel);
    }
  }

  const sep = " " + theme.fg("dim", ">") + " ";
  const lines: string[] = [];

  const pwdStr = showCwd ? theme.fg("accent", pwd) : "";
  const locationVariants: string[] = [];
  if (pwdStr && branchStr) locationVariants.push(pwdStr + sep + branchStr);
  if (pwdStr) locationVariants.push(pwdStr);
  if (branchStr) locationVariants.push(branchStr);
  const locationBlock = locationVariants.length > 0 ? fitFooterSegment(width, locationVariants) : "";

  const statusBlocks = [
    locationBlock,
    fitFooterSegment(width, modelStr === plainModelStr ? [plainModelStr] : [modelStr, plainModelStr]),
    fitFooterSegment(width, [
      renderContextGauge(percentage, theme, ctxUsed, ctxTotal, {
        barWidth: CTX_GAUGE_WIDTH,
        includeCounts: true,
      }),
      renderContextGauge(percentage, theme, ctxUsed, ctxTotal, {
        barWidth: 10,
        includeCounts: false,
      }),
      renderContextGauge(percentage, theme, ctxUsed, ctxTotal, {
        barWidth: 8,
        includeCounts: false,
      }),
      renderContextGauge(percentage, theme, ctxUsed, ctxTotal, {
        barWidth: 6,
        includeCounts: false,
      }),
      renderContextGauge(percentage, theme, ctxUsed, ctxTotal, {
        barWidth: 4,
        includeCounts: false,
      }),
    ]),
  ];

  lines.push(...wrapFooterSegments(statusBlocks, width, sep));

  if (latestUsage && latestUsage.windows.length > 0) {
    lines.push(...renderUsageLine(latestUsage, width, theme));
  }

  return lines.map((line) => truncateToWidth(line, width));
}

