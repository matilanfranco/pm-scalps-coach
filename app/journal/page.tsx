"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createTrade, listTrades, updateTradeImage } from "@/lib/tradesDb";
import { uploadTradeImage } from "@/lib/uploadTradeImage";
import { getTodayKey, isValidHHMM, buildTimestamp } from "@/lib/journalLogic";
import { computeContextTag } from "@/lib/journalLogic";
import type {
  Level, Instrument, TradeSide, FollowedPlan, SetupTag,
  AmDir, AmReac, HtfStruct, M15Struct, CisdDir, LevelLabel,
} from "@/lib/types";

type Outcome = "PROFIT" | "STOP" | "BE" | "NONE";
type Mode = "journal" | "pretrade";
type EmotionalState = "calm" | "nervous" | "frustrated" | "rushed";
type ConfirmationCandle = "m5" | "m2" | null;
type ErrorTag = "overtrading" | "against_m15" | "no_confirmation" | "phone" | "distraction" | "revenge" | null;
type PreSection = 1 | 2 | 3;

type DailyWrapType = {
  date: string;
  dailyError: string;
  dailyLearning: string;
  updatedAt: number;
};

const LS_DAILY_KEY = "pm_scalps_daily_v1";

// ─── Checklist item ───────────────────────────────
function ChecklistItem({ question }: { question: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <div onClick={() => setChecked(v => !v)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "5px 0" }}>
      <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `1px solid ${checked ? "rgba(74,158,106,0.6)" : "rgba(180,140,80,0.2)"}`, background: checked ? "rgba(74,158,106,0.15)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#7dcb9a", transition: "all 0.15s" }}>{checked ? "✓" : ""}</div>
      <span style={{ fontSize: 12, fontWeight: 600, color: checked ? "rgba(232,224,208,0.75)" : "rgba(232,224,208,0.35)", transition: "color 0.15s" }}>{question}</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────
function parseRR(s: string): number | null {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
}
function outcomeToDb(o: Outcome): "win" | "loss" | "be" | "unknown" {
  if (o === "PROFIT") return "win";
  if (o === "STOP") return "loss";
  if (o === "BE") return "be";
  return "unknown";
}

// ─── Styles ───────────────────────────────────────
const card: React.CSSProperties = {
  background: "rgba(10,8,5,0.8)", border: "1px solid rgba(180,140,80,0.14)",
  borderRadius: 16, padding: "18px 20px",
  backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
};
const lbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: "0.18em",
  color: "rgba(232,224,208,0.28)", marginBottom: 12, display: "block",
};
const div_: React.CSSProperties = { height: 1, background: "rgba(180,140,80,0.09)", margin: "16px 0" };

function inp(invalid = false): React.CSSProperties {
  return {
    height: 36, padding: "0 12px", borderRadius: 10,
    border: `1px solid ${invalid ? "rgba(184,85,85,0.5)" : "rgba(180,140,80,0.18)"}`,
    background: "rgba(0,0,0,0.35)", color: "rgba(232,224,208,0.9)",
    fontSize: 13, fontWeight: 600, outline: "none", fontFamily: "inherit",
  };
}
function txa(): React.CSSProperties {
  return {
    width: "100%", padding: "12px", borderRadius: 10,
    border: "1px solid rgba(180,140,80,0.15)", background: "rgba(0,0,0,0.3)",
    color: "rgba(232,224,208,0.85)", fontSize: 13, fontWeight: 500,
    outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit", boxSizing: "border-box",
  };
}
function bst(active = false, variant: "default"|"green"|"red"|"amber"|"blue" = "default", disabled = false): React.CSSProperties {
  const c = {
    default: { b:"rgba(180,140,80,0.35)", bg:"rgba(200,146,58,0.08)", t:"#c8923a" },
    green:   { b:"rgba(74,158,106,0.5)",  bg:"rgba(74,158,106,0.14)", t:"#7dcb9a" },
    red:     { b:"rgba(184,85,85,0.5)",   bg:"rgba(184,85,85,0.14)", t:"#e08888" },
    amber:   { b:"rgba(200,146,58,0.5)",  bg:"rgba(200,146,58,0.12)", t:"#c8923a" },
    blue:    { b:"rgba(74,126,184,0.5)",  bg:"rgba(74,126,184,0.14)", t:"#85b0e0" },
  }[variant];
  return {
    height: 36, padding: "0 16px", borderRadius: 999, cursor: disabled ? "default" : "pointer",
    border: `1px solid ${active ? c.b : "rgba(180,140,80,0.12)"}`,
    background: active ? c.bg : "rgba(255,255,255,0.025)",
    color: active ? c.t : "rgba(232,224,208,0.38)",
    fontSize: 12, fontWeight: 700, transition: "all 0.15s",
    whiteSpace: "nowrap" as const, opacity: disabled ? 0.32 : 1,
  };
}

function Btn({ children, active = false, variant = "default" as any, onClick, disabled = false, style: sx }: {
  children: React.ReactNode; active?: boolean;
  variant?: "default"|"green"|"red"|"amber"|"blue";
  onClick?: () => void; disabled?: boolean; style?: React.CSSProperties;
}) {
  return <button onClick={disabled ? undefined : onClick} style={{ ...bst(active, variant, disabled), ...sx }}>{children}</button>;
}

function ResetBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ height: 24, padding: "0 8px", borderRadius: 999, cursor: "pointer", border: "1px solid rgba(180,140,80,0.15)", background: "transparent", color: "rgba(232,224,208,0.25)", fontSize: 10, fontWeight: 800 }}>× reset</button>
  );
}

// ─── Nivel labels ─────────────────────────────────
const LEVELS: LevelLabel[] = ["PDH","PDL","London H","London L","Asia H","Asia L","Weekly H","Weekly L"];

