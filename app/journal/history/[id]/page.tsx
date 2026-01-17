"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getTradeById } from "@/lib/tradesDb";

type Level =
  | "PDH"
  | "PDL"
  | "ASIA_H"
  | "ASIA_L"
  | "LONDON_H"
  | "LONDON_L"
  | "WEEKLY_H"
  | "WEEKLY_L";

type Reaction = "accept" | "absorb" | "unclear";
type MarketState =
  | "EXPANSION"
  | "DELIVERY_CONDITIONAL"
  | "TRANSITION"
  | "REVERSAL_CONFIRMED"
  | "CHOP_NO_TRADE"
  | "WAIT";

type InvalidationChoice = "micro_m5" | "shift_m15" | "ifvg";
type SetupTag = "A" | "B" | "unknown";
type TargetTag = Level | "HTF" | "NONE";
type TradeSide = "BUY" | "SELL";
type FollowedPlan = "yes" | "no";

type TradeEntry = {
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

  tradeTaken: "yes" | "no";
  tradeTime: string; // HH:MM
  tradeSide: TradeSide;
  followedPlan: FollowedPlan;
  rr: number | null;
  setupTag: SetupTag;
  targetTag: TargetTag;

  note: string;
};

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

function tonePill(tone: "good" | "danger" | "warn" | "muted") {
  switch (tone) {
    case "good":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]";
    case "danger":
      return "border-red-400/30 bg-red-500/10 text-red-100 shadow-[0_0_0_1px_rgba(248,113,113,0.12)]";
    case "warn":
      return "border-amber-400/30 bg-amber-500/10 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.10)]";
    default:
      return "border-white/12 bg-white/5 text-white/75";
  }
}

function sidePill(side: TradeSide) {
  return side === "BUY"
    ? "border-sky-400/30 bg-sky-500/10 text-sky-100 shadow-[0_0_0_1px_rgba(56,189,248,0.10)]"
    : "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100 shadow-[0_0_0_1px_rgba(232,121,249,0.10)]";
}

