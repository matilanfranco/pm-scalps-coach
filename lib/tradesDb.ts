import { getSupabaseClient } from "@/lib/supabaseClient";
import type {
  AmDir, AmReac, HtfStruct, M15Struct, CisdDir, LevelLabel, ContextTag
} from "@/lib/types";

function sb() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client no inicializado.");
  return supabase;
}

export type TradeEntryDb = {
  userId: string;
  createdAt: number;
  instrument: "ES" | "NQ";

  // legacy
  liqTaken: "yes" | "no" | "unknown";
  lastTaken: any | null;
  reaction: "accept" | "absorb" | "unclear";
  hasFvg: "yes" | "no" | "skip";
  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  marketState: any;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationChoice?: string | null;
  helped: boolean;
  takenLevels: any[];
  pendingLevels: any[];
  suggestedTargets: any[];

  // trade
  tradeTaken: "yes" | "no";
  tradeTime: string;
  tradeSide: "BUY" | "SELL";
  followedPlan: "yes" | "no";
  rr: number | null;
  outcome?: "win" | "loss" | "be" | "unknown";
  setupTag?: string;
  note: string;
  numPartials?: number | null;
  partialRRs?: number[] | null;
  imgPath?: string | null;
  imgUrl?: string | null;

  // ─── Nuevo contexto de sesión ───────────────────
  amDir?: AmDir;
  amSweepNivel?: LevelLabel;
  amReac?: AmReac;
  htfStruct?: HtfStruct;
  pmSweepNivel?: LevelLabel;
  pmReac?: AmReac;
  m15Struct?: M15Struct;
  cisdDir?: CisdDir;
  contextTag?: ContextTag;
  htfAligned?: boolean | null;
  confirmationCandle?: "m5" | "m2" | "sin-confirmacion" | null;
};

function mapRow(r: any) {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).getTime(),
    instrument: r.instrument === "NQ" ? "NQ" : "ES",

    // legacy
    liqTaken: r.liq_taken,
    takenLevels: r.taken_levels ?? [],
    lastTaken: r.last_taken ?? null,
    reaction: r.reaction,
    pendingLevels: r.pending_levels ?? [],
    hasFvg: r.has_fvg,
    biasShown: r.bias_shown,
    marketState: r.market_state,
    invalidationHappened: r.invalidation_happened,
    invalidationKind: r.invalidation_choice ?? null,
    m15Imbalance: r.m15_imbalance ?? null,
    m15Confirmed: r.m15_confirmed ?? null,
    suggestedTargets: r.suggested_targets ?? [],
    helped: r.helped ?? false,

    // trade
    tradeTaken: r.trade_taken,
    tradeTime: r.trade_time,
    tradeSide: r.trade_side,
    followedPlan: r.followed_plan,
    rr: r.rr ?? null,
    outcome: r.outcome ?? "unknown",
    setupTag: r.setup_tag ?? "unknown",
    note: r.note ?? "",
    numPartials: r.num_partials ?? null,
    partialRRs: r.partial_rrs ?? null,
    imgUrl: r.img_url ?? null,
    imgPath: r.img_path ?? null,

    // ─── Nuevo contexto ─────────────────────────
    amDir: r.am_dir ?? null,
    amSweepNivel: r.am_sweep_nivel ?? null,
    amReac: r.am_reac ?? null,
    htfStruct: r.htf_struct ?? null,
    pmSweepNivel: r.pm_sweep_nivel ?? null,
    pmReac: r.pm_reac ?? null,
    m15Struct: r.m15_struct ?? null,
    cisdDir: r.cisd_dir ?? null,
    contextTag: r.context_tag ?? null,
    htfAligned: r.htf_aligned ?? null,
    confirmationCandle: r.confirmation_candle ?? null,
  };
}

