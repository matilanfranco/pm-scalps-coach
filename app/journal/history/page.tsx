"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { listTradesSince, deleteTrade } from "@/lib/tradesDb";

type Level =
  | "PDH"
  | "PDL"
  | "ASIA_H"
  | "ASIA_L"
  | "LONDON_H"
  | "LONDON_L"
  | "WEEKLY_H"
  | "WEEKLY_L";

type Reaction = "accept" | "absorb" | "unclear";
type OutcomeDb = "win" | "loss" | "be" | "unknown";

type MarketState =
  | "EXPANSION"
  | "DELIVERY_CONDITIONAL"
  | "TRANSITION"
  | "REVERSAL_CONFIRMED"
  | "CHOP_NO_TRADE"
  | "WAIT";

type InvalidationChoice = "micro_m5" | "shift_m15" | "ifvg";
type SetupTag = "A" | "B" | "unknown";
type TargetTag = Level | "HTF" | "NONE";
type TradeSide = "BUY" | "SELL";
type FollowedPlan = "yes" | "no";

type Instrument = "ES" | "NQ";

type TradeEntry = {
  id: string;
  createdAt: number;

  instrument: Instrument;

  liqTaken: "yes" | "no" | "unknown";
  takenLevels: Level[];
  lastTaken: Level | null;
  reaction: Reaction;
  pendingLevels: Level[];
  hasFvg: "yes" | "no" | "skip";
  outcome?: OutcomeDb;

  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  marketState: MarketState;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationChoice: InvalidationChoice | null;
  suggestedTargets: Level[];

  helped: boolean;

  tradeTaken: "yes" | "no";
  tradeTime: string; // HH:MM
  tradeSide: TradeSide;
  followedPlan: FollowedPlan;
  rr: number | null;
  setupTag: SetupTag;
  targetTag: TargetTag;

  note: string;
};

