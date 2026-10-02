export interface RateWindow {
  label: string;
  usedPercent: number;
  resetsIn?: string;
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

export interface ContextInfo {
  percentage: number;
  used: number;
  total: number;
}