export async function createTrade(trade: TradeEntryDb) {
  const payload: Record<string, any> = {
    user_id: trade.userId,
    created_at: new Date(trade.createdAt).toISOString(),
    instrument: trade.instrument ?? "ES",

    // legacy
    liq_taken: trade.liqTaken,
    taken_levels: trade.takenLevels ?? [],
    last_taken: trade.lastTaken ?? null,
    reaction: trade.reaction,
    pending_levels: trade.pendingLevels ?? [],
    has_fvg: trade.hasFvg,
    bias_shown: trade.biasShown,
    market_state: trade.marketState,
    invalidation_happened: trade.invalidationHappened,
    invalidation_choice: trade.invalidationChoice ?? null,
    suggested_targets: trade.suggestedTargets ?? [],
    helped: trade.helped,

    // trade
    trade_taken: trade.tradeTaken,
    trade_time: trade.tradeTime ?? "",
    trade_side: trade.tradeSide ?? "BUY",
    followed_plan: trade.followedPlan ?? "yes",
    rr: trade.rr ?? null,
    outcome: trade.outcome ?? "unknown",
    setup_tag: trade.setupTag ?? "unknown",
    note: trade.note ?? "",
    num_partials: trade.numPartials ?? null,
    partial_rrs: trade.partialRRs ?? null,
    img_path: trade.imgPath ?? null,
    img_url: trade.imgUrl ?? null,

    // ─── Nuevo contexto ─────────────────────────
    am_dir: trade.amDir ?? null,
    am_sweep_nivel: trade.amSweepNivel ?? null,
    am_reac: trade.amReac ?? null,
    htf_struct: trade.htfStruct ?? null,
    pm_sweep_nivel: trade.pmSweepNivel ?? null,
    pm_reac: trade.pmReac ?? null,
    m15_struct: trade.m15Struct ?? null,
    cisd_dir: trade.cisdDir ?? null,
    context_tag: trade.contextTag ?? null,
    htf_aligned: trade.htfAligned ?? null,
    confirmation_candle: trade.confirmationCandle ?? null,
  };

  const { data, error } = await sb()
    .from("trades")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function deleteTrade(userId: string, tradeId: string) {
  const { error } = await sb()
    .from("trades")
    .delete()
    .eq("user_id", userId)
    .eq("id", tradeId);
  if (error) throw error;
}

export async function listTrades(userId: string, n = 200) {
  const { data, error } = await sb()
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function listTradesSince(userId: string, sinceMs?: number, limit = 500) {
  let q = sb()
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sinceMs && sinceMs > 0) {
    q = q.gt("created_at", new Date(sinceMs).toISOString());
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function updateTradeImage(
  tradeId: string,
  patch: { imgUrl: string; imgPath: string }
) {
  const { error } = await sb()
    .from("trades")
    .update({ img_url: patch.imgUrl, img_path: patch.imgPath })
    .eq("id", tradeId);
  if (error) throw error;
}

export async function getTradeById(userId: string, tradeId: string) {
  const { data, error } = await sb()
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data);
}

export async function updateTrade(
  tradeId: string,
  patch: {
    createdAt?: number;
    tradeTime?: string;
    tradeSide?: "BUY" | "SELL";
    followedPlan?: "yes" | "no";
    rr?: number | null;
    outcome?: "win" | "loss" | "be" | "unknown";
    setupTag?: string;
    note?: string;
    instrument?: "ES" | "NQ";
    helped?: boolean;
    tradeTaken?: "yes" | "no";
    // ─── Nuevo contexto ─────────────────────────
    amDir?: AmDir;
    amSweepNivel?: LevelLabel;
    amReac?: AmReac;
    htfStruct?: HtfStruct;
    pmSweepNivel?: LevelLabel;
    pmReac?: AmReac;
    m15Struct?: M15Struct;
    cisdDir?: CisdDir;
    contextTag?: ContextTag;
    htfAligned?: boolean | null;
    confirmationCandle?: "m5" | "m2" | "sin-confirmacion" | null;
  }
) {
  const payload: Record<string, any> = {};

  if (patch.createdAt !== undefined)    payload.created_at    = new Date(patch.createdAt).toISOString();
  if (patch.tradeTime !== undefined)    payload.trade_time    = patch.tradeTime;
  if (patch.tradeSide !== undefined)    payload.trade_side    = patch.tradeSide;
  if (patch.followedPlan !== undefined) payload.followed_plan = patch.followedPlan;
  if (patch.rr !== undefined)           payload.rr            = patch.rr;
  if (patch.outcome !== undefined)      payload.outcome       = patch.outcome;
  if (patch.setupTag !== undefined)     payload.setup_tag     = patch.setupTag;
  if (patch.note !== undefined)         payload.note          = patch.note;
  if (patch.instrument !== undefined)   payload.instrument    = patch.instrument;
  if (patch.helped !== undefined)       payload.helped        = patch.helped;
  if (patch.tradeTaken !== undefined)   payload.trade_taken   = patch.tradeTaken;

  // ─── Nuevo contexto ─────────────────────────
  if (patch.amDir !== undefined)        payload.am_dir        = patch.amDir;
  if (patch.amSweepNivel !== undefined) payload.am_sweep_nivel = patch.amSweepNivel;
  if (patch.amReac !== undefined)       payload.am_reac       = patch.amReac;
  if (patch.htfStruct !== undefined)    payload.htf_struct    = patch.htfStruct;
  if (patch.pmSweepNivel !== undefined) payload.pm_sweep_nivel = patch.pmSweepNivel;
  if (patch.pmReac !== undefined)       payload.pm_reac       = patch.pmReac;
  if (patch.m15Struct !== undefined)    payload.m15_struct    = patch.m15Struct;
  if (patch.cisdDir !== undefined)      payload.cisd_dir      = patch.cisdDir;
  if (patch.contextTag !== undefined)   payload.context_tag   = patch.contextTag;
  if (patch.htfAligned !== undefined)   payload.htf_aligned   = patch.htfAligned;
  if (patch.confirmationCandle !== undefined) payload.confirmation_candle = patch.confirmationCandle;

  const { error } = await sb().from("trades").update(payload).eq("id", tradeId);
  if (error) throw error;
}