function formatYMD(ms: number) {
  return new Date(ms).toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// function levelLabel(l: Level) {
//   switch (l) {
//     case "PDH":
//       return "PDH";
//     case "PDL":
//       return "PDL";
//     case "ASIA_H":
//       return "Asia High";
//     case "ASIA_L":
//       return "Asia Low";
//     case "LONDON_H":
//       return "London High";
//     case "LONDON_L":
//       return "London Low";
//     case "WEEKLY_H":
//       return "Weekly High";
//     case "WEEKLY_L":
//       return "Weekly Low";
//   }
// }

type OutcomeKey = "all" | "win" | "loss" | "be" | "unknown";

function normalizeOutcome(o: any): "win" | "loss" | "be" | "unknown" {
  if (o === "win" || o === "loss" || o === "be" || o === "unknown") return o;
  if (o === "PROFIT") return "win";
  if (o === "STOP") return "loss";
  if (o === "BE") return "be";
  return "unknown";
}

// ✅ outcomeKey ahora se basa en outcome de DB (y fallback)
function outcomeKey(t: TradeEntry): OutcomeKey {
  const o = normalizeOutcome((t as any).outcome);
  if (o === "win" || o === "loss" || o === "be" || o === "unknown") return o;

  // fallback viejo si algún doc no trae outcome
  if (t.rr == null) return "unknown";
  if (t.rr > 0) return "win";
  if (t.rr < 0) return "loss";
  return "be";
}

function safeNumber(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * ✅ KPIs corregidos:
 * - Winrate: cuenta wins/loss por OUTCOME (no por signo de RR)
 * - NetRR: win suma rr (si null => 0), loss resta -1, BE=0, unknown=0
 * - AvgRR/Expectancy: basado en rrEarned por trade cerrado (win/loss/be)
 */
function computeKPIs(trades: TradeEntry[]) {
  const only = trades.filter((t) => t.tradeTaken === "yes");

  const closed = only
    .map((t) => ({ ...t, out: normalizeOutcome((t as any).outcome) }))
    .filter((t) => t.out === "win" || t.out === "loss" || t.out === "be");

  const winCount = closed.filter((t) => t.out === "win").length;
  const lossCount = closed.filter((t) => t.out === "loss").length;
  const beCount = closed.filter((t) => t.out === "be").length;

  const total = only.length;
  const totalClosed = closed.length;

  const winrate = totalClosed > 0 ? (winCount / (winCount + lossCount)) * 100 : 0;

  // ✅ RR earned: win = rr, loss = -1, be = 0
  const rrEarnedList = closed.map((t) => {
    if (t.out === "win") return safeNumber(t.rr) ?? 0;
    if (t.out === "loss") return -1;
    return 0; // be
  });

  const netRR = rrEarnedList.reduce((a, b) => a + b, 0);
  const avgRR = totalClosed > 0 ? netRR / totalClosed : 0;
  const medRR = median(rrEarnedList);

  const winsRR = rrEarnedList.filter((r, i) => closed[i].out === "win");
  const lossesRR = rrEarnedList.filter((r, i) => closed[i].out === "loss"); // siempre -1
  const avgWin = winsRR.length ? winsRR.reduce((a, b) => a + b, 0) / winsRR.length : 0;
  const avgLoss = lossesRR.length ? lossesRR.reduce((a, b) => a + b, 0) / lossesRR.length : 0; // negativo

  const pWin = totalClosed > 0 ? winCount / totalClosed : 0;
  const pLoss = totalClosed > 0 ? lossCount / totalClosed : 0;
  const expectancy = pWin * avgWin + pLoss * avgLoss;

  const sumWins = winsRR.reduce((a, b) => a + b, 0);
  const sumLossAbs = Math.abs(lossesRR.reduce((a, b) => a + b, 0)); // abs de negativos
  const profitFactor = sumLossAbs > 0 ? sumWins / sumLossAbs : sumWins > 0 ? Infinity : 0;

  // streaks (por outcome)
  let bestWinStreak = 0;
  let bestLossStreak = 0;
  let curW = 0;
  let curL = 0;

  for (const t of only) {
    const k = outcomeKey(t);
    if (k === "win") {
      curW += 1;
      curL = 0;
    } else if (k === "loss") {
      curL += 1;
      curW = 0;
    } else {
      curW = 0;
      curL = 0;
    }
    bestWinStreak = Math.max(bestWinStreak, curW);
    bestLossStreak = Math.max(bestLossStreak, curL);
  }

  return {
    total,
    totalWithRR: totalClosed, // ahora significa "cerrados"
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

function downloadTextFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSVRow(values: (string | number | null | undefined)[]) {
  return values
    .map((v) => {
      const s = v == null ? "" : String(v);
      const escaped = s.replaceAll('"', '""');
      return `"${escaped}"`;
    })
    .join(",");
}

function useIsMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < bp);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);

  return isMobile;
}

function exportTradesCSV(trades: TradeEntry[], filename: string) {
  const header = [
    "id",
    "createdAt",
    "day",
    "tradeTime",
    "instrument",
    "tradeSide",
    "rr",
    "outcome",
    "followedPlan",
    "setupTag",
    "targetTag",
    "biasShown",
    "marketState",
    "liqTaken",
    "reaction",
    "pendingCount",
    "note",
  ];

  const rows = trades.map((t) =>
    toCSVRow([
      t.id,
      t.createdAt,
      formatYMD(t.createdAt),
      t.tradeTime,
      t.instrument,
      t.tradeSide,
      t.rr,
      outcomeKey(t),
      t.followedPlan,
      t.setupTag,
      t.targetTag,
      t.biasShown,
      t.marketState,
      t.liqTaken,
      t.reaction,
      t.pendingLevels?.length ?? 0,
      t.note ?? "",
    ])
  );

  const csv = [toCSVRow(header), ...rows].join("\n");
  downloadTextFile(filename, csv, "text/csv");
}

function startOfDayMs(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime();
}
function endOfDayMs(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).getTime();
}

function rrTone(rr: number | null) {
  if (rr == null) return "muted" as const;
  if (rr > 0) return "good" as const;
  if (rr < 0) return "danger" as const;
  return "warn" as const;
}

function outcomeBadge(t: TradeEntry) {
  const k = outcomeKey(t);
  if (k === "win") return { text: "✅ Win", tone: "good" as const };
  if (k === "loss") return { text: "❌ Loss", tone: "danger" as const };
  if (k === "be") return { text: "◻︎ BE", tone: "warn" as const };
  return { text: "—", tone: "muted" as const };
}

