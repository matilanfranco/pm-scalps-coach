"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";

type Level =
  | "PDH"
  | "PDL"
  | "ASIA_H"
  | "ASIA_L"
  | "LONDON_H"
  | "LONDON_L"
  | "WEEKLY_H"
  | "WEEKLY_L";

type Side = "buyside" | "sellside";
type Reaction = "accept" | "absorb" | "unclear";
type Step = 1 | 2 | 3 | 4 | 5;

type MarketState =
  | "EXPANSION"
  | "DELIVERY_CONDITIONAL"
  | "TRANSITION"
  | "REVERSAL_CONFIRMED"
  | "CHOP_NO_TRADE"
  | "WAIT";

type InvalidationChoice = "micro_m5" | "shift_m15" | "ifvg";
type JournalAccuracy = "accurate" | "partial" | "wrong";

type JournalEntry = {
  id: string;
  createdAt: number;

  liqTaken: "yes" | "no" | "unknown";
  takenLevels: Level[];
  lastTaken: Level | null;
  reaction: Reaction;
  pendingLevels: Level[];
  hasFvg: "yes" | "no" | "skip";

  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  marketState: MarketState;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationChoice: InvalidationChoice | null;
  suggestedTargets: Level[];

  helped: boolean;
  accuracy: JournalAccuracy;
  note: string;
};

const LS_KEY = "pm_scalps_journal_v0";

function levelLabel(l: Level) {
  switch (l) {
    case "PDH":
      return "PDH";
    case "PDL":
      return "PDL";
    case "ASIA_H":
      return "Asia High";
    case "ASIA_L":
      return "Asia Low";
    case "LONDON_H":
      return "London High";
    case "LONDON_L":
      return "London Low";
    case "WEEKLY_H":
      return "Weekly High";
    case "WEEKLY_L":
      return "Weekly Low";
  }
}

function levelSide(l: Level): Side {
  return l === "PDH" || l === "ASIA_H" || l === "LONDON_H" || l === "WEEKLY_H"
    ? "buyside"
    : "sellside";
}

function formatSide(s: Side) {
  return s === "buyside" ? "buy-side" : "sell-side";
}

function suggestTargets(pending: Level[], bias: "LONG" | "SHORT" | "WAIT" | "NO TRADE") {
  if (bias !== "LONG" && bias !== "SHORT") return [];

  const wantSide: Side = bias === "LONG" ? "buyside" : "sellside";

  const priority: Level[] =
    bias === "LONG"
      ? ["LONDON_H", "ASIA_H", "PDH", "WEEKLY_H"]
      : ["LONDON_L", "ASIA_L", "PDL", "WEEKLY_L"];

  const candidates = pending.filter((l) => levelSide(l) === wantSide);
  candidates.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
  return candidates.slice(0, 2);
}

function inferBias(lastTaken: Level | null, reaction: Reaction) {
  if (!lastTaken || reaction === "unclear") {
    return { bias: "WAIT" as const, reason: "Falta claridad post-toma. Seguí como espectador." };
  }

  const side = levelSide(lastTaken);

  if (side === "buyside" && reaction === "accept")
    return { bias: "LONG" as const, reason: "Aceptación post-buyside (continuación probable)." };
  if (side === "buyside" && reaction === "absorb")
    return { bias: "SHORT" as const, reason: "Absorción post-buyside (reversal probable)." };

  if (side === "sellside" && reaction === "accept")
    return { bias: "SHORT" as const, reason: "Aceptación post-sellside (continuación probable)." };
  if (side === "sellside" && reaction === "absorb")
    return { bias: "LONG" as const, reason: "Absorción post-sellside (reversal probable)." };

  return { bias: "WAIT" as const, reason: "Caso raro. Esperá confirmación." };
}

