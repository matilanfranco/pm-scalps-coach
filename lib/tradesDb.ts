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

  liqTaken: "yes" | "no" | "unknown";
  takenLevels: any[];
  lastTaken: any | null;
  reaction: "accept" | "absorb" | "unclear";
  pendingLevels: any[];
  hasFvg: "yes" | "no" | "skip";

  biasShown: "LONG" | "SHORT" | "WAIT" | "NO TRADE";
  marketState: any;
  invalidationHappened: "yes" | "no" | "unknown";
  invalidationChoice: any | null;
  suggestedTargets: any[];

  helped: boolean;

  tradeTaken: "yes" | "no";
  tradeTime: string;
  tradeSide: "BUY" | "SELL";
  followedPlan: "yes" | "no";
  rr: number | null;

  outcome?: "win" | "loss" | "be" | "unknown";
  setupTag?: string;
  note: string;

  imgPath?: string | null;
  imgUrl?: string | null;
};

function mapRow(r: any) {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).getTime(),
    tradeTaken: r.trade_taken,
    tradeTime: r.trade_time,
    tradeSide: r.trade_side,
    followedPlan: r.followed_plan,
    rr: r.rr,
    outcome: r.outcome,
    setupTag: r.setup_tag,
    targetTag: r.target_tag,
    biasShown: r.bias_shown,
    marketState: r.market_state,
    liqTaken: r.liq_taken,
    lastTaken: r.last_taken,
    reaction: r.reaction,
    pendingLevels: r.pending_levels ?? [],
    hasFvg: r.has_fvg,
    helped: r.helped ?? false,
    note: r.note ?? "",
    imgUrl: r.img_url ?? null,
    imgPath: r.img_path ?? null,
  };
}

export async function createTrade(trade: TradeEntryDb) {
  const payload = {
    user_id: trade.userId,
    created_at: new Date(trade.createdAt).toISOString(),

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

  if (sinceMs) {
    q = q.gt("created_at", new Date(sinceMs).toISOString());
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map(mapRow);
}