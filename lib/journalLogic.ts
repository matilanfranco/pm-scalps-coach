// lib/journalLogic.ts
// Toda la lógica de inferencia del journal — bias, market state, delivery, invalidation guide

import type { Level, InvalidationKind, YesNo, M15Confirmed } from "./types";

// ─── Types locales ────────────────────────────────────────

type Side = "buyside" | "sellside";
type Reaction = "accept" | "absorb" | "unclear";
type Tone = "good" | "danger" | "warn" | "muted";

export type BiasShown = "LONG" | "SHORT" | "WAIT" | "NO TRADE";

export type MarketStateResult = {
  state: string;
  tone: Tone;
  desc: string;
};

export type DeliveryStatus = {
  title: string;
  tone: Tone;
  showTargets: boolean;
  body: string[];
} | null;

export type InvalidationGuideLines = {
  title: string;
  tone: Tone;
  lines: string[];
};

export type InvalidationGuideSections = {
  title: string;
  tone: Tone;
  sections: { h: string; bullets: string[] }[];
};

export type InvalidationGuide = InvalidationGuideLines | InvalidationGuideSections | null;

export type JournalContextArgs = {
  liqTaken: "yes" | "no" | "unknown";
  takenLevels: Level[];
  lastTaken: Level | null;
  reaction: Reaction;
  hasFvg: "yes" | "no" | "skip";
  pendingLevels: Level[];
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationKind: InvalidationKind | null;
  m15Imbalance: YesNo | null;
  // ✅ Nuevo: M15 confirmó cambio de estructura post-absorción
  m15Confirmed: M15Confirmed;
};

export type JournalContextResult = {
  biasShown: BiasShown;
  biasReason: string;
  marketState: MarketStateResult;
  deliveryStatus: DeliveryStatus;
  invalidationGuide: InvalidationGuide;
  suggestedTargets: Level[];
};

// ─── Helpers de fecha/hora ────────────────────────────────

export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.trim());
}

export function buildTimestamp(date: string, time: string): number {
  if (!date) return Date.now();
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (time && isValidHHMM(time)) {
    const [hh, mm] = time.split(":").map(Number);
    dt.setHours(hh, mm, 0, 0);
  }
  return dt.getTime();
}

// ─── Helpers de levels ────────────────────────────────────

function levelSide(l: Level): Side {
  return l === "PDH" || l === "ASIA_H" || l === "LONDON_H" || l === "WEEKLY_H"
    ? "buyside"
    : "sellside";
}

