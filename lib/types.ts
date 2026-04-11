// lib/types.ts

export type Level =
  | "PDH"
  | "PDL"
  | "ASIA_H"
  | "ASIA_L"
  | "LONDON_H"
  | "LONDON_L"
  | "WEEKLY_H"
  | "WEEKLY_L";

export type Side = "buyside" | "sellside";
export type Reaction = "accept" | "absorb" | "unclear";
export type Instrument = "ES" | "NQ";
export type TradeSide = "BUY" | "SELL";
export type FollowedPlan = "yes" | "no";
export type SetupTag = "A" | "B" | "none" | "unknown";
export type OutcomeDb = "win" | "loss" | "be" | "unknown";
export type OutcomeForm = "PROFIT" | "STOP" | "BE" | "NONE";
export type InvalidationKind = "M5" | "M15";
export type YesNo = "yes" | "no";
export type M15Confirmed = "yes" | "no" | null;

// ─── Nuevos tipos de contexto ─────────────────────

export type AmDir = "alcista" | "bajista" | "sin-dir" | null;
export type AmReac = "absorbio" | "acepto" | null;
export type HtfStruct = "alcista" | "bajista" | null;
export type M15Struct = "alcista" | "bajista" | null;
export type CisdDir = "alcista" | "bajista" | null;
export type LevelLabel =
  | "PDH" | "PDL"
  | "London H" | "London L"
  | "Asia H" | "Asia L"
  | "Weekly H" | "Weekly L"
  | null;

export type ContextTag =
  | "CONT-AM"
  | "CONT-AM-SWEEP"
  | "REVERSAL-SWEEP"
  | "REVERSAL-NO-SWEEP"
  | null;

// ─────────────────────────────────────────────────

export type MarketState =
  | "EXPANSION"
  | "DELIVERY_CONDITIONAL"
  | "TRANSITION"
  | "REVERSAL_CONFIRMED"
  | "CHOP_NO_TRADE"
  | "WAIT";

export type BiasShown = "LONG" | "SHORT" | "WAIT" | "NO TRADE";

export type TradeEntry = {
  id: string;
  createdAt: number;

  // contexto legacy (se mantiene por compatibilidad)
  instrument: Instrument;
  liqTaken: "yes" | "no" | "unknown";
  takenLevels: Level[];
  lastTaken: Level | null;
  reaction: Reaction;
  pendingLevels: Level[];
  hasFvg: "yes" | "no" | "skip";
  biasShown: BiasShown;
  marketState: MarketState;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationKind: InvalidationKind | null;
  m15Imbalance: YesNo | null;
  m15Confirmed: M15Confirmed;
  suggestedTargets: Level[];

  // ─── Nuevo contexto de sesión ───────────────────
  amDir: AmDir;
  amSweepNivel: LevelLabel;
  amReac: AmReac;
  htfStruct: HtfStruct;
  pmSweepNivel: LevelLabel;
  pmReac: AmReac;
  m15Struct: M15Struct;
  cisdDir: CisdDir;
  contextTag: ContextTag;
  htfAligned: boolean | null;
  // ────────────────────────────────────────────────

  // trade
  helped: boolean;
  tradeTaken: "yes" | "no";
  tradeTime: string;
  tradeSide: TradeSide;
  followedPlan: FollowedPlan;
  rr: number | null;
  setupTag: SetupTag;
  outcome: OutcomeDb;
  note: string;

  // parciales
  numPartials?: number | null;
  partialRRs?: number[] | null;

  // imagen
  imgUrl?: string | null;
  imgPath?: string | null;
};

export type DailyWrap = {
  date: string;
  dailyError: string;
  dailyLearning: string;
  updatedAt: number;
};

export type KPIs = {
  total: number;
  totalWithRR: number;
  winCount: number;
  lossCount: number;
  beCount: number;
  winrate: number;
  avgRR: number;
  medRR: number;
  netRR: number;
  expectancy: number;
  profitFactor: number;
  bestWinStreak: number;
  bestLossStreak: number;
};