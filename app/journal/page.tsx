"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createTrade, listTrades, updateTradeImage } from "@/lib/tradesDb";
import { uploadTradeImage } from "@/lib/uploadTradeImage";
import { getTodayKey, isValidHHMM, buildTimestamp, inferBias } from "@/lib/journalLogic";
import type { Level, Instrument, TradeSide, FollowedPlan, SetupTag, InvalidationKind, YesNo } from "@/lib/types";

type Reaction = "accept" | "absorb" | "unclear";
type Step = 1 | 2 | 3 | 4 | 5;
type Outcome = "PROFIT" | "STOP" | "BE" | "NONE";
type Mode = "journal" | "pretrade";
type EmotionalState = "calm" | "nervous" | "frustrated" | "rushed";
type ConfirmationCandle = "m5" | "m2" | null;
type ErrorTag = "overtrading" | "against_m15" | "no_confirmation" | "phone" | "distraction" | "revenge" | null;

type DailyWrapType = {
  date: string;
  dailyError: string;
  dailyLearning: string;
  updatedAt: number;
};

const LS_DAILY_KEY = "pm_scalps_daily_v1";

// ─── Checklist item (componente separado — respeta Rules of Hooks) ──────────
function ChecklistItem({ question }: { question: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <div onClick={() => setChecked(v => !v)}
      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "5px 0" }}>
      <div style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        border: `1px solid ${checked ? "rgba(74,158,106,0.6)" : "rgba(180,140,80,0.2)"}`,
        background: checked ? "rgba(74,158,106,0.15)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color: "#7dcb9a", transition: "all 0.15s",
      }}>{checked ? "✓" : ""}</div>
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: checked ? "rgba(232,224,208,0.75)" : "rgba(232,224,208,0.35)",
        transition: "color 0.15s",
      }}>{question}</span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseRR(s: string): number | null {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function outcomeToDb(o: Outcome): "win" | "loss" | "be" | "unknown" {
  switch (o) {
    case "PROFIT": return "win";
    case "STOP": return "loss";
    case "BE": return "be";
    default: return "unknown";
  }
}
function ll(l: Level): string {
  const m: Record<Level, string> = { PDH:"PDH", PDL:"PDL", ASIA_H:"Asia H", ASIA_L:"Asia L", LONDON_H:"London H", LONDON_L:"London L", WEEKLY_H:"Weekly H", WEEKLY_L:"Weekly L" };
  return m[l];
}
function ls(l: Level): "buy" | "sell" {
  return l === "PDH" || l === "ASIA_H" || l === "LONDON_H" || l === "WEEKLY_H" ? "buy" : "sell";
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "rgba(10, 8, 5, 0.8)",
  border: "1px solid rgba(180, 140, 80, 0.14)",
  borderRadius: 16,
  padding: "18px 20px",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};
const lbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: "0.18em",
  color: "rgba(232,224,208,0.28)", marginBottom: 12, display: "block",
};
const div_: React.CSSProperties = {
  height: 1, background: "rgba(180,140,80,0.09)", margin: "16px 0",
};
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
    outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit",
    boxSizing: "border-box",
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

function Btn({ children, active=false, variant="default" as any, onClick, disabled=false, style: sx }: {
  children: React.ReactNode; active?: boolean;
  variant?: "default"|"green"|"red"|"amber"|"blue";
  onClick?: () => void; disabled?: boolean; style?: React.CSSProperties;
}) {
  return <button onClick={disabled ? undefined : onClick} style={{ ...bst(active, variant, disabled), ...sx }}>{children}</button>;
}

