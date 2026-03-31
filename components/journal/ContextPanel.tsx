"use client";

type Level =
  | "PDH" | "PDL" | "ASIA_H" | "ASIA_L"
  | "LONDON_H" | "LONDON_L" | "WEEKLY_H" | "WEEKLY_L";

type Side = "buyside" | "sellside";
type InvalidationKind = "M5" | "M15";
type YesNo = "yes" | "no";

type Tone = "good" | "danger" | "warn" | "muted";

type MarketStateResult = {
  state: string;
  tone: Tone;
  desc: string;
};

type DeliveryStatus = {
  title: string;
  tone: Tone;
  showTargets: boolean;
  body: string[];
} | null;

type InvalidationGuideLines = {
  title: string;
  tone: Tone;
  lines: string[];
};

type InvalidationGuideSections = {
  title: string;
  tone: Tone;
  sections: { h: string; bullets: string[] }[];
};

type InvalidationGuide = InvalidationGuideLines | InvalidationGuideSections | null;

function hasSections(g: InvalidationGuide): g is InvalidationGuideSections {
  return !!g && "sections" in g;
}

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

function formatSide(s: Side) {
  return s === "buyside" ? "buy-side" : "sell-side";
}

function toneToClasses(tone: Tone) {
  switch (tone) {
    case "good": return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "danger": return "border-red-400/40 bg-red-500/10 text-red-100";
    case "warn": return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    default: return "border-slate-300/20 bg-white/5 text-slate-100";
  }
}

function chipTone(l: Level) {
  return levelSide(l) === "buyside"
    ? "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15"
    : "border-red-400/40 bg-red-500/10 hover:bg-red-500/15";
}

type Props = {
  // Bias
  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  biasReason: string;

  // Market state
  marketState: MarketStateResult;

  // Invalidation guide
  invalidationGuide: InvalidationGuide;

  // Last taken
  liqTaken: "yes" | "no" | "unknown";
  lastTaken: Level | null;

  // Delivery
  deliveryStatus: DeliveryStatus;
  invalidationKind: InvalidationKind | null;
  suggestedTargets: Level[];

  // Pending levels
  pendingLevels: Level[];
  onTogglePending: (l: Level) => void;

  // Invalidations
  invalidationHappened: "yes" | "no" | "unknown";
  m15Imbalance: YesNo | null;
  onSetInvalidationHappened: (v: "yes" | "no" | "unknown") => void;
  onSetInvalidationKind: (v: InvalidationKind | null) => void;
  onSetM15Imbalance: (v: YesNo | null) => void;

  // Reset
  onReset: () => void;
};