function inferMarketState(args: {
  liqTaken: "yes" | "no" | "unknown";
  reaction: Reaction;
  pendingLevels: Level[];
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationChoice: InvalidationChoice | null;
}) {
  const { liqTaken, reaction, pendingLevels, invalidationHappened, invalidationChoice } = args;

  if (invalidationHappened === "yes") {
    if (invalidationChoice === "ifvg") {
      return {
        state: "REVERSAL_CONFIRMED" as const,
        tone: "good" as const,
        desc: "Reversa operable: iFVG confirmada. Buscá retests + PD Array en zona lógica.",
      };
    }
    if (invalidationChoice === "shift_m15") {
      return {
        state: "TRANSITION" as const,
        tone: "danger" as const,
        desc: "Shift M15 + displacement: invalida fuerte, pero esperá retest (no persigas impulso).",
      };
    }
    if (invalidationChoice === "micro_m5") {
      return {
        state: "TRANSITION" as const,
        tone: "warn" as const,
        desc: "Micro M5: puede ser ruido/stop-hunt. No habilita reversa. Esperá confirmación M15.",
      };
    }
  }

  if (liqTaken === "no") {
    if (reaction === "absorb") {
      return {
        state: "CHOP_NO_TRADE" as const,
        tone: "muted" as const,
        desc: "Chop/rango sin evento: NO TRADE. Esperá sweep + displacement.",
      };
    }
    if (reaction === "accept") {
      return {
        state: "WAIT" as const,
        tone: "warn" as const,
        desc: "Hay expansión pero sin sweep claro. Esperá evento antes de casarte con dirección.",
      };
    }
    return {
      state: "WAIT" as const,
      tone: "warn" as const,
      desc: "Falta info: esperá estructura limpia o evento de liquidez.",
    };
  }

  if (liqTaken === "yes") {
    if (reaction === "accept" && pendingLevels.length === 0) {
      return {
        state: "EXPANSION" as const,
        tone: "good" as const,
        desc: "Aceptación limpia (sin pendientes fuertes). Mayor chance de continuación.",
      };
    }
    if (reaction === "accept" && pendingLevels.length > 0) {
      return {
        state: "DELIVERY_CONDITIONAL" as const,
        tone: "warn" as const,
        desc: "Aceptación condicional: hay pendientes. Vigilá CHoCH M15 / iFVG antes de apretar.",
      };
    }
    if (reaction === "absorb") {
      return {
        state: "TRANSITION" as const,
        tone: "danger" as const,
        desc: "Absorción post-toma: reversal probable, pero operable SOLO con shift + PD Array.",
      };
    }
  }

  return {
    state: "WAIT" as const,
    tone: "warn" as const,
    desc: "Esperá confirmación. No inventes lectura por ansiedad.",
  };
}

function invalidationInfo(choice: InvalidationChoice, currentBias: "LONG" | "SHORT" | "WAIT" | "NO TRADE") {
  const opposite = currentBias === "LONG" ? "SHORT" : currentBias === "SHORT" ? "LONG" : "WAIT";

  const deliveryExplainer = [
    "🧠 Cambio de delivery = el mercado deja de hacer lo que debía para sostener tu lectura.",
    "La aceptación previa NO manda si el nivel que la sostenía muere.",
    "Si hay liquidez pendiente (ej: London Low), estos shifts pesan más.",
  ];

  if (choice === "micro_m5") {
    return {
      title: "Micro BOS/CHoCH en M5 (ruido / stop-hunt)",
      effect: "SOLO INVALIDA (no habilita reversa)",
      state: "WAIT",
      tone: "warn" as const,
      when: ["Rompió un HL/LH chico en M5.", "No hubo displacement real (drift/velas chicas).", "Se siente como 'me saca y vuelve'."],
      whyMatters: ["Invalida entrar apurado en continuation.", "No autoriza operar al revés: puede ser solo pullback."],
      action: ["Esperá confirmación M15 o displacement claro.", "Si aparece iFVG o CHoCH M15 + disp, recién ahí cambia el plan."],
      deliveryExplainer,
    };
  }

  if (choice === "shift_m15") {
    return {
      title: "CHoCH/BOS contrario en M15 + displacement",
      effect: "INVALIDA FUERTE (reversa NO automática)",
      state: "SHIFT DETECTADO",
      tone: "danger" as const,
      when: ["Rompió el swing REAL de M15 (HL si long / LH si short).", "Impulso real (cuerpo/velocidad, no drift).", "Suele dejar FVG en dirección del shift."],
      whyMatters: ["La aceptación previa pierde autoridad: cambió el delivery.", "Falta el entry: si perseguís el impulso, te clavan el retest."],
      action: [`Esperá retest a PD Array contrario (FVG/OB/Breaker) para habilitar ${opposite}.`, "Si el retest aguanta y hay confirmación M5 → ahí sí."],
      deliveryExplainer,
    };
  }

  return {
    title: "iFVG confirmada (break + retest + hold)",
    effect: "INVALIDA + HABILITA REVERSA (operable)",
    state: `BUSCAR ${opposite}`,
    tone: "good" as const,
    when: ["El FVG/OB que sostenía se rompe con cierre (no mecha).", "Retestea desde el otro lado y RECHAZA (hold).", "Se vuelve iFVG: soporte↔resistencia."],
    whyMatters: ["Gatillo más limpio para cambiar sesgo SIN ansiedad.", "Si hay liquidez pendiente en la nueva dirección: doble confirmación."],
    action: [`Habilitado: buscar ${opposite} en zona lógica + PD Array.`, "Entry ideal: retest iFVG/OB/Breaker + confirmación M5.", "Target lógico: la liquidez pendiente más cercana."],
    deliveryExplainer,
  };
}