// Pequeño botón reset ×
function ResetBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Resetear" style={{
      height: 24, padding: "0 8px", borderRadius: 999, cursor: "pointer",
      border: "1px solid rgba(180,140,80,0.15)", background: "transparent",
      color: "rgba(232,224,208,0.25)", fontSize: 10, fontWeight: 800,
      transition: "all 0.15s",
    }}>× reset</button>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
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

  // ── Journal state ──
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

  // ── Pre-trade state ──
  const [liqTaken, setLiqTaken] = useState<"yes"|"no"|"unknown">("unknown");
  const [takenLevels, setTakenLevels] = useState<Level[]>([]);
  const [lastTaken, setLastTaken] = useState<Level|null>(null);
  const [reaction, setReaction] = useState<Reaction>("unclear");
  const [hasFvg, setHasFvg] = useState<"yes"|"no"|"skip">("skip");
  const [pendingLevels, setPendingLevels] = useState<Level[]>([]);
  const [invalidationHappened, setInvalidationHappened] = useState<"yes"|"no"|"unknown">("unknown");
  const [invalidationKind, setInvalidationKind] = useState<InvalidationKind|null>(null);
  const [m15Imbalance, setM15Imbalance] = useState<YesNo|null>(null);
  const [preStep, setPreStep] = useState<Step>(1);

  // ── Chart ──
  const [lastSavedTradeId, setLastSavedTradeId] = useState<string|null>(null);
  const [chartFile, setChartFile] = useState<File|null>(null);
  const [chartName, setChartName] = useState("");
  const [chartStatus, setChartStatus] = useState<"idle"|"selected"|"uploading"|"done"|"error">("idle");

  // ── Daily ──
  const [dailyError, setDailyError] = useState("");
  const [dailyLearning, setDailyLearning] = useState("");
  const [dailySaved, setDailySaved] = useState<DailyWrapType|null>(null);
  const [dailyOpen, setDailyOpen] = useState(false);

  // ── Computed ──
  const context = useMemo(() => inferBias({
    liqTaken, takenLevels, lastTaken, reaction, hasFvg,
    pendingLevels, invalidationHappened, invalidationKind, m15Imbalance,
  }), [liqTaken, takenLevels, lastTaken, reaction, hasFvg, pendingLevels, invalidationHappened, invalidationKind, m15Imbalance]);

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

  function toggleLevel(arr: Level[], setArr: (v: Level[]) => void, l: Level) {
    setArr(arr.includes(l) ? arr.filter(x => x !== l) : [...arr, l]);
  }

  // ── Reset functions ──
  function resetJournalForm() {
    setTradeTaken("yes"); setTradeDate(getTodayKey()); setTradeTime("");
    setTradeSide("BUY"); setInstrument("NQ"); setSetupTag("unknown");
    setOutcome("NONE"); setFollowedPlan("yes"); setNumPartials(1);
    setPartialRRs(["","",""]); setNote(""); setEmotionalState(null);
    setErrorTag(null); setSmt(null); setAmdPresented(null); setConfirmationCandle(null);
    setChartFile(null); setChartName(""); setChartStatus("idle");
  }

  function resetPreTrade() {
    setLiqTaken("unknown"); setTakenLevels([]); setLastTaken(null);
    setReaction("unclear"); setHasFvg("skip"); setPendingLevels([]);
    setInvalidationHappened("unknown"); setInvalidationKind(null);
    setM15Imbalance(null); setPreStep(1);
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
    const finalRR = filled.length ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length * 100) / 100 : null;
    try {
      if (!userId) return;
      const tradeId = await createTrade({
        userId, createdAt: buildTimestamp(tradeDate, tradeTime),
        liqTaken, takenLevels, lastTaken, reaction, pendingLevels, hasFvg,
        instrument, biasShown: context.biasShown, marketState: context.marketState.state,
        invalidationHappened, suggestedTargets: context.suggestedTargets,
        helped: true, tradeTaken, tradeTime: tradeTime.trim(),
        tradeSide, followedPlan, rr: finalRR, setupTag,
        outcome: outcomeToDb(outcome), note: note.trim(),
        numPartials: tradeTaken === "yes" ? numPartials : null,
        partialRRs: tradeTaken === "yes" ? filled : null,
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

  const levelsAll: Level[] = ["PDH","PDL","ASIA_H","ASIA_L","LONDON_H","LONDON_L","WEEKLY_H","WEEKLY_L"];
  const biasColor = context.biasShown === "LONG" ? "#4a9e6a" : context.biasShown === "SHORT" ? "#b85555" : "#c8923a";
  const hasContext = context.biasShown !== "WAIT" && context.biasShown !== "NO TRADE";

  if (!sessionReady || !userId) {
    return <div style={{ minHeight:"100vh", background:"#0c0a07", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(232,224,208,0.3)", fontSize:13 }}>Cargando…</div>;
  }

  return (
    <>
      {/* ── BG fijo — fuera del scroll ── */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: "url('/PM_SCALPS_BG.png')",
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
      }} />
      {/* Overlay oscuro */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1,
        background: "rgba(6,4,2,0.70)",
        backgroundImage: "radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.28) 0%, transparent 60%)",
      }} />

      {/* ── Welcome modal ── */}
      {showWelcome && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(4,3,1,0.9)", backdropFilter: "blur(14px)", padding: 20,
        }}>
          <div style={{ maxWidth: 420, width: "100%", ...card, padding: "32px 28px", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.28em", color: "rgba(200,146,58,0.45)" }}>PM SCALPS COACH</div>
            <div style={{ marginTop: 22, fontSize: 17, fontWeight: 800, lineHeight: 1.55, color: "rgba(232,224,208,0.9)" }}>{MOTIVATION}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: "rgba(232,224,208,0.28)" }}>Respirá. Observá. Reaccioná.</div>
            <button onClick={() => setShowWelcome(false)} style={{
              marginTop: 24, width: "100%", height: 42, borderRadius: 999,
              border: "1px solid rgba(200,146,58,0.4)", background: "rgba(200,146,58,0.1)",
              color: "#c8923a", fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", cursor: "pointer",
            }}>INICIAR →</button>
          </div>
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div style={{ position: "relative", zIndex: 2, maxWidth: 820, margin: "0 auto", padding: "24px 20px 48px" }}>

        {/* Top bar */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.22em", color: "rgba(200,146,58,0.45)" }}>TRADING DAY</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "rgba(232,224,208,0.88)", marginTop: 2 }}>
              {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{
              height: 32, padding: "0 14px", display: "flex", alignItems: "center", borderRadius: 999,
              border: `1px solid ${todayTrades.length >= 3 ? "rgba(184,85,85,0.35)" : "rgba(180,140,80,0.14)"}`,
              background: todayTrades.length >= 3 ? "rgba(184,85,85,0.08)" : "rgba(0,0,0,0.2)",
              fontSize: 11, fontWeight: 700,
              color: todayTrades.length >= 3 ? "#e08888" : "rgba(232,224,208,0.35)",
            }}>
              {todayTrades.length} trade{todayTrades.length !== 1 ? "s" : ""} hoy{todayTrades.length >= 3 && " ⚠️"}
            </div>
            <Btn active={mode === "pretrade"} variant="amber"
              onClick={() => setMode(mode === "journal" ? "pretrade" : "journal")}>
              {mode === "journal" ? "Pre-trade →" : "← Journal"}
            </Btn>
          </div>
        </div>

        {/* Sobreoperación */}
        {todayTrades.length >= 3 && (
          <div style={{ ...card, marginBottom: 14, borderColor: "rgba(184,85,85,0.28)", background: "rgba(184,85,85,0.05)", display: "flex", gap: 12 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#e08888", marginBottom: 3 }}>{todayTrades.length} TRADES HOY — REVISÁ ANTES DE CONTINUAR</div>
              <div style={{ fontSize: 11, color: "rgba(224,136,136,0.5)" }}>Tu historial muestra que el 3er+ trade suele ser sobreoperación.</div>
            </div>
          </div>
        )}

        {/* ════ JOURNAL ════ */}
        {mode === "journal" && (
          <div>
            {hasContext && (
              <div style={{ ...card, marginBottom: 12, borderColor: context.biasShown === "LONG" ? "rgba(74,158,106,0.28)" : "rgba(184,85,85,0.28)", background: context.biasShown === "LONG" ? "rgba(74,158,106,0.05)" : "rgba(184,85,85,0.05)", display: "flex", alignItems: "center", gap: 14, padding: "12px 18px" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: biasColor }}>{context.biasShown}</div>
                <div style={{ fontSize: 11, color: "rgba(232,224,208,0.3)", fontWeight: 700 }}>· {context.marketState.state}</div>
                <button onClick={() => setMode("pretrade")} style={{ marginLeft: "auto", fontSize: 11, color: "rgba(200,146,58,0.5)", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Editar →</button>
              </div>
            )}

            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(232,224,208,0.88)" }}>Registrar en el Journal</div>
                <ResetBtn onClick={resetJournalForm} />
              </div>

              {/* SESIÓN */}
              <span style={lbl}>SESIÓN</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn active={tradeTaken === "yes"} variant="green" onClick={() => setTradeTaken("yes")}>Sí</Btn>
                  <Btn active={tradeTaken === "no"} variant="red" onClick={() => setTradeTaken("no")}>No</Btn>
                </div>
                <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} style={inp()} />
                <input value={tradeTime} onChange={e => setTradeTime(e.target.value)}
                  placeholder="HH:MM" inputMode="numeric" disabled={tradeTaken !== "yes"}
                  style={{ ...inp(!tradeTimeOk), width: 78, opacity: tradeTaken !== "yes" ? 0.32 : 1 }} />
                <div style={{ display: "flex", gap: 6 }}>
                  {(["NQ","ES"] as Instrument[]).map(ins => (
                    <Btn key={ins} active={instrument === ins && tradeTaken === "yes"} disabled={tradeTaken !== "yes"} onClick={() => setInstrument(ins)}>{ins}</Btn>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn active={tradeSide === "BUY" && tradeTaken === "yes"} variant="blue" disabled={tradeTaken !== "yes"} onClick={() => setTradeSide("BUY")}>BUY</Btn>
                  <Btn active={tradeSide === "SELL" && tradeTaken === "yes"} variant="red" disabled={tradeTaken !== "yes"} onClick={() => setTradeSide("SELL")}>SELL</Btn>
                </div>
              </div>
              {tradeTaken === "yes" && tradeTime && !tradeTimeOk && (
                <div style={{ fontSize: 11, color: "#e08888", marginTop: 6 }}>Hora inválida — usá HH:MM (ej: 14:35)</div>
              )}

              <div style={div_} />

              {/* SETUP */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ ...lbl, marginBottom: 0 }}>SETUP</span>
                {setupTag !== "unknown" && <ResetBtn onClick={() => setSetupTag("unknown")} />}
              </div>
              <div style={{ display: "grid", gap: 7 }}>
                {[
                  { tag: "A" as SetupTag, label: "Setup A", desc: "OB + FVG + OTE + Confirmación · 2–3R" },
                  { tag: "B" as SetupTag, label: "Setup B", desc: "FVG + Confirmación · 1.5R" },
                  { tag: "none" as SetupTag, label: "Sin setup / Solo estudio", desc: "Registrás el escenario sin entrada" },
                ].map(({ tag, label, desc }) => {
                  const isActive = setupTag === tag;
                  const dis = tradeTaken !== "yes" && tag !== "none";
                  return (
                    <button key={tag} onClick={() => !dis && setSetupTag(isActive ? "unknown" : tag)} style={{
                      padding: "11px 15px", borderRadius: 11, textAlign: "left",
                      border: `1px solid ${isActive ? "rgba(200,146,58,0.4)" : "rgba(180,140,80,0.1)"}`,
                      background: isActive ? "rgba(200,146,58,0.07)" : "rgba(0,0,0,0.12)",
                      cursor: dis ? "default" : "pointer", opacity: dis ? 0.3 : 1, transition: "all 0.15s",
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: isActive ? "#c8923a" : "rgba(232,224,208,0.65)" }}>{label}</div>
                      <div style={{ fontSize: 10, color: "rgba(232,224,208,0.28)", marginTop: 2 }}>{desc}</div>
                    </button>
                  );
                })}
              </div>

              <div style={div_} />

              {/* ICT */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ ...lbl, marginBottom: 0 }}>ICT · CONTEXTO</span>
                {(smt !== null || amdPresented !== null || confirmationCandle !== null) && (
                  <ResetBtn onClick={() => { setSmt(null); setAmdPresented(null); setConfirmationCandle(null); }} />
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6 }}>SMT NQ/ES</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn active={smt === true} variant="green" onClick={() => setSmt(smt === true ? null : true)}>Sí</Btn>
                    <Btn active={smt === false} variant="red" onClick={() => setSmt(smt === false ? null : false)}>No</Btn>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6 }}>¿Se presentó AMD?</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn active={amdPresented === true} variant="green" onClick={() => setAmdPresented(amdPresented === true ? null : true)}>Sí</Btn>
                    <Btn active={amdPresented === false} variant="red" onClick={() => setAmdPresented(amdPresented === false ? null : false)}>No</Btn>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6 }}>Vela confirmación</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn active={confirmationCandle === "m5"} variant="amber" onClick={() => setConfirmationCandle(confirmationCandle === "m5" ? null : "m5")}>M5</Btn>
                    <Btn active={confirmationCandle === "m2"} variant="amber" onClick={() => setConfirmationCandle(confirmationCandle === "m2" ? null : "m2")}>M2</Btn>
                  </div>
                </div>
              </div>

              <div style={div_} />

              {/* RESULTADO */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ ...lbl, marginBottom: 0 }}>RESULTADO</span>
                {(outcome !== "NONE" || followedPlan !== "yes" || errorTag) && (
                  <ResetBtn onClick={() => { setOutcome("NONE"); setFollowedPlan("yes"); setErrorTag(null); }} />
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {[
                  { val: "PROFIT" as Outcome, l: "Profit", v: "green" as const },
                  { val: "STOP" as Outcome, l: "Stop", v: "red" as const },
                  { val: "BE" as Outcome, l: "BE", v: "amber" as const },
                  { val: "NONE" as Outcome, l: "—", v: "default" as const },
                ].map(({ val, l, v }) => (
                  <Btn key={val} active={outcome === val && tradeTaken === "yes"} variant={v}
                    disabled={tradeTaken !== "yes"} onClick={() => setOutcome(outcome === val ? "NONE" : val)}>{l}</Btn>
                ))}
                <div style={{ width: 1, height: 22, background: "rgba(180,140,80,0.1)", margin: "0 2px" }} />
                <Btn active={followedPlan === "yes" && tradeTaken === "yes"} variant="green"
                  disabled={tradeTaken !== "yes"} onClick={() => setFollowedPlan("yes")}>Cumplí ✓</Btn>
                <Btn active={followedPlan === "no" && tradeTaken === "yes"} variant="red"
                  disabled={tradeTaken !== "yes"} onClick={() => setFollowedPlan("no")}>No cumplí ✗</Btn>
              </div>
              {followedPlan === "no" && tradeTaken === "yes" && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.25)" }}>MOTIVO</span>
                  {([
                    { v: "overtrading", l: "Sobreoperación" },
                    { v: "against_m15", l: "Contra M15" },
                    { v: "no_confirmation", l: "Sin confirmación" },
                    { v: "phone", l: "Desde teléfono" },
                    { v: "distraction", l: "Distracción" },
                    { v: "revenge", l: "Revenge" },
                  ] as { v: ErrorTag; l: string }[]).map(({ v, l }) => (
                    <Btn key={v as string} active={errorTag === v} variant="red"
                      onClick={() => setErrorTag(errorTag === v ? null : v)}
                      style={{ height: 28, fontSize: 11 }}>{l}</Btn>
                  ))}
                </div>
              )}

              <div style={div_} />

              {/* PARCIALES */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ ...lbl, marginBottom: 0 }}>PARCIALES & RR</span>
                {(partialRRs.some(r => r !== "") || numPartials !== 1) && (
                  <ResetBtn onClick={() => { setNumPartials(1); setPartialRRs(["","",""]); }} />
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: "rgba(232,224,208,0.3)", fontWeight: 700 }}>TPs:</span>
                {([1,2,3] as const).map(n => (
                  <Btn key={n} active={numPartials === n && tradeTaken === "yes"} disabled={tradeTaken !== "yes"}
                    onClick={() => setNumPartials(n)} style={{ width: 38 }}>{n}</Btn>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {Array.from({ length: numPartials }).map((_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", width: 28 }}>TP{i+1}</span>
                    <input value={partialRRs[i]} onChange={e => {
                      const next = [...partialRRs] as [string,string,string];
                      next[i] = e.target.value; setPartialRRs(next);
                    }} placeholder="2.0" inputMode="decimal" disabled={tradeTaken !== "yes"}
                      style={{ ...inp(), width: 70, opacity: tradeTaken !== "yes" ? 0.32 : 1 }} />
                    {parseRR(partialRRs[i]) !== null && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#7dcb9a" }}>{parseRR(partialRRs[i])}R</span>
                    )}
                  </div>
                ))}
              </div>
              {computedRR !== null && tradeTaken === "yes" && (
                <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 10, padding: "9px 16px", borderRadius: 10, border: "1px solid rgba(74,158,106,0.22)", background: "rgba(74,158,106,0.05)" }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(125,203,154,0.45)", letterSpacing: "0.14em" }}>RR FINAL</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: "#7dcb9a" }}>{computedRR}R</span>
                </div>
              )}

              <div style={div_} />

              {/* ESTADO MENTAL */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ ...lbl, marginBottom: 0 }}>ESTADO MENTAL</span>
                {emotionalState && <ResetBtn onClick={() => setEmotionalState(null)} />}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {([
                  { v: "calm", l: "Tranquilo", c: "green" as const },
                  { v: "nervous", l: "Nervioso", c: "amber" as const },
                  { v: "frustrated", l: "Frustrado", c: "red" as const },
                  { v: "rushed", l: "Apurado", c: "red" as const },
                ] as { v: EmotionalState; l: string; c: "green"|"amber"|"red" }[]).map(({ v, l, c }) => (
                  <Btn key={v} active={emotionalState === v} variant={c}
                    onClick={() => setEmotionalState(emotionalState === v ? null : v)}
                    style={{ height: 30, fontSize: 11 }}>{l}</Btn>
                ))}
              </div>
              {(emotionalState === "nervous" || emotionalState === "frustrated" || emotionalState === "rushed") && (
                <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(184,85,85,0.2)", background: "rgba(184,85,85,0.05)", fontSize: 12, color: "rgba(224,136,136,0.6)" }}>
                  Tu historial muestra winrate cercano a 0% en estados alterados. Considerá esperar.
                </div>
              )}

              <div style={div_} />

              {/* CAPTURA + NOTA */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, alignItems: "center" }}>
                <input id="chart-upload" type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => {
                    const file = e.target.files?.[0]; e.target.value = "";
                    if (!file) return;
                    setChartFile(file); setChartName(file.name); setChartStatus("selected");
                    uploadChart();
                  }} />
                <Btn disabled={tradeTaken !== "yes"}
                  onClick={() => (document.getElementById("chart-upload") as HTMLInputElement)?.click()}>
                  📷 Captura
                </Btn>
                {chartName && (
                  <div style={{
                    height: 28, padding: "0 10px", borderRadius: 999,
                    display: "flex", alignItems: "center", gap: 6,
                    border: `1px solid ${chartStatus === "done" ? "rgba(74,158,106,0.3)" : "rgba(180,140,80,0.14)"}`,
                    background: chartStatus === "done" ? "rgba(74,158,106,0.07)" : "rgba(0,0,0,0.15)",
                    fontSize: 11, fontWeight: 700,
                    color: chartStatus === "done" ? "#7dcb9a" : "rgba(232,224,208,0.35)",
                  }}>
                    {chartName.slice(0,22)}{chartName.length > 22 ? "…" : ""}{chartStatus === "done" ? " ✓" : chartStatus === "uploading" ? " …" : ""}
                  </div>
                )}
              </div>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="Contexto, confluencias, ejecución, qué salió bien/mal…"
                rows={4} style={txa()} />

              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={handleSave} disabled={!tradeTimeOk} style={{
                  height: 40, padding: "0 24px", borderRadius: 999, cursor: "pointer",
                  border: "1px solid rgba(200,146,58,0.38)", background: "rgba(200,146,58,0.09)",
                  color: "#c8923a", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em",
                  opacity: tradeTimeOk ? 1 : 0.32,
                }}>Guardar trade</button>
                <span style={{ fontSize: 11, color: "rgba(232,224,208,0.22)" }}>{trades.length} trade{trades.length !== 1 ? "s" : ""} total</span>
              </div>
            </div>

            {/* Cierre de jornada */}
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setDailyOpen(v => !v)} style={{ width: "100%", padding: "13px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", ...card, cursor: "pointer" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(232,224,208,0.38)", letterSpacing: "0.18em" }}>CIERRE DE JORNADA</span>
                <span style={{ fontSize: 11, color: dailySaved ? "rgba(74,158,106,0.6)" : "rgba(200,146,58,0.4)" }}>
                  {dailySaved ? "✓ Guardado" : dailyOpen ? "▲" : "▼"}
                </span>
              </button>
              {dailyOpen && (
                <div style={{ ...card, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: "none", marginTop: -1 }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "rgba(184,85,85,0.5)", marginBottom: 6 }}>ERROR DEL DÍA</div>
                      <textarea value={dailyError} onChange={e => setDailyError(e.target.value)}
                        placeholder='Ej: "Sobreoperé luego del 2do SL."' rows={2}
                        style={{ ...txa(), borderColor: "rgba(184,85,85,0.14)" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "rgba(74,126,184,0.5)", marginBottom: 6 }}>APRENDIZAJE</div>
                      <textarea value={dailyLearning} onChange={e => setDailyLearning(e.target.value)}
                        placeholder='Ej: "Cuando esperé, el trade se dio solo."' rows={2}
                        style={{ ...txa(), borderColor: "rgba(74,126,184,0.14)" }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Btn active={!!(dailyError.trim() && dailyLearning.trim())} variant="amber" onClick={saveDailyWrap}>Guardar cierre</Btn>
                      {dailySaved && <span style={{ fontSize: 11, color: "rgba(232,224,208,0.22)" }}>{new Date(dailySaved.updatedAt).toLocaleTimeString()}</span>}
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
            {/* Bias output */}
            <div style={{ ...card, marginBottom: 12, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.22em", color: "rgba(232,224,208,0.28)", marginBottom: 4 }}>DIRECCIÓN OPERABLE</div>
                <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: "0.04em", color: biasColor }}>{context.biasShown}</div>
              </div>
              <div style={{
                padding: "10px 14px", borderRadius: 10, flex: 1, minWidth: 200,
                border: `1px solid ${context.marketState.tone === "good" ? "rgba(74,158,106,0.22)" : context.marketState.tone === "danger" ? "rgba(184,85,85,0.22)" : "rgba(200,146,58,0.18)"}`,
                background: context.marketState.tone === "good" ? "rgba(74,158,106,0.05)" : context.marketState.tone === "danger" ? "rgba(184,85,85,0.05)" : "rgba(200,146,58,0.04)",
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(232,224,208,0.65)" }}>{context.marketState.state}</div>
                <div style={{ fontSize: 11, color: "rgba(232,224,208,0.35)", marginTop: 3 }}>{context.marketState.desc}</div>
              </div>
              <ResetBtn onClick={resetPreTrade} />
            </div>

            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: "rgba(232,224,208,0.85)" }}>Análisis Pre-trade</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1,2,3,4,5].map(s => (
                    <div key={s} style={{ width: 20, height: 3, borderRadius: 999, transition: "background 0.2s", background: s <= preStep ? "rgba(200,146,58,0.55)" : "rgba(180,140,80,0.14)" }} />
                  ))}
                </div>
              </div>

              {preStep === 1 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,224,208,0.78)", marginBottom: 5 }}>1 · ¿Se tomó liquidez importante hoy?</div>
                  <div style={{ fontSize: 11, color: "rgba(232,224,208,0.32)", marginBottom: 14 }}>PDH/PDL · London H/L · Asia H/L</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <Btn active={liqTaken === "yes"} variant="green" onClick={() => setLiqTaken(liqTaken === "yes" ? "unknown" : "yes")}>Sí</Btn>
                    <Btn active={liqTaken === "no"} variant="red" onClick={() => setLiqTaken(liqTaken === "no" ? "unknown" : "no")}>No</Btn>
                  </div>
                  <Btn active={liqTaken !== "unknown"} variant="amber" disabled={liqTaken === "unknown"} onClick={() => setPreStep(2)}>Siguiente →</Btn>
                </div>
              )}

              {preStep === 2 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,224,208,0.78)", marginBottom: 5 }}>
                    {liqTaken === "yes" ? "2 · ¿Qué niveles se tomaron?" : "2 · ¿Cómo está M15?"}
                  </div>
                  {liqTaken === "yes" ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                      {levelsAll.map(l => {
                        const on = takenLevels.includes(l);
                        const side = ls(l);
                        return (
                          <button key={l} onClick={() => toggleLevel(takenLevels, setTakenLevels, l)} style={{
                            height: 30, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                            border: `1px solid ${on ? (side === "buy" ? "rgba(74,158,106,0.5)" : "rgba(184,85,85,0.5)") : "rgba(180,140,80,0.14)"}`,
                            background: on ? (side === "buy" ? "rgba(74,158,106,0.12)" : "rgba(184,85,85,0.12)") : "transparent",
                            color: on ? (side === "buy" ? "#7dcb9a" : "#e08888") : "rgba(232,224,208,0.35)",
                            fontSize: 11, fontWeight: 700, transition: "all 0.15s",
                          }}>{on ? "✓ " : ""}{ll(l)}</button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <Btn active={reaction === "accept"} onClick={() => setReaction(reaction === "accept" ? "unclear" : "accept")}>Expansión</Btn>
                      <Btn active={reaction === "absorb"} onClick={() => setReaction(reaction === "absorb" ? "unclear" : "absorb")}>Rango/Chop</Btn>
                      <Btn active={reaction === "unclear"} onClick={() => setReaction("unclear")}>No claro</Btn>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={() => setPreStep(1)}>← Atrás</Btn>
                    <Btn active variant="amber" disabled={liqTaken === "yes" ? takenLevels.length === 0 : false}
                      onClick={() => setPreStep(liqTaken === "yes" ? 3 : 4)}>Siguiente →</Btn>
                  </div>
                </div>
              )}

              {preStep === 3 && liqTaken === "yes" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,224,208,0.78)", marginBottom: 5 }}>3 · ¿Cuál fue la ÚLTIMA?</div>
                  <div style={{ fontSize: 11, color: "rgba(232,224,208,0.32)", marginBottom: 14 }}>La última manda el sesgo</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                    {takenLevels.map(l => (
                      <Btn key={l} active={lastTaken === l} onClick={() => setLastTaken(lastTaken === l ? null : l)}>{ll(l)}</Btn>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={() => setPreStep(2)}>← Atrás</Btn>
                    <Btn active={lastTaken !== null} variant="amber" disabled={!lastTaken} onClick={() => setPreStep(4)}>Siguiente →</Btn>
                  </div>
                </div>
              )}

              {preStep === 4 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,224,208,0.78)", marginBottom: 5 }}>
                    {liqTaken === "yes" ? "4 · Post-toma: ¿aceptación o absorción?" : "4 · ¿Seguís esperando evento?"}
                  </div>
                  {liqTaken === "yes" && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <Btn active={reaction === "accept"} variant="green" onClick={() => setReaction(reaction === "accept" ? "unclear" : "accept")}>Aceptación</Btn>
                      <Btn active={reaction === "absorb"} variant="red" onClick={() => setReaction(reaction === "absorb" ? "unclear" : "absorb")}>Absorción</Btn>
                      <Btn active={reaction === "unclear"} onClick={() => setReaction("unclear")}>No claro</Btn>
                    </div>
                  )}
                  {liqTaken === "no" && <div style={{ fontSize: 11, color: "rgba(232,224,208,0.32)", marginBottom: 16 }}>Sin sweep, tu edge exige paciencia.</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={() => setPreStep(liqTaken === "yes" ? 3 : 2)}>← Atrás</Btn>
                    <Btn active variant="amber" onClick={() => setPreStep(5)}>Siguiente →</Btn>
                  </div>
                </div>
              )}

              {preStep === 5 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(232,224,208,0.78)", marginBottom: 5 }}>5 · Gate técnico: ¿hay FVG?</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    <Btn active={hasFvg === "yes"} variant="green" onClick={() => setHasFvg(hasFvg === "yes" ? "skip" : "yes")}>Sí, hay FVG</Btn>
                    <Btn active={hasFvg === "no"} variant="red" onClick={() => setHasFvg(hasFvg === "no" ? "skip" : "no")}>No hay FVG</Btn>
                  </div>
                  {hasFvg === "no" && (
                    <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(184,85,85,0.22)", background: "rgba(184,85,85,0.05)", fontSize: 12, color: "rgba(224,136,136,0.65)", marginBottom: 14 }}>
                      Sin FVG no hay trade. Esperá que el mercado lo construya.
                    </div>
                  )}
                  {hasFvg === "yes" && (
                    <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(74,158,106,0.22)", background: "rgba(74,158,106,0.05)", fontSize: 12, color: "rgba(125,203,154,0.65)", marginBottom: 14 }}>
                      Setup A: OB + FVG + OTE + Confirmación → 2–3R<br />
                      Setup B: FVG + Confirmación → 1.5R
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={() => setPreStep(4)}>← Atrás</Btn>
                    <button onClick={() => setMode("journal")} style={{
                      height: 36, padding: "0 20px", borderRadius: 999, cursor: "pointer",
                      border: "1px solid rgba(200,146,58,0.4)", background: "rgba(200,146,58,0.09)",
                      color: "#c8923a", fontSize: 12, fontWeight: 800,
                    }}>Ir al Journal →</button>
                  </div>
                </div>
              )}
            </div>

            {/* Checklist */}
            <div style={{ ...card, marginTop: 10 }}>
              <span style={lbl}>CHECKLIST ANTES DE OPERAR</span>
              <div style={{ display: "grid", gap: 2 }}>
                {[
                  "¿Estás solo y en la computadora?",
                  "¿M15 está alineado con tu entrada?",
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