export interface RateWindow {
  label: string;
  usedPercent: number;
  /** Epoch milliseconds when the window resets, when the provider reports it. */
  resetsAt?: number;
}

export interface UsageSnapshot {
  provider: string;
  windows: RateWindow[];
  error?: string;
  fetchedAt: number;
}

export interface GitCache {
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface CacheUsage {
  read: number;
  write: number;
}