export default function ContextPanel({
  biasShown, biasReason,
  marketState,
  invalidationGuide,
  liqTaken, lastTaken,
  deliveryStatus, invalidationKind, suggestedTargets,
  pendingLevels, onTogglePending,
  invalidationHappened, m15Imbalance,
  onSetInvalidationHappened, onSetInvalidationKind, onSetM15Imbalance,
  onReset,
}: Props) {
  const [liquidezVisible, setLiquidezVisible] = useState(false);
  const [showInvalidations, setShowInvalidations] = useState(false);

  const btn = "h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white transition cursor-pointer";
  const btnActive = "h-10 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-bold text-white transition cursor-pointer";
  const btnPrimary = "h-10 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15 transition cursor-pointer";
  const chipBase = "select-none cursor-pointer rounded-full border px-4 py-2 text-sm font-bold transition";

  const levelsAll: Level[] = ["PDH", "PDL", "LONDON_H", "LONDON_L", "ASIA_H", "ASIA_L", "WEEKLY_H", "WEEKLY_L"];

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">

      {/* Bias */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-black tracking-widest text-white/40">DIRECCIÓN OPERABLE</div>
        <div className={
          biasShown === "LONG" ? "text-2xl font-black text-emerald-400"
          : biasShown === "SHORT" ? "text-2xl font-black text-red-400"
          : "text-2xl font-black text-amber-400"
        }>
          {biasShown}
        </div>
      </div>

      <div className="mt-2 text-sm text-white/65">{biasReason}</div>

      {/* Market state */}
      <div className={`mt-3 rounded-xl border p-3 ${toneToClasses(marketState.tone)}`}>
        <div className="text-xs font-black">{marketState.state}</div>
        <div className="mt-1 text-sm text-white/80">{marketState.desc}</div>
      </div>

      {/* Invalidation guide */}
      {invalidationGuide && (
        <div className={`mt-3 rounded-xl border p-4 ${toneToClasses(invalidationGuide.tone)}`}>
          <div className="text-[10px] font-black text-white/40 mb-2">INVALIDACIONES</div>
          <div className="text-sm font-black">{invalidationGuide.title}</div>
          {hasSections(invalidationGuide) ? (
            <div className="mt-3 grid gap-3 text-sm text-white/85">
              {invalidationGuide.sections.map((s, i) => (
                <div key={i}>
                  <div className="font-black text-white/95">{s.h}</div>
                  <div className="mt-1 grid gap-0.5">
                    {s.bullets.map((b, j) => <div key={j}>• {b}</div>)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 grid gap-1 text-sm text-white/85">
              {"lines" in invalidationGuide && invalidationGuide.lines.map((l, i) => (
                <div key={i}>• {l}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Last taken */}
      {liqTaken === "yes" && lastTaken && (
        <div className="mt-3 text-sm text-white/60">
          Última liq: <span className="font-bold text-white/85">{levelLabel(lastTaken)}</span>{" "}
          <span className="text-white/40">({formatSide(levelSide(lastTaken))})</span>
        </div>
      )}

      {/* Delivery */}
      {deliveryStatus && invalidationKind !== "M15" && (
        <div className={`mt-3 rounded-xl border p-3 ${toneToClasses(deliveryStatus.tone)}`}>
          <div className="font-black text-sm">{deliveryStatus.title}</div>
          <div className="mt-1 grid gap-1 text-sm text-white/80">
            {deliveryStatus.body.map((line, i) => <div key={i}>• {line}</div>)}
          </div>
          {deliveryStatus.showTargets && suggestedTargets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestedTargets.map((t) => (
                <div key={t} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold">
                  🎯 {levelLabel(t)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="my-4 h-px bg-white/10" />

      {/* Liquidez pendiente */}
      <button className={btnPrimary} onClick={() => setLiquidezVisible(v => !v)}>
        {liquidezVisible ? "Ocultar liquidez pendiente" : "Liquidez pendiente"}
      </button>

      {liquidezVisible && (
        <div className="mt-3">
          <div className="text-xs text-white/50 mb-2">Marcá la liquidez que está "resting".</div>
          <div className="flex flex-wrap gap-2">
            {levelsAll.map((l) => {
              const on = pendingLevels.includes(l);
              return (
                <div key={l}
                  onClick={() => onTogglePending(l)}
                  className={[chipBase, on ? chipTone(l) : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"].join(" ")}>
                  {on ? "✓ " : ""}{levelLabel(l)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invalidaciones */}
      <div className="mt-3">
        <button onClick={() => setShowInvalidations(v => !v)} className={btnPrimary}>
          {showInvalidations ? "Ocultar invalidaciones" : "Revisar invalidaciones"}
        </button>
      </div>

      {showInvalidations && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-sm font-black text-white/90">¿Hubo invalidación?</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={invalidationHappened === "no" ? btnActive : btn}
              onClick={() => { onSetInvalidationHappened("no"); onSetInvalidationKind(null); onSetM15Imbalance(null); }}
            >No</button>
            <button
              className={invalidationHappened === "yes" ? btnActive : btn}
              onClick={() => onSetInvalidationHappened("yes")}
            >Sí</button>
          </div>

          {invalidationHappened === "yes" && (
            <div className="mt-4">
              <div className="text-sm font-black text-white/90">¿En qué TF?</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className={[btn, invalidationKind === "M5" ? "border-amber-400/50 bg-amber-500/10 text-amber-100" : ""].join(" ")}
                  onClick={() => { onSetInvalidationKind("M5"); onSetM15Imbalance(null); }}
                >M5 (invalida)</button>
                <button
                  className={[btn, invalidationKind === "M15" ? "border-red-400/50 bg-red-500/10 text-red-100" : ""].join(" ")}
                  onClick={() => { onSetInvalidationKind("M15"); onSetM15Imbalance(null); }}
                >M15 (cambio delivery)</button>
              </div>

              {invalidationKind === "M15" && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-black text-white/90">¿Hubo displacement / imbalance?</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className={[btn, m15Imbalance === "yes" ? "border-emerald-400/50 bg-emerald-500/10" : ""].join(" ")}
                      onClick={() => onSetM15Imbalance("yes")}
                    >Sí</button>
                    <button
                      className={[btn, m15Imbalance === "no" ? "border-amber-400/50 bg-amber-500/10" : ""].join(" ")}
                      onClick={() => onSetM15Imbalance("no")}
                    >No</button>
                  </div>
                  {m15Imbalance === null && (
                    <div className="mt-2 text-xs text-white/50">Obligatorio para completar la lectura.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button onClick={onReset} className="mt-4 h-9 rounded-xl border border-red-400/30 bg-red-500/10 px-4 text-xs font-black text-red-200 hover:bg-red-500/15 transition">
        Reset Day
      </button>
    </div>
  );
}

// necesita useState — import al principio del archivo
import { useState } from "react";