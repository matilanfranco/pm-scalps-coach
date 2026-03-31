// lib/helpers.ts

import type {
  Level,
  Side,
  OutcomeDb,
  OutcomeForm,
  TradeEntry,
} from "./types";

// ─── Levels ───────────────────────────────────────────────

export function levelLabel(l: Level): string {
  switch (l) {
    case "PDH":      return "PDH";
    case "PDL":      return "PDL";
    case "ASIA_H":   return "Asia High";
    case "ASIA_L":   return "Asia Low";
    case "LONDON_H": return "London High";
    case "LONDON_L": return "London Low";
    case "WEEKLY_H": return "Weekly High";
    case "WEEKLY_L": return "Weekly Low";
  }
}

export function levelSide(l: Level): Side {
  return l === "PDH" || l === "ASIA_H" || l === "LONDON_H" || l === "WEEKLY_H"
    ? "buyside"
    : "sellside";
}

export function formatSide(s: Side): string {
  return s === "buyside" ? "buy-side" : "sell-side";
}

// ─── Fecha / Hora ─────────────────────────────────────────

export function getTodayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatYMD(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayLabel(ms: number): string {
  const d = new Date(ms).getDay();
  return ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][d];
}

export function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());
}

export function startOfDayMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function endOfDayMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function buildTimestamp(date: string, time: string): number {
  if (!date) return Date.now();
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (time && isValidHHMM(time)) {
    const [hh, mm] = time.split(":").map(Number);
    dt.setHours(hh, mm, 0, 0);
  }
  return dt.getTime();
}

// ─── Outcome ──────────────────────────────────────────────

export function normalizeOutcome(o: any): OutcomeDb {
  if (o === "win" || o === "loss" || o === "be" || o === "unknown") return o;
  if (o === "PROFIT") return "win";
  if (o === "STOP")   return "loss";
  if (o === "BE")     return "be";
  return "unknown";
}

export function outcomeFormToDb(o: OutcomeForm): OutcomeDb {
  switch (o) {
    case "PROFIT": return "win";
    case "STOP":   return "loss";
    case "BE":     return "be";
    default:       return "unknown";
  }
}

export function outcomeKey(t: TradeEntry): OutcomeDb {
  return normalizeOutcome(t.outcome);
}

// ─── Tones / estilos ──────────────────────────────────────

export type Tone = "good" | "danger" | "warn" | "muted";

export function toneToClasses(tone: Tone): string {
  switch (tone) {
    case "good":   return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "danger": return "border-red-400/40 bg-red-500/10 text-red-100";
    case "warn":   return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    default:       return "border-slate-300/20 bg-white/5 text-slate-100";
  }
}

export function tonePill(tone: Tone): string {
  switch (tone) {
    case "good":   return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
    case "danger": return "border-red-400/30 bg-red-500/10 text-red-100";
    case "warn":   return "border-amber-400/30 bg-amber-500/10 text-amber-100";
    default:       return "border-white/12 bg-white/5 text-white/75";
  }
}

export function rrTone(rr: number | null): Tone {
  if (rr == null) return "muted";
  if (rr > 0)     return "good";
  if (rr < 0)     return "danger";
  return "warn";
}

export function outcomeBadge(t: TradeEntry): { text: string; tone: Tone } {
  const k = outcomeKey(t);
  if (k === "win")  return { text: "✅ Win",  tone: "good"   };
  if (k === "loss") return { text: "❌ Loss", tone: "danger" };
  if (k === "be")   return { text: "◻︎ BE",  tone: "warn"   };
  return { text: "—", tone: "muted" };
}

export function chipTone(l: Level): string {
  return levelSide(l) === "buyside"
    ? "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15"
    : "border-red-400/40 bg-red-500/10 hover:bg-red-500/15";
}

export function sidePill(side: "BUY" | "SELL"): string {
  return side === "BUY"
    ? "border-sky-400/30 bg-sky-500/10 text-sky-100"
    : "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100";
}

// ─── Números ──────────────────────────────────────────────

export function safeNumber(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function parseRR(raw: string): number | null {
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// ─── KPIs ─────────────────────────────────────────────────

export function computeKPIs(trades: TradeEntry[]) {
  const only = trades.filter((t) => t.tradeTaken === "yes");

  const closed = only
    .map((t) => ({ ...t, out: normalizeOutcome(t.outcome) }))
    .filter((t) => t.out === "win" || t.out === "loss" || t.out === "be");

  const winCount  = closed.filter((t) => t.out === "win").length;
  const lossCount = closed.filter((t) => t.out === "loss").length;
  const beCount   = closed.filter((t) => t.out === "be").length;

  const total       = only.length;
  const totalClosed = closed.length;

  const winrate = totalClosed > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;

  const rrEarnedList = closed.map((t) => {
    if (t.out === "win")  return safeNumber(t.rr) ?? 0;
    if (t.out === "loss") return -1;
    return 0;
  });

  const netRR = rrEarnedList.reduce((a, b) => a + b, 0);
  const avgRR = totalClosed > 0 ? netRR / totalClosed : 0;
  const medRR = median(rrEarnedList);

  const winsRR   = rrEarnedList.filter((_, i) => closed[i].out === "win");
  const lossesRR = rrEarnedList.filter((_, i) => closed[i].out === "loss");

  const avgWin  = winsRR.length   ? winsRR.reduce((a, b) => a + b, 0)   / winsRR.length   : 0;
  const avgLoss = lossesRR.length ? lossesRR.reduce((a, b) => a + b, 0) / lossesRR.length : 0;

  const pWin  = totalClosed > 0 ? winCount  / totalClosed : 0;
  const pLoss = totalClosed > 0 ? lossCount / totalClosed : 0;
  const expectancy = pWin * avgWin + pLoss * avgLoss;

  const sumWins    = winsRR.reduce((a, b) => a + b, 0);
  const sumLossAbs = Math.abs(lossesRR.reduce((a, b) => a + b, 0));
  const profitFactor =
    sumLossAbs > 0 ? sumWins / sumLossAbs : sumWins > 0 ? Infinity : 0;

  let bestWinStreak = 0, bestLossStreak = 0, curW = 0, curL = 0;
  for (const t of only) {
    const k = outcomeKey(t);
    if (k === "win")       { curW += 1; curL = 0; }
    else if (k === "loss") { curL += 1; curW = 0; }
    else                   { curW = 0;  curL = 0; }
    bestWinStreak  = Math.max(bestWinStreak,  curW);
    bestLossStreak = Math.max(bestLossStreak, curL);
  }

  return {
    total,
    totalWithRR: totalClosed,
    winCount,
    lossCount,
    beCount,
    winrate,
    avgRR,
    medRR,
    netRR,
    expectancy,
    profitFactor,
    bestWinStreak,
    bestLossStreak,
  };
}