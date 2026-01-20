"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { createTrade, listTrades, updateTradeImage } from "@/lib/tradesDb";
import { uploadTradeImage } from "@/lib/uploadTradeImage";



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

type Instrument = "ES" | "NQ";

type MarketState =
  | "EXPANSION"
  | "DELIVERY_CONDITIONAL"
  | "TRANSITION"
  | "REVERSAL_CONFIRMED"
  | "CHOP_NO_TRADE"
  | "WAIT";

type Outcome = "PROFIT" | "STOP" | "BE" | "NONE";

type InvalidationKind = "M5" | "M15";
type YesNo = "yes" | "no";

type SetupTag = "A" | "B" | "unknown";

type TradeSide = "BUY" | "SELL";
type FollowedPlan = "yes" | "no";

type TradeEntry = {
  id: string;
  createdAt: number; // solo para ordenar (no se muestra)

  // ✅ CONTEXTO SNAPSHOT (lo que vos querías que figure)
  liqTaken: "yes" | "no" | "unknown";
  takenLevels: Level[];
  lastTaken: Level | null;
  reaction: Reaction;
  pendingLevels: Level[];
  hasFvg: "yes" | "no" | "skip";
  instrument: Instrument;
  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  marketState: MarketState;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationKind: InvalidationKind | null;
  m15Imbalance: YesNo | null; // default "skip"
  suggestedTargets: Level[];

  // ✅ INPUTS DEL TRADE
  helped: boolean;

  tradeTaken: "yes" | "no";
  tradeTime: string; // HH:MM (manual)
  tradeSide: TradeSide; // BUY/SELL
  followedPlan: FollowedPlan; // yes/no
  rr: number | null;
  setupTag: SetupTag;
  outcome: Outcome;

  note: string; // descripción del trade
};

type InvalidationGuideLines = {
  title: string;
  tone: "good" | "danger" | "warn" | "muted";
  lines: string[];
};

type InvalidationGuideSections = {
  title: string;
  tone: "good" | "danger" | "warn" | "muted";
  sections: { h: string; bullets: string[] }[];
};

type InvalidationGuide = InvalidationGuideLines | InvalidationGuideSections | null;

function hasSections(g: InvalidationGuide): g is InvalidationGuideSections {
  return !!g && "sections" in g;
}

type DailyWrap = {
  date: string; // YYYY-MM-DD
  dailyError: string;
  dailyLearning: string;
  updatedAt: number;
};

// ✅ LS keys
const LS_DAILY_KEY = "pm_scalps_daily_v1";
const LS_DRAFT_KEY = "pm_scalps_draft_v0";

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