function tonePill(tone: "good" | "danger" | "warn" | "muted") {
  switch (tone) {
    case "good":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]";
    case "danger":
      return "border-red-400/30 bg-red-500/10 text-red-100 shadow-[0_0_0_1px_rgba(248,113,113,0.12)]";
    case "warn":
      return "border-amber-400/30 bg-amber-500/10 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.10)]";
    default:
      return "border-white/12 bg-white/5 text-white/75";
  }
}

function sidePill(side: TradeSide) {
  return side === "BUY"
    ? "border-sky-400/30 bg-sky-500/10 text-sky-100 shadow-[0_0_0_1px_rgba(56,189,248,0.10)]"
    : "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100 shadow-[0_0_0_1px_rgba(232,121,249,0.10)]";
}

function chip(s: string, variant: "muted" | "good" | "danger" | "warn" = "muted") {
  const base = "rounded-full border px-3 py-1 text-xs font-extrabold whitespace-nowrap";
  const cls = tonePill(
    variant === "good" ? "good" : variant === "danger" ? "danger" : variant === "warn" ? "warn" : "muted"
  );
  return <span className={`${base} ${cls}`}>{s}</span>;
}

type Weekday = "ALL" | "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes";

function weekdayEsFromMs(ms: number): Weekday {
  const d = new Date(ms).getDay(); // 0 dom .. 6 sáb
  if (d === 1) return "Lunes";
  if (d === 2) return "Martes";
  if (d === 3) return "Miércoles";
  if (d === 4) return "Jueves";
  if (d === 5) return "Viernes";
  return "ALL";
}

