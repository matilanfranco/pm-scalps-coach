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

  // contexto
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
  suggestedTargets: Level[];

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
