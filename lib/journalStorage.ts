export const LS_TRADES_KEY = "pm_scalps_trades_v1";
export const LS_DAILY_KEY = "pm_scalps_daily_v1";
export const LS_DRAFT_KEY = "pm_scalps_draft_v0";

export function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadTrades<T = any>(): T[] {
  if (typeof window === "undefined") return [];
  return safeJsonParse<T[]>(localStorage.getItem(LS_TRADES_KEY), []);
}