export default function HistoryPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  // ✅ no returns antes de hooks
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [allTrades, setAllTrades] = useState<TradeEntry[]>([]);

  // Filters
  const [fOutcome, setFOutcome] = useState<OutcomeKey>("all");
  const [fSide, setFSide] = useState<"all" | TradeSide>("all");
  const [fPlan, setFPlan] = useState<"all" | FollowedPlan>("all");
  const [fSetup, setFSetup] = useState<"all" | SetupTag>("all");
  const [fBias, setFBias] = useState<"all" | TradeEntry["biasShown"]>("all");
  const [fState, setFState] = useState<"all" | MarketState>("all");
  const [fTarget, setFTarget] = useState<"all" | TargetTag>("all");
  const [fWeekday, setFWeekday] = useState<Weekday>("ALL");

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [q, setQ] = useState("");

  const [pageSize, setPageSize] = useState<number>(15);
  const [page, setPage] = useState<number>(1);

  const [userId, setUserId] = useState<string | null>(null);

  const LS_KEY = "trades_cache_v1";
  const LS_LAST = "trades_lastFetchedAt_v1";

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    // 1) render rápido desde cache
    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setAllTrades(parsed);
      } catch {}
    }

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;
        if (!uid) return;
        setUserId(uid);

        const userId = uid;

        const last = Number(localStorage.getItem(LS_LAST) || "0") || 0;

        // 2) traer SOLO nuevos
        const newTrades = await listTradesSince(userId, last, 500);

        if (!alive) return;

        // 3) merge por id (evita duplicados)
        setAllTrades((prev) => {
          const map = new Map<string, any>();
          [...newTrades, ...prev].forEach((t) => map.set(t.id, t));

          // ✅ aseguramos instrument default si alguno viene sin eso
          const merged = Array.from(map.values())
            .map((t) => ({ ...t, instrument: (t.instrument === "ES" || t.instrument === "NQ") ? t.instrument : "ES" }))
            .sort((a, b) => a.createdAt - b.createdAt);

          localStorage.setItem(LS_KEY, JSON.stringify(merged));

          const newest = merged[merged.length - 1]?.createdAt ?? last;
          localStorage.setItem(LS_LAST, String(newest));

          return merged;
        });
      } catch (e) {
        console.error("History load failed:", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [supabase]);

  useEffect(() => {
    setPage(1);
  }, [fOutcome, fSide, fPlan, fSetup, fBias, fState, fTarget, fWeekday, from, to, q, pageSize]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const fromMs = from ? startOfDayMs(from) : null;
    const toMs = to ? endOfDayMs(to) : null;

    const base = allTrades.filter((t) => {
      if (fromMs != null && t.createdAt < fromMs) return false;
      if (toMs != null && t.createdAt > toMs) return false;

      if (fWeekday !== "ALL") {
        if (weekdayEsFromMs(t.createdAt) !== fWeekday) return false;
      }

      if (fOutcome !== "all" && outcomeKey(t) !== fOutcome) return false;
      if (fSide !== "all" && t.tradeSide !== fSide) return false;
      if (fPlan !== "all" && t.followedPlan !== fPlan) return false;
      if (fSetup !== "all" && t.setupTag !== fSetup) return false;
      if (fBias !== "all" && t.biasShown !== fBias) return false;
      if (fState !== "all" && t.marketState !== fState) return false;
      if (fTarget !== "all" && t.targetTag !== fTarget) return false;

      if (query) {
        const blob = [
          t.note ?? "",
          t.marketState ?? "",
          t.biasShown ?? "",
          t.instrument ?? "",
          t.targetTag ?? "",
          t.setupTag ?? "",
          t.tradeTime ?? "",
          t.tradeSide ?? "",
          t.followedPlan ?? "",
          t.reaction ?? "",
          t.liqTaken ?? "",
        ]
          .join(" ")
          .toLowerCase();

        if (!blob.includes(query)) return false;
      }

      return true;
    });

    base.sort((a, b) => a.createdAt - b.createdAt); // oldest -> newest
    return base;
  }, [allTrades, fOutcome, fSide, fPlan, fSetup, fBias, fState, fTarget, fWeekday, from, to, q]);

  const kpisAll = useMemo(() => computeKPIs(allTrades), [allTrades]);
  const kpisFiltered = useMemo(() => computeKPIs(filtered), [filtered]);

  const last7 = useMemo(() => {
    const newest = [...filtered].sort((a, b) => b.createdAt - a.createdAt).slice(0, 7);

    // ✅ netRR last7 con regla nueva (loss=-1)
    const netRR = newest.reduce((acc, t) => {
      const o = normalizeOutcome((t as any).outcome);
      if (o === "win") return acc + (safeNumber(t.rr) ?? 0);
      if (o === "loss") return acc - 1;
      if (o === "be") return acc + 0;
      return acc;
    }, 0);

    return { count: newest.length, netRR };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (pageSafe - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageSafe, pageSize]);

  // UI classes
  const panel =
    "mt-5 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 shadow-[0_18px_40px_rgba(0,0,0,0.45)]";
  const pillBtn =
    "h-9 rounded-full border cursor-pointer border-white/12 bg-white/[0.03] px-3 text-xs font-extrabold text-white/75 hover:bg-white/[0.06] hover:border-white/20 transition";
  const pillOn = "border-white/25 bg-white/[0.07] text-white";
  const input =
    "h-9 rounded-xl border border-white/12 bg-white/[0.03] px-2 text-xs font-extrabold text-white outline-none placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.05] transition";

  const kpiCard =
    "rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.03] p-4 shadow-[0_14px_30px_rgba(0,0,0,0.38)]";

  function resetFilters() {
    setFOutcome("all");
    setFSide("all");
    setFPlan("all");
    setFSetup("all");
    setFBias("all");
    setFState("all");
    setFTarget("all");
    setFWeekday("ALL");
    setFrom("");
    setTo("");
    setQ("");
    setPageSize(15);
    setPage(1);
  }

  async function handleDeleteTrade(e: React.MouseEvent, t: TradeEntry) {
  e.stopPropagation();

  if (!userId) {
    alert("No hay sesión activa.");
    return;
  }

  const ok = window.confirm(
    `¿Estás seguro que querés borrar este trade?\n\n${formatYMD(t.createdAt)} ${t.tradeTime || ""} · ${t.instrument} · ${t.tradeSide}`
  );
  if (!ok) return;

  try {
    await deleteTrade(userId, t.id);

    // ✅ sacarlo del state
    setAllTrades((prev) => {
      const next = prev.filter((x) => x.id !== t.id);
      localStorage.setItem(LS_KEY, JSON.stringify(next));

      // ✅ recomputar LS_LAST (el más nuevo que queda)
      const newest = next[next.length - 1]?.createdAt ?? 0;
      localStorage.setItem(LS_LAST, String(newest));

      return next;
    });
  } catch (err) {
    console.error("Delete failed:", err);
    alert("No se pudo borrar el trade.");
  }
}

  if (!supabase) {
    return <div className="min-h-screen bg-neutral-950 text-white p-6">Supabase no configurado.</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-extrabold tracking-[0.18em] text-white/55">JOURNAL</div>
            <h1 className="mt-2 text-3xl font-black">History</h1>
            <div className="mt-2 text-sm text-white/65">Lista de trades. Click en la fila para ver la descripción.</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={pillBtn}
              onClick={() => exportTradesCSV(allTrades, "pm-scalps-trades_ALL.csv")}
              title="Exporta TODO (sin filtros)"
            >
              Export ALL CSV
            </button>

            <button
              className={pillBtn}
              onClick={() => exportTradesCSV(filtered, "pm-scalps-trades_FILTERED.csv")}
              title="Exporta lo filtrado"
            >
              Export FILTERED CSV
            </button>

            <button className={pillBtn} onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className={kpiCard}>
            <div className="text-xs font-extrabold text-white/55">TOTAL TRADES</div>
            <div className="mt-2 flex items-end gap-2">
              <div className="text-3xl font-black">{kpisAll.total}</div>
            </div>
            <div className="mt-2 text-sm text-white/70">
              Closed: <b className="text-white/90">{kpisAll.totalWithRR}</b>
            </div>
          </div>

          <div className={kpiCard}>
            <div className="text-xs font-extrabold text-white/55">WINRATE (cerrados)</div>
            <div className="mt-2 text-3xl font-black">{kpisFiltered.winrate.toFixed(1)}%</div>
            <div className="mt-2 text-sm text-white/70">
              W <b className="text-white/90">{kpisFiltered.winCount}</b> · L{" "}
              <b className="text-white/90">{kpisFiltered.lossCount}</b> · BE{" "}
              <b className="text-white/90">{kpisFiltered.beCount}</b>
            </div>
          </div>

          <div className={kpiCard}>
            <div className="text-xs font-extrabold text-white/55">NET RR / MEDIAN RR</div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-3xl font-black">{kpisFiltered.netRR.toFixed(2)}</div>
              <div className="text-sm text-white/60">
                median <b className="text-white/90">{kpisFiltered.medRR.toFixed(2)}</b>
              </div>
            </div>
            <div className="mt-2 text-sm text-white/70">
              Last 7: <b className="text-white/90">{last7.netRR.toFixed(2)} RR</b>
            </div>
          </div>

          <div className={kpiCard}>
            <div className="text-xs font-extrabold text-white/55">AVG RR / EXPECTANCY</div>
            <div className="mt-2 text-3xl font-black">{kpisFiltered.avgRR.toFixed(2)}</div>
            <div className="mt-2 text-sm text-white/70">
              Exp/trade: <b className="text-white/90">{kpisFiltered.expectancy.toFixed(2)}</b> · PF{" "}
              <b className="text-white/90">
                {kpisFiltered.profitFactor === Infinity ? "∞" : kpisFiltered.profitFactor.toFixed(2)}
              </b>
            </div>
            <div className="mt-1 text-sm text-white/70">
              Streaks: W <b className="text-white/90">{kpisFiltered.bestWinStreak}</b> · L{" "}
              <b className="text-white/90">{kpisFiltered.bestLossStreak}</b>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className={panel}>
          <div className="text-xs font-extrabold tracking-[0.16em] text-white/55">FILTROS</div>

          <div className="mt-3 flex flex-wrap items-start md:items-center gap-2">
            {/* Outcome */}
            <button onClick={() => setFOutcome("win")} className={[pillBtn, fOutcome === "win" ? pillOn : ""].join(" ")}>
              ✅ Wins
            </button>

            <button
              onClick={() => setFOutcome("loss")}
              className={[pillBtn, fOutcome === "loss" ? pillOn : ""].join(" ")}
            >
              ❌ Losses
            </button>

            <button onClick={() => setFOutcome("be")} className={[pillBtn, fOutcome === "be" ? pillOn : ""].join(" ")}>
              ◻︎ BE
            </button>

            <button onClick={() => setFOutcome("all")} className={[pillBtn, fOutcome === "all" ? pillOn : ""].join(" ")}>
              All
            </button>

            <div className="mx-2 h-6 w-px bg-white/10" />

            {/* Side */}
            <button onClick={() => setFSide("BUY")} className={[pillBtn, fSide === "BUY" ? pillOn : ""].join(" ")}>
              BUY
            </button>

            <button onClick={() => setFSide("SELL")} className={[pillBtn, fSide === "SELL" ? pillOn : ""].join(" ")}>
              SELL
            </button>

            <button onClick={() => setFSide("all")} className={[pillBtn, fSide === "all" ? pillOn : ""].join(" ")}>
              Buy+Sell
            </button>

            <div className="mx-2 h-6 w-px bg-white/10" />

            {/* Weekday */}
            <select
              value={fWeekday}
              onChange={(e) => setFWeekday(e.target.value as Weekday)}
              className={input}
              title="Filtrar por día de la semana"
            >
              <option value="ALL">Selecciona el día</option>
              <option value="Lunes">Lunes</option>
              <option value="Martes">Martes</option>
              <option value="Miércoles">Miércoles</option>
              <option value="Jueves">Jueves</option>
              <option value="Viernes">Viernes</option>
            </select>

            <div className="mx-2 h-6 w-px bg-white/10" />

            {/* Dates */}
            <div className="flex items-center gap-2">
              <div className="text-xs font-extrabold text-white/55">From</div>
              <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className={input} />
              <div className="text-xs font-extrabold text-white/55">To</div>
              <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className={input} />
            </div>

            <button
              onClick={() => {
                setFOutcome("all");
                setFSide("all");
                setFWeekday("ALL");
                setFrom("");
                setTo("");
              }}
              className="ml-auto px-2 py-2 rounded-xl text-xs font-extrabold border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition"
              title="Clear"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Table/List */}
        <div className={panel}>
          {isMobile ? (
            <div className="grid gap-3">
              {pageItems.length === 0 ? (
                <div className="py-6 text-white/60">No hay trades con esos filtros.</div>
              ) : (
                pageItems.map((t, idx) => {
                  const globalIndex = (pageSafe - 1) * pageSize + idx + 1;
                  const d = formatYMD(t.createdAt);
                  const oc = outcomeBadge(t);

                  return (
                    <button
                      key={t.id}
                      onClick={() => router.push(`/journal/history/${t.id}`)}
                      className="relative text-left rounded-2xl border border-white/10 bg-white/3 p-4 active:scale-[0.99] transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-extrabold text-white/50">
                          #{globalIndex} · {d} · {t.tradeTime || "—"}
                        </div>

                        <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${sidePill(t.tradeSide)}`}>
                          {t.tradeSide}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${tonePill(oc.tone)}`}>
                          {oc.text}
                        </span>

                        <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${tonePill(rrTone(t.rr))}`}>
                          RR {t.rr == null ? "—" : t.rr.toFixed(2)}
                        </span>

                        {chip(`Instr: ${t.instrument}`, "muted")}
                        {t.followedPlan === "yes" ? chip("Plan: Sí", "good") : chip("Plan: No", "danger")}
                        {t.setupTag === "A"
                          ? chip("Setup A", "good")
                          : t.setupTag === "B"
                          ? chip("Setup B", "warn")
                          : chip("Setup —")}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {chip(t.biasShown, t.biasShown === "LONG" ? "good" : t.biasShown === "SHORT" ? "danger" : "muted")}
                        {chip(
                          t.marketState,
                          t.marketState === "EXPANSION"
                            ? "good"
                            : t.marketState === "TRANSITION"
                            ? "danger"
                            : t.marketState === "DELIVERY_CONDITIONAL"
                            ? "warn"
                            : "muted"
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteTrade(e, t)}
                        className="absolute top-3 right-3 h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition"
                        title="Borrar trade"
                        aria-label="Borrar trade"
                      >
                        ✕
                      </button>

                      {t.note?.trim() ? (
                        <div className="mt-3 text-sm text-white/70 line-clamp-2">{t.note.trim()}</div>
                      ) : (
                        <div className="mt-3 text-sm text-white/40">Sin nota.</div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-260 text-left">
                <thead>
                  <tr className="text-xs font-extrabold text-white/55">
                    <th className="py-3 pr-4">#</th>
                    <th className="py-3 pr-4">Día</th>
                    <th className="py-3 pr-4">Hora</th>
                    <th className="py-3 pr-4">Instrumento</th>
                    <th className="py-3 pr-4">Dirección</th>
                    <th className="py-3 pr-4">Resultado</th>
                    <th className="py-3 pr-4">RR</th>
                    <th className="py-3 pr-4">Plan</th>
                    <th className="py-3 pr-4">Setup</th>
                    <th className="py-3 pr-4">Bias</th>
                    <th className="py-3 pr-4">Estado del mercado</th>
                    <th className="py-3 pr-2 text-right">🗑</th>
                  </tr>
                </thead>

                <tbody className="text-sm">
                  {pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-6 text-white/60">
                        No hay trades con esos filtros.
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((t, idx) => {
                      const globalIndex = (pageSafe - 1) * pageSize + idx + 1;
                      const d = formatYMD(t.createdAt);
                      const oc = outcomeBadge(t);

                      return (
                        <tr
                          key={t.id}
                          onClick={() => router.push(`/journal/history/${t.id}`)}
                          className="border-t border-white/10 transition cursor-pointer hover:bg-white/4 hover:border-white/15"
                        >
                          <td className="py-3 pr-4">
                            <Link
                              href={`/journal/history/${t.id}`}
                              className="font-extrabold underline decoration-white/15 hover:decoration-white/70"
                              onClick={(e) => e.stopPropagation()}
                              title="Abrir detalle"
                            >
                              {globalIndex}
                            </Link>
                          </td>

                          <td className="py-3 pr-4 text-white/85">{d}</td>
                          <td className="py-3 pr-4 text-white/85">{t.tradeTime || "—"}</td>

                          <td className="py-3 pr-4 font-extrabold text-white/90">{t.instrument}</td>

                          <td className="py-3 pr-4">
                            <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${sidePill(t.tradeSide)}`}>
                              {t.tradeSide}
                            </span>
                          </td>

                          <td className="py-3 pr-4">
                            <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${tonePill(oc.tone)}`}>
                              {oc.text}
                            </span>
                          </td>

                          <td className="py-3 pr-4">
                            <span
                              className={["rounded-full border px-3 py-1 text-xs font-black", tonePill(rrTone(t.rr))].join(" ")}
                              title="RR del trade"
                            >
                              {t.rr == null ? "—" : t.rr.toFixed(2)}
                            </span>
                          </td>

                          <td className="py-3 pr-4">{t.followedPlan === "yes" ? chip("Sí", "good") : chip("No", "danger")}</td>

                          <td className="py-3 pr-4">
                            {t.setupTag === "A"
                              ? chip("Setup A", "good")
                              : t.setupTag === "B"
                              ? chip("Setup B", "warn")
                              : chip("Setup —")}
                          </td>

                          <td className="py-3 pr-4">
                            {chip(t.biasShown, t.biasShown === "LONG" ? "good" : t.biasShown === "SHORT" ? "danger" : "muted")}
                          </td>

                          <td className="py-3 pr-4">
                            {chip(
                              t.marketState,
                              t.marketState === "EXPANSION"
                                ? "good"
                                : t.marketState === "TRANSITION"
                                ? "danger"
                                : t.marketState === "DELIVERY_CONDITIONAL"
                                ? "warn"
                                : "muted"
                            )}
                          </td>
                          <td className="py-3 pr-2 text-right">
                            <button
                              type="button"
                              onClick={(e) => handleDeleteTrade(e, t)}
                              className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition"
                              title="Borrar trade"
                              aria-label="Borrar trade"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className={pillBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageSafe <= 1}
              style={{ opacity: pageSafe <= 1 ? 0.5 : 1 }}
            >
              ← Prev
            </button>

            <div className="text-sm text-white/65">
              Page <b className="text-white/90">{pageSafe}</b> / <b className="text-white/90">{totalPages}</b>
            </div>

            <button
              className={pillBtn}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageSafe >= totalPages}
              style={{ opacity: pageSafe >= totalPages ? 0.5 : 1 }}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}