function chip(text: string, tone: "good" | "danger" | "warn" | "muted" = "muted") {
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${tonePill(tone)}`}>
      {text}
    </span>
  );
}

function rrTone(rr: number | null) {
  if (rr == null) return "muted" as const;
  if (rr > 0) return "good" as const;
  if (rr < 0) return "danger" as const;
  return "warn" as const;
}

function outcomeText(rr: number | null) {
  if (rr == null) return "— No RR";
  if (rr > 0) return "✅ Win";
  if (rr < 0) return "❌ Loss";
  return "◻︎ BE";
}

function stateTone(s: MarketState) {
  if (s === "EXPANSION") return "good" as const;
  if (s === "DELIVERY_CONDITIONAL") return "warn" as const;
  if (s === "TRANSITION" || s === "REVERSAL_CONFIRMED") return "danger" as const;
  return "muted" as const;
}

function biasTone(b: TradeEntry["biasShown"]) {
  if (b === "LONG") return "good" as const;
  if (b === "SHORT") return "danger" as const;
  return "muted" as const;
}

export default function TradeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [trade, setTrade] = useState<TradeEntry | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");
  const [openImg, setOpenImg] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string>("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
        if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    }, []);

  useEffect(() => {
  let alive = true;

  (async () => {
    if (!id) return;

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const session = data.session;
      if (!session?.user?.id) {
        router.push("/login");
        return;
      }

      const userId = session.user.id;

      const row = await getTradeById(userId, String(id));
      if (!alive) return;

      if (row && row.tradeTaken === "yes") {
        setTrade(row as any);
        setStatus("ok");

        // ✅ sacar hardcode: usar la url del trade si existe
        setImgUrl(row.imgUrl ?? "");
      } else {
        setTrade(null);
        setStatus("notfound");
      }
    } catch (e) {
      console.error("Trade detail Supabase load failed:", e);
      if (!alive) return;
      setTrade(null);
      setStatus("notfound");
    }
  })();

  return () => {
    alive = false;
  };
}, [id, router]);

  const day = useMemo(() => (trade ? new Date(trade.createdAt).toLocaleDateString() : "—"), [trade]);

  const kpiRR = useMemo(() => {
    if (!trade) return { rrText: "—", rrTone: "muted" as const, outcome: "—" };
    const rr = trade.rr;
    return {
      rrText: rr == null ? "—" : rr.toFixed(2),
      rrTone: rrTone(rr),
      outcome: outcomeText(rr),
    };
  }, [trade]);

  // UI
  const panel =
    "rounded-2xl border border-white/10 bg-white/4 backdrop-blur-xl p-4 shadow-[0_18px_40px_rgba(0,0,0,0.45)]";
  const btn =
    "h-10 rounded-full border border-white/12 inline-flex items-center cursor-pointer  bg-white/3 px-4 text-sm font-extrabold text-white/80 hover:bg-white/[0.06] hover:border-white/20 transition";

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="text-sm text-white/70">Cargando…</div>
        </div>
      </div>
    );
  }

  if (status === "notfound") {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className={panel}>
            <div className="text-xs font-extrabold tracking-[0.18em] text-white/55">JOURNAL</div>
            <h1 className="mt-2 text-2xl font-black">Trade no encontrado</h1>

            <div className="mt-3 text-sm text-white/70">
              No hay trade con ese id.
            </div>

            <div className="mt-4 flex gap-2">
              <Link href="/journal/history" className={btn}>
                ← Volver a History
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!trade) return null;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
     
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-extrabold tracking-[0.18em] text-white/55">TRADE DETAIL</div>
            <div className="mt-2 text-xl text-white/65">
              Día <b className="text-white/90">{day}</b> · Hora{" "}
              <b className="text-white/90">{trade.tradeTime || "—"}</b>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/journal/history" className={btn}>
              ← History
            </Link>
            <button onClick={() => router.back()} className={btn} title="Volver">
              Back
            </button>
          </div>
        </div>

        {/* Hero card */}
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className={`${panel} md:col-span-2`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${sidePill(trade.tradeSide)}`}>
                {trade.tradeSide}
              </span>

              {chip(kpiRR.outcome, kpiRR.rrTone)}
              {chip(`RR ${kpiRR.rrText}`, kpiRR.rrTone)}

              {trade.followedPlan === "yes" ? chip("Plan: sí", "good") : chip("Plan: no", "danger")}
              {trade.setupTag !== "unknown"
                ? chip(`Setup ${trade.setupTag}`, trade.setupTag === "A" ? "good" : "warn")
                : chip("Setup —", "muted")}
              {/* {chip(`Target: ${String(trade.targetTag)}`, "muted")} */}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
                <div className="text-xs font-extrabold text-white/55">BIAS / DIRECCIÓN DEL PRECIO</div>
                <div className="mt-2">{chip(trade.biasShown, biasTone(trade.biasShown))}</div>
                <div className="mt-3 text-xs font-extrabold text-white/55">ESTADO DEL MERCADO</div>
                <div className="mt-2">{chip(trade.marketState, stateTone(trade.marketState))}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
                <div className="text-xs font-extrabold text-white/55">¿FUÉ LA APP DE AYUDA?</div>
                <div className="mt-2">
                  {trade.helped ? chip("Sí", "good") : chip("No", "danger")}
                </div>

                <div className="mt-3 text-xs font-extrabold text-white/55">¿MOVIMIENTO CON IMBALANCE?</div>
                <div className="mt-2">
                  {trade.hasFvg === "yes"
                    ? chip("Sí, había FVG", "good")
                    : trade.hasFvg === "no"
                    ? chip("No, no hubo FVG", "danger")
                    : chip("Skip", "muted")}
                </div>
              </div>
            </div>
          </div>

          {/* Context quick */}
          <div className={panel}>
            <div className="text-xs font-extrabold tracking-[0.18em] text-white/55">CONTEXTO PREVIO</div>

            <div className="mt-4 text-sm text-white/80">
              <div>
                <span className="text-white/55">Última liquidez importante tomada antes del trade: </span>
                <b className="text-white/90">{trade.lastTaken ? levelLabel(trade.lastTaken) : "—"}</b>
              </div>

              <div className="mt-2">
                <span className="text-white/55">Aceptación / continuacion o absorción / reversal: </span>
                <b className="text-white/90">{trade.reaction === "accept" ? "Aceptación." : trade.reaction === "absorb" ? "Absorción." : "Movimiento no claro."}</b>
              </div>

              <div className="mt-2">
                <span className="text-white/55">Niveles pendientes / posibles targets:</span>{" "}
                <b className="text-white/90">{trade.pendingLevels?.length ?? 0}</b>
              </div>
            </div>

            {trade.pendingLevels?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {trade.pendingLevels.map((l) => (
                  <span key={l} className="rounded-full border border-white/10 bg-white/3 px-3 py-1 text-xs font-extrabold text-white/80">
                    {levelLabel(l)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-white/55">No marcaste liquidez pendiente.</div>
            )}
          </div>
        </div>

        {/* Deep detail */}
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {/* Chart preview */}
            <div className={panel}>
            <div className="text-xs font-extrabold tracking-[0.18em] text-white/55">GRÁFICO (PREVIEW)</div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/3 p-4">
                <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/3">
                {/* Cuando tengas imágenes reales, reemplazá este src por el tuyo */}
                {imgUrl ? (
                    <button
                        type="button"
                        onClick={() => setOpenImg(imgUrl)}
                        className="group w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 cursor-pointer"
                        aria-label="Abrir imagen"
                    >
                        <img
                        src={imgUrl}
                        alt="Captura del trade"
                        className="h-56 w-full object-cover transition group-hover:scale-[1.02]"
                        />
                        <div className="flex items-center justify-between px-4 py-3 text-xs text-white/70">
                        <span>Click para agrandar</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">🔍</span>
                        </div>
                    </button>
                    ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                        (Acá va la foto cuando la agregues)
                    </div>
                    )}
                </div>
            </div>
            </div>          
          {/* Manual note */}
          <div className={panel}>
            <div className="text-xs font-extrabold tracking-[0.18em] text-white/55">DESCRIPCIÓN DEL TRADE</div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/3 p-4">
              {trade.note?.trim() ? (
                <div className="whitespace-pre-wrap text-sm text-white/90">{trade.note.trim()}</div>
              ) : (
                <div className="text-sm text-white/55">Sin nota.</div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/3 p-4">
              <div className="text-xs font-extrabold text-white/55">Checklist rápido</div>
              <div className="mt-3 grid gap-2 text-sm text-white/85">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-white/65">Trade dentro del plan?</div>
                  {trade.followedPlan === "yes" ? chip("Sí", "good") : chip("No", "danger")}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-white/65">Movimiento con FVG?</div>
                  {trade.hasFvg === "yes" ? chip("Sí", "good") : trade.hasFvg === "no" ? chip("No", "danger") : chip("Skip", "muted")}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-white/65">¿Me ayudó la app?</div>
                  {trade.helped ? chip("Sí", "good") : chip("No", "danger")}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/journal/history" className={btn}>
                ← Volver a lista
              </Link>
            </div>
          </div>
        </div>

        {/* Footer hint */}
        {/* <div className="mt-6 text-xs text-white/45">
          Todo esto está leído desde <b>localStorage</b> (snapshot). No hay data de guita: todo RR.
        </div> */}
      </div>
      {openImg && (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center"
            onClick={() => setOpenImg(null)}
            role="dialog"
            aria-modal="true"
        >
            <div
            className="relative w-full max-w-5xl"
            onClick={(e) => e.stopPropagation()} // evita que se cierre al clickear la imagen
            >
            <button
                type="button"
                onClick={() => setOpenImg(null)}
                className="absolute -top-3 -right-3 h-10 w-10 rounded-full border border-white/15 bg-white/10 text-white/90 hover:bg-white/15 cursor-pointer"
                aria-label="Cerrar"
            >
                ✕
            </button>

            <div className="overflow-hidden rounded-2xl border border-white/15 bg-black">
                <img src={openImg} alt="Captura grande" className="w-full h-auto max-h-[80vh] object-contain" />
            </div>

            <div className="mt-3 text-center text-xs text-white/60">
                Click afuera o ✕ para cerrar
            </div>
            </div>
        </div>
        )}
    </div>
  );
}