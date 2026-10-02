/** Clamp a percentage to [0, 100]. Does NOT auto-normalize 0-1 fractions. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Label a quota window from its actual length, e.g. "5h", "8h", "1d", "7d".
 * The fallback is used only when the provider does not report a length.
 */
export function getWindowLabel(durationMs: number | undefined, fallback: string): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return fallback;

  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;

  // Rolling windows rarely align exactly; snap to a week or a day within two hours.
  if (Math.abs(durationMs - weekMs) <= hourMs * 2) return "7d";
  if (Math.abs(durationMs - dayMs) <= hourMs * 2) return "1d";

  const hours = Math.round(durationMs / hourMs);
  if (hours >= 1 && hours < 48) return `${hours}h`;

  const days = Math.round(durationMs / dayMs);
  if (days >= 1) return `${days}d`;

  const mins = Math.max(1, Math.round(durationMs / 60000));
  return `${mins}m`;
}

/** Token counts with one decimal: 950, 424.5k, 1.0M. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${Math.trunc(tokens)}`;
}

/** Elapsed wall-clock time: 42m, 2h03m, 28h04m. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Local reset time: "HH:MM" for windows measured in hours or minutes,
 * "MM/DD HH:MM" for longer or unnamed windows.
 */
export function formatResetClock(resetsAt: number, label: string): string {
  const date = new Date(resetsAt);
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (/^\d+[hm]$/.test(label)) return clock;
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${clock}`;
}
