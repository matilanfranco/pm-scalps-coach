"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createTrade, listTrades, updateTradeImage } from "@/lib/tradesDb";
import { uploadTradeImage } from "@/lib/uploadTradeImage";

import WelcomeModal from "@/components/journal/WelcomeModal";
import ContextPanel from "@/components/journal/ContextPanel";
import StepsFlow from "@/components/journal/StepsFlow";
import TradeForm from "@/components/journal/TradeForm";
import DailyWrap from "@/components/journal/DailyWrap";

import type { Level, Instrument, TradeSide, FollowedPlan, SetupTag, InvalidationKind, YesNo } from "@/lib/types";
import {
  getTodayKey,
  isValidHHMM,
  buildTimestamp,
  inferBias,
  suggestTargets,
} from "@/lib/journalLogic";

// ── Types locales ──
type Reaction = "accept" | "absorb" | "unclear";
type Step = 1 | 2 | 3 | 4 | 5;
type Outcome = "PROFIT" | "STOP" | "BE" | "NONE";

type DailyWrapType = {
  date: string;
  dailyError: string;
  dailyLearning: string;
  updatedAt: number;
};

const LS_DAILY_KEY = "pm_scalps_daily_v1";
const LS_DRAFT_KEY = "pm_scalps_draft_v0";

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

const MOTIVATION_MSGS = [
  "¿Hoy vas a trabajar como trader? ¿Vas a usar el día de hoy para trabajar en vos mismo más allá del resultado del día?",
  "El resultado de hoy no importa tanto como la persona que estás formando. Un buen trade es el que respeta el plan, no el que gana.",
  "¿Estás acá para ganar hoy o para volverte consistente a largo plazo? Hoy entrenás disciplina. El dinero es consecuencia.",
  "Cada trade es información. ¿Vas a usarla o a reaccionar?",
  "Hoy no se mide en RR, se mide en disciplina. El mercado no te debe nada. Tu proceso sí.",
  "En el mercado solo se puede hacer tres cosas: comprar, vender o esperar.",
];

