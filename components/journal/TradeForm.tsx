"use client";

import { useMemo } from "react";

type Instrument = "ES" | "NQ";
type TradeSide = "BUY" | "SELL";
type FollowedPlan = "yes" | "no";
type SetupTag = "A" | "B" | "none" | "unknown";
type Outcome = "PROFIT" | "STOP" | "BE" | "NONE";

function parseRR(s: string): number | null {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isValidHHMM(s: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());
}

type Props = {
  // Session
  tradeTaken: "yes" | "no";
  onTradeTaken: (v: "yes" | "no") => void;
  tradeDate: string;
  onTradeDate: (v: string) => void;
  tradeTime: string;
  onTradeTime: (v: string) => void;
  instrument: Instrument;
  onInstrument: (v: Instrument) => void;
  tradeSide: TradeSide;
  onTradeSide: (v: TradeSide) => void;

  // Setup
  setupTag: SetupTag;
  onSetupTag: (v: SetupTag) => void;

  // Result
  outcome: Outcome;
  onOutcome: (v: Outcome) => void;
  followedPlan: FollowedPlan;
  onFollowedPlan: (v: FollowedPlan) => void;

  // Partials
  numPartials: 1 | 2 | 3;
  onNumPartials: (v: 1 | 2 | 3) => void;
  partialRRs: [string, string, string];
  onPartialRR: (i: number, v: string) => void;

  // Chart
  chartName: string;
  chartStatus: "idle" | "selected" | "uploading" | "done" | "error";
  onChartChange: (file: File) => void;

  // Note
  note: string;
  onNote: (v: string) => void;

  // Save
  tradesCount: number;
  onSave: () => void;
};