export function levelLabel(l: Level): string {
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

function formatSide(s: Side): string {
  return s === "buyside" ? "buy-side" : "sell-side";
}

function pendingBySide(pending: Level[]) {
  return {
    buyside: pending.filter((l) => levelSide(l) === "buyside"),
    sellside: pending.filter((l) => levelSide(l) === "sellside"),
  };
}

function flipBias(bias: BiasShown): BiasShown {
  if (bias === "LONG") return "SHORT";
  if (bias === "SHORT") return "LONG";
  return bias;
}

// ─── Targets sugeridos ────────────────────────────────────

export function suggestTargets(pending: Level[], bias: BiasShown): Level[] {
  if (bias !== "LONG" && bias !== "SHORT") return [];
  const wantSide: Side = bias === "LONG" ? "buyside" : "sellside";
  const priority: Level[] = bias === "LONG"
    ? ["LONDON_H", "ASIA_H", "PDH", "WEEKLY_H"]
    : ["LONDON_L", "ASIA_L", "PDL", "WEEKLY_L"];
  const candidates = pending.filter((l) => levelSide(l) === wantSide);
  candidates.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
  return candidates.slice(0, 2);
}

// ─── Bias base (sin invalidación) ─────────────────────────

function inferBiasBase(
  lastTaken: Level | null,
  reaction: Reaction,
  m15Confirmed: M15Confirmed
): { bias: BiasShown; reason: string } {
  if (!lastTaken || reaction === "unclear")
    return { bias: "WAIT", reason: "Falta claridad post-toma. Seguí como espectador." };

  const side = levelSide(lastTaken);

  // Aceptación — continuación directa, no necesita confirmación M15
  if (side === "buyside" && reaction === "accept")
    return { bias: "LONG", reason: "Aceptación post-buyside. Continuación probable." };
  if (side === "sellside" && reaction === "accept")
    return { bias: "SHORT", reason: "Aceptación post-sellside. Continuación probable." };

  // Absorción — requiere confirmar que M15 cambió estructura
  // Sin esa confirmación el sesgo NO se flipea automáticamente
  if (reaction === "absorb") {
    if (m15Confirmed === "yes") {
      // M15 confirmó → flip real
      if (side === "buyside")
        return { bias: "SHORT", reason: "Absorción post-buyside + BOS/CHoCH M15 confirmado. Reversal operativo." };
      return { bias: "LONG", reason: "Absorción post-sellside + BOS/CHoCH M15 confirmado. Reversal operativo." };
    }
    if (m15Confirmed === "no") {
      // M15 sigue igual → la absorción fue un retroceso, no un reversal
      if (side === "buyside")
        return { bias: "LONG", reason: "Absorción post-buyside pero M15 no cambió estructura. Retroceso probable — plan original vigente." };
      return { bias: "SHORT", reason: "Absorción post-sellside pero M15 no cambió estructura. Retroceso probable — plan original vigente." };
    }
    // No respondió aún → WAIT hasta confirmar
    return { bias: "WAIT", reason: "Absorción detectada. ¿M15 confirmó cambio de estructura (BOS/CHoCH)? Respondé para definir el sesgo." };
  }

  return { bias: "WAIT", reason: "Caso raro. Esperá confirmación." };
}

// ─── Market state base (sin invalidación) ─────────────────

function inferMarketStateBase(args: {
  liqTaken: "yes" | "no" | "unknown";
  reaction: Reaction;
  pendingLevels: Level[];
  biasShown: BiasShown;
}): MarketStateResult {
  const { liqTaken, reaction, pendingLevels, biasShown } = args;

  if (liqTaken === "no") {
    if (reaction === "absorb") return { state: "CHOP_NO_TRADE", tone: "muted", desc: "Chop/rango sin evento: NO TRADE. Esperá sweep + displacement." };
    if (reaction === "accept") return { state: "WAIT", tone: "warn", desc: "Hay expansión pero sin sweep claro. Esperá evento antes de casarte con dirección." };
    return { state: "WAIT", tone: "warn", desc: "Falta info: esperá estructura limpia o evento de liquidez." };
  }

  if (liqTaken === "yes") {
    const { buyside, sellside } = pendingBySide(pendingLevels);
    if (reaction === "accept") {
      if (pendingLevels.length === 0)
        return { state: "EXPANSION", tone: "good", desc: "Aceptación limpia (sin pendientes fuertes). Mayor chance de continuación." };
      const hasOppositePending = (biasShown === "LONG" && sellside.length > 0) || (biasShown === "SHORT" && buyside.length > 0);
      if (hasOppositePending)
        return { state: "DELIVERY_CONDITIONAL", tone: "warn", desc: "Aceptación, pero hay liquidez pendiente CONTRARIA al sesgo. Delivery condicional: vigilá invalidaciones." };
      return { state: "EXPANSION", tone: "good", desc: "Aceptación + liquidez pendiente ALINEADA: eso es fuel/targets. Seguí el plan." };
    }
    if (reaction === "absorb")
      return { state: "TRANSITION", tone: "danger", desc: "Cambio de delivery detectado. Operable SOLO si hay retest a PD Array. No persigas precio." };
  }

  return { state: "WAIT", tone: "warn", desc: "Esperá confirmación. No inventes lectura por ansiedad." };
}

// ─── Delivery status ──────────────────────────────────────

function computeDeliveryStatus(args: {
  liqTaken: "yes" | "no" | "unknown";
  lastTaken: Level | null;
  reaction: Reaction;
  pendingLevels: Level[];
  biasShown: BiasShown;
  invalidationKind: InvalidationKind | null;
}): DeliveryStatus {
  const { liqTaken, lastTaken, reaction, pendingLevels, biasShown, invalidationKind } = args;

  if (liqTaken !== "yes" || !lastTaken || reaction === "unclear" || invalidationKind === "M15") return null;

  const took = `${levelLabel(lastTaken)} (${formatSide(levelSide(lastTaken))})`;
  const { buyside, sellside } = pendingBySide(pendingLevels);
  const hasOppositePending = (biasShown === "LONG" && sellside.length > 0) || (biasShown === "SHORT" && buyside.length > 0);

  if (reaction === "accept" && hasOppositePending)
    return { title: "Aceptación CONDICIONAL", tone: "warn", showTargets: false, body: [`Aceptación post-toma (${took}), pero queda liquidez pendiente CONTRARIA.`, "Vigilá SMT e invalidaciones (CHoCH M15 / iFVG)."] };

  if (reaction === "accept" && !hasOppositePending)
    return { title: "Aceptación + targets", tone: "good", showTargets: true, body: [`Aceptación post-toma (${took}). Pendientes ALINEADOS al sesgo.`, "Buscá el target lógico más cercano."] };

  if (reaction === "absorb")
    return { title: "Absorción (reversal probable)", tone: "danger", showTargets: false, body: [`Absorción post-toma (${took}).`, "El mercado succionó liquidez y cambió delivery. Solo operás con shift confirmable."] };

  return null;
}

// ─── Invalidation guide ───────────────────────────────────

function computeInvalidationGuide(args: {
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationKind: InvalidationKind | null;
  m15Imbalance: YesNo | null;
}): InvalidationGuide {
  const { invalidationHappened, invalidationKind, m15Imbalance } = args;
  if (invalidationHappened !== "yes") return null;

  if (invalidationKind === "M5")
    return { title: "INVALIDACIÓN M5 (micro) = setup cancelado", tone: "warn", lines: ["Invalida el setup, pero NO confirma reversal.", "Pasás a ESPECTADOR hasta que M15 haga BOS o M5 vuelva a alinear.", "No persigas precio. Esperá nuevo PD Array + confirmación."] };

  if (invalidationKind === "M15" && m15Imbalance === "no")
    return { title: "SHIFT M15 sin displacement = intención no confirmada", tone: "warn", lines: ["Rompió algo, pero sin expansión clara.", "WAIT / condicional hasta displacement real.", "Si no hay FVG / OB claro post-quiebre: no hay trade."] };

  if (invalidationKind === "M15" && m15Imbalance === "yes")
    return {
      title: "POSIBLE REVERSAL (solo si cumple condiciones)", tone: "danger",
      sections: [
        { h: "Descripción:", bullets: ["Rompe el swing REAL de M15 (no micro-ruido de M5).", "Hay displacement claro (cuerpo grande / velocidad / expansión).", "Suele dejar un FVG en dirección del quiebre."] },
        { h: "¿Qué hacés?", bullets: ["PASO 1: cancelá el plan anterior. NO persigas la ruptura.", "PASO 2: marcá la zona de retest: FVG M15 + M5 / OB / Breaker.", "PASO 3: esperá que el precio vuelva y RECHACE.", "PASO 4: solo entrás con confirmación M5 limpia.", "PASO 5: si M15 sostiene → ok. Si anula el displacement → WAIT."] },
      ],
    };

  if (invalidationKind === "M15" && m15Imbalance === null)
    return { title: "Ruptura M15: falta confirmar displacement", tone: "warn", lines: ["Respondé si hubo displacement con imbalance para completar la lectura."] };

  return null;
}

// ─── Función principal exportada ──────────────────────────

export function inferBias(args: JournalContextArgs): JournalContextResult {
  const {
    liqTaken, lastTaken, reaction, pendingLevels,
    invalidationHappened, invalidationKind, m15Imbalance,
    m15Confirmed,
  } = args;

  // Bias base — absorción ahora requiere m15Confirmed
  const modeNoLiq = reaction === "accept" ? "EXPANSION" : reaction === "absorb" ? "RANGE" : "UNCLEAR";
  const baseBias: BiasShown = liqTaken === "no"
    ? modeNoLiq === "RANGE" ? "NO TRADE" : "WAIT"
    : inferBiasBase(lastTaken, reaction, m15Confirmed).bias;

  // Bias con invalidación
  let biasShown: BiasShown = baseBias;
  if (invalidationHappened === "yes") {
    if (invalidationKind === "M5") biasShown = "WAIT";
    else if (invalidationKind === "M15") biasShown = m15Imbalance === "yes" ? flipBias(baseBias) : "WAIT";
  }

  // Bias reason
  const biasReason =
    biasShown === "LONG" ? "Estructura activa M15–M5 ALCISTA. Operá pullbacks en PD Arrays alineados. No persigas precio."
    : biasShown === "SHORT" ? "Estructura activa M15–M5 BAJISTA. Buscá retests/pullbacks en PD Arrays. No persigas impulsos."
    : biasShown === "WAIT" ? "No hay estructura activa clara para operar. Esperá sweep/shift válido o PD Array limpio."
    : "Contexto desordenado o rango. Mercado abierto, pero no operable.";

  // Market state base
  const baseMarketState = inferMarketStateBase({ liqTaken, reaction, pendingLevels, biasShown });

  // Market state con invalidación
  let marketState: MarketStateResult = baseMarketState;
  if (invalidationHappened === "yes") {
    if (invalidationKind === "M5")
      marketState = { state: "WAIT", tone: "warn", desc: "Invalidación micro (M5): invalida el setup, pero no confirma reversa. Esperá confirmación M15." };
    else if (invalidationKind === "M15") {
      if (m15Imbalance === "yes")
        marketState = { state: "TRANSITION", tone: "danger", desc: "Shift M15 con displacement: cambio de delivery confirmado. Esperá retest a PD Array + confirmación M5." };
      else if (m15Imbalance === "no")
        marketState = { state: "DELIVERY_CONDITIONAL", tone: "warn", desc: "Shift M15 sin displacement: intención no confirmada. Esperá próximo movimiento con intención." };
      else
        marketState = { state: "WAIT", tone: "warn", desc: "Elegiste M15: falta responder si hubo displacement (imbalance)." };
    }
  }

  // Delivery
  const deliveryStatus = computeDeliveryStatus({ liqTaken, lastTaken, reaction, pendingLevels, biasShown, invalidationKind });

  // Invalidation guide
  const invalidationGuide = computeInvalidationGuide({ invalidationHappened, invalidationKind, m15Imbalance });

  // Targets
  const suggestedTargetsResult = suggestTargets(pendingLevels, biasShown);

  return {
    biasShown,
    biasReason,
    marketState,
    deliveryStatus,
    invalidationGuide,
    suggestedTargets: suggestedTargetsResult,
  };
}