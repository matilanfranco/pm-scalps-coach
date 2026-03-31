import { getSupabaseClient } from "@/lib/supabaseClient";
 
function sb() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Supabase client no inicializado. Revisá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return supabase;
}
 
export type TradeEntryDb = {
  userId: string;
  createdAt: number;
 
  instrument: "ES" | "NQ";
 
  liqTaken: "yes" | "no" | "unknown";
  lastTaken: any | null;
  reaction: "accept" | "absorb" | "unclear";
  hasFvg: "yes" | "no" | "skip";
 
  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  marketState: any;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationChoice?: string | null;
  numPartials?: number | null;
  partialRRs?: number[] | null;
 
  helped: boolean;
 
  tradeTaken: "yes" | "no";
  tradeTime: string;
  tradeSide: "BUY" | "SELL";
  followedPlan: "yes" | "no";
  rr: number | null;
 
  takenLevels: any[];
  pendingLevels: any[];
  suggestedTargets: any[];
 
  outcome?: "win" | "loss" | "be" | "unknown";
  setupTag?: string;
  note: string;
 
  imgPath?: string | null;
  imgUrl?: string | null;
};
 
export async function deleteTrade(userId: string, tradeId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not configured");
 
  const { error } = await supabase
    .from("trades")
    .delete()
    .eq("user_id", userId)
    .eq("id", tradeId);
 
  if (error) throw error;
}
 
// ✅ FIX: invalidationChoice → invalidationKind para que matchee con lib/types.ts
function mapRow(r: any) {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).getTime(),
 
    instrument: r.instrument === "NQ" ? "NQ" : "ES",
 
    liqTaken: r.liq_taken,
    takenLevels: r.taken_levels ?? [],
    lastTaken: r.last_taken ?? null,
    reaction: r.reaction,
    pendingLevels: r.pending_levels ?? [],
    hasFvg: r.has_fvg,
 
    biasShown: r.bias_shown,
    marketState: r.market_state,
    invalidationHappened: r.invalidation_happened,
 
    // ✅ antes era invalidationChoice — ahora es invalidationKind
    invalidationKind: r.invalidation_choice ?? null,
 
    suggestedTargets: r.suggested_targets ?? [],
 
    helped: r.helped ?? false,
 
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
  };
}
 
export async function createTrade(trade: TradeEntryDb) {
  const payload = {
    user_id: trade.userId,
    created_at: new Date(trade.createdAt).toISOString(),
 
    instrument: trade.instrument ?? "ES",
 
    liq_taken: trade.liqTaken,
    taken_levels: trade.takenLevels ?? [],
    last_taken: trade.lastTaken ?? null,
    reaction: trade.reaction,
    pending_levels: trade.pendingLevels ?? [],
    has_fvg: trade.hasFvg,
    num_partials: trade.numPartials ?? null,
    partial_rrs: trade.partialRRs ?? null,
 
    bias_shown: trade.biasShown,
    market_state: trade.marketState,
    invalidation_happened: trade.invalidationHappened,
    invalidation_choice: trade.invalidationChoice ?? null,
    suggested_targets: trade.suggestedTargets ?? [],
 
    helped: trade.helped,
 
    trade_taken: trade.tradeTaken,
    trade_time: trade.tradeTime ?? "",
    trade_side: trade.tradeSide ?? "BUY",
    followed_plan: trade.followedPlan ?? "yes",
 
    rr: trade.rr ?? null,
    outcome: trade.outcome ?? "unknown",
    setup_tag: trade.setupTag ?? "unknown",
 
    note: trade.note ?? "",
 
    img_path: trade.imgPath ?? null,
    img_url: trade.imgUrl ?? null,
  };
 
  const { data, error } = await sb()
    .from("trades")
    .insert(payload)
    .select("id")
    .single();
 
  if (error) throw error;
  return data.id as string;
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
 
export async function listTradesSince(userId: string, sinceMs?: number, limit = 500) {
  let q = sb()
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
 
  // ✅ sinceMs=0 trae todo — solo filtramos si es un timestamp real
  if (sinceMs && sinceMs > 0) {
    q = q.gt("created_at", new Date(sinceMs).toISOString());
  }
 
  const { data, error } = await q;
  if (error) throw error;
 
  return (data ?? []).map(mapRow);
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
  }
) {
  const payload: Record<string, any> = {};
 
  if (patch.createdAt !== undefined)
    payload.created_at = new Date(patch.createdAt).toISOString();
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
 
  const { error } = await sb().from("trades").update(payload).eq("id", tradeId);
  if (error) throw error;
}