"use client";

import { useState } from "react";

type Level =
  | "PDH" | "PDL" | "ASIA_H" | "ASIA_L"
  | "LONDON_H" | "LONDON_L" | "WEEKLY_H" | "WEEKLY_L";

type Side = "buyside" | "sellside";
type Reaction = "accept" | "absorb" | "unclear";
type Step = 1 | 2 | 3 | 4 | 5;

function levelLabel(l: Level) {
  switch (l) {
    case "PDH": return "PDH";
    case "PDL": return "PDL";
    case "ASIA_H": return "Asia High";
    case "ASIA_L": return "Asia Low";
    case "LONDON_H": return "London High";
    case "LONDON_L": return "London Low";
    case "WEEKLY_H": return "Weekly High";
    case "WEEKLY_L": return "Weekly Low";
  }
}

function levelSide(l: Level): Side {
  return l === "PDH" || l === "ASIA_H" || l === "LONDON_H" || l === "WEEKLY_H"
    ? "buyside" : "sellside";
}

function chipTone(l: Level) {
  return levelSide(l) === "buyside"
    ? "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15"
    : "border-red-400/40 bg-red-500/10 hover:bg-red-500/15";
}

type Props = {
  step: Step;
  onStepChange: (s: Step) => void;

  liqTaken: "yes" | "no" | "unknown";
  onLiqTaken: (v: "yes" | "no" | "unknown") => void;

  takenLevels: Level[];
  onToggleTaken: (l: Level) => void;

  lastTaken: Level | null;
  onLastTaken: (l: Level) => void;

  reaction: Reaction;
  onReaction: (r: Reaction) => void;

  hasFvg: "yes" | "no" | "skip";
  onHasFvg: (v: "yes" | "no" | "skip") => void;
};

function toneToClasses(tone: "good" | "danger" | "warn" | "muted") {
  switch (tone) {
    case "good": return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "danger": return "border-red-400/40 bg-red-500/10 text-red-100";
    case "warn": return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    default: return "border-slate-300/20 bg-white/5 text-slate-100";
  }
}

