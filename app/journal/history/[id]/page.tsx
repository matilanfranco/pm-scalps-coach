"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getTradeById } from "@/lib/tradesDb";

import type { TradeEntry } from "@/lib/types";
import {
  formatYMD,
  weekdayLabel,
  outcomeBadge,
  tonePill,
  sidePill,
  rrTone,
  toneToClasses,
  normalizeOutcome,
} from "@/lib/helpers";

function chip(s: string, variant: "muted" | "good" | "danger" | "warn" = "muted") {
  const base = "rounded-full border px-3 py-1 text-xs font-extrabold whitespace-nowrap";
  return <span className={`${base} ${tonePill(variant)}`}>{s}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <div className="w-40 shrink-0 text-xs font-extrabold text-white/50 uppercase tracking-wide pt-0.5">
        {label}
      </div>
      <div className="text-sm text-white/90">{children}</div>
    </div>
  );
}

export default function TradeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [trade, setTrade] = useState<TradeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;
        if (!uid) { router.replace("/login"); return; }

        const t = await getTradeById(uid, id);
        if (!t) { setError("Trade no encontrado."); return; }

        setTrade(t as TradeEntry);
      } catch (e) {
        console.error(e);
        setError("Error al cargar el trade.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  const panel = "rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]";

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-8 text-white/60">Cargando…</div>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="text-red-300">{error ?? "Trade no encontrado."}</div>
          <button
            onClick={() => router.push("/journal/history")}
            className="mt-4 h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-extrabold text-white hover:bg-white/10 transition"
          >
            ← Volver al historial
          </button>
        </div>
      </div>
    );
  }

  const oc = outcomeBadge(trade);
  const outcome = normalizeOutcome(trade.outcome);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">

        {/* ── Breadcrumb ── */}
        <button
          onClick={() => router.push("/journal/history")}
          className="text-xs font-extrabold text-white/50 hover:text-white/80 transition"
        >
          ← Historial
        </button>

        {/* ── Título ── */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black">
            {weekdayLabel(trade.createdAt)} {formatYMD(trade.createdAt)}
          </h1>
          {trade.tradeTime && (
            <span className="text-sm font-extrabold text-white/50">{trade.tradeTime}</span>
          )}
          <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${tonePill(oc.tone)}`}>
            {oc.text}
          </span>
          {trade.tradeTaken === "yes" && (
            <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${sidePill(trade.tradeSide)}`}>
              {trade.tradeSide}
            </span>
          )}
        </div>

        {/* ── Imagen ── */}
        {trade.imgUrl && (
          <div className="mt-6">
            <img
              src={trade.imgUrl}
              alt="Chart"
              className="rounded-2xl border border-white/10 w-full max-h-[500px] object-contain bg-black/30"
            />
          </div>
        )}

        {/* ── Trade info ── */}
        {trade.tradeTaken === "yes" && (
          <div className={`mt-6 ${panel}`}>
            <div className="text-xs font-extrabold tracking-[0.16em] text-white/50 mb-4">TRADE</div>
            <div className="grid gap-3">
              <Row label="Instrumento">{trade.instrument}</Row>
              <Row label="Dirección">
                <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${sidePill(trade.tradeSide)}`}>
                  {trade.tradeSide}
                </span>
              </Row>
              <Row label="Resultado">
                <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${tonePill(oc.tone)}`}>
                  {oc.text}
                </span>
              </Row>
              <Row label="RR">
                <span className={`rounded-full border px-3 py-1 text-xs font-black ${tonePill(rrTone(trade.rr))}`}>
                  {trade.rr == null ? "—" : trade.rr.toFixed(2)}
                </span>
              </Row>
              {trade.partialRRs?.length ? (
              <Row label="Parciales">
                <div className="flex flex-wrap gap-2">
                  {trade.partialRRs.map((rr, i) => (
                    <span key={i} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-100 px-3 py-1 text-xs font-black">
                      TP{i + 1}: {rr}R
                    </span>
                  ))}
                </div>
              </Row>
            ) : null}
              <Row label="Setup">
                {trade.setupTag === "A" ? chip("Setup A", "good")
                  : trade.setupTag === "B" ? chip("Setup B", "warn")
                  : chip("—")}
              </Row>
              <Row label="Siguió el plan">
                {trade.followedPlan === "yes" ? chip("Sí ✓", "good") : chip("No ✗", "danger")}
              </Row>
              <Row label="App ayudó">
                {trade.helped ? chip("Sí", "good") : chip("No", "muted")}
              </Row>
            </div>
          </div>
        )}

        {trade.tradeTaken === "no" && (
          <div className={`mt-6 ${panel}`}>
            <div className="text-sm text-white/60">No se tomó trade en esta sesión.</div>
          </div>
        )}

        {/* ── Contexto de mercado ── */}
        <div className={`mt-4 ${panel}`}>
          <div className="text-xs font-extrabold tracking-[0.16em] text-white/50 mb-4">CONTEXTO</div>
          <div className="grid gap-3">
            <Row label="Bias">
              {chip(
                trade.biasShown,
                trade.biasShown === "LONG" ? "good"
                  : trade.biasShown === "SHORT" ? "danger"
                  : "muted"
              )}
            </Row>
            <Row label="Estado mercado">
              {chip(
                trade.marketState,
                trade.marketState === "EXPANSION" ? "good"
                  : trade.marketState === "TRANSITION" ? "danger"
                  : trade.marketState === "DELIVERY_CONDITIONAL" ? "warn"
                  : "muted"
              )}
            </Row>
            <Row label="Liquidez tomada">
              {chip(trade.liqTaken, trade.liqTaken === "yes" ? "good" : "muted")}
            </Row>
            {trade.lastTaken && (
              <Row label="Última tomada">{trade.lastTaken}</Row>
            )}
            <Row label="Reacción">
              {chip(
                trade.reaction,
                trade.reaction === "accept" ? "good"
                  : trade.reaction === "absorb" ? "danger"
                  : "muted"
              )}
            </Row>
            <Row label="FVG">{chip(trade.hasFvg, trade.hasFvg === "yes" ? "good" : trade.hasFvg === "no" ? "danger" : "muted")}</Row>
            {trade.invalidationHappened === "yes" && (
              <Row label="Invalidación">
                {chip(trade.invalidationKind ?? "—", "warn")}
              </Row>
            )}
            {trade.takenLevels?.length > 0 && (
              <Row label="Niveles tomados">
                <div className="flex flex-wrap gap-1">
                  {trade.takenLevels.map((l) => (
                    <span key={l} className={`rounded-full border px-2 py-0.5 text-xs font-extrabold ${tonePill("muted")}`}>{l}</span>
                  ))}
                </div>
              </Row>
            )}
            {trade.pendingLevels?.length > 0 && (
              <Row label="Pendientes">
                <div className="flex flex-wrap gap-1">
                  {trade.pendingLevels.map((l) => (
                    <span key={l} className={`rounded-full border px-2 py-0.5 text-xs font-extrabold ${tonePill("muted")}`}>{l}</span>
                  ))}
                </div>
              </Row>
            )}
          </div>
        </div>

        {/* ── Nota ── */}
        {trade.note?.trim() && (
          <div className={`mt-4 ${panel}`}>
            <div className="text-xs font-extrabold tracking-[0.16em] text-white/50 mb-3">NOTA</div>
            <p className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed">{trade.note.trim()}</p>
          </div>
        )}

        {/* ── Volver ── */}
        <div className="mt-8">
          <button
            onClick={() => router.push("/journal/history")}
            className="h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-extrabold text-white hover:bg-white/10 transition"
          >
            ← Volver al historial
          </button>
        </div>

      </div>
    </div>
  );
}
