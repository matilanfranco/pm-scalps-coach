"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { listTradesSince, deleteTrade, updateTrade } from "@/lib/tradesDb";
import type { TradeEntry, Instrument, TradeSide, FollowedPlan, OutcomeDb, MarketState, SetupTag } from "@/lib/types";
import { formatYMD, weekdayLabel, startOfDayMs, endOfDayMs, buildTimestamp, normalizeOutcome, outcomeKey, outcomeBadge, safeNumber, computeKPIs, isValidHHMM } from "@/lib/helpers";

const LS_KEY = "trades_cache_v1";

type OutcomeKey = "all" | OutcomeDb;
type Weekday = "ALL" | "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes";

function weekdayEsFromMs(ms: number): Weekday {
  const d = new Date(ms).getDay();
  if (d === 1) return "Lunes"; if (d === 2) return "Martes";
  if (d === 3) return "Miércoles"; if (d === 4) return "Jueves";
  if (d === 5) return "Viernes"; return "ALL";
}

// ─── Styles ───────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "rgba(10,8,5,0.8)", border: "1px solid rgba(180,140,80,0.14)",
  borderRadius: 16, padding: "18px 20px",
  backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
};

function pillStyle(active = false, variant: "default"|"green"|"red"|"amber" = "default"): React.CSSProperties {
  const c = {
    default: { b:"rgba(180,140,80,0.35)", bg:"rgba(200,146,58,0.08)", t:"#c8923a" },
    green:   { b:"rgba(74,158,106,0.5)",  bg:"rgba(74,158,106,0.12)", t:"#7dcb9a" },
    red:     { b:"rgba(184,85,85,0.5)",   bg:"rgba(184,85,85,0.12)", t:"#e08888" },
    amber:   { b:"rgba(200,146,58,0.5)",  bg:"rgba(200,146,58,0.1)", t:"#c8923a" },
  }[variant];
  return {
    height: 32, padding: "0 14px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? c.b : "rgba(180,140,80,0.12)"}`,
    background: active ? c.bg : "rgba(255,255,255,0.02)",
    color: active ? c.t : "rgba(232,224,208,0.35)",
    fontSize: 11, fontWeight: 700, transition: "all 0.15s", whiteSpace: "nowrap" as const,
  };
}

function outcomeColor(k: OutcomeDb): string {
  if (k === "win") return "#7dcb9a";
  if (k === "loss") return "#e08888";
  if (k === "be") return "#c8923a";
  return "rgba(232,224,208,0.35)";
}

function outcomeBg(k: OutcomeDb): string {
  if (k === "win") return "rgba(74,158,106,0.12)";
  if (k === "loss") return "rgba(184,85,85,0.12)";
  if (k === "be") return "rgba(200,146,58,0.1)";
  return "rgba(255,255,255,0.04)";
}

function outcomeBorder(k: OutcomeDb): string {
  if (k === "win") return "rgba(74,158,106,0.35)";
  if (k === "loss") return "rgba(184,85,85,0.35)";
  if (k === "be") return "rgba(200,146,58,0.3)";
  return "rgba(180,140,80,0.12)";
}