function toneToClasses(tone: "good" | "danger" | "warn" | "muted") {
  switch (tone) {
    case "good":
      return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
    case "danger":
      return "border-red-400/40 bg-red-500/10 text-red-100";
    case "warn":
      return "border-amber-400/40 bg-amber-500/10 text-amber-100";
    default:
      return "border-slate-300/20 bg-white/5 text-slate-100";
  }
}

function chipTone(l: Level) {
  return levelSide(l) === "buyside"
    ? "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15"
    : "border-red-400/40 bg-red-500/10 hover:bg-red-500/15";
}

export default function Page() {
  const [step, setStep] = useState<Step>(1);

  const [liqTaken, setLiqTaken] = useState<"yes" | "no" | "unknown">("unknown");
  const [takenLevels, setTakenLevels] = useState<Level[]>([]);
  const [lastTaken, setLastTaken] = useState<Level | null>(null);
  const [reaction, setReaction] = useState<Reaction>("unclear");
  const [hasFvg, setHasFvg] = useState<"yes" | "no" | "skip">("skip");
  const [pendingLevels, setPendingLevels] = useState<Level[]>([]);

  const [showInvalidations, setShowInvalidations] = useState(false);
  const [invalidationHappened, setInvalidationHappened] = useState<"yes" | "no" | "unknown">("unknown");
  const [invalidationChoice, setInvalidationChoice] = useState<InvalidationChoice | null>(null);

  const [helped, setHelped] = useState<boolean | null>(null);
  const [accuracy, setAccuracy] = useState<JournalAccuracy>("accurate");
  const [note, setNote] = useState("");
  const [journal, setJournal] = useState<JournalEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setJournal(JSON.parse(raw) as JournalEntry[]);
    } catch {}
  }, []);

  function persistJournal(next: JournalEntry[]) {
    setJournal(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {}
  }

  const bias = useMemo(() => inferBias(lastTaken, reaction), [lastTaken, reaction]);

  const modeNoLiq = reaction === "accept" ? "EXPANSION" : reaction === "absorb" ? "RANGE" : "UNCLEAR";

  const biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE" =
    liqTaken === "no"
      ? modeNoLiq === "EXPANSION"
        ? "WAIT"
        : modeNoLiq === "RANGE"
        ? "NO TRADE"
        : "WAIT"
      : bias.bias;

  const biasReason =
    liqTaken === "no"
      ? modeNoLiq === "EXPANSION"
        ? "Sin sweep claro. No fuerces: esperá evento (sweep + displacement) o no operes."
        : modeNoLiq === "RANGE"
          ? "Chop/rango sin evento. Hoy te vas a lastimar si insistís."
          : "Falta info para decidir."
      : bias.reason;

  const marketState = useMemo(() => {
    return inferMarketState({
      liqTaken,
      reaction,
      pendingLevels,
      invalidationHappened,
      invalidationChoice,
    });
  }, [liqTaken, reaction, pendingLevels, invalidationHappened, invalidationChoice]);

  const inval = useMemo(() => {
    if (!invalidationChoice) return null;
    return invalidationInfo(invalidationChoice, biasShown);
  }, [invalidationChoice, biasShown]);

  const suggestedTargets = useMemo(() => {
    if (invalidationChoice !== "ifvg") return [];
    return suggestTargets(pendingLevels, biasShown);
  }, [invalidationChoice, pendingLevels, biasShown]);

  const deliveryStatus = useMemo(() => {
    if (liqTaken !== "yes") return null;
    if (!lastTaken || reaction === "unclear") return null;

    const took = `${levelLabel(lastTaken)} (${formatSide(levelSide(lastTaken))})`;
    const hasPending = pendingLevels.length > 0;

    if (reaction === "accept" && hasPending) {
      return {
        title: "Aceptación CONDICIONAL",
        tone: "warn" as const,
        body: [
          `Hay aceptación post-toma (${took}), pero queda liquidez pendiente.`,
          "Esto suele generar 'delivery incompleto': puede continuar… o puede invalidarse fuerte.",
          "Resultado: no te cases. Vigilá invalidaciones (CHoCH M15 / iFVG).",
        ],
      };
    }

    if (reaction === "accept" && !hasPending) {
      return {
        title: "Aceptación (más limpia)",
        tone: "good" as const,
        body: [
          `Aceptación post-toma (${took}) y no marcaste pendientes fuertes.`,
          "Más chance de continuación. Igual: si muere el PD Array que sostiene, se cancela.",
        ],
      };
    }

    if (reaction === "absorb") {
      return {
        title: "Absorción (reversal probable)",
        tone: "danger" as const,
        body: [
          `Absorción post-toma (${took}).`,
          "La toma fue 'cebo': el mercado succionó liquidez y cambió el delivery.",
          "Ahora solo operás si ves shift confirmable (M15 + PD Array).",
        ],
      };
    }

    return null;
  }, [liqTaken, lastTaken, reaction, pendingLevels]);

  function toggleLevel(arr: Level[], setArr: (next: Level[]) => void, l: Level) {
    setArr(arr.includes(l) ? arr.filter((x) => x !== l) : [...arr, l]);
  }

  function resetAll() {
    setStep(1);
    setLiqTaken("unknown");
    setTakenLevels([]);
    setLastTaken(null);
    setReaction("unclear");
    setHasFvg("skip");
    setPendingLevels([]);
    setShowInvalidations(false);
    setInvalidationHappened("unknown");
    setInvalidationChoice(null);
  }

  function saveJournalEntry() {
    if (helped === null) return;

    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),

      liqTaken,
      takenLevels,
      lastTaken,
      reaction,
      pendingLevels,
      hasFvg,

      biasShown,
      marketState: marketState.state,
      invalidationHappened,
      invalidationChoice,
      suggestedTargets,

      helped,
      accuracy,
      note: note.trim(),
    };

    const next = [entry, ...journal].slice(0, 200);
    persistJournal(next);

    setHelped(null);
    setAccuracy("accurate");
    setNote("");
  }

  function exportJournalJson() {
    const blob = new Blob([JSON.stringify(journal, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pm-scalps-journal.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const levelsAll: Level[] = ["PDH", "PDL", "ASIA_H", "ASIA_L", "LONDON_H", "LONDON_L", "WEEKLY_H", "WEEKLY_L"];

  const canGo2 = liqTaken !== "unknown";
  const canGo3 = liqTaken === "yes" ? takenLevels.length > 0 : liqTaken === "no";
  const canGo4 = liqTaken === "yes" ? lastTaken !== null && reaction !== "unclear" : liqTaken === "no" ? reaction !== "unclear" : false;

  const panel = "mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_12px_30px_rgba(0,0,0,0.25)]";
  const h3 = "text-lg font-extrabold";
  const sub = "mt-1 text-sm text-white/65";
  const btn =
    "h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-extrabold text-white hover:bg-white/10 transition";
  const btnPrimary =
    "h-11 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-extrabold text-white hover:bg-white/15 transition";
  const btnDanger =
    "h-11 rounded-xl border border-red-400/40 bg-red-500/15 px-4 text-sm font-extrabold text-red-100 hover:bg-red-500/20 transition";
  const btnGood =
    "h-11 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 text-sm font-extrabold text-emerald-100 hover:bg-emerald-500/20 transition";

  const chipBase =
    "select-none cursor-pointer rounded-full border px-4 py-2 text-sm font-extrabold transition";

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <Header onReset={resetAll} />
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Output */}
        <div className={panel}>
          <div className="flex flex-col items-start gap-3">
            <div className="text-xs font-extrabold tracking-wide text-white/70">LECTURA DEL MERCADO / CONTEXTO</div>
            <div className={
              biasShown === "LONG" 
                ? "text-2xl font-black tracking-wide text-emerald-600"
                :
              biasShown === "SHORT"  
                ? "text-2xl font-black tracking-wide text-red-400" 
                : "text-2xl font-black tracking-wide text-yellow-400"
              }>{biasShown}</div>

            <div className="max-w-2xl text-sm text-white/80">{biasReason}</div>

            <div className={`w-full md:w-auto rounded-2xl border p-3 ${toneToClasses(marketState.tone)}`}>
              <div className="text-sm font-extrabold">Estado del mercado: {marketState.state}</div>
              <div className="mt-1 text-sm text-white/85">{marketState.desc}</div>
            </div>
          </div>

          {liqTaken === "yes" && (
            <div className="mt-3 text-sm text-white/85">
              <span className="font-extrabold">Última liquidez:</span>{" "}
              {lastTaken ? levelLabel(lastTaken) : "—"}{" "}
              <span className="text-white/60">
                {lastTaken ? `(${formatSide(levelSide(lastTaken))})` : ""}
              </span>
            </div>
          )}

          {deliveryStatus && (
            <div className={`mt-4 rounded-2xl border p-3 ${toneToClasses(deliveryStatus.tone)}`}>
              <div className="font-extrabold">Estado del delivery: {deliveryStatus.title}</div>
              <div className="mt-2 grid gap-1 text-sm text-white/85">
                {deliveryStatus.body.map((line, i) => (
                  <div key={i}>• {line}</div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Liquidity */}
          <div className="my-4 h-px bg-white/10" />

          <div className="font-extrabold">Liquidez pendiente (manual)</div>
          <div className="mt-1 text-sm text-white/65">
            Marcá lo que sabés que está “resting” (esto hace condicional la aceptación).
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["PDH", "PDL", "LONDON_H", "LONDON_L", "ASIA_H", "ASIA_L", "WEEKLY_H", "WEEKLY_L"] as Level[]).map((l) => {
              const on = pendingLevels.includes(l);
              return (
                <div
                  key={l}
                  onClick={() => toggleLevel(pendingLevels, setPendingLevels, l)}
                  className={[
                    chipBase,
                    on ? chipTone(l) : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
                  ].join(" ")}
                  title={levelSide(l) === "buyside" ? "Buy-side pendiente" : "Sell-side pendiente"}
                >
                  {on ? "✓ " : ""}{levelLabel(l)}
                </div>
              );
            })}
          </div>

          {/* Invalidations toggle */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => setShowInvalidations((v) => !v)} className={btnPrimary}>
              {showInvalidations ? "Ocultar invalidaciones" : "Revisar invalidaciones"}
            </button>
          </div>

          {showInvalidations && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="text-base font-extrabold">Invalidaciones (cambio de delivery)</div>
              <div className="mt-1 text-sm text-white/70">
                La idea es: <b>M5 avisa</b>, <b>M15 confirma</b>, <b>iFVG habilita</b>.
              </div>

              <div className="mt-3">
                <div className="text-sm font-extrabold text-white/90">¿Pasó algo de esto?</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setInvalidationHappened("no");
                      setInvalidationChoice(null);
                    }}
                    className={btn}
                  >
                    No
                  </button>
                  <button onClick={() => setInvalidationHappened("yes")} className={btnDanger}>
                    Sí
                  </button>
                </div>

                {invalidationHappened === "no" && (
                  <div className="mt-3 text-sm text-white/85">
                    Perfecto. Seguí con el plan original. No inventes “shifts” por ansiedad.
                  </div>
                )}

                {invalidationHappened === "yes" && (
                  <div className="mt-4">
                    <div className="text-sm font-extrabold text-white/90">¿Cuál?</div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => setInvalidationChoice("micro_m5")}
                        className={[
                          btn,
                          invalidationChoice === "micro_m5" ? "border-amber-400/50 bg-amber-500/10" : "",
                        ].join(" ")}
                      >
                        1) Micro M5
                      </button>

                      <button
                        onClick={() => setInvalidationChoice("shift_m15")}
                        className={[
                          btn,
                          invalidationChoice === "shift_m15" ? "border-red-400/50 bg-red-500/10" : "",
                        ].join(" ")}
                      >
                        2) Shift M15 + disp
                      </button>

                      <button
                        onClick={() => setInvalidationChoice("ifvg")}
                        className={[
                          btn,
                          invalidationChoice === "ifvg" ? "border-emerald-400/50 bg-emerald-500/10" : "",
                        ].join(" ")}
                      >
                        3) iFVG confirmada
                      </button>
                    </div>

                    {inval && (
                      <div className={`mt-4 rounded-2xl border p-4 ${toneToClasses(inval.tone)}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="text-base font-extrabold">{inval.title}</div>
                          <div className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-extrabold text-white/90">
                            {inval.effect}
                          </div>
                        </div>

                        <div className="mt-2 text-sm">
                          <span className="font-extrabold">Estado ahora:</span> {inval.state}
                        </div>

                        <div className="my-4 h-px bg-white/10" />

                        <div className="grid gap-4">
                          <section>
                            <div className="font-extrabold">Cuándo es esto (pattern)</div>
                            <div className="mt-2 grid gap-1 text-sm text-white/85">
                              {inval.when.map((x, i) => (
                                <div key={i}>• {x}</div>
                              ))}
                            </div>
                          </section>

                          <section>
                            <div className="font-extrabold">Por qué invalida (delivery)</div>
                            <div className="mt-2 grid gap-1 text-sm text-white/85">
                              {inval.whyMatters.map((x, i) => (
                                <div key={i}>• {x}</div>
                              ))}
                            </div>
                          </section>

                          <section>
                            <div className="font-extrabold">Qué hacés ahora</div>
                            <div className="mt-2 grid gap-1 text-sm text-white/85">
                              {inval.action.map((x, i) => (
                                <div key={i}>• {x}</div>
                              ))}
                            </div>
                          </section>

                          {invalidationChoice === "ifvg" && (
                            <section>
                              <div className="font-extrabold">Target lógico sugerido</div>

                              {suggestedTargets.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {suggestedTargets.map((t) => (
                                    <div
                                      key={t}
                                      className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-extrabold"
                                      title="Se basa en tu liquidez pendiente marcada"
                                    >
                                      🎯 {levelLabel(t)}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-2 text-sm text-white/85">
                                  No marcaste liquidez pendiente alineada a esta reversa. Si estás seguro, usá HTF (weekly/daily) como target.
                                </div>
                              )}

                              <div className="mt-2 text-sm text-white/70">
                                Tip: si el target está MUY lejos y no hay estructura limpia → bajá expectativa (1.5R).
                              </div>
                            </section>
                          )}

                          <section>
                            <div className="font-extrabold">Mini regla (para el bocho)</div>
                            <div className="mt-2 grid gap-1 text-sm text-white/85">
                              {inval.deliveryExplainer.map((x, i) => (
                                <div key={i}>• {x}</div>
                              ))}
                            </div>
                          </section>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 text-xs text-white/65">
                Regla: <b>La aceptación no se respeta</b> si muere el nivel que la sostiene (FVG/OB). Y si hay liquidez pendiente, más todavía.
              </div>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="mt-5 text-sm font-extrabold text-white/85">
          Paso {step} / 5
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div className={panel}>
            <div className={h3}>1) ¿Ya se tomó liquidez importante hoy?</div>
            <div className={sub}>PDH/PDL o London H/L o Asia H/L (weekly opcional).</div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setLiqTaken("yes")}
                className={liqTaken === "yes" ? btnGood : btn}
              >
                Sí
              </button>
              <button
                onClick={() => setLiqTaken("no")}
                className={liqTaken === "no" ? btnPrimary : btn}
              >
                No
              </button>
            </div>

            <div className="mt-4">
              <button
                onClick={() => setStep(2)}
                className={`${btnPrimary} ${canGo2 ? "" : "opacity-40 pointer-events-none"}`}
              >
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
                <div className={h3}>2) ¿Qué niveles se tomaron? (multi)</div>
                <div className={sub}>Marcá todo lo que viste barrer.</div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {levelsAll.map((l) => {
                    const on = takenLevels.includes(l);
                    return (
                      <div
                        key={l}
                        onClick={() => toggleLevel(takenLevels, setTakenLevels, l)}
                        className={[
                          chipBase,
                          on ? chipTone(l) : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
                        ].join(" ")}
                        title={levelSide(l) === "buyside" ? "Buy-side" : "Sell-side"}
                      >
                        {on ? "✓ " : ""}{levelLabel(l)}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => setStep(1)} className={btn}>
                    ← Atrás
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className={`${btnPrimary} ${canGo3 ? "" : "opacity-40 pointer-events-none"}`}
                  >
                    Siguiente →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={h3}>2) Sin sweep claro: ¿cómo está M5–M15?</div>
                <div className={sub}>Solo para decidir si esperás o te vas.</div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setReaction("accept")} className={reaction === "accept" ? btnPrimary : btn}>
                    Expansión / Trend
                  </button>
                  <button onClick={() => setReaction("absorb")} className={reaction === "absorb" ? btnPrimary : btn}>
                    Rango / Chop
                  </button>
                  <button onClick={() => setReaction("unclear")} className={reaction === "unclear" ? btnPrimary : btn}>
                    No claro
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => setStep(1)} className={btn}>
                    ← Atrás
                  </button>
                  <button
                    onClick={() => setStep(4)}
                    className={`${btnPrimary} ${canGo3 ? "" : "opacity-40 pointer-events-none"}`}
                  >
                    Siguiente →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && liqTaken === "yes" && (
          <div className={panel}>
            <div className={h3}>3) ¿Cuál fue la ÚLTIMA liquidez tomada?</div>
            <div className={sub}>La última manda el sesgo inmediato (continuación vs absorción).</div>

            <div className="mt-3 flex flex-wrap gap-2">
              {takenLevels.map((l) => (
                <button
                  key={l}
                  onClick={() => setLastTaken(l)}
                  className={[
                    btn,
                    lastTaken === l ? "border-white/30 bg-white/10" : "",
                  ].join(" ")}
                >
                  {levelLabel(l)}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setStep(2)} className={btn}>
                ← Atrás
              </button>
              <button
                onClick={() => setStep(4)}
                className={`${btnPrimary} ${lastTaken ? "" : "opacity-40 pointer-events-none"}`}
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <div className={panel}>
            <div className={h3}>
              {liqTaken === "yes" ? "4) Post-toma: ¿aceptación o absorción?" : "4) Sin sweep: ¿seguís esperando evento?"}
            </div>

            {liqTaken === "yes" ? (
              <>
                <div className={sub}>Aceptación = siguió con displacement. Absorción = volvió fuerte y cambia delivery.</div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setReaction("accept")} className={reaction === "accept" ? btnGood : btn}>
                    Aceptación / Continuación
                  </button>
                  <button onClick={() => setReaction("absorb")} className={reaction === "absorb" ? btnDanger : btn}>
                    Absorción / Reversal
                  </button>
                  <button onClick={() => setReaction("unclear")} className={reaction === "unclear" ? btnPrimary : btn}>
                    No claro
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => (liqTaken === "yes" ? setStep(3) : setStep(2))} className={btn}>
                    ← Atrás
                  </button>
                  <button
                    onClick={() => setStep(5)}
                    className={`${btnPrimary} ${canGo4 ? "" : "opacity-40 pointer-events-none"}`}
                  >
                    Siguiente →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={sub}>Si no hubo sweep, tu edge exige paciencia: sin evento no hay trade.</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => setStep(2)} className={btn}>
                    ← Atrás
                  </button>
                  <button onClick={() => setStep(5)} className={btnPrimary}>
                    Siguiente →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 5 */}
        {step === 5 && (
          <div className={panel}>
            <div className={h3}>5) Gate técnico: ¿hay FVG en tu dirección?</div>
            <div className={sub}>
              Recordatorio: <b>sin FVG no hay trade</b>.
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setHasFvg("yes")} className={hasFvg === "yes" ? btnGood : btn}>
                Sí, hay FVG
              </button>
              <button onClick={() => setHasFvg("no")} className={hasFvg === "no" ? btnDanger : btn}>
                No hay FVG
              </button>
              <button onClick={() => setHasFvg("skip")} className={hasFvg === "skip" ? btnPrimary : btn}>
                Skip
              </button>
            </div>

            <div className="mt-4">
              {hasFvg === "no" ? (
                <div className={`rounded-2xl border p-3 ${toneToClasses("danger")}`}>
                  <b>Firme:</b> sin FVG no hay trade. Esperá que el mercado te lo construya.
                </div>
              ) : hasFvg === "yes" ? (
                <div className={`rounded-2xl border p-3 ${toneToClasses("good")}`}>
                  <div className="font-extrabold">Plan (recordatorio)</div>
                  <div className="mt-2 text-sm text-white/90">
                    <b>Setup A:</b> 2–3R (parciales) si hay confluencia <b>FVG + OB/Breaker</b> + (OTE = plus).
                  </div>
                  <div className="mt-1 text-sm text-white/90">
                    <b>Setup B:</b> continuación impulsiva con reacción en FVG importante → buscá <b>1.5R</b>.
                  </div>
                  <div className="mt-3 text-sm text-white/85">
                    <b>Regla:</b> si estás persiguiendo precio, esto NO es tu trade.
                  </div>
                </div>
              ) : (
                <div className="text-sm text-white/70">Elegí una opción. Si no está claro, skip.</div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setStep(4)} className={btn}>
                ← Atrás
              </button>
              <button onClick={resetAll} className={btnPrimary}>
                Nuevo chequeo
              </button>
            </div>
          </div>
        )}

        {/* Journal */}
        <div className={panel}>
          <div className="text-lg font-extrabold">Journal (v0)</div>
          <div className="mt-1 text-sm text-white/65">
            Guardás un snapshot del contexto + tu veredicto para medir si la app te sirve.
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => setHelped(true)} className={helped === true ? btnGood : btn}>
              Me ayudó
            </button>
            <button onClick={() => setHelped(false)} className={helped === false ? btnDanger : btn}>
              No me ayudó
            </button>

            <select
              value={accuracy}
              onChange={(e) => setAccuracy(e.target.value as JournalAccuracy)}
              className="h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-extrabold text-white outline-none"
            >
              <option value="accurate">Accurate</option>
              <option value="partial">Parcial</option>
              <option value="wrong">No</option>
            </select>
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contexto breve (ej: tomó London Low → PDH → accept → luego shift M15...)"
            rows={3}
            className="mt-3 w-full resize-y rounded-xl border border-white/15 bg-white/5 p-3 text-sm font-semibold text-white/95 outline-none placeholder:text-white/40"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={saveJournalEntry}
              className={`${btnPrimary} ${helped === null ? "opacity-40 pointer-events-none" : ""}`}
            >
              Guardar Journal
            </button>
            <button onClick={exportJournalJson} className={btn}>
              Export JSON
            </button>
          </div>

          <div className="mt-3 text-sm text-white/80">
            <b>Entradas guardadas:</b> {journal.length}
          </div>

          <div className="mt-3 grid gap-2">
            {journal.slice(0, 8).map((j) => (
              <div key={j.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-extrabold">
                    {new Date(j.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-white/80">
                    <b>{j.marketState}</b> · {j.biasShown} · {j.accuracy} · {j.helped ? "ayudó" : "no ayudó"}
                  </div>
                </div>
                {j.note && <div className="mt-2 text-sm text-white/85">{j.note}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Footer mental */}
        <div className="mt-4 text-xs text-white/60">
          <b>Ancla:</b> La aceptación no se respeta si muere el nivel que la sostiene (FVG/OB). Si hay liquidez pendiente, mirá invalidaciones antes de apretar el gatillo.
        </div>
      </div>
    </div>
  );
}