// ─── Main component ───────────────────────────────
export default function Page() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);

  const MOTIVATION = useMemo(() => {
    const msgs = [
      "El mercado no te debe nada. Tu proceso sí.",
      "Hoy no se mide en RR, se mide en disciplina.",
      "Cada trade es información. ¿La vas a usar o a reaccionar?",
      "Un buen trade es el que respeta el plan, no el que gana.",
      "En el mercado solo podés hacer tres cosas: comprar, vender o esperar.",
      "¿Estás acá para ganar hoy o para volverte consistente?",
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }, []);

  useEffect(() => setMounted(true), []);
  const supabase = useMemo(() => getSupabaseClient(), [mounted]);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s) { router.replace("/login"); return; }
      if (alive) { setUserId(s.user.id); setSessionReady(true); }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) { router.replace("/login"); return; }
      setUserId(s.user.id); setSessionReady(true);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [supabase, router]);

  const [mode, setMode] = useState<Mode>("journal");

  // ── Journal state ──────────────────────────────
  const [trades, setTrades] = useState<any[]>([]);
  const [tradeTaken, setTradeTaken] = useState<"yes"|"no">("yes");
  const [tradeDate, setTradeDate] = useState(getTodayKey());
  const [tradeTime, setTradeTime] = useState("");
  const [tradeSide, setTradeSide] = useState<TradeSide>("BUY");
  const [instrument, setInstrument] = useState<Instrument>("NQ");
  const [setupTag, setSetupTag] = useState<SetupTag>("unknown");
  const [outcome, setOutcome] = useState<Outcome>("NONE");
  const [followedPlan, setFollowedPlan] = useState<FollowedPlan>("yes");
  const [numPartials, setNumPartials] = useState<1|2|3>(1);
  const [partialRRs, setPartialRRs] = useState<[string,string,string]>(["","",""]);
  const [note, setNote] = useState("");
  const [emotionalState, setEmotionalState] = useState<EmotionalState|null>(null);
  const [errorTag, setErrorTag] = useState<ErrorTag>(null);
  const [smt, setSmt] = useState<boolean|null>(null);
  const [amdPresented, setAmdPresented] = useState<boolean|null>(null);
  const [confirmationCandle, setConfirmationCandle] = useState<ConfirmationCandle>(null);

  // ── Pre-trade state — nuevo sistema 3 secciones ─
  const [preSection, setPreSection] = useState<PreSection>(1);
  // Sección 1 — Contexto apertura
  const [amSweep, setAmSweep] = useState<"si"|"no"|null>(null);
  const [amSweepNivel, setAmSweepNivel] = useState<LevelLabel>(null);
  const [amReac, setAmReac] = useState<AmReac>(null);
  const [amDir, setAmDir] = useState<AmDir>(null);
  const [htfStruct, setHtfStruct] = useState<HtfStruct>(null);
  // Sección 2 — Estado actual
  const [pmSweep, setPmSweep] = useState<"si"|"no"|null>(null);
  const [pmSweepNivel, setPmSweepNivel] = useState<LevelLabel>(null);
  const [pmReac, setPmReac] = useState<AmReac>(null);
  const [m15Struct, setM15Struct] = useState<M15Struct>(null);
  // Sección 3 — Update delivery
  const [hasCisd, setHasCisd] = useState<"si"|"no"|null>(null);
  const [cisdDir, setCisdDir] = useState<CisdDir>(null);

  // ── Chart ──────────────────────────────────────
  const [lastSavedTradeId, setLastSavedTradeId] = useState<string|null>(null);
  const [chartFile, setChartFile] = useState<File|null>(null);
  const [chartName, setChartName] = useState("");
  const [chartStatus, setChartStatus] = useState<"idle"|"selected"|"uploading"|"done"|"error">("idle");

  // ── Daily ──────────────────────────────────────
  const [dailyError, setDailyError] = useState("");
  const [dailyLearning, setDailyLearning] = useState("");
  const [dailySaved, setDailySaved] = useState<DailyWrapType|null>(null);
  const [dailyOpen, setDailyOpen] = useState(false);

  // ── Contexto derivado ──────────────────────────
  const contextResult = useMemo(() => computeContextTag({
    amDir, amSweepNivel, amReac, htfStruct,
    pmSweepNivel, pmReac, m15Struct, cisdDir,
  }, tradeSide), [amDir, amSweepNivel, amReac, htfStruct, pmSweepNivel, pmReac, m15Struct, cisdDir, tradeSide]);

  const operableDir = contextResult.operableDir;

  // ── Computed ───────────────────────────────────
  const computedRR = useMemo(() => {
    const filled = partialRRs.slice(0, numPartials).map(parseRR).filter((v): v is number => v !== null);
    if (!filled.length) return null;
    return Math.round(filled.reduce((a, b) => a + b, 0) / filled.length * 100) / 100;
  }, [partialRRs, numPartials]);

  const tradeTimeOk = tradeTaken !== "yes" || !tradeTime || isValidHHMM(tradeTime);

  const todayTrades = useMemo(() => trades.filter(t => {
    const d = new Date(t.createdAt);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return k === getTodayKey();
  }), [trades]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try { setTrades((await listTrades(userId, 200)) as any); } catch { setTrades([]); }
    })();
  }, [userId]);

  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(LS_DAILY_KEY) || "{}") as Record<string, DailyWrapType>;
      const today = all[getTodayKey()] || null;
      setDailySaved(today);
      if (today) { setDailyError(today.dailyError || ""); setDailyLearning(today.dailyLearning || ""); }
    } catch {}
  }, []);

  // ── Reset functions ────────────────────────────
  function resetJournalForm() {
    setTradeTaken("yes"); setTradeDate(getTodayKey()); setTradeTime("");
    setTradeSide("BUY"); setInstrument("NQ"); setSetupTag("unknown");
    setOutcome("NONE"); setFollowedPlan("yes"); setNumPartials(1);
    setPartialRRs(["","",""]); setNote(""); setEmotionalState(null);
    setErrorTag(null); setSmt(null); setAmdPresented(null); setConfirmationCandle(null);
    setChartFile(null); setChartName(""); setChartStatus("idle");
  }

  function resetPreTrade() {
    setPreSection(1);
    setAmSweep(null); setAmSweepNivel(null); setAmReac(null);
    setAmDir(null); setHtfStruct(null);
    setPmSweep(null); setPmSweepNivel(null); setPmReac(null); setM15Struct(null);
    setHasCisd(null); setCisdDir(null);
  }

  async function uploadChart(opts?: { tradeId?: string }) {
    const tradeId = opts?.tradeId ?? lastSavedTradeId;
    if (!chartFile || !userId || !tradeId) { if (chartFile && !tradeId) setChartStatus("selected"); return; }
    try {
      setChartStatus("uploading");
      const { imgUrl, imgPath } = await uploadTradeImage({ userId, tradeId, file: chartFile });
      await updateTradeImage(tradeId, { imgUrl, imgPath });
      setChartStatus("done");
    } catch { setChartStatus("error"); }
  }

  async function handleSave() {
    if (tradeTaken === "yes" && tradeTime && !isValidHHMM(tradeTime)) return;
    const filled = partialRRs.slice(0, numPartials).map(parseRR).filter((v): v is number => v !== null);
    const finalRR = outcome === "STOP" ? -1 : filled.length ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length * 100) / 100 : null;
    try {
      if (!userId) return;
      const tradeId = await createTrade({
        userId, createdAt: buildTimestamp(tradeDate, tradeTime),
        // legacy
        liqTaken: pmSweep === "si" ? "yes" : pmSweep === "no" ? "no" : "unknown",
        takenLevels: [], lastTaken: null,
        reaction: pmReac === "acepto" ? "accept" : pmReac === "absorbio" ? "absorb" : "unclear",
        pendingLevels: [], hasFvg: "skip",
        instrument,
        biasShown: operableDir === "alcista" ? "LONG" : operableDir === "bajista" ? "SHORT" : "WAIT",
        marketState: contextResult.contextTag ? "TRANSITION" : "WAIT",
        invalidationHappened: "unknown", suggestedTargets: [],
        helped: true, tradeTaken, tradeTime: tradeTime.trim(),
        tradeSide, followedPlan, rr: finalRR, setupTag,
        outcome: outcomeToDb(outcome), note: note.trim(),
        numPartials: filled.length > 0 ? numPartials : null,
        partialRRs: filled.length > 0 ? filled : null,
        // nuevo contexto
        amDir, amSweepNivel, amReac, htfStruct,
        pmSweepNivel, pmReac, m15Struct, cisdDir,
        contextTag: contextResult.contextTag,
        htfAligned: contextResult.htfAligned,
      });
      setLastSavedTradeId(tradeId);
      await uploadChart({ tradeId });
      resetJournalForm();
      setTrades((await listTrades(userId, 200)) as any);
    } catch (err) { console.error(err); }
  }

  function saveDailyWrap() {
    const err = dailyError.trim(); const learn = dailyLearning.trim();
    if (!err || !learn) return;
    const next: DailyWrapType = { date: getTodayKey(), dailyError: err, dailyLearning: learn, updatedAt: Date.now() };
    try {
      const all = JSON.parse(localStorage.getItem(LS_DAILY_KEY) || "{}");
      all[next.date] = next;
      localStorage.setItem(LS_DAILY_KEY, JSON.stringify(all));
    } catch {}
    setDailySaved(next);
  }

  if (!sessionReady || !userId) {
    return <div style={{ minHeight:"100vh", background:"#0c0a07", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(232,224,208,0.3)", fontSize:13 }}>Cargando…</div>;
  }

  return (
    <>
      <div style={{ position:"fixed", inset:0, zIndex:0, backgroundImage:"url('/PM_SCALPS_BG.png')", backgroundSize:"cover", backgroundPosition:"center" }} />
      <div style={{ position:"fixed", inset:0, zIndex:1, background:"rgba(6,4,2,0.70)", backgroundImage:"radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.28) 0%, transparent 60%)" }} />

      {/* Welcome */}
      {showWelcome && (
        <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(4,3,1,0.9)", backdropFilter:"blur(14px)", padding:20 }}>
          <div style={{ maxWidth:420, width:"100%", ...card, padding:"32px 28px", textAlign:"center" }}>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.28em", color:"rgba(200,146,58,0.45)" }}>PM SCALPS COACH</div>
            <div style={{ marginTop:22, fontSize:17, fontWeight:800, lineHeight:1.55, color:"rgba(232,224,208,0.9)" }}>{MOTIVATION}</div>
            <div style={{ marginTop:10, fontSize:12, color:"rgba(232,224,208,0.28)" }}>Respirá. Observá. Reaccioná.</div>
            <button onClick={() => setShowWelcome(false)} style={{ marginTop:24, width:"100%", height:42, borderRadius:999, border:"1px solid rgba(200,146,58,0.4)", background:"rgba(200,146,58,0.1)", color:"#c8923a", fontSize:12, fontWeight:800, cursor:"pointer" }}>INICIAR →</button>
          </div>
        </div>
      )}

      <div style={{ position:"relative", zIndex:2, maxWidth:820, margin:"0 auto", padding:"24px 20px 48px" }}>

        {/* Top bar */}
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.22em", color:"rgba(200,146,58,0.45)" }}>TRADING DAY</div>
            <div style={{ fontSize:18, fontWeight:900, color:"rgba(232,224,208,0.88)", marginTop:2 }}>
              {new Date().toLocaleDateString("es-AR", { weekday:"long", day:"numeric", month:"long" })}
            </div>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ height:32, padding:"0 14px", display:"flex", alignItems:"center", borderRadius:999, border:`1px solid ${todayTrades.length >= 3 ? "rgba(184,85,85,0.35)" : "rgba(180,140,80,0.14)"}`, background:todayTrades.length >= 3 ? "rgba(184,85,85,0.08)" : "rgba(0,0,0,0.2)", fontSize:11, fontWeight:700, color:todayTrades.length >= 3 ? "#e08888" : "rgba(232,224,208,0.35)" }}>
              {todayTrades.length} trade{todayTrades.length !== 1 ? "s" : ""} hoy{todayTrades.length >= 3 && " ⚠️"}
            </div>
            <Btn active={mode === "pretrade"} variant="amber" onClick={() => setMode(mode === "journal" ? "pretrade" : "journal")}>
              {mode === "journal" ? "Pre-trade →" : "← Journal"}
            </Btn>
          </div>
        </div>

        {todayTrades.length >= 3 && (
          <div style={{ ...card, marginBottom:14, borderColor:"rgba(184,85,85,0.28)", background:"rgba(184,85,85,0.05)", display:"flex", gap:12 }}>
            <span style={{ fontSize:18, lineHeight:1 }}>⚠️</span>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:"#e08888", marginBottom:3 }}>{todayTrades.length} TRADES HOY — REVISÁ ANTES DE CONTINUAR</div>
              <div style={{ fontSize:11, color:"rgba(224,136,136,0.5)" }}>Tu historial muestra que el 3er+ trade suele ser sobreoperación.</div>
            </div>
          </div>
        )}

        {/* ════ JOURNAL ════ */}
        {mode === "journal" && (
          <div>
            {/* Banner contexto */}
            {operableDir && (
              <div style={{ ...card, marginBottom:12, borderColor:operableDir === "alcista" ? "rgba(74,158,106,0.28)" : "rgba(184,85,85,0.28)", background:operableDir === "alcista" ? "rgba(74,158,106,0.05)" : "rgba(184,85,85,0.05)", display:"flex", alignItems:"center", gap:14, padding:"12px 18px" }}>
                <div style={{ fontSize:20, fontWeight:900, color:operableDir === "alcista" ? "#4a9e6a" : "#b85555" }}>
                  {operableDir === "alcista" ? "LONG" : "SHORT"}
                </div>
                {contextResult.contextTag && (
                  <div style={{ fontSize:11, color:"rgba(232,224,208,0.3)", fontWeight:700 }}>· {contextResult.contextTag}</div>
                )}
                {contextResult.htfAligned !== null && (
                  <div style={{ fontSize:11, fontWeight:700, color:contextResult.htfAligned ? "rgba(74,158,106,0.6)" : "rgba(184,85,85,0.6)" }}>
                    · HTF {contextResult.htfAligned ? "a favor" : "en contra"}
                  </div>
                )}
                <button onClick={() => setMode("pretrade")} style={{ marginLeft:"auto", fontSize:11, color:"rgba(200,146,58,0.5)", background:"none", border:"none", cursor:"pointer", fontWeight:700 }}>Editar →</button>
              </div>
            )}

            <div style={card}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
                <div style={{ fontSize:14, fontWeight:900, color:"rgba(232,224,208,0.88)" }}>Registrar en el Journal</div>
                <ResetBtn onClick={resetJournalForm} />
              </div>

              {/* SESIÓN */}
              <span style={lbl}>SESIÓN</span>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
                <div style={{ display:"flex", gap:6 }}>
                  <Btn active={tradeTaken === "yes"} variant="green" onClick={() => setTradeTaken("yes")}>Sí</Btn>
                  <Btn active={tradeTaken === "no"} variant="red" onClick={() => setTradeTaken("no")}>No</Btn>
                </div>
                <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} style={inp()} />
                <input value={tradeTime} onChange={e => setTradeTime(e.target.value)} placeholder="HH:MM" inputMode="numeric" disabled={tradeTaken !== "yes"} style={{ ...inp(!tradeTimeOk), width:78, opacity:tradeTaken !== "yes" ? 0.32 : 1 }} />
                <div style={{ display:"flex", gap:6 }}>
                  {(["NQ","ES"] as Instrument[]).map(ins => (
                    <Btn key={ins} active={instrument === ins && tradeTaken === "yes"} disabled={tradeTaken !== "yes"} onClick={() => setInstrument(ins)}>{ins}</Btn>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <Btn active={tradeSide === "BUY" && tradeTaken === "yes"} variant="blue" disabled={tradeTaken !== "yes"} onClick={() => setTradeSide("BUY")}>BUY</Btn>
                  <Btn active={tradeSide === "SELL" && tradeTaken === "yes"} variant="red" disabled={tradeTaken !== "yes"} onClick={() => setTradeSide("SELL")}>SELL</Btn>
                </div>
              </div>
              {tradeTaken === "yes" && tradeTime && !tradeTimeOk && (
                <div style={{ fontSize:11, color:"#e08888", marginTop:6 }}>Hora inválida — usá HH:MM (ej: 14:35)</div>
              )}

              <div style={div_} />

              {/* SETUP */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ ...lbl, marginBottom:0 }}>SETUP</span>
                {setupTag !== "unknown" && <ResetBtn onClick={() => setSetupTag("unknown")} />}
              </div>
              <div style={{ display:"grid", gap:7 }}>
                {[
                  { tag:"A" as SetupTag, label:"Setup A", desc:"FVG + OB + OTE + Confirmación" },
                  { tag:"B" as SetupTag, label:"Setup B", desc:"FVG + Breaker (opcional) + Confirmación" },
                  { tag:"none" as SetupTag, label:"Sin setup / Solo estudio", desc:"Registrás el escenario sin entrada" },
                ].map(({ tag, label, desc }) => {
                  const isActive = setupTag === tag;
                  const dis = tradeTaken !== "yes" && tag !== "none";
                  return (
                    <button key={tag} onClick={() => !dis && setSetupTag(isActive ? "unknown" : tag)} style={{ padding:"11px 15px", borderRadius:11, textAlign:"left", border:`1px solid ${isActive ? "rgba(200,146,58,0.4)" : "rgba(180,140,80,0.1)"}`, background:isActive ? "rgba(200,146,58,0.07)" : "rgba(0,0,0,0.12)", cursor:dis ? "default" : "pointer", opacity:dis ? 0.3 : 1, transition:"all 0.15s" }}>
                      <div style={{ fontSize:12, fontWeight:800, color:isActive ? "#c8923a" : "rgba(232,224,208,0.65)" }}>{label}</div>
                      <div style={{ fontSize:10, color:"rgba(232,224,208,0.28)", marginTop:2 }}>{desc}</div>
                    </button>
                  );
                })}
              </div>

              <div style={div_} />

              {/* ICT */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ ...lbl, marginBottom:0 }}>ICT · CONTEXTO</span>
                {(smt !== null || amdPresented !== null || confirmationCandle !== null) && (
                  <ResetBtn onClick={() => { setSmt(null); setAmdPresented(null); setConfirmationCandle(null); }} />
                )}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:16, alignItems:"flex-start" }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6 }}>SMT NQ/ES</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <Btn active={smt === true} variant="green" onClick={() => setSmt(smt === true ? null : true)}>Sí</Btn>
                    <Btn active={smt === false} variant="red" onClick={() => setSmt(smt === false ? null : false)}>No</Btn>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6 }}>¿Se presentó AMD?</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <Btn active={amdPresented === true} variant="green" onClick={() => setAmdPresented(amdPresented === true ? null : true)}>Sí</Btn>
                    <Btn active={amdPresented === false} variant="red" onClick={() => setAmdPresented(amdPresented === false ? null : false)}>No</Btn>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", marginBottom:6 }}>Vela confirmación</div>
                  <div style={{ display:"flex", gap:6 }}>
                    <Btn active={confirmationCandle === "m5"} variant="amber" onClick={() => setConfirmationCandle(confirmationCandle === "m5" ? null : "m5")}>M5</Btn>
                    <Btn active={confirmationCandle === "m2"} variant="amber" onClick={() => setConfirmationCandle(confirmationCandle === "m2" ? null : "m2")}>M2</Btn>
                  </div>
                </div>
              </div>

              <div style={div_} />

              {/* RESULTADO */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ ...lbl, marginBottom:0 }}>RESULTADO</span>
                {(outcome !== "NONE" || followedPlan !== "yes" || errorTag) && (
                  <ResetBtn onClick={() => { setOutcome("NONE"); setFollowedPlan("yes"); setErrorTag(null); }} />
                )}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
                {[
                  { val:"PROFIT" as Outcome, l:"Profit", v:"green" as const },
                  { val:"STOP" as Outcome, l:"Stop", v:"red" as const },
                  { val:"BE" as Outcome, l:"BE", v:"amber" as const },
                  { val:"NONE" as Outcome, l:"—", v:"default" as const },
                ].map(({ val, l, v }) => (
                  <Btn key={val} active={outcome === val && tradeTaken === "yes"} variant={v} disabled={tradeTaken !== "yes"} onClick={() => setOutcome(outcome === val ? "NONE" : val)}>{l}</Btn>
                ))}
                <div style={{ width:1, height:22, background:"rgba(180,140,80,0.1)", margin:"0 2px" }} />
                <Btn active={followedPlan === "yes" && tradeTaken === "yes"} variant="green" disabled={tradeTaken !== "yes"} onClick={() => setFollowedPlan("yes")}>Cumplí ✓</Btn>
                <Btn active={followedPlan === "no" && tradeTaken === "yes"} variant="red" disabled={tradeTaken !== "yes"} onClick={() => setFollowedPlan("no")}>No cumplí ✗</Btn>
              </div>
              {followedPlan === "no" && tradeTaken === "yes" && (
                <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.25)" }}>MOTIVO</span>
                  {([
                    { v:"overtrading", l:"Sobreoperación" },
                    { v:"against_m15", l:"Contra M15" },
                    { v:"no_confirmation", l:"Sin confirmación" },
                    { v:"phone", l:"Desde teléfono" },
                    { v:"distraction", l:"Distracción" },
                    { v:"revenge", l:"Revenge" },
                  ] as { v: ErrorTag; l: string }[]).map(({ v, l }) => (
                    <Btn key={v as string} active={errorTag === v} variant="red" onClick={() => setErrorTag(errorTag === v ? null : v)} style={{ height:28, fontSize:11 }}>{l}</Btn>
                  ))}
                </div>
              )}

              <div style={div_} />

              {/* PARCIALES */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ ...lbl, marginBottom:0 }}>PARCIALES & RR</span>
                {(partialRRs.some(r => r !== "") || numPartials !== 1) && outcome !== "STOP" && (
                  <ResetBtn onClick={() => { setNumPartials(1); setPartialRRs(["","",""]); }} />
                )}
              </div>

              {outcome === "STOP" ? (
                <div style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"9px 16px", borderRadius:10, border:"1px solid rgba(184,85,85,0.25)", background:"rgba(184,85,85,0.06)" }}>
                  <span style={{ fontSize:9, fontWeight:800, color:"rgba(224,136,136,0.45)", letterSpacing:"0.14em" }}>RR</span>
                  <span style={{ fontSize:22, fontWeight:900, color:"#e08888" }}>-1R</span>
                </div>
              ) : (
                <>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center", marginBottom:12 }}>
                    <span style={{ fontSize:11, color:"rgba(232,224,208,0.3)", fontWeight:700 }}>TPs:</span>
                    {([1,2,3] as const).map(n => (
                      <Btn key={n} active={numPartials === n} onClick={() => setNumPartials(n)} style={{ width:38 }}>{n}</Btn>
                    ))}
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                    {Array.from({ length: numPartials }).map((_, i) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:10, fontWeight:800, color:"rgba(232,224,208,0.28)", width:28 }}>TP{i+1}</span>
                        <input value={partialRRs[i]} onChange={e => { const next = [...partialRRs] as [string,string,string]; next[i] = e.target.value; setPartialRRs(next); }} placeholder="2.0" inputMode="decimal" style={{ ...inp(), width:72 }} />
                        {parseRR(partialRRs[i]) !== null && (
                          <span style={{ fontSize:11, fontWeight:800, color:"#7dcb9a" }}>{parseRR(partialRRs[i])}R</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {computedRR !== null && tradeTaken === "yes" && (
                    <div style={{ marginTop:12, display:"inline-flex", alignItems:"center", gap:10, padding:"9px 16px", borderRadius:10, border:"1px solid rgba(74,158,106,0.22)", background:"rgba(74,158,106,0.05)" }}>
                      <span style={{ fontSize:9, fontWeight:800, color:"rgba(125,203,154,0.45)", letterSpacing:"0.14em" }}>RR FINAL</span>
                      <span style={{ fontSize:22, fontWeight:900, color:"#7dcb9a" }}>{computedRR}R</span>
                    </div>
                  )}
                </>
              )}

              <div style={div_} />

              {/* ESTADO MENTAL */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ ...lbl, marginBottom:0 }}>ESTADO MENTAL</span>
                {emotionalState && <ResetBtn onClick={() => setEmotionalState(null)} />}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {([
                  { v:"calm", l:"Tranquilo", c:"green" as const },
                  { v:"nervous", l:"Nervioso", c:"amber" as const },
                  { v:"frustrated", l:"Frustrado", c:"red" as const },
                  { v:"rushed", l:"Apurado", c:"red" as const },
                ] as { v: EmotionalState; l: string; c: "green"|"amber"|"red" }[]).map(({ v, l, c }) => (
                  <Btn key={v} active={emotionalState === v} variant={c} onClick={() => setEmotionalState(emotionalState === v ? null : v)} style={{ height:30, fontSize:11 }}>{l}</Btn>
                ))}
              </div>
              {(emotionalState === "nervous" || emotionalState === "frustrated" || emotionalState === "rushed") && (
                <div style={{ marginTop:10, padding:"10px 14px", borderRadius:10, border:"1px solid rgba(184,85,85,0.2)", background:"rgba(184,85,85,0.05)", fontSize:12, color:"rgba(224,136,136,0.6)" }}>
                  Tu historial muestra winrate cercano a 0% en estados alterados. Considerá esperar.
                </div>
              )}

              <div style={div_} />

              {/* CAPTURA + NOTA */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10, alignItems:"center" }}>
                <input id="chart-upload" type="file" accept="image/*" style={{ display:"none" }}
                  onChange={e => {
                    const file = e.target.files?.[0]; e.target.value = "";
                    if (!file) return;
                    setChartFile(file); setChartName(file.name); setChartStatus("selected");
                    uploadChart();
                  }} />
                <Btn disabled={tradeTaken !== "yes"} onClick={() => (document.getElementById("chart-upload") as HTMLInputElement)?.click()}>📷 Captura</Btn>
                {chartName && (
                  <div style={{ height:28, padding:"0 10px", borderRadius:999, display:"flex", alignItems:"center", gap:6, border:`1px solid ${chartStatus === "done" ? "rgba(74,158,106,0.3)" : "rgba(180,140,80,0.14)"}`, background:chartStatus === "done" ? "rgba(74,158,106,0.07)" : "rgba(0,0,0,0.15)", fontSize:11, fontWeight:700, color:chartStatus === "done" ? "#7dcb9a" : "rgba(232,224,208,0.35)" }}>
                    {chartName.slice(0,22)}{chartName.length > 22 ? "…" : ""}{chartStatus === "done" ? " ✓" : chartStatus === "uploading" ? " …" : ""}
                  </div>
                )}
              </div>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Contexto, confluencias, ejecución, qué salió bien/mal…" rows={4} style={txa()} />

              <div style={{ marginTop:14, display:"flex", alignItems:"center", gap:12 }}>
                <button onClick={handleSave} disabled={!tradeTimeOk} style={{ height:40, padding:"0 24px", borderRadius:999, cursor:"pointer", border:"1px solid rgba(200,146,58,0.38)", background:"rgba(200,146,58,0.09)", color:"#c8923a", fontSize:12, fontWeight:800, letterSpacing:"0.06em", opacity:tradeTimeOk ? 1 : 0.32 }}>Guardar trade</button>
                <span style={{ fontSize:11, color:"rgba(232,224,208,0.22)" }}>{trades.length} trade{trades.length !== 1 ? "s" : ""} total</span>
              </div>
            </div>

            {/* Cierre de jornada */}
            <div style={{ marginTop:10 }}>
              <button onClick={() => setDailyOpen(v => !v)} style={{ width:"100%", padding:"13px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", ...card, cursor:"pointer" }}>
                <span style={{ fontSize:11, fontWeight:800, color:"rgba(232,224,208,0.38)", letterSpacing:"0.18em" }}>CIERRE DE JORNADA</span>
                <span style={{ fontSize:11, color:dailySaved ? "rgba(74,158,106,0.6)" : "rgba(200,146,58,0.4)" }}>
                  {dailySaved ? "✓ Guardado" : dailyOpen ? "▲" : "▼"}
                </span>
              </button>
              {dailyOpen && (
                <div style={{ ...card, borderTopLeftRadius:0, borderTopRightRadius:0, borderTop:"none", marginTop:-1 }}>
                  <div style={{ display:"grid", gap:10 }}>
                    <div>
                      <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.15em", color:"rgba(184,85,85,0.5)", marginBottom:6 }}>ERROR DEL DÍA</div>
                      <textarea value={dailyError} onChange={e => setDailyError(e.target.value)} placeholder='Ej: "Sobreoperé luego del 2do SL."' rows={2} style={{ ...txa(), borderColor:"rgba(184,85,85,0.14)" }} />
                    </div>
                    <div>
                      <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.15em", color:"rgba(74,126,184,0.5)", marginBottom:6 }}>APRENDIZAJE</div>
                      <textarea value={dailyLearning} onChange={e => setDailyLearning(e.target.value)} placeholder='Ej: "Cuando esperé, el trade se dio solo."' rows={2} style={{ ...txa(), borderColor:"rgba(74,126,184,0.14)" }} />
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <Btn active={!!(dailyError.trim() && dailyLearning.trim())} variant="amber" onClick={saveDailyWrap}>Guardar cierre</Btn>
                      {dailySaved && <span style={{ fontSize:11, color:"rgba(232,224,208,0.22)" }}>{new Date(dailySaved.updatedAt).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ PRE-TRADE ════ */}
        {mode === "pretrade" && (
          <div>
            {/* Output derivado */}
            <div style={{ ...card, marginBottom:12, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", padding:"14px 18px" }}>
              <div>
                <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.22em", color:"rgba(232,224,208,0.28)", marginBottom:4 }}>DIRECCIÓN OPERABLE</div>
                <div style={{ fontSize:28, fontWeight:900, color:operableDir === "alcista" ? "#4a9e6a" : operableDir === "bajista" ? "#b85555" : "#c8923a" }}>
                  {operableDir === "alcista" ? "LONG" : operableDir === "bajista" ? "SHORT" : "WAIT"}
                </div>
              </div>
              {contextResult.contextTag && (
                <div style={{ padding:"8px 14px", borderRadius:10, border:"1px solid rgba(200,146,58,0.25)", background:"rgba(200,146,58,0.06)" }}>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.12em", color:"rgba(200,146,58,0.5)", marginBottom:3 }}>CATEGORÍA</div>
                  <div style={{ fontSize:13, fontWeight:800, color:"#c8923a" }}>{contextResult.contextTag}</div>
                </div>
              )}
              {contextResult.htfAligned !== null && (
                <div style={{ padding:"8px 14px", borderRadius:10, border:`1px solid ${contextResult.htfAligned ? "rgba(74,158,106,0.3)" : "rgba(184,85,85,0.3)"}`, background:contextResult.htfAligned ? "rgba(74,158,106,0.06)" : "rgba(184,85,85,0.06)" }}>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.12em", color:"rgba(232,224,208,0.3)", marginBottom:3 }}>HTF H1/H4</div>
                  <div style={{ fontSize:13, fontWeight:800, color:contextResult.htfAligned ? "#7dcb9a" : "#e08888" }}>{contextResult.htfAligned ? "A favor" : "En contra"}</div>
                </div>
              )}
              <ResetBtn onClick={resetPreTrade} />
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", gap:6, marginBottom:10 }}>
              {([
                [1, "1. Apertura"],
                [2, "2. Estado actual"],
                [3, "3. Update delivery"],
              ] as [PreSection, string][]).map(([s, label]) => (
                <button key={s} onClick={() => setPreSection(s)} style={{ height:32, padding:"0 14px", borderRadius:999, cursor:"pointer", fontSize:11, fontWeight:700, border:`1px solid ${preSection === s ? "rgba(200,146,58,0.45)" : "rgba(180,140,80,0.12)"}`, background:preSection === s ? "rgba(200,146,58,0.09)" : "rgba(255,255,255,0.02)", color:preSection === s ? "#c8923a" : "rgba(232,224,208,0.35)", transition:"all 0.15s" }}>{label}</button>
              ))}
            </div>

            <div style={card}>

              {/* Sección 1 */}
              {preSection === 1 && (
                <div>
                  <div style={{ fontSize:13, fontWeight:900, color:"rgba(232,224,208,0.8)", marginBottom:4 }}>Contexto apertura</div>
                  <div style={{ fontSize:11, color:"rgba(232,224,208,0.3)", marginBottom:18, lineHeight:1.5 }}>¿Cómo arrancó el precio? ¿Se potenció con sweep o no?</div>

                  <span style={lbl}>¿HUBO TOMA DE NIVEL HTF EN LA APERTURA?</span>
                  <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                    <Btn active={amSweep === "si"} variant="green" onClick={() => setAmSweep(amSweep === "si" ? null : "si")}>Sí</Btn>
                    <Btn active={amSweep === "no"} variant="red" onClick={() => { setAmSweep(amSweep === "no" ? null : "no"); setAmSweepNivel(null); setAmReac(null); }}>No</Btn>
                  </div>

                  {amSweep === "si" && (
                    <>
                      <span style={lbl}>¿CUÁL FUE EL NIVEL MÁS IMPORTANTE? (uno solo)</span>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:14 }}>
                        {LEVELS.map(l => (
                          <Btn key={l!} active={amSweepNivel === l} onClick={() => setAmSweepNivel(amSweepNivel === l ? null : l)}>{l}</Btn>
                        ))}
                      </div>
                      <span style={lbl}>¿EL PRECIO ABSORBIÓ O ACEPTÓ ESE NIVEL?</span>
                      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                        <Btn active={amReac === "absorbio"} variant="amber" onClick={() => setAmReac(amReac === "absorbio" ? null : "absorbio")}>Absorbió</Btn>
                        <Btn active={amReac === "acepto"} variant="green" onClick={() => setAmReac(amReac === "acepto" ? null : "acepto")}>Aceptó</Btn>
                      </div>
                    </>
                  )}

                  <div style={{ height:1, background:"rgba(180,140,80,0.09)", margin:"6px 0 18px" }} />

                  <span style={lbl}>¿QUÉ DIRECCIÓN TOMÓ LA AM?</span>
                  <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                    <Btn active={amDir === "alcista"} variant="green" onClick={() => setAmDir(amDir === "alcista" ? null : "alcista")}>Alcista</Btn>
                    <Btn active={amDir === "bajista"} variant="red" onClick={() => setAmDir(amDir === "bajista" ? null : "bajista")}>Bajista</Btn>
                    <Btn active={amDir === "sin-dir"} variant="amber" onClick={() => setAmDir(amDir === "sin-dir" ? null : "sin-dir")}>Sin dirección</Btn>
                  </div>

                  <div style={{ height:1, background:"rgba(180,140,80,0.09)", margin:"6px 0 18px" }} />

                  <span style={lbl}>HTF H1/H4 — ESTRUCTURA MACRO</span>
                  <div style={{ display:"flex", gap:8 }}>
                    <Btn active={htfStruct === "alcista"} variant="green" onClick={() => setHtfStruct(htfStruct === "alcista" ? null : "alcista")}>Alcista</Btn>
                    <Btn active={htfStruct === "bajista"} variant="red" onClick={() => setHtfStruct(htfStruct === "bajista" ? null : "bajista")}>Bajista</Btn>
                  </div>
                </div>
              )}

              {/* Sección 2 */}
              {preSection === 2 && (
                <div>
                  <div style={{ fontSize:13, fontWeight:900, color:"rgba(232,224,208,0.8)", marginBottom:4 }}>Estado actual de sesión</div>
                  <div style={{ fontSize:11, color:"rgba(232,224,208,0.3)", marginBottom:18, lineHeight:1.5 }}>¿Qué pasó en AM / Lunch / PM hasta ahora? Determina si estás a favor o en contra de la AM.</div>

                  <span style={lbl}>¿SE TOMÓ ALGÚN NIVEL HTF EN EL DESARROLLO DE LA SESIÓN?</span>
                  <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                    <Btn active={pmSweep === "si"} variant="green" onClick={() => setPmSweep(pmSweep === "si" ? null : "si")}>Sí</Btn>
                    <Btn active={pmSweep === "no"} variant="red" onClick={() => { setPmSweep(pmSweep === "no" ? null : "no"); setPmSweepNivel(null); setPmReac(null); }}>No</Btn>
                  </div>

                  {pmSweep === "si" && (
                    <>
                      <span style={lbl}>¿CUÁL ES EL MÁS RECIENTE?</span>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:14 }}>
                        {LEVELS.map(l => (
                          <Btn key={l!} active={pmSweepNivel === l} onClick={() => setPmSweepNivel(pmSweepNivel === l ? null : l)}>{l}</Btn>
                        ))}
                      </div>
                      <span style={lbl}>¿EL PRECIO ABSORBIÓ O ACEPTÓ ESE NIVEL?</span>
                      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                        <Btn active={pmReac === "absorbio"} variant="amber" onClick={() => setPmReac(pmReac === "absorbio" ? null : "absorbio")}>Absorbió</Btn>
                        <Btn active={pmReac === "acepto"} variant="green" onClick={() => setPmReac(pmReac === "acepto" ? null : "acepto")}>Aceptó</Btn>
                      </div>
                    </>
                  )}

                  <div style={{ height:1, background:"rgba(180,140,80,0.09)", margin:"6px 0 18px" }} />

                  <span style={lbl}>¿CÓMO ESTÁ LA ESTRUCTURA M15 AHORA?</span>
                  <div style={{ display:"flex", gap:8 }}>
                    <Btn active={m15Struct === "alcista"} variant="green" onClick={() => setM15Struct(m15Struct === "alcista" ? null : "alcista")}>Alcista</Btn>
                    <Btn active={m15Struct === "bajista"} variant="red" onClick={() => setM15Struct(m15Struct === "bajista" ? null : "bajista")}>Bajista</Btn>
                  </div>
                </div>
              )}

              {/* Sección 3 */}
              {preSection === 3 && (
                <div>
                  <div style={{ fontSize:13, fontWeight:900, color:"rgba(232,224,208,0.8)", marginBottom:4 }}>Update de delivery</div>
                  <div style={{ fontSize:11, color:"rgba(232,224,208,0.3)", marginBottom:18, lineHeight:1.5 }}>CISD = Cambio en el estado de la entrega en M15.</div>

                  <span style={lbl}>¿HAY UN CISD M15 ACTIVO?</span>
                  <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                    <Btn active={hasCisd === "si"} variant="green" onClick={() => setHasCisd(hasCisd === "si" ? null : "si")}>Sí</Btn>
                    <Btn active={hasCisd === "no"} variant="red" onClick={() => { setHasCisd(hasCisd === "no" ? null : "no"); setCisdDir(null); }}>No</Btn>
                  </div>

                  {hasCisd === "si" && (
                    <>
                      <span style={lbl}>¿EL CISD M15 ES ALCISTA O BAJISTA?</span>
                      <div style={{ display:"flex", gap:8 }}>
                        <Btn active={cisdDir === "alcista"} variant="green" onClick={() => setCisdDir(cisdDir === "alcista" ? null : "alcista")}>Alcista</Btn>
                        <Btn active={cisdDir === "bajista"} variant="red" onClick={() => setCisdDir(cisdDir === "bajista" ? null : "bajista")}>Bajista</Btn>
                      </div>
                    </>
                  )}

                  {hasCisd === "no" && (
                    <div style={{ padding:"10px 14px", borderRadius:10, border:"1px solid rgba(74,158,106,0.22)", background:"rgba(74,158,106,0.05)", fontSize:12, color:"rgba(125,203,154,0.65)" }}>
                      Sin CISD M15 — dirección operable viene de estructura M15 y AM.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Ir al journal */}
            <div style={{ marginTop:10, display:"flex", justifyContent:"flex-end" }}>
              <button onClick={() => setMode("journal")} style={{ height:38, padding:"0 20px", borderRadius:999, cursor:"pointer", border:"1px solid rgba(200,146,58,0.4)", background:"rgba(200,146,58,0.09)", color:"#c8923a", fontSize:12, fontWeight:800 }}>Ir al Journal →</button>
            </div>

            {/* Checklist */}
            <div style={{ ...card, marginTop:10 }}>
              <span style={lbl}>CHECKLIST ANTES DE OPERAR</span>
              <div style={{ display:"grid", gap:2 }}>
                {[
                  "¿Estás solo y en la computadora?",
                  "¿CISD M15 está alineado con tu entrada?",
                  "¿Pasaron más de 10 min desde tu último SL?",
                  "¿Hay FVG claro en tu dirección?",
                  "¿Revisaste el SMT entre NQ y ES?",
                  "¿Tenés un target lógico de liquidez?",
                ].map((q, i) => <ChecklistItem key={i} question={q} />)}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}