"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getTradeById } from "@/lib/tradesDb";
import type { TradeEntry } from "@/lib/types";
import { formatYMD, weekdayLabel, normalizeOutcome } from "@/lib/helpers";

function outcomeColor(k: string): string {
  if (k === "win") return "#7dcb9a";
  if (k === "loss") return "#e08888";
  if (k === "be") return "#c8923a";
  return "rgba(232,224,208,0.35)";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"120px 1fr", gap:12, alignItems:"flex-start", padding:"10px 0", borderBottom:"1px solid rgba(180,140,80,0.07)" }}>
      <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.14em", color:"rgba(232,224,208,0.28)", paddingTop:2 }}>{label}</div>
      <div style={{ fontSize:13, color:"rgba(232,224,208,0.8)", fontWeight:600 }}>{children}</div>
    </div>
  );
}

function Tag({ children, color = "rgba(232,224,208,0.5)", bg = "rgba(255,255,255,0.04)", border = "rgba(180,140,80,0.15)" }: {
  children: React.ReactNode; color?: string; bg?: string; border?: string;
}) {
  return (
    <span style={{ height:24, padding:"0 10px", display:"inline-flex", alignItems:"center", borderRadius:999, border:`1px solid ${border}`, background:bg, fontSize:11, fontWeight:700, color }}>
      {children}
    </span>
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
      } catch { setError("Error al cargar el trade."); }
      finally { setLoading(false); }
    })();
  }, [id, router]);

  const card: React.CSSProperties = {
    background: "rgba(10,8,5,0.82)", border: "1px solid rgba(180,140,80,0.14)",
    borderRadius: 16, padding: "20px 22px",
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
  };

  const outcome = trade ? normalizeOutcome(trade.outcome) : "unknown";
  const oc = outcomeColor(outcome);

  return (
    <>
      {/* BG */}
      <div style={{ position:"fixed", inset:0, zIndex:0, backgroundImage:"url('/PM_SCALPS_BG.png')", backgroundSize:"cover", backgroundPosition:"center" }} />
      <div style={{ position:"fixed", inset:0, zIndex:1, background:"rgba(6,4,2,0.78)", backgroundImage:"radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.22) 0%, transparent 60%)" }} />

      <div style={{ position:"relative", zIndex:2, maxWidth:700, margin:"0 auto", padding:"24px 20px 48px" }}>

        {/* Back */}
        <button onClick={() => router.push("/journal/history")} style={{
          background:"none", border:"none", cursor:"pointer",
          fontSize:12, fontWeight:700, color:"rgba(200,146,58,0.5)",
          display:"flex", alignItems:"center", gap:6, marginBottom:20, padding:0,
        }}>← Volver al historial</button>

        {loading && (
          <div style={{ textAlign:"center", color:"rgba(232,224,208,0.3)", fontSize:13, padding:"48px 0" }}>Cargando…</div>
        )}

        {error && (
          <div style={{ ...card, textAlign:"center" }}>
            <div style={{ color:"#e08888", fontSize:13, marginBottom:16 }}>{error}</div>
            <button onClick={() => router.push("/journal/history")} style={{ height:36, padding:"0 20px", borderRadius:999, border:"1px solid rgba(180,140,80,0.2)", background:"transparent", color:"rgba(200,146,58,0.6)", fontSize:12, fontWeight:700, cursor:"pointer" }}>← Volver</button>
          </div>
        )}

        {trade && (
          <div style={{ display:"grid", gap:12 }}>
            {/* Header card */}
            <div style={{ ...card, borderColor: outcome === "win" ? "rgba(74,158,106,0.3)" : outcome === "loss" ? "rgba(184,85,85,0.3)" : "rgba(200,146,58,0.2)", background: outcome === "win" ? "rgba(74,158,106,0.06)" : outcome === "loss" ? "rgba(184,85,85,0.06)" : "rgba(200,146,58,0.05)" }}>
              <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:12 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.2em", color:"rgba(232,224,208,0.3)", marginBottom:4 }}>
                    {weekdayLabel(trade.createdAt)} · {formatYMD(trade.createdAt)}
                    {trade.tradeTime && <span style={{ marginLeft:8, color:"rgba(232,224,208,0.25)" }}>{trade.tradeTime}</span>}
                  </div>
                  <div style={{ fontSize:28, fontWeight:900, color: oc }}>
                    {outcome === "win" ? "✅ Win" : outcome === "loss" ? "❌ Loss" : outcome === "be" ? "◻︎ Break Even" : "—"}
                  </div>
                </div>

                <div style={{ marginLeft:"auto", display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
                  {trade.rr != null && (
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.14em", color:"rgba(232,224,208,0.25)", marginBottom:2 }}>RR</div>
                      <div style={{ fontSize:22, fontWeight:900, color:"#7dcb9a" }}>{trade.rr.toFixed(2)}R</div>
                    </div>
                  )}
                  <Tag color={trade.tradeSide === "BUY" ? "#85b0e0" : "#e08888"} border={trade.tradeSide === "BUY" ? "rgba(74,126,184,0.35)" : "rgba(184,85,85,0.35)"} bg={trade.tradeSide === "BUY" ? "rgba(74,126,184,0.12)" : "rgba(184,85,85,0.12)"}>{trade.tradeSide}</Tag>
                  <Tag>{trade.instrument}</Tag>
                </div>
              </div>
            </div>

            {/* Imagen */}
            {trade.imgUrl && (
              <div style={card}>
                <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.18em", color:"rgba(232,224,208,0.28)", marginBottom:12 }}>CAPTURA</div>
                <img src={trade.imgUrl} alt="Chart" style={{ width:"100%", borderRadius:10, border:"1px solid rgba(180,140,80,0.12)", maxHeight:500, objectFit:"contain", background:"rgba(0,0,0,0.3)" }} />
              </div>
            )}

            {/* Trade info */}
            {trade.tradeTaken === "yes" && (
              <div style={card}>
                <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.18em", color:"rgba(232,224,208,0.28)", marginBottom:4 }}>TRADE</div>
                <div>
                  <Row label="INSTRUMENTO">{trade.instrument}</Row>
                  <Row label="DIRECCIÓN">
                    <Tag color={trade.tradeSide === "BUY" ? "#85b0e0" : "#e08888"} border={trade.tradeSide === "BUY" ? "rgba(74,126,184,0.35)" : "rgba(184,85,85,0.35)"} bg={trade.tradeSide === "BUY" ? "rgba(74,126,184,0.1)" : "rgba(184,85,85,0.1)"}>{trade.tradeSide}</Tag>
                  </Row>
                  <Row label="RESULTADO">
                    <Tag color={oc}>{outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : outcome === "be" ? "BE" : "—"}</Tag>
                  </Row>
                  {trade.rr != null && (
                    <Row label="RR">
                      <Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{trade.rr.toFixed(2)}R</Tag>
                    </Row>
                  )}
                  {/* Parciales */}
                  {(trade as any).partialRRs?.length > 0 && (
                    <Row label="PARCIALES">
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {(trade as any).partialRRs.map((rr: number, i: number) => (
                          <Tag key={i} color="#7dcb9a" border="rgba(74,158,106,0.25)" bg="rgba(74,158,106,0.06)">TP{i+1}: {rr}R</Tag>
                        ))}
                      </div>
                    </Row>
                  )}
                  <Row label="SETUP">
                    {trade.setupTag === "A" ? <Tag color="#c8923a" border="rgba(200,146,58,0.3)" bg="rgba(200,146,58,0.08)">Setup A</Tag>
                    : trade.setupTag === "B" ? <Tag color="#85b0e0" border="rgba(74,126,184,0.3)" bg="rgba(74,126,184,0.08)">Setup B</Tag>
                    : <span style={{ color:"rgba(232,224,208,0.3)" }}>—</span>}
                  </Row>
                  <Row label="PLAN">
                    <Tag color={trade.followedPlan === "yes" ? "#7dcb9a" : "#e08888"} border={trade.followedPlan === "yes" ? "rgba(74,158,106,0.3)" : "rgba(184,85,85,0.3)"} bg={trade.followedPlan === "yes" ? "rgba(74,158,106,0.08)" : "rgba(184,85,85,0.08)"}>
                      {trade.followedPlan === "yes" ? "Cumplí el plan" : "No cumplí"}
                    </Tag>
                  </Row>
                </div>
              </div>
            )}

            {trade.tradeTaken === "no" && (
              <div style={{ ...card, color:"rgba(232,224,208,0.35)", fontSize:13, textAlign:"center" }}>
                No se tomó trade en esta sesión — registro de análisis.
              </div>
            )}

            {/* Contexto */}
            <div style={card}>
              <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.18em", color:"rgba(232,224,208,0.28)", marginBottom:4 }}>CONTEXTO ICT</div>
              <div>
                <Row label="BIAS">
                  <Tag color={trade.biasShown === "LONG" ? "#7dcb9a" : trade.biasShown === "SHORT" ? "#e08888" : "#c8923a"}>{trade.biasShown}</Tag>
                </Row>
                <Row label="ESTADO MERCADO">
                  <Tag color={trade.marketState === "EXPANSION" ? "#7dcb9a" : trade.marketState === "TRANSITION" ? "#e08888" : "#c8923a"}>{trade.marketState}</Tag>
                </Row>
                <Row label="LIQUIDEZ">
                  <Tag color={trade.liqTaken === "yes" ? "#7dcb9a" : "rgba(232,224,208,0.4)"}>{trade.liqTaken === "yes" ? "Tomada" : trade.liqTaken === "no" ? "No tomada" : "—"}</Tag>
                </Row>
                {trade.lastTaken && (
                  <Row label="ÚLTIMA LIQ">
                    <Tag>{trade.lastTaken}</Tag>
                  </Row>
                )}
                <Row label="REACCIÓN">
                  <Tag color={trade.reaction === "accept" ? "#7dcb9a" : trade.reaction === "absorb" ? "#e08888" : "rgba(232,224,208,0.4)"}>
                    {trade.reaction === "accept" ? "Aceptación" : trade.reaction === "absorb" ? "Absorción" : "No claro"}
                  </Tag>
                </Row>
                <Row label="FVG">
                  <Tag color={trade.hasFvg === "yes" ? "#7dcb9a" : trade.hasFvg === "no" ? "#e08888" : "rgba(232,224,208,0.35)"}>
                    {trade.hasFvg === "yes" ? "Sí" : trade.hasFvg === "no" ? "No" : "—"}
                  </Tag>
                </Row>
                {(trade as any).invalidationKind && (
                  <Row label="INVALIDACIÓN">
                    <Tag color="#c8923a" border="rgba(200,146,58,0.3)" bg="rgba(200,146,58,0.08)">{(trade as any).invalidationKind}</Tag>
                  </Row>
                )}
                {trade.takenLevels?.length > 0 && (
                  <Row label="NIVELES TOMADOS">
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {trade.takenLevels.map(l => <Tag key={l}>{l}</Tag>)}
                    </div>
                  </Row>
                )}
                {trade.pendingLevels?.length > 0 && (
                  <Row label="PENDIENTES">
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {trade.pendingLevels.map(l => <Tag key={l}>{l}</Tag>)}
                    </div>
                  </Row>
                )}
              </div>
            </div>

            {/* Nota */}
            {trade.note?.trim() && (
              <div style={card}>
                <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.18em", color:"rgba(232,224,208,0.28)", marginBottom:12 }}>NOTA</div>
                <p style={{ fontSize:13, color:"rgba(232,224,208,0.72)", lineHeight:1.75, margin:0, whiteSpace:"pre-wrap" }}>{trade.note.trim()}</p>
              </div>
            )}

            {/* Volver */}
            <div style={{ paddingTop:8 }}>
              <button onClick={() => router.push("/journal/history")} style={{
                height:38, padding:"0 20px", borderRadius:999, cursor:"pointer",
                border:"1px solid rgba(180,140,80,0.18)", background:"transparent",
                color:"rgba(200,146,58,0.55)", fontSize:12, fontWeight:700,
              }}>← Volver al historial</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}