function flipBias(bias: "LONG" | "SHORT" | "WAIT" | "NO TRADE") {
  if (bias === "LONG") return "SHORT";
  if (bias === "SHORT") return "LONG";
  return bias;
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

function pendingBySide(pending: Level[]) {
  const buyside = pending.filter((l) => levelSide(l) === "buyside");
  const sellside = pending.filter((l) => levelSide(l) === "sellside");
  return { buyside, sellside };
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

function inferMarketStateBase(args: {
  liqTaken: "yes" | "no" | "unknown";
  reaction: Reaction;
  pendingLevels: Level[];
  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
}) {
  const { liqTaken, reaction, pendingLevels, biasShown } = args;

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
    const { buyside, sellside } = pendingBySide(pendingLevels);

    if (reaction === "accept") {
      if (pendingLevels.length === 0) {
        return {
          state: "EXPANSION" as const,
          tone: "good" as const,
          desc: "Aceptación limpia (sin pendientes fuertes). Mayor chance de continuación.",
        };
      }

      const hasOppositePending =
        (biasShown === "LONG" && sellside.length > 0) ||
        (biasShown === "SHORT" && buyside.length > 0);

      if (hasOppositePending) {
        return {
          state: "DELIVERY_CONDITIONAL" as const,
          tone: "warn" as const,
          desc: "Aceptación, pero hay liquidez pendiente CONTRARIA al sesgo. Delivery condicional: vigilá invalidaciones.",
        };
      }

      return {
        state: "EXPANSION" as const,
        tone: "good" as const,
        desc: "Aceptación + liquidez pendiente ALINEADA: eso es fuel/targets. Seguí el plan.",
      };
    }

    if (reaction === "absorb") {
      return {
        state: "TRANSITION" as const,
        tone: "danger" as const,
        desc: "Cambio de delivery detectado. Operable SOLO si hay retest a PD Array. No persigas precio.",
      };
    }
  }

  return {
    state: "WAIT" as const,
    tone: "warn" as const,
    desc: "Esperá confirmación. No inventes lectura por ansiedad.",
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

function outcomeToDb(o: Outcome): "win" | "loss" | "be" | "unknown" {
  switch (o) {
    case "PROFIT":
      return "win";
    case "STOP":
      return "loss";
    case "BE":
      return "be";
    default:
      return "unknown";
  }
}

function chipTone(l: Level) {
  return levelSide(l) === "buyside"
    ? "border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/15"
    : "border-red-400/40 bg-red-500/10 hover:bg-red-500/15";
}

function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isValidHHMM(s: string) {
  // HH:MM 00-23 : 00-59
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());
}

export default function Page() {
  const router = useRouter();

  // ✅ STATES (los tuyos tal cual)
  const [step, setStep] = useState<Step>(1);

  const [liqTaken, setLiqTaken] = useState<"yes" | "no" | "unknown">("unknown");
  const [takenLevels, setTakenLevels] = useState<Level[]>([]);
  const [lastTaken, setLastTaken] = useState<Level | null>(null);
  const [reaction, setReaction] = useState<Reaction>("unclear");
  const [hasFvg, setHasFvg] = useState<"yes" | "no" | "skip">("skip");
  const [pendingLevels, setPendingLevels] = useState<Level[]>([]);

  const [showInvalidations, setShowInvalidations] = useState(false);
  const [invalidationHappened, setInvalidationHappened] = useState<"yes" | "no" | "unknown">("unknown");
  const [invalidationKind, setInvalidationKind] = useState<InvalidationKind | null>(null);
  const [m15Imbalance, setM15Imbalance] = useState<YesNo | null>(null);
  const [liquidezPendienteVisible, setLiquidezPendienteVisible] = useState(false);

  const [helped, setHelped] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [trades, setTrades] = useState<TradeEntry[]>([]);

  const [tradeTaken, setTradeTaken] = useState<"yes" | "no">("no");
  const [tradeTime, setTradeTime] = useState<string>("");
  const [tradeSide, setTradeSide] = useState<TradeSide>("BUY");
  const [followedPlan, setFollowedPlan] = useState<FollowedPlan>("yes");
  const [rr, setRr] = useState<string>("");
  const [setupTag, setSetupTag] = useState<SetupTag>("unknown");
  const [outcome, setOutcome] = useState<Outcome>("NONE");

  const [dailyError, setDailyError] = useState("");
  const [dailyLearning, setDailyLearning] = useState("");
  const [dailySaved, setDailySaved] = useState<DailyWrap | null>(null);

  const [lastSavedTradeId, setLastSavedTradeId] = useState<string | null>(null);

  const [chartFile, setChartFile] = useState<File | null>(null);
  const [chartName, setChartName] = useState<string>("");
  const [chartStatus, setChartStatus] = useState<"idle" | "selected" | "uploading" | "done" | "error">("idle");
  const [chartUrl, setChartUrl] = useState<string | null>(null);

  const [sessionReady, setSessionReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [instrument, setInstrument] = useState<Instrument>("NQ");

  const [showMotivation, setShowMotivation] = useState(true);

  const motivationText = useMemo(() => {
    const msgs = [
      "¿Hoy vas a trabajar como trader? ¿Vas a usar el día de hoy para trabajar en vos mismo como trader mas allá del resultado del día?",
      "El resultado de hoy no importa tanto como la persona que estás formando. Un buen trade es el que respeta el plan, no el que gana.",
      "¿Estás acá para ganar hoy o para volverte consistente a largo plazo? Hoy entrenás disciplina. El dinero es consecuencia.",
      "Cada trade es información. ¿Vas a usarla o a reaccionar?",
      "Hoy no se mide en RR, se mide en disciplina. El mercado no te debe nada. Tu proceso sí.",
      "En el mercado solo se puede hacer tres cosas. Comprar, vender o esperar",
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }, []);

  // ✅ “mounted” gate
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ✅ crear supabase solo en client real
  const supabase = useMemo(() => {
    return getSupabaseClient();
  }, [mounted]);

  /**
   * ✅ Auth bootstrap (UN SOLO effect)
   * - No corre hasta que mounted=true y supabase exista
   * - Setea userId + sessionReady
   * - Redirect a /login si no hay session
   */
  useEffect(() => {
    if (!supabase) return;

    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;

      if (!s) {
        router.replace("/login");
        return;
      }

      if (alive) {
        setUserId(s.user.id);
        setSessionReady(true);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) {
        router.replace("/login");
        return;
      }
      setUserId(s.user.id);
      setSessionReady(true);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, router]);

  /**
   * ✅ Cargar trades cuando ya hay userId
   */
  useEffect(() => {
    if (!userId) return;

    (async () => {
      try {
        const rows = await listTrades(userId, 200);
        setTrades(rows as any);
      } catch (err) {
        console.error("BOOT FAIL (supabase):", err);
        setTrades([]);
      }
    })();
  }, [userId]);


  useEffect(() => {
    // 1) Draft UI (flow)
    try {
      const rawDraft = localStorage.getItem(LS_DRAFT_KEY);
      if (rawDraft) {
        const d = JSON.parse(rawDraft);

        if (d.liqTaken === "yes" || d.liqTaken === "no" || d.liqTaken === "unknown") setLiqTaken(d.liqTaken);
        if (Array.isArray(d.takenLevels)) setTakenLevels(d.takenLevels);
        if (d.lastTaken !== undefined) setLastTaken(d.lastTaken);
        if (d.reaction) setReaction(d.reaction);
        if (d.hasFvg) setHasFvg(d.hasFvg);
        if (Array.isArray(d.pendingLevels)) setPendingLevels(d.pendingLevels);

        if (typeof d.showInvalidations === "boolean") setShowInvalidations(d.showInvalidations);
        if (d.invalidationHappened) setInvalidationHappened(d.invalidationHappened);

        if (d.invalidationKind === "M5" || d.invalidationKind === "M15" || d.invalidationKind === null) {
          setInvalidationKind(d.invalidationKind);
        }

        if (d.m15Imbalance === "yes" || d.m15Imbalance === "no" || d.m15Imbalance === null) {
          setM15Imbalance(d.m15Imbalance);
}
      }
    } catch {}


    // 3) Daily
    try {
      const rawDaily = localStorage.getItem(LS_DAILY_KEY);
      if (rawDaily) {
        const all = JSON.parse(rawDaily) as Record<string, DailyWrap>;
        const todayKey = getTodayKey();
        const today = all[todayKey] || null;
        setDailySaved(today);
        if (today) {
          setDailyError(today.dailyError || "");
          setDailyLearning(today.dailyLearning || "");
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const draft = {
        step,
        liqTaken,
        takenLevels,
        lastTaken,
        reaction,
        hasFvg,
        pendingLevels,
        showInvalidations,
        invalidationHappened,
        invalidationKind,
        m15Imbalance,
      };
      localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [
    step,
    liqTaken,
    takenLevels,
    lastTaken,
    reaction,
    hasFvg,
    pendingLevels,
    showInvalidations,
    invalidationHappened,
    invalidationKind,
    m15Imbalance,
  ]);

  

    async function uploadChartIfPossible(opts?: { tradeId?: string }) {
      const tradeId = opts?.tradeId ?? lastSavedTradeId;
      if (!chartFile) return;

      if (!tradeId) {
        setChartStatus("selected");
        return;
      }

      try {
        if (!userId) return;

        setChartStatus("uploading");

        const { imgUrl, imgPath } = await uploadTradeImage({
          userId,
          tradeId,
          file: chartFile,
        });

        await updateTradeImage(tradeId, { imgUrl, imgPath });

        setChartUrl(imgUrl);      // ✅ string
        setChartStatus("done");

        const rows = await listTrades(userId, 200);
        setTrades(rows as any);
      } catch (e) {
        console.error("upload chart failed:", e);
        setChartStatus("error");
      }
    }

  function persistDaily(nextForToday: DailyWrap) {
    try {
      const rawDaily = localStorage.getItem(LS_DAILY_KEY);
      const all: Record<string, DailyWrap> = rawDaily ? JSON.parse(rawDaily) : {};
      all[nextForToday.date] = nextForToday;
      localStorage.setItem(LS_DAILY_KEY, JSON.stringify(all));
    } catch {}
    setDailySaved(nextForToday);
  }

const invalidationGuide = useMemo<InvalidationGuide>(() => {
  if (invalidationHappened !== "yes") return null;

  if (invalidationKind === "M5") {
    return {
      title: "INVALIDACIÓN M5 (micro) = setup cancelado",
      tone: "warn" as const,
      lines: [
        "Qué significa: invalida el setup, pero NO confirma reversal.",
        "Qué hacés: pasás a ESPECTADOR hasta que M15 haga BOS o m5 vuelva a alinear.",
        "Regla: no persigas precio, esperá nuevo PD Array + confirmación.",
      ],
    };
  }

  if (invalidationKind === "M15" && m15Imbalance === "no") {
    return {
      title: "SHIFT M15 sin displacement = intención no confirmada",
      tone: "warn" as const,
      lines: [
        "Rompió algo, pero sin expansión clara.",
        "Qué hacés: WAIT / condicional hasta que aparezca un displacement real.",
        "Si no hay FVG / OB claro post-quiebre: no hay trade.",
      ],
    };
  }

  if (invalidationKind === "M15" && m15Imbalance === "yes") {
    return {
      title: "POSIBLE REVERSAL (solo si cumple condiciones)",
      tone: "danger" as const,
      sections: [
        {
          h: "Descripción del escenario:",
          bullets: [
            "Rompe el swing REAL de M15 (no micro-ruido de M5).",
            "Hay displacement claro (cuerpo grande / velocidad / expansión).",
            "Suele dejar un FVG en dirección del quiebre.",
          ],
        },
        {
          h: "¿Por qué invalida la dirección anterior?",
          bullets: [
            "La lectura anterior muere: el mercado dejó de respetar el camino esperado.",
            "El quiebre confirma intención, pero todavía NO te da un entry seguro.",
            "Si entrás en la ruptura, te exponés al retest que balancea el precio / te expones a un RR muy bajo.",
          ],
        },
        {
          h: "¿Qué hacés ahora?",
          bullets: [
            "PASO 1 (STOP): cancelá el plan anterior. NO persigas la ruptura.",
            "PASO 2 (ZONA): marcá la zona de retest probable: FVG M15 + m5 / OB importante / Breaker.",
            "PASO 3 (RETEST): esperá que el precio vuelva a esa zona y RECHACE (no que la atraviese).",
            "PASO 4 (ENTRY): solo entrás si en M5 hay confirmación limpia: shift M5 + reacción en PD Array.",
            "PASO 5 (FILTRO): si M15 sostiene la nueva dirección → ok. Si vuelve adentro y anula el displacement → WAIT.",
            "Habilitado SOLO si se cumplen TODAS: (1) quiebre M15 real, (2) retest+hold en PD Array, (3) confirmación M5, (4) target lógico. Si falta una → WAIT.",
          ],
        },
        // {
        //   h: "Mini regla 🧠",
        //   bullets: [
        //     "Ruptura M15 = cambió el guión (INVALIDA el plan anterior).",
        //     "Retest + hold = recién ahí te deja subirte.",
        //     "Sin retest/confirmación = te quiere cazar (WAIT).",
        //   ],
        // },
      ],
    };
  }

  if (invalidationKind === "M15" && m15Imbalance === null) {
    return {
      title: "Hubo ruptura clara en M15: falta confirmar displacement",
      tone: "warn" as const,
      lines: ["Respondé si hubo displacement con imbalance para completar la lectura."],
    };
  }

  return null;
}, [invalidationHappened, invalidationKind, m15Imbalance]);

  const bias = useMemo(() => inferBias(lastTaken, reaction), [lastTaken, reaction]);

  const modeNoLiq = reaction === "accept" ? "EXPANSION" : reaction === "absorb" ? "RANGE" : "UNCLEAR";

  const baseBiasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE" =
  liqTaken === "no"
    ? modeNoLiq === "EXPANSION"
      ? "WAIT"
      : modeNoLiq === "RANGE"
        ? "NO TRADE"
        : "WAIT"
    : bias.bias;

   const biasShown = useMemo<"LONG" | "SHORT" | "WAIT" | "NO TRADE">(() => {
  // sin invalidación: sesgo normal
  if (invalidationHappened !== "yes") return baseBiasShown;

  // M5 invalida setup, NO reversa => espectador
  if (invalidationKind === "M5") return "WAIT";

  // M15 cambia delivery, pero SOLO si hay displacement
  if (invalidationKind === "M15") {
    if (m15Imbalance === "yes") return flipBias(baseBiasShown);
    return "WAIT"; // <- si es "no" o null, WAIT
  }

  return baseBiasShown;
}, [invalidationHappened, invalidationKind, m15Imbalance, baseBiasShown]);

  const biasReason =
    biasShown === "LONG"
      ? "Estructura activa M15–M5 ALCISTA. Operá pullbacks en PD Arrays alineados. No persigas precio."
      : biasShown === "SHORT"
        ? "Estructura activa M15–M5 BAJISTA. Buscá retests/pullbacks en PD Arrays. No persigas impulsos."
        : biasShown === "WAIT"
          ? "No hay estructura activa clara para operar. Esperá sweep/shift válido o PD Array limpio."
          : "Contexto desordenado o rango. Mercado abierto, pero no operable.";

  const baseMarketState = useMemo(() => {
    return inferMarketStateBase({
      liqTaken,
      reaction,
      pendingLevels,
      biasShown, // ojo: ya es el bias final (con flip si M15)
    });
  }, [liqTaken, reaction, pendingLevels, biasShown]);

  const marketState = useMemo(() => {
      if (invalidationHappened !== "yes") return baseMarketState;

      // M5: invalida pero NO cambia narrativa
      if (invalidationKind === "M5") {
        return {
          state: "WAIT" as const,
          tone: "warn" as const,
          desc: "Invalidación micro (M5): invalida el setup, pero no confirma reversa. Esperá confirmación M15.",
        };
      }

      // M15: cambia delivery (pero depende de displacement)
      if (invalidationKind === "M15") {
        if (m15Imbalance === "yes") {
          return {
            state: "TRANSITION" as const,
            tone: "danger" as const,
            desc: "Shift M15 con displacement: cambio de delivery confirmado. Esperá retest a PD Array + confirmación M5.",
          };
        }
        if (m15Imbalance === "no") {
          return {
            state: "DELIVERY_CONDITIONAL" as const,
            tone: "warn" as const,
            desc: "Shift M15 sin displacement: intención no confirmada. Mejor espera hasta que aparezca un próximo movimiento con intensión que te genere una nueva lectura del mercado.",
          };
        }

        // si todavía no respondió imbalance
        return {
          state: "WAIT" as const,
          tone: "warn" as const,
          desc: "Elegiste M15: falta responder si hubo displacement (imbalance).",
        };
      }

      return baseMarketState;
    }, [baseMarketState, invalidationHappened, invalidationKind, m15Imbalance]);

  const suggestedTargets = useMemo((): Level[] => {
    if (biasShown !== "LONG" && biasShown !== "SHORT") return [];
    return suggestTargets(pendingLevels, biasShown);
  }, [pendingLevels, biasShown]);

  const deliveryStatus = useMemo(() => {
    if (liqTaken !== "yes") return null;
    if (!lastTaken || reaction === "unclear") return null;

    const took = `${levelLabel(lastTaken)} (${formatSide(levelSide(lastTaken))})`;
    const hasPending = pendingLevels.length > 0;

    const { buyside, sellside } = pendingBySide(pendingLevels);
    const hasOppositePending =
      (biasShown === "LONG" && sellside.length > 0) ||
      (biasShown === "SHORT" && buyside.length > 0);

    if (reaction === "accept" && hasOppositePending) {
      return {
        title: "Aceptación CONDICIONAL",
        tone: "warn" as const,
        showTargets: false as const,
        body: [
          `Hay aceptación post-toma (${took}), pero queda liquidez pendiente CONTRARIA al sesgo.`,
          "Eso suele generar delivery incompleto: puede continuar… o invalidarse fuerte.",
          "Resultado: Vigilá mucho posibles SMT e invalidaciones (CHoCH M15 / iFVG).",
        ],
      };
    }

    if (reaction === "accept" && !hasOppositePending) {
      return {
        title: "Aceptación + targets",
        tone: "good" as const,
        showTargets: true as const,
        body: [
          `Aceptación post-toma (${took}) y lo pendiente está ALINEADO al sesgo.`,
          "Eso es fuel/targets, no peligro. Buscá el target lógico más cercano.",
        ],
      };
    }

    if (reaction === "accept" && !hasPending) {
      return {
        title: "Aceptación (más limpia)",
        tone: "good" as const,
        showTargets: false as const,
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
        showTargets: false as const,
        body: [
          `Absorción post-toma (${took}).`,
          "La toma fue 'cebo': el mercado succionó liquidez y cambió el delivery.",
          "Ahora solo operás si ves shift confirmable (M15 + PD Array).",
        ],
      };
    }

    return null;
  }, [liqTaken, lastTaken, reaction, pendingLevels, biasShown]);

  function toggleLevel(arr: Level[], setArr: (next: Level[]) => void, l: Level) {
    setArr(arr.includes(l) ? arr.filter((x) => x !== l) : [...arr, l]);
  }

  function showLiquidezPendiente() {
    if (liquidezPendienteVisible) {
      setLiquidezPendienteVisible(false);
    } else {
      setLiquidezPendienteVisible(true);
    }
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
    setInvalidationKind(null);
    setM15Imbalance(null);
    setLiquidezPendienteVisible(false)
  }

  async function saveTradeEntry() {

    console.log("saveTradeEntry fired", { userId });
  // Gate 1: sin “me ayudó / no me ayudó” no guardamos
  if (helped === null) return;

  // Gate 2: si tradeTaken === yes, validar HH:MM
  const t = tradeTime.trim();
  if (tradeTaken === "yes" && !isValidHHMM(t)) return;

  // Normalizamos RR si tomaste trade
  const rrValue =
    tradeTaken === "yes"
      ? (() => {
          const n = Number(String(rr).replace(",", "."));
          return Number.isFinite(n) ? n : null;
        })()
      : null;

  const entry: TradeEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),

    // snapshot contexto
    liqTaken,
    takenLevels,
    lastTaken,
    reaction,
    pendingLevels,
    hasFvg,
    instrument,

    biasShown,
    marketState: marketState.state,
    invalidationHappened,
    invalidationKind,
    m15Imbalance,
    suggestedTargets,


    // inputs trade
    helped,

    tradeTaken,
    tradeTime: t,
    tradeSide,
    followedPlan,

    rr: rrValue,
    setupTag,
    outcome,

    note: note.trim(),
  };

  console.log("INSERT DEBUG", { userId });

    try {
    if (!userId) return;

   const tradeId = await createTrade({
      userId,
      createdAt: entry.createdAt,

      liqTaken: entry.liqTaken,
      takenLevels: entry.takenLevels,          // ✅ array
      lastTaken: entry.lastTaken,
      reaction: entry.reaction,
      pendingLevels: entry.pendingLevels,      // ✅ array
      hasFvg: entry.hasFvg,

      instrument: entry.instrument,

      biasShown: entry.biasShown,
      marketState: entry.marketState,

      invalidationHappened: entry.invalidationHappened,
      suggestedTargets: entry.suggestedTargets, // ✅ array
      

      helped: entry.helped,
      tradeTaken: entry.tradeTaken,
      tradeTime: entry.tradeTime,
      tradeSide: entry.tradeSide,
      followedPlan: entry.followedPlan,
      rr: entry.rr,
      setupTag: entry.setupTag,
      outcome: outcomeToDb(entry.outcome),

      note: entry.note,
    });

    setLastSavedTradeId(tradeId);

    await uploadChartIfPossible({ tradeId });

    // reset inputs
    setHelped(null);
    setNote("");
    setTradeTaken("no");
    setTradeTime("");
    setTradeSide("BUY");
    setFollowedPlan("yes");
    setRr("");
    setSetupTag("unknown");
    setOutcome("NONE");

    const rows = await listTrades(userId, 200);
    setTrades(rows as any);
  } catch (err) {
    console.error("saveTradeEntry failed:", err);
  }
}
  function saveDailyWrap() {
    const err = dailyError.trim();
    const learn = dailyLearning.trim();
    if (!err || !learn) return;

    const today = getTodayKey();
    const next: DailyWrap = {
      date: today,
      dailyError: err,
      dailyLearning: learn,
      updatedAt: Date.now(),
    };

    persistDaily(next);
  }

  function exportTradesJson() {
    const blob = new Blob([JSON.stringify(trades, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pm-scalps-trades.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const levelsAll: Level[] = ["PDH", "PDL", "ASIA_H", "ASIA_L", "LONDON_H", "LONDON_L", "WEEKLY_H", "WEEKLY_L"];

  const canGo2 = liqTaken !== "unknown";
  const canGo3 = liqTaken === "yes" ? takenLevels.length > 0 : liqTaken === "no";
  const canGo4 =
    liqTaken === "yes"
      ? lastTaken !== null && reaction !== "unclear"
      : liqTaken === "no"
        ? reaction !== "unclear"
        : false;

  const panel =
  "mt-4 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]";
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

  const chipBase = "select-none cursor-pointer rounded-full border px-4 py-2 text-sm font-extrabold transition";

  // ✅ Botones estéticos para BUY/SELL y Cumplí/No cumplí
  const pill =
    "h-11 rounded-full border border-white/15 bg-white/5 px-4 text-sm font-extrabold text-white hover:bg-white/10 transition";
  const pillOn = "border-white/30 bg-white/10";

  const tradeTimeOk = tradeTaken !== "yes" || isValidHHMM(tradeTime);
  const invalidationOk =
  invalidationHappened !== "yes" ||
  invalidationKind !== "M15" ||
  m15Imbalance !== null;

  const canSaveTrade = helped !== null && tradeTimeOk && invalidationOk;

  const todayKey = getTodayKey();

  if (!sessionReady || !userId) {
    return <div className="min-h-screen bg-neutral-950 text-white p-6">Cargando…</div>;
  }

  const loadingText = !mounted
  ? "Cargando…"
  : !supabase
  ? "Supabase no configurado."
  : !sessionReady || !userId
  ? "Cargando…"
  : null;

  return (
    
    <div className="min-h-screen bg-neutral-950 text-white">
      {showMotivation && (
    <div className="
        fixed inset-0 z-50 flex items-center justify-center
        bg-black/70
        backdrop-blur-sm
        animate-fade-in
        `bg-linear-to-b from-black/60 to-black/80
      ">
      <div className="
        max-w-xl mx-4 rounded-3xl
        border border-white/15
        bg-white/5
        p-6 shadow-2xl
        animate-scale-in
      ">
        
        {/* glow suave */}
        <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-white/10 shadow-[0_0_80px_rgba(255,255,255,0.06)]" />

        <div className="relative text-center">
          <div className="text-[11px] font-extrabold tracking-[0.28em] text-white/50">
            PM SCALPS COACH · BIENVENIDO
          </div>

          <div className="mt-5 text-2xl md:text-3xl font-black leading-tight text-white">
            {motivationText}
          </div>

          <div className="mt-3 text-sm text-white/55">
            Respira. Observa. Reacciona.
          </div>

          <button
            onClick={() => setShowMotivation(false)}
            className="mt-8 h-11 w-full cursor-pointer rounded-full px-6 text-sm font-extrabold
                       bg-white text-black hover:bg-white/90 transition
                       shadow-[0_10px_30px_rgba(255,255,255,0.15)]"
          >
            INICIAR EL DÍA DE TRADING →
          </button>
        </div>
      </div>
    </div>
  )}

      <div className="mx-auto max-w-5xl px-4 py-6 ">
 
          <div className="bg-red-500/10 rounded-2xl border border-white/10 p-4 shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold tracking-wide text-white/60">REGLA BASE</div>
              <div className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs font-extrabold text-amber-200">
                M5 invalida · M15 confirma
              </div>
            </div>

            <div className="mt-2 text-sm text-white/80">
              <b>M15 manda</b>, M5 ajusta el setup. Si en M5 aparece algo en contra (SMT / micro shift / etc), pasás a modo{" "}
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-extrabold text-white/90">
                ESPECTADOR
              </span>{" "}
              hasta re-alinear con M15.
            </div>
          </div>

        {/* Output */}
        <div className={panel}>
          <div className="flex flex-col items-start gap-3">
            <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-extrabold tracking-wide text-white/60">DIRECCIÓN OPERABLE (M15–M5)</div>
          </div>
            <div
              className={
                biasShown === "LONG"
                  ? "text-2xl font-black tracking-wide text-emerald-600"
                  : biasShown === "SHORT"
                    ? "text-2xl font-black tracking-wide text-red-400"
                    : "text-2xl font-black tracking-wide text-yellow-400"
              }
            >
              {biasShown}
            </div>

            <div className="max-w-2xl text-sm text-white/80">{biasReason}</div>

            <div className={`w-full md:w-auto rounded-2xl border p-3 ${toneToClasses(marketState.tone)}`}>
              <div className="text-sm font-extrabold">Estado del mercado: {marketState.state}</div>
              <div className="mt-1 text-sm text-white/85">{marketState.desc}</div>
            </div>
            {invalidationGuide && (
              <div className={`mt-4 rounded-2xl border p-4 ${toneToClasses(invalidationGuide.tone)}`}>
                <p className="text-xs text-white/50 mb-2">OUTPUT DEL PANEL INVALIDACIONES:</p>
                <div className="text-sm font-extrabold">{invalidationGuide.title}</div>

                {hasSections(invalidationGuide) ? (
                  <div className="mt-3 grid gap-4 text-sm text-white/90">
                    {invalidationGuide.sections.map((s, idx) => (
                      <div key={idx}>
                        <div className="font-extrabold text-white/95">{s.h}</div>
                        <div className="mt-2 grid gap-1">
                          {s.bullets.map((b, i) => (
                            <div key={i}>• {b}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 grid gap-1 text-sm text-white/90">
                    {invalidationGuide.lines.map((l, i) => (
                      <div key={i}>• {l}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {liqTaken === "yes" && (
            <div className="mt-3 text-sm text-white/85">
              <span className="font-extrabold">Última liquidez:</span>{" "}
              {lastTaken ? levelLabel(lastTaken) : "—"}{" "}
              <span className="text-white/60">{lastTaken ? `(${formatSide(levelSide(lastTaken))})` : ""}</span>
            </div>
          )}

          {deliveryStatus && invalidationKind !== "M15" &&  (
            <div className={`mt-4 rounded-2xl border p-3 ${toneToClasses(deliveryStatus.tone)}`}>
              <div className="font-extrabold">Estado del delivery: {deliveryStatus.title}</div>

              <div className="mt-2 grid gap-1 text-sm text-white/85">
                {deliveryStatus.body.map((line, i) => (
                  <div key={i}>• {line}</div>
                ))}
              </div>

              {deliveryStatus.showTargets && suggestedTargets.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-extrabold text-white/70">TARGETS SUGERIDOS</div>
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
                </div>
              )}
            </div>
          )}
          

          {/* Pending Liquidity */}
          <div className="my-4 h-px bg-white/10" />

          <button className={btnPrimary} onClick={showLiquidezPendiente}>
            Liquidez pendiente
          </button>

          {liquidezPendienteVisible && (
            <>
              <div className="mt-3 text-sm text-white/65">Marcá la liquidez que esta "resting".</div>

              <div className="mt-3 flex flex-wrap gap-2">
                {(["PDH", "PDL", "LONDON_H", "LONDON_L", "ASIA_H", "ASIA_L", "WEEKLY_H", "WEEKLY_L"] as Level[]).map(
                  (l) => {
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
                        {on ? "✓ " : ""}
                        {levelLabel(l)}
                      </div>
                    );
                  }
                )}
              </div>
            </>
          )}

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
                <b>M5 invalida - M15 confirma</b> (si hay displacement).
              </div>

              <div className="mt-3">
                <div className="text-sm font-extrabold text-white/90">¿Hubo invalidación?</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className={btn}
                    onClick={() => {
                      setInvalidationHappened("no");
                      setInvalidationKind(null);
                      setM15Imbalance(null);
                    }}
                  >
                    No
                  </button>

                  <button
                    className={btn}
                    onClick={() => {
                      setInvalidationHappened("yes");
                      // no elegimos kind todavía
                    }}
                  >
                    Sí
                  </button>
                </div>

                {invalidationHappened === "no" && (
                  <div className="mt-3 text-sm text-white/85">
                    Bien. Seguís con el plan original.
                  </div>
                )}

                {invalidationHappened === "yes" && (
                  <div className="mt-4">
                    <div className="text-sm font-extrabold text-white/90">¿En qué TF fue?</div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className={[btn, invalidationKind === "M5" ? "border-amber-400/50 bg-amber-500/10" : ""].join(" ")}
                        onClick={() => {
                          setInvalidationKind("M5");
                          setM15Imbalance(null);
                        }}
                      >
                        M5 (invalida)
                      </button>

                      <button
                        className={[btn, invalidationKind === "M15" ? "border-red-400/50 bg-red-500/10" : ""].join(" ")}
                        onClick={() => {
                          setInvalidationKind("M15");
                          // ACA ES LA COSA
                          setM15Imbalance(null); // obliga a responder
                        }}
                      >
                        M15 (cambio de delivery)
                      </button>
                    </div>

                    {/* Pregunta extra SOLO si M15 */}
                    {invalidationKind === "M15" && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-sm font-extrabold text-white/90">
                          ¿Hubo displacement / imbalance en la ruptura?
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            className={[btn, m15Imbalance === "yes" ? "border-emerald-400/50 bg-emerald-500/10" : ""].join(" ")}
                            onClick={() => setM15Imbalance("yes")}
                          >
                            Sí
                          </button>
                          <button
                            className={[btn, m15Imbalance === "no" ? "border-amber-400/50 bg-amber-500/10" : ""].join(" ")}
                            onClick={() => setM15Imbalance("no")}
                          >
                            No
                          </button>
                        </div>

                        {m15Imbalance === null && (
                          <div className="mt-2 text-xs text-white/70">
                            Esto es obligatorio: el estado del mercado tiene que tener respuesta.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            onClick={resetAll}
            className="mt-3 w-full md:w-auto px-4 py-2 rounded-xl text-sm font-extrabold
                        border border-red-400/40 bg-red-500/15 text-red-100
                        hover:bg-red-500/25 transition"
            >
            Reset Day
            </button>
        </div>

        {/* Steps */}
        <div className="mt-5 text-sm font-extrabold text-white/85">Paso {step} / 5</div>

        {/* STEP 1 */}
        {step === 1 && (
          <div className={panel}>
            <div className={h3}>1) ¿Ya se tomó liquidez importante hoy?</div>
            <div className={sub}>PDH/PDL o London H/L o Asia H/L (weekly opcional).</div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setLiqTaken("yes")} className={liqTaken === "yes" ? btnGood : btn}>
                Sí
              </button>
              <button onClick={() => setLiqTaken("no")} className={liqTaken === "no" ? btnPrimary : btn}>
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
                        {on ? "✓ " : ""}
                        {levelLabel(l)}
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
                  className={[btn, lastTaken === l ? "border-white/30 bg-white/10" : ""].join(" ")}
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
                    <b>Regla:</b> chequea que no haya SMT. Si hay SMT o divergencias en el precio, no operes.
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
            </div>
          </div>
        )}

        {/* Trades journal */}
        <div className={panel}>
          <div className="text-lg font-extrabold">Guarda tu trade en el Journal:</div>
          {/* <div className="mt-1 text-sm text-white/65">Guardás trades sin resetear el contexto del chequeo.</div> */}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => setHelped(true)} className={helped === true ? btnGood : btn}>
              La app me ayudó
            </button>
            <button onClick={() => setHelped(false)} className={helped === false ? btnDanger : btn}>
              La app no me ayudó
            </button>

            <div className="h-11 flex items-center px-2 text-xs font-extrabold text-white/70">¿Tomaste trade?</div>
            <button onClick={() => setTradeTaken("yes")} className={tradeTaken === "yes" ? btnGood : btn}>
              Sí
            </button>
            <button onClick={() => setTradeTaken("no")} className={tradeTaken === "no" ? btnDanger : btn}>
              No
            </button>

            <div className="h-11 flex items-center px-2 text-xs font-extrabold text-white/70">
              Instrumento
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setInstrument("NQ")}
                className={[pill, instrument === "NQ" ? pillOn : ""].join(" ")}
                disabled={tradeTaken !== "yes"}
              >
                NQ
              </button>

              <button
                onClick={() => setInstrument("ES")}
                className={[pill, instrument === "ES" ? pillOn : ""].join(" ")}
                disabled={tradeTaken !== "yes"}
              >
                ES
              </button>
            </div>

            <div className="h-11 flex items-center px-2 text-xs font-extrabold text-white/70">
              Hora
            </div>

            <input
              value={tradeTime}
              onChange={(e) => setTradeTime(e.target.value)}
              placeholder="HH:MM"
              inputMode="numeric"
              className={[
                "h-11 w-24 rounded-xl border bg-white/5 px-3 text-sm font-extrabold text-white outline-none placeholder:text-white/40",
                tradeTaken === "yes" ? "border-white/15" : "border-white/10 opacity-50",
                tradeTimeOk ? "" : "border-red-400/60",
              ].join(" ")}
              disabled={tradeTaken !== "yes"}
            />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setTradeSide("BUY")}
                className={[pill, tradeSide === "BUY" ? pillOn : ""].join(" ")}
                disabled={tradeTaken !== "yes"}
              >
                BUY
              </button>
              <button
                onClick={() => setTradeSide("SELL")}
                className={[pill, tradeSide === "SELL" ? pillOn : ""].join(" ")}
                disabled={tradeTaken !== "yes"}
              >
                SELL
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFollowedPlan("yes")}
                className={[pill, followedPlan === "yes" ? pillOn : ""].join(" ")}
                disabled={tradeTaken !== "yes"}
              >
                Cumplí plan
              </button>
              <button
                onClick={() => setFollowedPlan("no")}
                className={[pill, followedPlan === "no" ? pillOn : ""].join(" ")}
                disabled={tradeTaken !== "yes"}
              >
                No cumplí
              </button>
            </div>

            <input
              value={rr}
              onChange={(e) => setRr(e.target.value)}
              placeholder="RR planeado (ej 2.5)"
              inputMode="decimal"
              className="h-11 w-28 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-extrabold text-white outline-none placeholder:text-white/40"
              disabled={tradeTaken !== "yes"}
            />

            <select
              value={setupTag}
              onChange={(e) => setSetupTag(e.target.value as SetupTag)}
              className="h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-extrabold text-white outline-none"
              disabled={tradeTaken !== "yes"}
            >
              <option value="unknown">Setup?</option>
              <option value="A">A (2–3R / confluencia)</option>
              <option value="B">B (impulsivo / 1.5R)</option>
            </select>

            {/* Resultado (tu select tal cual) */}
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
              className="h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-extrabold text-white outline-none"
              disabled={tradeTaken !== "yes"}
            >
              <option value="NONE">Resultado?</option>
              <option value="PROFIT">Profit</option>
              <option value="STOP">Stop Loss</option>
              <option value="BE">Break Even</option>
            </select>

            {/* input hidden */}
            <input
              id="chart-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0] || null;
                e.target.value = ""; // permite elegir el mismo de nuevo
                if (!file) return;

                // reemplaza selección anterior
                setChartFile(file);
                setChartName(file.name);
                setChartUrl(null);
                setChartStatus("selected");

                // si ya hay trade guardado, sube al toque y reemplaza
                await uploadChartIfPossible();
              }}
            />

            {/* botón */}
            <button
              type="button"
              className={[
                "h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-extrabold text-white hover:bg-white/10 transition",
                tradeTaken !== "yes" ? "opacity-50 pointer-events-none" : "",
                chartStatus === "uploading" ? "opacity-60 pointer-events-none" : "",
              ].join(" ")}
              onClick={() => (document.getElementById("chart-upload") as HTMLInputElement | null)?.click()}
              title={lastSavedTradeId ? "Adjuntar / Reemplazar captura (se sube al toque)" : "Elegí captura (se sube al guardar)"}
            >
              📷 Captura
            </button>

            {/* “nombre + tilde” */}
            {chartName && (
              <div
                className={[
                  "h-11 flex items-center gap-2 rounded-xl border px-3 text-xs font-extrabold",
                  chartStatus === "done"
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                    : chartStatus === "uploading"
                    ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
                    : chartStatus === "error"
                    ? "border-red-400/30 bg-red-500/10 text-red-100"
                    : "border-white/15 bg-white/5 text-white/80",
                ].join(" ")}
              >
                <span className="max-w-5 truncate" title={chartName}>
                  {chartName}
                </span>

                {chartStatus === "done" ? (
                  <span title="Subida OK">✓</span>
                ) : chartStatus === "uploading" ? (
                  <span title="Subiendo…">…</span>
                ) : chartStatus === "error" ? (
                  <span title="Falló">!</span>
                ) : (
                  <span className="text-white/60" title="Pendiente de subir">
                    (pendiente)
                  </span>
                )}
              </div>
            )}
          </div>
          
          {tradeTaken === "yes" && !tradeTimeOk && (
            <div className="mt-2 text-sm text-red-200/90">
              Hora inválida. Usá formato <b>HH:MM</b> (ej: 14:35).
            </div>
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='Descripción del trade (ej: "Tomó London Low → shift M15 → entry en FVG M5...")'
            rows={3}
            className="mt-3 w-full resize-y rounded-xl border border-white/15 bg-white/5 p-3 text-sm font-semibold text-white/95 outline-none placeholder:text-white/40"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={saveTradeEntry}
              className={`${btnPrimary} ${canSaveTrade ? "" : "opacity-40 pointer-events-none"}`}
            >
              Guardar trade
            </button>
          </div>

          <div className="mt-3 text-sm text-white/80">
            <b>Trades guardados:</b> {trades.length}
          </div>
        </div>

        {/* ✅ Daily wrap (separado) */}
        <div className={panel}>
          <div className="text-lg font-extrabold">Cierre de jornada</div>
          <div className="mt-1 text-sm text-white/65">
            Fecha: <b>{todayKey}</b>. Guardá esto una vez por día.
          </div>

          <div className="mt-4 grid gap-3">
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-3">
              <div className="text-xs font-extrabold text-red-200/90">ERROR DEL DÍA</div>
              <textarea
                value={dailyError}
                onChange={(e) => setDailyError(e.target.value)}
                placeholder='Ej: "Entré al mercado sin confirmación en m5. Me apuré."'
                rows={3}
                className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-white/5 p-3 text-sm font-semibold text-white/95 outline-none placeholder:text-white/40"
              />
            </div>

            <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-3">
              <div className="text-xs font-extrabold text-sky-200/90">APRENDIZAJE / APRECIACIÓN</div>
              <textarea
                value={dailyLearning}
                onChange={(e) => setDailyLearning(e.target.value)}
                placeholder='Ej: "Hoy fui paciente, esperé el momento justo para entrar según mi estrategia."'
                rows={3}
                className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-white/5 p-3 text-sm font-semibold text-white/95 outline-none placeholder:text-white/40"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={saveDailyWrap}
              className={`${btnPrimary} ${!dailyError.trim() || !dailyLearning.trim() ? "opacity-40 pointer-events-none" : ""}`}
            >
              Guardar cierre del día
            </button>
            {dailySaved && (
              <div className="text-sm text-white/70 flex items-center">
                Guardado:{" "}
                <span className="ml-2 font-extrabold text-white/90">
                  {new Date(dailySaved.updatedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}