export default function TradeForm({
  tradeTaken, onTradeTaken,
  tradeDate, onTradeDate,
  tradeTime, onTradeTime,
  instrument, onInstrument,
  tradeSide, onTradeSide,
  setupTag, onSetupTag,
  outcome, onOutcome,
  followedPlan, onFollowedPlan,
  numPartials, onNumPartials,
  partialRRs, onPartialRR,
  chartName, chartStatus, onChartChange,
  note, onNote,
  tradesCount, onSave,
}: Props) {
  const tradeTimeOk = tradeTaken !== "yes" || isValidHHMM(tradeTime);

  const computedRR = useMemo(() => {
    const filled = partialRRs.slice(0, numPartials).map(parseRR).filter((v): v is number => v !== null);
    if (!filled.length) return null;
    const sum = filled.reduce((a, b) => a + b, 0);
    return Math.round((sum / filled.length) * 100) / 100;
  }, [partialRRs, numPartials]);

  const canSave = tradeTimeOk;

  // Styles
  const card = "rounded-2xl border border-white/10 bg-white/[0.04] p-4";
  const btn = "h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white transition cursor-pointer";
  const btnActive = "h-10 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-bold text-white transition cursor-pointer";
  const btnGood = "h-10 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-100 hover:bg-emerald-500/20 transition cursor-pointer";
  const btnDanger = "h-10 rounded-xl border border-red-400/40 bg-red-500/15 px-4 text-sm font-bold text-red-100 hover:bg-red-500/20 transition cursor-pointer";
  const inputBase = "h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-bold text-white outline-none placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.07] transition";

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
      <div className="text-base font-black text-white mb-5">Registrar en el Journal</div>

      <div className="grid gap-4">

        {/* ── Sesión ── */}
        <div className={card}>
          <div className="text-xs font-black text-white/40 mb-3">SESIÓN</div>
          <div className="flex flex-wrap gap-3 items-end">

            <div>
              <div className="text-xs text-white/50 mb-1">¿Tomaste trade?</div>
              <div className="flex gap-2">
                <button onClick={() => onTradeTaken("yes")} className={tradeTaken === "yes" ? btnGood : btn}>Sí</button>
                <button onClick={() => onTradeTaken("no")} className={tradeTaken === "no" ? btnDanger : btn}>No</button>
              </div>
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Fecha</div>
              <input type="date" value={tradeDate} onChange={(e) => onTradeDate(e.target.value)} className={inputBase} />
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Hora</div>
              <input
                value={tradeTime}
                onChange={(e) => onTradeTime(e.target.value)}
                placeholder="HH:MM"
                inputMode="numeric"
                disabled={tradeTaken !== "yes"}
                className={[inputBase, "w-24", tradeTaken !== "yes" ? "opacity-40" : "", !tradeTimeOk ? "border-red-400/60" : ""].join(" ")}
              />
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Instrumento</div>
              <div className="flex gap-2">
                {(["NQ", "ES"] as Instrument[]).map((ins) => (
                  <button key={ins} onClick={() => onInstrument(ins)} disabled={tradeTaken !== "yes"}
                    className={[tradeTaken !== "yes" ? "opacity-40 pointer-events-none " : "", instrument === ins && tradeTaken === "yes" ? btnActive : btn].join(" ")}>
                    {ins}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Dirección</div>
              <div className="flex gap-2">
                <button onClick={() => onTradeSide("BUY")} disabled={tradeTaken !== "yes"}
                  className={[tradeTaken !== "yes" ? "opacity-40 pointer-events-none " : "",
                    tradeSide === "BUY" && tradeTaken === "yes"
                      ? "h-10 rounded-xl border border-sky-400/40 bg-sky-500/15 px-4 text-sm font-bold text-sky-100 cursor-pointer"
                      : btn].join(" ")}>
                  BUY
                </button>
                <button onClick={() => onTradeSide("SELL")} disabled={tradeTaken !== "yes"}
                  className={[tradeTaken !== "yes" ? "opacity-40 pointer-events-none " : "",
                    tradeSide === "SELL" && tradeTaken === "yes"
                      ? "h-10 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/15 px-4 text-sm font-bold text-fuchsia-100 cursor-pointer"
                      : btn].join(" ")}>
                  SELL
                </button>
              </div>
            </div>
          </div>

          {tradeTaken === "yes" && !tradeTimeOk && (
            <div className="mt-2 text-xs text-red-300">Hora inválida. Usá formato HH:MM (ej: 14:35)</div>
          )}
        </div>

        {/* ── Setup ── */}
        <div className={card}>
          <div className="text-xs font-black text-white/40 mb-3">SETUP</div>
          <div className="grid gap-2">
            {[
              { tag: "A" as SetupTag, label: "Setup A", desc: "OB + FVG + Zona OTE + Confirmación · Apuntá 2–3R", color: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" },
              { tag: "B" as SetupTag, label: "Setup B", desc: "FVG + Confirmación · Apuntá 1.5R", color: "border-sky-400/30 bg-sky-500/10 text-sky-100" },
              { tag: "none" as SetupTag, label: "Sin setup / Solo estudio", desc: "Registrás el escenario sin entrada", color: "border-white/15 bg-white/5 text-white/70" },
            ].map(({ tag, label, desc, color }) => (
              <button key={tag}
                onClick={() => onSetupTag(tag)}
                disabled={tradeTaken !== "yes" && tag !== "none"}
                className={[
                  "w-full text-left rounded-xl border px-4 py-3 transition cursor-pointer",
                  setupTag === tag ? color : "border-white/10 bg-white/[0.02] text-white/50 hover:bg-white/[0.04]",
                  tradeTaken !== "yes" && tag !== "none" ? "opacity-40 pointer-events-none" : "",
                ].join(" ")}>
                <div className="text-sm font-black">{label}</div>
                <div className="text-xs mt-0.5 opacity-75">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Resultado ── */}
        <div className={card}>
          <div className="text-xs font-black text-white/40 mb-3">RESULTADO</div>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <div className="text-xs text-white/50 mb-1">Outcome</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { val: "PROFIT" as Outcome, label: "Profit", cls: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" },
                  { val: "STOP" as Outcome, label: "Stop", cls: "border-red-400/40 bg-red-500/15 text-red-100" },
                  { val: "BE" as Outcome, label: "BE", cls: "border-amber-400/40 bg-amber-500/15 text-amber-100" },
                  { val: "NONE" as Outcome, label: "—", cls: "border-white/15 bg-white/5 text-white/50" },
                ].map(({ val, label, cls }) => (
                  <button key={val} onClick={() => onOutcome(val)} disabled={tradeTaken !== "yes"}
                    className={[
                      "h-10 rounded-xl border px-4 text-sm font-bold transition cursor-pointer",
                      outcome === val && tradeTaken === "yes" ? cls : "border-white/10 bg-white/[0.02] text-white/40 hover:bg-white/[0.04]",
                      tradeTaken !== "yes" ? "opacity-40 pointer-events-none" : "",
                    ].join(" ")}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Plan</div>
              <div className="flex gap-2">
                <button onClick={() => onFollowedPlan("yes")} disabled={tradeTaken !== "yes"}
                  className={[tradeTaken !== "yes" ? "opacity-40 pointer-events-none " : "", followedPlan === "yes" && tradeTaken === "yes" ? btnGood : btn].join(" ")}>
                  Cumplí ✓
                </button>
                <button onClick={() => onFollowedPlan("no")} disabled={tradeTaken !== "yes"}
                  className={[tradeTaken !== "yes" ? "opacity-40 pointer-events-none " : "", followedPlan === "no" && tradeTaken === "yes" ? btnDanger : btn].join(" ")}>
                  No cumplí ✗
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Parciales ── */}
        <div className={card}>
          <div className="text-xs font-black text-white/40 mb-3">PARCIALES & RR</div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="text-sm text-white/60">¿Cuántos TPs?</div>
            {([1, 2, 3] as const).map((n) => (
              <button key={n} onClick={() => onNumPartials(n)} disabled={tradeTaken !== "yes"}
                className={[tradeTaken !== "yes" ? "opacity-40 pointer-events-none " : "", numPartials === n && tradeTaken === "yes" ? btnActive : btn, "w-11"].join(" ")}>
                {n}
              </button>
            ))}
          </div>

          <div className="grid gap-3">
            {Array.from({ length: numPartials }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="text-xs font-black text-white/40 w-14">TP {i + 1}</div>
                <input
                  value={partialRRs[i]}
                  onChange={(e) => onPartialRR(i, e.target.value)}
                  placeholder="RR (ej: 2.0)"
                  inputMode="decimal"
                  disabled={tradeTaken !== "yes"}
                  className={[inputBase, "w-32", tradeTaken !== "yes" ? "opacity-40" : ""].join(" ")}
                />
                {parseRR(partialRRs[i]) && (
                  <div className="text-sm font-black text-emerald-400">{parseRR(partialRRs[i])}R</div>
                )}
              </div>
            ))}
          </div>

          {computedRR !== null && tradeTaken === "yes" && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="text-xs font-black text-white/40">RR PROMEDIO FINAL</div>
              <div className="text-2xl font-black text-emerald-400">{computedRR}R</div>
              {numPartials > 1 && (
                <div className="text-xs text-white/40 ml-auto">
                  {Array.from({ length: numPartials }).map((_, i) => parseRR(partialRRs[i])).filter(Boolean).join(" + ")} ÷ {numPartials}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Captura ── */}
        <div className={card}>
          <div className="text-xs font-black text-white/40 mb-3">CAPTURA DE PANTALLA</div>
          <div className="flex flex-wrap items-center gap-3">
            <input id="chart-upload" type="file" accept="image/*" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onChartChange(file);
              }}
            />
            <button type="button" disabled={tradeTaken !== "yes"}
              className={[btn, tradeTaken !== "yes" ? "opacity-40 pointer-events-none" : "", chartStatus === "uploading" ? "opacity-60 pointer-events-none" : ""].join(" ")}
              onClick={() => (document.getElementById("chart-upload") as HTMLInputElement | null)?.click()}>
              📷 Adjuntar captura
            </button>
            {chartName && (
              <div className={["flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold",
                chartStatus === "done" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                : chartStatus === "uploading" ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
                : chartStatus === "error" ? "border-red-400/30 bg-red-500/10 text-red-100"
                : "border-white/15 bg-white/5 text-white/70"].join(" ")}>
                <span className="max-w-[120px] truncate">{chartName}</span>
                <span>{chartStatus === "done" ? "✓" : chartStatus === "uploading" ? "…" : chartStatus === "error" ? "!" : "(pendiente)"}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Nota ── */}
        <div className={card}>
          <div className="text-xs font-black text-white/40 mb-2">NOTA DEL TRADE</div>
          <textarea
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder='Describí el escenario: "Tomó London Low → shift M15 → entry en FVG M5…"'
            rows={3}
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.05] transition"
          />
        </div>
      </div>

      {/* Guardar */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button onClick={onSave}
          className={[
            "h-11 rounded-xl border border-white/25 bg-white/10 px-6 text-sm font-black text-white hover:bg-white/15 transition",
            canSave ? "" : "opacity-40 pointer-events-none",
          ].join(" ")}>
          Guardar en el journal
        </button>
        <div className="text-xs text-white/40">
          {tradesCount} trade{tradesCount !== 1 ? "s" : ""} registrado{tradesCount !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}