export default function StepsFlow({
  step, onStepChange,
  liqTaken, onLiqTaken,
  takenLevels, onToggleTaken,
  lastTaken, onLastTaken,
  reaction, onReaction,
  hasFvg, onHasFvg,
}: Props) {
  const levelsAll: Level[] = ["PDH", "PDL", "ASIA_H", "ASIA_L", "LONDON_H", "LONDON_L", "WEEKLY_H", "WEEKLY_L"];

  const canGo2 = liqTaken !== "unknown";
  const canGo3 = liqTaken === "yes" ? takenLevels.length > 0 : liqTaken === "no";
  const canGo4 = liqTaken === "yes"
    ? lastTaken !== null && reaction !== "unclear"
    : liqTaken === "no" ? reaction !== "unclear" : false;

  const btn = "h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white transition cursor-pointer";
  const btnActive = "h-10 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-bold text-white transition cursor-pointer";
  const btnGood = "h-10 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-100 hover:bg-emerald-500/20 transition cursor-pointer";
  const btnDanger = "h-10 rounded-xl border border-red-400/40 bg-red-500/15 px-4 text-sm font-bold text-red-100 hover:bg-red-500/20 transition cursor-pointer";
  const btnPrimary = "h-10 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15 transition cursor-pointer";
  const chipBase = "select-none cursor-pointer rounded-full border px-4 py-2 text-sm font-bold transition";
  const panel = "mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]";
  const h3 = "text-base font-black text-white";
  const sub = "mt-1 text-sm text-white/55";

  return (
    <>
      {/* Progress */}
      <div className="mt-5 flex items-center gap-2">
        <div className="text-xs font-black text-white/40">PASO {step} / 5</div>
        <div className="flex gap-1 ml-2">
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className={`h-1.5 w-6 rounded-full transition ${s <= step ? "bg-white/60" : "bg-white/15"}`} />
          ))}
        </div>
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className={panel}>
          <div className={h3}>1 · ¿Ya se tomó liquidez importante hoy?</div>
          <div className={sub}>PDH/PDL · London H/L · Asia H/L (weekly opcional)</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => onLiqTaken("yes")} className={liqTaken === "yes" ? btnGood : btn}>Sí</button>
            <button onClick={() => onLiqTaken("no")} className={liqTaken === "no" ? btnActive : btn}>No</button>
          </div>
          <div className="mt-5">
            <button onClick={() => onStepChange(2)} className={`${btnPrimary} ${canGo2 ? "" : "opacity-40 pointer-events-none"}`}>
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className={panel}>
          {liqTaken === "yes" ? (
            <>
              <div className={h3}>2 · ¿Qué niveles se tomaron?</div>
              <div className={sub}>Marcá todo lo que viste barrer (multi)</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {levelsAll.map((l) => {
                  const on = takenLevels.includes(l);
                  return (
                    <div key={l} onClick={() => onToggleTaken(l)}
                      className={[chipBase, on ? chipTone(l) : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"].join(" ")}>
                      {on ? "✓ " : ""}{levelLabel(l)}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className={h3}>2 · Sin sweep: ¿cómo está M5–M15?</div>
              <div className={sub}>Solo para decidir si esperás o te vas</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => onReaction("accept")} className={reaction === "accept" ? btnActive : btn}>Expansión / Trend</button>
                <button onClick={() => onReaction("absorb")} className={reaction === "absorb" ? btnActive : btn}>Rango / Chop</button>
                <button onClick={() => onReaction("unclear")} className={reaction === "unclear" ? btnActive : btn}>No claro</button>
              </div>
            </>
          )}
          <div className="mt-5 flex gap-2">
            <button onClick={() => onStepChange(1)} className={btn}>← Atrás</button>
            <button
              onClick={() => onStepChange(liqTaken === "yes" ? 3 : 4)}
              className={`${btnPrimary} ${canGo3 ? "" : "opacity-40 pointer-events-none"}`}
            >Siguiente →</button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && liqTaken === "yes" && (
        <div className={panel}>
          <div className={h3}>3 · ¿Cuál fue la ÚLTIMA liquidez tomada?</div>
          <div className={sub}>La última manda el sesgo inmediato</div>
          <div className="mt-4 flex flex-wrap gap-2">
            {takenLevels.map((l) => (
              <button key={l} onClick={() => onLastTaken(l)} className={lastTaken === l ? btnActive : btn}>
                {levelLabel(l)}
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={() => onStepChange(2)} className={btn}>← Atrás</button>
            <button
              onClick={() => onStepChange(4)}
              className={`${btnPrimary} ${lastTaken ? "" : "opacity-40 pointer-events-none"}`}
            >Siguiente →</button>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && (
        <div className={panel}>
          <div className={h3}>
            {liqTaken === "yes" ? "4 · Post-toma: ¿aceptación o absorción?" : "4 · Sin sweep: ¿seguís esperando?"}
          </div>
          {liqTaken === "yes" ? (
            <>
              <div className={sub}>Aceptación = siguió con displacement · Absorción = cambio de delivery</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => onReaction("accept")} className={reaction === "accept" ? btnGood : btn}>Aceptación</button>
                <button onClick={() => onReaction("absorb")} className={reaction === "absorb" ? btnDanger : btn}>Absorción</button>
                <button onClick={() => onReaction("unclear")} className={reaction === "unclear" ? btnActive : btn}>No claro</button>
              </div>
            </>
          ) : (
            <div className={sub}>Sin sweep, tu edge exige paciencia. Sin evento no hay trade.</div>
          )}
          <div className="mt-5 flex gap-2">
            <button onClick={() => onStepChange(liqTaken === "yes" ? 3 : 2)} className={btn}>← Atrás</button>
            <button
              onClick={() => onStepChange(5)}
              className={`${btnPrimary} ${canGo4 || liqTaken === "no" ? "" : "opacity-40 pointer-events-none"}`}
            >Siguiente →</button>
          </div>
        </div>
      )}

      {/* STEP 5 */}
      {step === 5 && (
        <div className={panel}>
          <div className={h3}>5 · Gate técnico: ¿hay FVG en tu dirección?</div>
          <div className={sub}>Sin FVG no hay trade</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => onHasFvg("yes")} className={hasFvg === "yes" ? btnGood : btn}>Sí, hay FVG</button>
            <button onClick={() => onHasFvg("no")} className={hasFvg === "no" ? btnDanger : btn}>No hay FVG</button>
          </div>
          {hasFvg === "no" && (
            <div className={`mt-4 rounded-xl border p-3 ${toneToClasses("danger")}`}>
              <span className="font-black">Firme:</span> sin FVG no hay trade. Esperá que el mercado lo construya.
            </div>
          )}
          {hasFvg === "yes" && (
            <div className={`mt-4 rounded-xl border p-3 ${toneToClasses("good")}`}>
              <div className="font-black text-sm">Recordatorio del plan</div>
              <div className="mt-2 text-sm text-white/80 grid gap-1">
                <div><span className="font-black">Setup A:</span> OB + FVG + OTE + Confirmación → apuntá 2–3R</div>
                <div><span className="font-black">Setup B:</span> FVG + Confirmación → apuntá 1.5R</div>
                <div className="mt-1 text-white/60">Chequea SMT. Si hay divergencia de precio, no operes.</div>
              </div>
            </div>
          )}
          <div className="mt-5">
            <button onClick={() => onStepChange(4)} className={btn}>← Atrás</button>
          </div>
        </div>
      )}
    </>
  );
}