export default function Page() {
  const router = useRouter();

  // ── Auth ──
  const [mounted, setMounted] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showMotivation, setShowMotivation] = useState(true);
  const motivationText = useMemo(() => MOTIVATION_MSGS[Math.floor(Math.random() * MOTIVATION_MSGS.length)], []);

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

  // ── Flow state ──
  const [step, setStep] = useState<Step>(1);
  const [liqTaken, setLiqTaken] = useState<"yes" | "no" | "unknown">("unknown");
  const [takenLevels, setTakenLevels] = useState<Level[]>([]);
  const [lastTaken, setLastTaken] = useState<Level | null>(null);
  const [reaction, setReaction] = useState<Reaction>("unclear");
  const [hasFvg, setHasFvg] = useState<"yes" | "no" | "skip">("skip");
  const [pendingLevels, setPendingLevels] = useState<Level[]>([]);
  const [invalidationHappened, setInvalidationHappened] = useState<"yes" | "no" | "unknown">("unknown");
  const [invalidationKind, setInvalidationKind] = useState<InvalidationKind | null>(null);
  const [m15Imbalance, setM15Imbalance] = useState<YesNo | null>(null);

  // ── Journal form state ──
  const [trades, setTrades] = useState<any[]>([]);
  const [tradeTaken, setTradeTaken] = useState<"yes" | "no">("no");
  const [tradeDate, setTradeDate] = useState(getTodayKey());
  const [tradeTime, setTradeTime] = useState("");
  const [tradeSide, setTradeSide] = useState<TradeSide>("BUY");
  const [followedPlan, setFollowedPlan] = useState<FollowedPlan>("yes");
  const [instrument, setInstrument] = useState<Instrument>("NQ");
  const [setupTag, setSetupTag] = useState<SetupTag>("unknown");
  const [outcome, setOutcome] = useState<Outcome>("NONE");
  const [numPartials, setNumPartials] = useState<1 | 2 | 3>(1);
  const [partialRRs, setPartialRRs] = useState<[string, string, string]>(["", "", ""]);
  const [note, setNote] = useState("");

  // ── Chart upload state ──
  const [lastSavedTradeId, setLastSavedTradeId] = useState<string | null>(null);
  const [chartFile, setChartFile] = useState<File | null>(null);
  const [chartName, setChartName] = useState("");
  const [chartStatus, setChartStatus] = useState<"idle" | "selected" | "uploading" | "done" | "error">("idle");

  // ── Daily wrap state ──
  const [dailyError, setDailyError] = useState("");
  const [dailyLearning, setDailyLearning] = useState("");
  const [dailySaved, setDailySaved] = useState<DailyWrapType | null>(null);

  // ── Load trades ──
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try { setTrades((await listTrades(userId, 200)) as any); } catch { setTrades([]); }
    })();
  }, [userId]);

  // ── Draft restore/persist ──
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(LS_DRAFT_KEY) || "{}");
      if (d.liqTaken) setLiqTaken(d.liqTaken);
      if (Array.isArray(d.takenLevels)) setTakenLevels(d.takenLevels);
      if (d.lastTaken !== undefined) setLastTaken(d.lastTaken);
      if (d.reaction) setReaction(d.reaction);
      if (d.hasFvg) setHasFvg(d.hasFvg);
      if (Array.isArray(d.pendingLevels)) setPendingLevels(d.pendingLevels);
      if (d.invalidationHappened) setInvalidationHappened(d.invalidationHappened);
      if (d.invalidationKind === "M5" || d.invalidationKind === "M15" || d.invalidationKind === null) setInvalidationKind(d.invalidationKind);
      if (d.m15Imbalance === "yes" || d.m15Imbalance === "no" || d.m15Imbalance === null) setM15Imbalance(d.m15Imbalance);
    } catch {}
    try {
      const all = JSON.parse(localStorage.getItem(LS_DAILY_KEY) || "{}") as Record<string, DailyWrapType>;
      const today = all[getTodayKey()] || null;
      setDailySaved(today);
      if (today) { setDailyError(today.dailyError || ""); setDailyLearning(today.dailyLearning || ""); }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_DRAFT_KEY, JSON.stringify({
        liqTaken, takenLevels, lastTaken, reaction, hasFvg,
        pendingLevels, invalidationHappened, invalidationKind, m15Imbalance,
      }));
    } catch {}
  }, [liqTaken, takenLevels, lastTaken, reaction, hasFvg, pendingLevels, invalidationHappened, invalidationKind, m15Imbalance]);

  // ── Computed values ──
  const { biasShown, biasReason, marketState, deliveryStatus, invalidationGuide, suggestedTargets: targets } =
    useMemo(() => inferBias({ liqTaken, takenLevels, lastTaken, reaction, hasFvg, pendingLevels, invalidationHappened, invalidationKind, m15Imbalance }),
    [liqTaken, takenLevels, lastTaken, reaction, hasFvg, pendingLevels, invalidationHappened, invalidationKind, m15Imbalance]);

  // ── Handlers ──
  function toggleLevel(arr: Level[], setArr: (v: Level[]) => void, l: Level) {
    setArr(arr.includes(l) ? arr.filter(x => x !== l) : [...arr, l]);
  }

  function resetAll() {
    setStep(1); setLiqTaken("unknown"); setTakenLevels([]); setLastTaken(null);
    setReaction("unclear"); setHasFvg("skip"); setPendingLevels([]);
    setInvalidationHappened("unknown"); setInvalidationKind(null); setM15Imbalance(null);
  }

  function resetForm() {
    setNote(""); setTradeTaken("no"); setTradeDate(getTodayKey()); setTradeTime("");
    setTradeSide("BUY"); setFollowedPlan("yes"); setSetupTag("unknown");
    setOutcome("NONE"); setNumPartials(1); setPartialRRs(["", "", ""]);
  }

  async function uploadChart(opts?: { tradeId?: string }) {
    const tradeId = opts?.tradeId ?? lastSavedTradeId;
    if (!chartFile || !userId || !tradeId) { if (chartFile && !tradeId) setChartStatus("selected"); return; }
    try {
      setChartStatus("uploading");
      const { imgUrl, imgPath } = await uploadTradeImage({ userId, tradeId, file: chartFile });
      await updateTradeImage(tradeId, { imgUrl, imgPath });
      setChartStatus("done");
      setTrades((await listTrades(userId, 200)) as any);
    } catch { setChartStatus("error"); }
  }

  async function handleSave() {
    if (tradeTaken === "yes" && !isValidHHMM(tradeTime)) return;
    const filled = partialRRs.slice(0, numPartials).map(parseRR).filter((v): v is number => v !== null);
    const finalRR = filled.length ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length * 100) / 100 : null;

    try {
      if (!userId) return;
      const tradeId = await createTrade({
        userId, createdAt: buildTimestamp(tradeDate, tradeTime),
        liqTaken, takenLevels, lastTaken, reaction, pendingLevels, hasFvg,
        instrument, biasShown, marketState: marketState.state,
        invalidationHappened, suggestedTargets: targets,
        helped: true, tradeTaken, tradeTime: tradeTime.trim(),
        tradeSide, followedPlan, rr: finalRR, setupTag,
        outcome: outcomeToDb(outcome), note: note.trim(),
        numPartials: tradeTaken === "yes" ? numPartials : null,
        partialRRs: tradeTaken === "yes" ? filled : null,
      });
      setLastSavedTradeId(tradeId);
      await uploadChart({ tradeId });
      resetForm();
      setTrades((await listTrades(userId, 200)) as any);
    } catch (err) { console.error("saveTradeEntry failed:", err); }
  }

  function handleDailySave() {
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
    return <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center text-white/40">Cargando…</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {showMotivation && <WelcomeModal text={motivationText} onStart={() => setShowMotivation(false)} />}

      <div className="mx-auto max-w-4xl px-4 py-6">

        {/* Regla base */}
        <div className="rounded-2xl border border-white/10 bg-amber-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-black tracking-widest text-white/50">REGLA BASE</div>
            <div className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200">
              M5 invalida · M15 confirma
            </div>
          </div>
          <div className="mt-2 text-sm text-white/75">
            <span className="font-black text-white">M15 manda</span>, M5 ajusta el setup. Si en M5 aparece algo en contra, pasás a modo{" "}
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-bold">ESPECTADOR</span>{" "}
            hasta re-alinear.
          </div>
        </div>

        <ContextPanel
          biasShown={biasShown}
          biasReason={biasReason}
          marketState={marketState}
          invalidationGuide={invalidationGuide}
          liqTaken={liqTaken}
          lastTaken={lastTaken}
          deliveryStatus={deliveryStatus}
          invalidationKind={invalidationKind}
          suggestedTargets={targets}
          pendingLevels={pendingLevels}
          onTogglePending={(l) => toggleLevel(pendingLevels, setPendingLevels, l)}
          invalidationHappened={invalidationHappened}
          m15Imbalance={m15Imbalance}
          onSetInvalidationHappened={setInvalidationHappened}
          onSetInvalidationKind={setInvalidationKind}
          onSetM15Imbalance={setM15Imbalance}
          onReset={resetAll}
        />

        <StepsFlow
          step={step}
          onStepChange={setStep}
          liqTaken={liqTaken}
          onLiqTaken={setLiqTaken}
          takenLevels={takenLevels}
          onToggleTaken={(l) => toggleLevel(takenLevels, setTakenLevels, l)}
          lastTaken={lastTaken}
          onLastTaken={setLastTaken}
          reaction={reaction}
          onReaction={setReaction}
          hasFvg={hasFvg}
          onHasFvg={setHasFvg}
        />

        <TradeForm
          tradeTaken={tradeTaken} onTradeTaken={setTradeTaken}
          tradeDate={tradeDate} onTradeDate={setTradeDate}
          tradeTime={tradeTime} onTradeTime={setTradeTime}
          instrument={instrument} onInstrument={setInstrument}
          tradeSide={tradeSide} onTradeSide={setTradeSide}
          setupTag={setupTag} onSetupTag={setSetupTag}
          outcome={outcome} onOutcome={setOutcome}
          followedPlan={followedPlan} onFollowedPlan={setFollowedPlan}
          numPartials={numPartials} onNumPartials={setNumPartials}
          partialRRs={partialRRs}
          onPartialRR={(i, v) => { const next = [...partialRRs] as [string, string, string]; next[i] = v; setPartialRRs(next); }}
          chartName={chartName}
          chartStatus={chartStatus}
          onChartChange={(file) => { setChartFile(file); setChartName(file.name); setChartStatus("selected"); uploadChart(); }}
          note={note} onNote={setNote}
          tradesCount={trades.length}
          onSave={handleSave}
        />

        <DailyWrap
          todayKey={getTodayKey()}
          dailyError={dailyError}
          dailyLearning={dailyLearning}
          dailySaved={dailySaved}
          onChangeError={setDailyError}
          onChangeLearning={setDailyLearning}
          onSave={handleDailySave}
        />

      </div>
    </div>
  );
}