function Tag({ children, color = "rgba(232,224,208,0.35)", bg = "rgba(255,255,255,0.04)", border = "rgba(180,140,80,0.12)" }: {
  children: React.ReactNode; color?: string; bg?: string; border?: string;
}) {
  return (
    <span style={{
      height: 24, padding: "0 10px", display: "inline-flex", alignItems: "center",
      borderRadius: 999, border: `1px solid ${border}`, background: bg,
      fontSize: 11, fontWeight: 700, color, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function useIsMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const f = () => setIsMobile(window.innerWidth < bp);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [bp]);
  return isMobile;
}

function toCSVRow(values: (string | number | null | undefined)[]) {
  return values.map(v => `"${(v == null ? "" : String(v)).replaceAll('"', '""')}"`).join(",");
}

function exportTradesCSV(trades: TradeEntry[], filename: string) {
  const header = ["id","createdAt","day","tradeTime","instrument","tradeSide","rr","outcome","followedPlan","setupTag","biasShown","marketState","liqTaken","reaction","note"];
  const rows = trades.map(t => toCSVRow([t.id, t.createdAt, formatYMD(t.createdAt), t.tradeTime, t.instrument, t.tradeSide, t.rr, outcomeKey(t), t.followedPlan, t.setupTag, t.biasShown, t.marketState, t.liqTaken, t.reaction, t.note ?? ""]));
  const csv = [toCSVRow(header), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function HistoryPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseClient> | null>(null);
  useEffect(() => { setSupabase(getSupabaseClient()); }, []);

  const [allTrades, setAllTrades] = useState<TradeEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [fOutcome, setFOutcome] = useState<OutcomeKey>("all");
  const [fSide, setFSide] = useState<"all" | TradeSide>("all");
  const [fWeekday, setFWeekday] = useState<Weekday>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [pageSize] = useState(15);
  const [page, setPage] = useState(1);

  // Modal edición
  const [editTrade, setEditTrade] = useState<TradeEntry | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editSide, setEditSide] = useState<TradeSide>("BUY");
  const [editFollowed, setEditFollowed] = useState<FollowedPlan>("yes");
  const [editRR, setEditRR] = useState("");
  const [editOutcome, setEditOutcome] = useState<OutcomeDb>("unknown");
  const [editSetup, setEditSetup] = useState<string>("unknown");
  const [editNote, setEditNote] = useState("");
  const [editInstrument, setEditInstrument] = useState<Instrument>("NQ");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setAllTrades(parsed as TradeEntry[]);
      }
    } catch {}
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;
        if (!uid) return;
        if (alive) setUserId(uid);
        const fromDb = await listTradesSince(uid, 0, 500);
        if (!alive) return;
        const normalized = fromDb
          .map(t => ({ ...t, instrument: t.instrument === "ES" || t.instrument === "NQ" ? t.instrument : ("ES" as Instrument) }))
          .sort((a, b) => a.createdAt - b.createdAt);
        setAllTrades(normalized as TradeEntry[]);
        localStorage.setItem(LS_KEY, JSON.stringify(normalized));
      } catch (e) { console.error(e); }
    })();
    return () => { alive = false; };
  }, [supabase]);

  useEffect(() => { setPage(1); }, [fOutcome, fSide, fWeekday, from, to, q]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const fromMs = from ? startOfDayMs(from) : null;
    const toMs = to ? endOfDayMs(to) : null;
    const base = allTrades.filter(t => {
      if (fromMs != null && t.createdAt < fromMs) return false;
      if (toMs != null && t.createdAt > toMs) return false;
      if (fWeekday !== "ALL" && weekdayEsFromMs(t.createdAt) !== fWeekday) return false;
      if (fOutcome !== "all" && outcomeKey(t) !== fOutcome) return false;
      if (fSide !== "all" && t.tradeSide !== fSide) return false;
      if (query) {
        const blob = [t.note ?? "", t.marketState ?? "", t.biasShown ?? "", t.instrument ?? "", t.setupTag ?? "", t.tradeSide ?? "", t.reaction ?? ""].join(" ").toLowerCase();
        if (!blob.includes(query)) return false;
      }
      return true;
    });
    return base.sort((a, b) => b.createdAt - a.createdAt);
  }, [allTrades, fOutcome, fSide, fWeekday, from, to, q]);

  const kpisAll = useMemo(() => computeKPIs(allTrades), [allTrades]);
  const kpisFiltered = useMemo(() => computeKPIs(filtered), [filtered]);

  const last7 = useMemo(() => {
    const newest = [...filtered].slice(0, 7);
    const netRR = newest.reduce((acc, t) => {
      const o = normalizeOutcome(t.outcome);
      if (o === "win") return acc + (safeNumber(t.rr) ?? 0);
      if (o === "loss") return acc - 1;
      return acc;
    }, 0);
    return { netRR };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(() => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize), [filtered, pageSafe, pageSize]);

  function openEdit(t: TradeEntry) {
    setEditTrade(t); setEditDate(formatYMD(t.createdAt)); setEditTime(t.tradeTime || "");
    setEditSide(t.tradeSide); setEditFollowed(t.followedPlan);
    setEditRR(t.rr != null ? String(t.rr) : "");
    setEditOutcome(normalizeOutcome(t.outcome)); setEditSetup(t.setupTag ?? "unknown");
    setEditNote(t.note ?? ""); setEditInstrument(t.instrument ?? "NQ");
  }

  async function saveEdit() {
    if (!editTrade) return;
    setEditSaving(true);
    try {
      const ts = buildTimestamp(editDate, editTime);
      const rrVal = (() => { const n = Number(String(editRR).replace(",", ".")); return Number.isFinite(n) ? n : null; })();
      await updateTrade(editTrade.id, { createdAt: ts, tradeTime: editTime, tradeSide: editSide, followedPlan: editFollowed, rr: rrVal, outcome: editOutcome, setupTag: editSetup, note: editNote, instrument: editInstrument });
      setAllTrades(prev => {
        const next = prev.map(t => t.id !== editTrade.id ? t : { ...t, createdAt: ts, tradeTime: editTime, tradeSide: editSide, followedPlan: editFollowed, rr: rrVal, outcome: editOutcome, setupTag: editSetup as SetupTag, note: editNote, instrument: editInstrument });
        localStorage.setItem(LS_KEY, JSON.stringify(next)); return next;
      });
      setEditTrade(null);
    } catch (err) { console.error(err); alert("No se pudo guardar."); }
    finally { setEditSaving(false); }
  }

  async function handleDelete(e: React.MouseEvent, t: TradeEntry) {
    e.stopPropagation();
    if (!userId) return;
    if (!window.confirm(`¿Borrar este trade?\n${formatYMD(t.createdAt)} ${t.tradeTime || ""} · ${t.instrument} · ${t.tradeSide}`)) return;
    try {
      await deleteTrade(userId, t.id);
      setAllTrades(prev => { const next = prev.filter(x => x.id !== t.id); localStorage.setItem(LS_KEY, JSON.stringify(next)); return next; });
    } catch { alert("No se pudo borrar."); }
  }

  if (!supabase) return <div style={{ minHeight:"100vh", background:"#0c0a07", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(232,224,208,0.3)", fontSize:13 }}>Cargando…</div>;

  return (
    <>
      <div style={{ position:"fixed", inset:0, zIndex:0, backgroundImage:"url('/PM_SCALPS_BG.png')", backgroundSize:"cover", backgroundPosition:"center" }} />
      <div style={{ position:"fixed", inset:0, zIndex:1, background:"rgba(6,4,2,0.78)", backgroundImage:"radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.22) 0%, transparent 60%)" }} />

      <div style={{ position:"relative", zIndex:2, maxWidth:1000, margin:"0 auto", padding:"24px 20px 48px" }}>

        {/* Header */}
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"flex-end", justifyContent:"space-between", gap:12, marginBottom:24 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.22em", color:"rgba(200,146,58,0.45)" }}>JOURNAL</div>
            <div style={{ fontSize:22, fontWeight:900, color:"rgba(232,224,208,0.9)", marginTop:2 }}>History</div>
            <div style={{ fontSize:12, color:"rgba(232,224,208,0.35)", marginTop:4 }}>Click en un trade para ver el detalle</div>
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            <button onClick={() => exportTradesCSV(allTrades, "pm-scalps-ALL.csv")} style={{ ...pillStyle(), fontSize:11 }}>Export ALL</button>
            <button onClick={() => exportTradesCSV(filtered, "pm-scalps-FILTERED.csv")} style={{ ...pillStyle(), fontSize:11 }}>Export filtrado</button>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:10, marginBottom:16 }}>
          {[
            { label:"TOTAL TRADES", value: kpisAll.total, sub: `${kpisAll.totalWithRR} cerrados` },
            { label:"WINRATE", value: `${kpisFiltered.winrate.toFixed(1)}%`, sub: `W ${kpisFiltered.winCount} · L ${kpisFiltered.lossCount} · BE ${kpisFiltered.beCount}` },
            { label:"NET RR", value: kpisFiltered.netRR.toFixed(2), sub: `Last 7: ${last7.netRR.toFixed(2)}R`, color: kpisFiltered.netRR >= 0 ? "#7dcb9a" : "#e08888" },
            { label:"AVG RR", value: kpisFiltered.avgRR.toFixed(2), sub: `Exp: ${kpisFiltered.expectancy.toFixed(2)} · PF: ${kpisFiltered.profitFactor === Infinity ? "∞" : kpisFiltered.profitFactor.toFixed(2)}` },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={card}>
              <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.18em", color:"rgba(232,224,208,0.28)", marginBottom:8 }}>{label}</div>
              <div style={{ fontSize:26, fontWeight:900, color: color ?? "rgba(232,224,208,0.9)" }}>{value}</div>
              <div style={{ fontSize:11, color:"rgba(232,224,208,0.35)", marginTop:4 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div style={{ ...card, marginBottom:12 }}>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
            {([
              { v:"all", l:"Todos" }, { v:"win", l:"✅ Wins" }, { v:"loss", l:"❌ Losses" }, { v:"be", l:"◻︎ BE" },
            ] as { v: OutcomeKey, l: string }[]).map(({ v, l }) => (
              <button key={v} onClick={() => setFOutcome(v)} style={pillStyle(fOutcome === v, v === "win" ? "green" : v === "loss" ? "red" : v === "be" ? "amber" : "default")}>{l}</button>
            ))}

            <div style={{ width:1, height:20, background:"rgba(180,140,80,0.1)" }} />

            {([{v:"all",l:"Buy+Sell"},{v:"BUY",l:"BUY"},{v:"SELL",l:"SELL"}] as {v:string,l:string}[]).map(({v,l}) => (
              <button key={v} onClick={() => setFSide(v as any)} style={pillStyle(fSide === v)}>{l}</button>
            ))}

            <div style={{ width:1, height:20, background:"rgba(180,140,80,0.1)" }} />

            <select value={fWeekday} onChange={e => setFWeekday(e.target.value as Weekday)} style={{
              height:32, padding:"0 10px", borderRadius:999, cursor:"pointer",
              border:"1px solid rgba(180,140,80,0.12)", background:"rgba(0,0,0,0.3)",
              color:"rgba(232,224,208,0.4)", fontSize:11, fontWeight:700, outline:"none",
            }}>
              <option value="ALL">Todos los días</option>
              {(["Lunes","Martes","Miércoles","Jueves","Viernes"] as Weekday[]).map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:10, color:"rgba(232,224,208,0.28)", fontWeight:700 }}>De</span>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ height:32, padding:"0 10px", borderRadius:10, border:"1px solid rgba(180,140,80,0.12)", background:"rgba(0,0,0,0.3)", color:"rgba(232,224,208,0.5)", fontSize:11, outline:"none" }} />
              <span style={{ fontSize:10, color:"rgba(232,224,208,0.28)", fontWeight:700 }}>a</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ height:32, padding:"0 10px", borderRadius:10, border:"1px solid rgba(180,140,80,0.12)", background:"rgba(0,0,0,0.3)", color:"rgba(232,224,208,0.5)", fontSize:11, outline:"none" }} />
            </div>

            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" style={{ height:32, padding:"0 12px", borderRadius:999, border:"1px solid rgba(180,140,80,0.12)", background:"rgba(0,0,0,0.3)", color:"rgba(232,224,208,0.5)", fontSize:11, fontWeight:600, outline:"none", width:120 }} />

            <button onClick={() => { setFOutcome("all"); setFSide("all"); setFWeekday("ALL"); setFrom(""); setTo(""); setQ(""); }} style={{ ...pillStyle(), marginLeft:"auto" }}>Clear</button>
          </div>
        </div>

        {/* Lista */}
        <div style={card}>
          {isMobile ? (
            <div style={{ display:"grid", gap:10 }}>
              {pageItems.length === 0 ? (
                <div style={{ padding:"32px 0", textAlign:"center", color:"rgba(232,224,208,0.3)", fontSize:13 }}>No hay trades con esos filtros.</div>
              ) : pageItems.map((t, idx) => {
                const ok = outcomeKey(t);
                const globalIndex = (pageSafe - 1) * pageSize + idx + 1;
                return (
                  <div key={t.id} onClick={() => router.push(`/journal/history/${t.id}`)}
                    style={{ position:"relative", padding:"14px 16px", borderRadius:14, cursor:"pointer", transition:"all 0.15s", border:`1px solid ${outcomeBorder(ok)}`, background:outcomeBg(ok) }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <span style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.35)" }}>#{globalIndex} · {formatYMD(t.createdAt)} · {t.tradeTime || "—"}</span>
                      <span style={{ fontSize:13, fontWeight:900, color: outcomeColor(ok) }}>
                        {ok === "win" ? "✅" : ok === "loss" ? "❌" : ok === "be" ? "◻︎" : "—"}
                      </span>
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      <Tag color={t.tradeSide === "BUY" ? "#85b0e0" : "#e08888"} border={t.tradeSide === "BUY" ? "rgba(74,126,184,0.35)" : "rgba(184,85,85,0.35)"} bg={t.tradeSide === "BUY" ? "rgba(74,126,184,0.12)" : "rgba(184,85,85,0.12)"}>{t.tradeSide}</Tag>
                      <Tag>{t.instrument}</Tag>
                      {t.rr != null && <Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{t.rr.toFixed(2)}R</Tag>}
                      {t.setupTag && t.setupTag !== "unknown" && <Tag>{t.setupTag === "A" ? "Setup A" : t.setupTag === "B" ? "Setup B" : t.setupTag}</Tag>}
                    </div>
                    {t.note?.trim() && <div style={{ marginTop:8, fontSize:11, color:"rgba(232,224,208,0.35)", overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" as any }}>{t.note.trim()}</div>}
                    <div style={{ position:"absolute", top:10, right:10, display:"flex", gap:4 }}>
                      <button onClick={e => { e.stopPropagation(); openEdit(t); }} style={{ width:28, height:28, borderRadius:999, border:"1px solid rgba(180,140,80,0.15)", background:"rgba(0,0,0,0.3)", color:"rgba(232,224,208,0.4)", fontSize:11, cursor:"pointer" }}>✎</button>
                      <button onClick={e => handleDelete(e, t)} style={{ width:28, height:28, borderRadius:999, border:"1px solid rgba(184,85,85,0.2)", background:"rgba(184,85,85,0.06)", color:"rgba(224,136,136,0.5)", fontSize:11, cursor:"pointer" }}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid rgba(180,140,80,0.1)" }}>
                    {["#","FECHA","DÍA","HORA","INSTR","DIR","RESULTADO","RR","PLAN","SETUP","BIAS",""].map(h => (
                      <th key={h} style={{ padding:"10px 12px 10px 0", textAlign:"left", fontSize:9, fontWeight:800, letterSpacing:"0.15em", color:"rgba(232,224,208,0.28)", whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr><td colSpan={12} style={{ padding:"32px 0", textAlign:"center", color:"rgba(232,224,208,0.3)", fontSize:13 }}>No hay trades con esos filtros.</td></tr>
                  ) : pageItems.map((t, idx) => {
                    const ok = outcomeKey(t);
                    const globalIndex = (pageSafe - 1) * pageSize + idx + 1;
                    return (
                      <tr key={t.id} onClick={() => router.push(`/journal/history/${t.id}`)}
                        style={{ borderBottom:"1px solid rgba(180,140,80,0.07)", cursor:"pointer", transition:"background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(200,146,58,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding:"12px 12px 12px 0", fontSize:12 }}>
                          <Link href={`/journal/history/${t.id}`} onClick={e => e.stopPropagation()} style={{ color:"rgba(200,146,58,0.6)", fontWeight:800, textDecoration:"none" }}>{globalIndex}</Link>
                        </td>
                        <td style={{ padding:"12px 12px 12px 0", fontSize:12, color:"rgba(232,224,208,0.6)", whiteSpace:"nowrap" }}>{formatYMD(t.createdAt)}</td>
                        <td style={{ padding:"12px 12px 12px 0", fontSize:12, color:"rgba(232,224,208,0.4)" }}>{weekdayLabel(t.createdAt)}</td>
                        <td style={{ padding:"12px 12px 12px 0", fontSize:12, color:"rgba(232,224,208,0.5)" }}>{t.tradeTime || "—"}</td>
                        <td style={{ padding:"12px 12px 12px 0", fontSize:12, fontWeight:800, color:"rgba(232,224,208,0.7)" }}>{t.instrument}</td>
                        <td style={{ padding:"12px 12px 12px 0" }}>
                          <Tag color={t.tradeSide === "BUY" ? "#85b0e0" : "#e08888"} border={t.tradeSide === "BUY" ? "rgba(74,126,184,0.35)" : "rgba(184,85,85,0.35)"} bg={t.tradeSide === "BUY" ? "rgba(74,126,184,0.1)" : "rgba(184,85,85,0.1)"}>{t.tradeSide}</Tag>
                        </td>
                        <td style={{ padding:"12px 12px 12px 0" }}>
                          <Tag color={outcomeColor(ok)} border={outcomeBorder(ok)} bg={outcomeBg(ok)}>
                            {ok === "win" ? "✅ Win" : ok === "loss" ? "❌ Loss" : ok === "be" ? "◻︎ BE" : "—"}
                          </Tag>
                        </td>
                        <td style={{ padding:"12px 12px 12px 0" }}>
                          {t.rr != null ? <Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{t.rr.toFixed(2)}R</Tag> : <span style={{ color:"rgba(232,224,208,0.25)", fontSize:12 }}>—</span>}
                        </td>
                        <td style={{ padding:"12px 12px 12px 0" }}>
                          <Tag color={t.followedPlan === "yes" ? "#7dcb9a" : "#e08888"} border={t.followedPlan === "yes" ? "rgba(74,158,106,0.3)" : "rgba(184,85,85,0.3)"} bg={t.followedPlan === "yes" ? "rgba(74,158,106,0.08)" : "rgba(184,85,85,0.08)"}>{t.followedPlan === "yes" ? "Sí" : "No"}</Tag>
                        </td>
                        <td style={{ padding:"12px 12px 12px 0" }}>
                          {t.setupTag && t.setupTag !== "unknown" ? <Tag>{t.setupTag === "A" ? "Setup A" : t.setupTag === "B" ? "Setup B" : t.setupTag}</Tag> : <span style={{ color:"rgba(232,224,208,0.2)", fontSize:12 }}>—</span>}
                        </td>
                        <td style={{ padding:"12px 12px 12px 0" }}>
                          <Tag color={t.biasShown === "LONG" ? "#7dcb9a" : t.biasShown === "SHORT" ? "#e08888" : "rgba(232,224,208,0.4)"}>{t.biasShown}</Tag>
                        </td>
                        <td style={{ padding:"12px 0", textAlign:"right" }}>
                          <div style={{ display:"flex", gap:4, justifyContent:"flex-end" }}>
                            <button onClick={e => { e.stopPropagation(); openEdit(t); }} style={{ width:28, height:28, borderRadius:999, border:"1px solid rgba(180,140,80,0.15)", background:"rgba(0,0,0,0.3)", color:"rgba(232,224,208,0.4)", fontSize:11, cursor:"pointer" }}>✎</button>
                            <button onClick={e => handleDelete(e, t)} style={{ width:28, height:28, borderRadius:999, border:"1px solid rgba(184,85,85,0.2)", background:"rgba(184,85,85,0.06)", color:"rgba(224,136,136,0.5)", fontSize:11, cursor:"pointer" }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación */}
          <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={pageSafe <= 1}
              style={{ ...pillStyle(), opacity: pageSafe <= 1 ? 0.3 : 1 }}>← Prev</button>
            <span style={{ fontSize:12, color:"rgba(232,224,208,0.35)", fontWeight:600 }}>
              {pageSafe} / {totalPages} <span style={{ color:"rgba(232,224,208,0.2)" }}>({filtered.length} trades)</span>
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={pageSafe >= totalPages}
              style={{ ...pillStyle(), opacity: pageSafe >= totalPages ? 0.3 : 1 }}>Next →</button>
          </div>
        </div>
      </div>

      {/* Modal edición */}
      {editTrade && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(4,3,1,0.88)", backdropFilter:"blur(12px)", padding:20 }}>
          <div style={{ ...card, width:"100%", maxWidth:520, maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ fontSize:14, fontWeight:900, color:"rgba(232,224,208,0.88)", marginBottom:4 }}>Editar trade</div>
            <div style={{ fontSize:10, color:"rgba(232,224,208,0.25)", marginBottom:20 }}>{editTrade.id.slice(0,8)}…</div>

            <div style={{ display:"grid", gap:14 }}>
              <div>
                <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>FECHA</div>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                  style={{ height:36, padding:"0 12px", borderRadius:10, border:"1px solid rgba(180,140,80,0.18)", background:"rgba(0,0,0,0.35)", color:"rgba(232,224,208,0.9)", fontSize:13, fontWeight:600, outline:"none", width:"100%", boxSizing:"border-box" }} />
              </div>

              <div>
                <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>HORA</div>
                <input value={editTime} onChange={e => setEditTime(e.target.value)} placeholder="HH:MM"
                  style={{ height:36, padding:"0 12px", borderRadius:10, border:`1px solid ${editTime && !isValidHHMM(editTime) ? "rgba(184,85,85,0.5)" : "rgba(180,140,80,0.18)"}`, background:"rgba(0,0,0,0.35)", color:"rgba(232,224,208,0.9)", fontSize:13, fontWeight:600, outline:"none", width:100 }} />
              </div>

              <div style={{ display:"flex", flexWrap:"wrap", gap:14 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>INSTRUMENTO</div>
                  <div style={{ display:"flex", gap:6 }}>
                    {(["NQ","ES"] as Instrument[]).map(ins => (
                      <button key={ins} onClick={() => setEditInstrument(ins)} style={{ ...pillStyle(editInstrument === ins) }}>{ins}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>DIRECCIÓN</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={() => setEditSide("BUY")} style={pillStyle(editSide === "BUY")}>BUY</button>
                    <button onClick={() => setEditSide("SELL")} style={pillStyle(editSide === "SELL")}>SELL</button>
                  </div>
                </div>
              </div>

              <div style={{ display:"flex", flexWrap:"wrap", gap:14 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>RESULTADO</div>
                  <select value={editOutcome} onChange={e => setEditOutcome(e.target.value as OutcomeDb)}
                    style={{ height:36, padding:"0 10px", borderRadius:10, border:"1px solid rgba(180,140,80,0.18)", background:"rgba(0,0,0,0.4)", color:"rgba(232,224,208,0.8)", fontSize:12, fontWeight:700, outline:"none" }}>
                    <option value="unknown">—</option>
                    <option value="win">Win</option>
                    <option value="loss">Loss</option>
                    <option value="be">BE</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>RR</div>
                  <input value={editRR} onChange={e => setEditRR(e.target.value)} placeholder="2.5"
                    style={{ height:36, padding:"0 12px", borderRadius:10, border:"1px solid rgba(180,140,80,0.18)", background:"rgba(0,0,0,0.35)", color:"rgba(232,224,208,0.9)", fontSize:13, fontWeight:600, outline:"none", width:80 }} />
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>SETUP</div>
                  <select value={editSetup} onChange={e => setEditSetup(e.target.value)}
                    style={{ height:36, padding:"0 10px", borderRadius:10, border:"1px solid rgba(180,140,80,0.18)", background:"rgba(0,0,0,0.4)", color:"rgba(232,224,208,0.8)", fontSize:12, fontWeight:700, outline:"none" }}>
                    <option value="unknown">—</option>
                    <option value="A">Setup A</option>
                    <option value="B">Setup B</option>
                    <option value="none">Sin setup</option>
                  </select>
                </div>
              </div>

              <div>
                <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>PLAN</div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={() => setEditFollowed("yes")} style={pillStyle(editFollowed === "yes", "green")}>Cumplí ✓</button>
                  <button onClick={() => setEditFollowed("no")} style={pillStyle(editFollowed === "no", "red")}>No cumplí ✗</button>
                </div>
              </div>

              <div>
                <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6, letterSpacing:"0.15em" }}>NOTA</div>
                <textarea value={editNote} onChange={e => setEditNote(e.target.value)} rows={4}
                  style={{ width:"100%", padding:"12px", borderRadius:10, border:"1px solid rgba(180,140,80,0.15)", background:"rgba(0,0,0,0.3)", color:"rgba(232,224,208,0.85)", fontSize:13, fontWeight:500, outline:"none", resize:"vertical", lineHeight:1.7, fontFamily:"inherit", boxSizing:"border-box" }} />
              </div>
            </div>

            <div style={{ marginTop:20, display:"flex", gap:8 }}>
              <button onClick={saveEdit} disabled={editSaving} style={{
                flex:1, height:40, borderRadius:999, cursor:"pointer",
                border:"1px solid rgba(200,146,58,0.38)", background:"rgba(200,146,58,0.09)",
                color:"#c8923a", fontSize:12, fontWeight:800, opacity: editSaving ? 0.5 : 1,
              }}>{editSaving ? "Guardando…" : "Guardar cambios"}</button>
              <button onClick={() => setEditTrade(null)} style={{
                height:40, padding:"0 18px", borderRadius:999, cursor:"pointer",
                border:"1px solid rgba(180,140,80,0.12)", background:"transparent",
                color:"rgba(232,224,208,0.35)", fontSize:12, fontWeight:700,
              }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}