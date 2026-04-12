"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getTradeById } from "@/lib/tradesDb";
import type { TradeEntry } from "@/lib/types";
import { formatYMD, weekdayLabel, normalizeOutcome, outcomeKey } from "@/lib/helpers";

function oc(k: string) {
  if (k==="win") return "#7dcb9a";
  if (k==="loss") return "#e08888";
  if (k==="be") return "#c8923a";
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

function Tag({ children, color="rgba(232,224,208,0.5)", bg="rgba(255,255,255,0.04)", border="rgba(180,140,80,0.15)" }: {
  children: React.ReactNode; color?:string; bg?:string; border?:string;
}) {
  return (
    <span style={{ height:24, padding:"0 10px", display:"inline-flex", alignItems:"center", borderRadius:999, border:`1px solid ${border}`, background:bg, fontSize:11, fontWeight:700, color, whiteSpace:"nowrap" }}>
      {children}
    </span>
  );
}

// ─── Image Lightbox ────────────────────────────────
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [posStart, setPosStart] = useState({ x: 0, y: 0 });
  const [lastTouchDist, setLastTouchDist] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale(s => Math.min(5, Math.max(0.5, s - e.deltaY * 0.002)));
  }
  function handleMouseDown(e: React.MouseEvent) {
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPosStart({ ...pos });
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return;
    setPos({ x: posStart.x + (e.clientX - dragStart.x), y: posStart.y + (e.clientY - dragStart.y) });
  }
  function handleMouseUp() { setDragging(false); }
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      setDragging(true);
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      setPosStart({ ...pos });
    }
    setLastTouchDist(null);
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (lastTouchDist !== null) setScale(s => Math.min(5, Math.max(0.5, s + (dist - lastTouchDist) * 0.01)));
      setLastTouchDist(dist);
    } else if (e.touches.length === 1 && dragging) {
      setPos({ x: posStart.x + (e.touches[0].clientX - dragStart.x), y: posStart.y + (e.touches[0].clientY - dragStart.y) });
    }
  }
  function handleTouchEnd() { setDragging(false); setLastTouchDist(null); }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(4,3,1,0.95)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", cursor: dragging ? "grabbing" : "grab" }}>
      <div onClick={e => e.stopPropagation()} style={{ position:"fixed", top:20, right:20, zIndex:301, display:"flex", gap:8 }}>
        <button onClick={() => setScale(s => Math.min(5, s + 0.5))} style={{ width:36, height:36, borderRadius:999, border:"1px solid rgba(180,140,80,0.3)", background:"rgba(10,8,5,0.8)", color:"rgba(232,224,208,0.7)", fontSize:16, cursor:"pointer" }}>+</button>
        <button onClick={() => setScale(1)} style={{ width:36, height:36, borderRadius:999, border:"1px solid rgba(180,140,80,0.3)", background:"rgba(10,8,5,0.8)", color:"rgba(232,224,208,0.7)", fontSize:11, fontWeight:700, cursor:"pointer" }}>1:1</button>
        <button onClick={() => setScale(s => Math.max(0.5, s - 0.5))} style={{ width:36, height:36, borderRadius:999, border:"1px solid rgba(180,140,80,0.3)", background:"rgba(10,8,5,0.8)", color:"rgba(232,224,208,0.7)", fontSize:16, cursor:"pointer" }}>−</button>
        <button onClick={onClose} style={{ width:36, height:36, borderRadius:999, border:"1px solid rgba(184,85,85,0.3)", background:"rgba(10,8,5,0.8)", color:"rgba(224,136,136,0.7)", fontSize:14, cursor:"pointer" }}>✕</button>
      </div>
      <div style={{ position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)", fontSize:11, color:"rgba(232,224,208,0.3)", pointerEvents:"none" }}>
        Scroll o pellizco para zoom · Arrastrar para mover · ESC para cerrar
      </div>
      <img src={src} alt="Chart" onClick={e => e.stopPropagation()} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} draggable={false}
        style={{ maxWidth:"90vw", maxHeight:"90vh", objectFit:"contain", borderRadius:8, transform:`translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: dragging ? "none" : "transform 0.15s ease", userSelect:"none", cursor: dragging ? "grabbing" : "grab" }}
      />
    </div>
  );
}

// ─── Main ──────────────────────────────────────────
export default function TradeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params?.id as string;

  const [trade, setTrade] = useState<TradeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  const backUrl = searchParams?.get("back") || "/journal/history";
  const idsParam = searchParams?.get("ids") || "";
  const allIds = idsParam ? idsParam.split(",") : [];
  const currentIdx = allIds.indexOf(id);
  const prevId = currentIdx < allIds.length - 1 ? allIds[currentIdx + 1] : null;
  const nextId = currentIdx > 0 ? allIds[currentIdx - 1] : null;

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

  function navTo(targetId: string) {
    router.push(`/journal/history/${targetId}?back=${encodeURIComponent(backUrl)}&ids=${encodeURIComponent(idsParam)}`);
  }

  const card: React.CSSProperties = {
    background:"rgba(10,8,5,0.82)", border:"1px solid rgba(180,140,80,0.14)",
    borderRadius:16, padding:"20px 22px",
    backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)",
  };

  const outcome = trade ? normalizeOutcome(trade.outcome) : "unknown";
  const ocColor = oc(outcome);

  return (
    <>
      <div style={{ position:"fixed",inset:0,zIndex:0,backgroundImage:"url('/PM_SCALPS_BG.png')",backgroundSize:"cover",backgroundPosition:"center" }}/>
      <div style={{ position:"fixed",inset:0,zIndex:1,background:"rgba(6,4,2,0.78)",backgroundImage:"radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.22) 0%, transparent 60%)" }}/>

      {lightbox && trade?.imgUrl && <ImageLightbox src={trade.imgUrl} onClose={() => setLightbox(false)} />}

      <div style={{ position:"relative",zIndex:2,maxWidth:700,margin:"0 auto",padding:"24px 20px 48px" }}>

        {/* Nav bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <button onClick={() => router.push(backUrl)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,color:"rgba(200,146,58,0.5)",display:"flex",alignItems:"center",gap:6,padding:0 }}>
            ← Volver
          </button>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={() => prevId && navTo(prevId)} disabled={!prevId}
              style={{ height:32, width:32, borderRadius:999, border:"1px solid rgba(180,140,80,0.15)", background:"rgba(0,0,0,0.3)", color: prevId ? "rgba(232,224,208,0.6)" : "rgba(232,224,208,0.15)", fontSize:16, cursor: prevId ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center" }}
              title="Trade anterior">‹</button>
            <button onClick={() => nextId && navTo(nextId)} disabled={!nextId}
              style={{ height:32, width:32, borderRadius:999, border:"1px solid rgba(180,140,80,0.15)", background:"rgba(0,0,0,0.3)", color: nextId ? "rgba(232,224,208,0.6)" : "rgba(232,224,208,0.15)", fontSize:16, cursor: nextId ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center" }}
              title="Trade siguiente">›</button>
          </div>
        </div>

        {loading && <div style={{ textAlign:"center",color:"rgba(232,224,208,0.3)",fontSize:13,padding:"48px 0" }}>Cargando…</div>}

        {error && (
          <div style={{ ...card,textAlign:"center" }}>
            <div style={{ color:"#e08888",fontSize:13,marginBottom:16 }}>{error}</div>
            <button onClick={() => router.push(backUrl)} style={{ height:36,padding:"0 20px",borderRadius:999,border:"1px solid rgba(180,140,80,0.2)",background:"transparent",color:"rgba(200,146,58,0.6)",fontSize:12,fontWeight:700,cursor:"pointer" }}>← Volver</button>
          </div>
        )}

        {trade && (
          <div style={{ display:"grid",gap:12 }}>

            {/* Header */}
            <div style={{ ...card, borderColor: outcome==="win"?"rgba(74,158,106,0.3)":outcome==="loss"?"rgba(184,85,85,0.3)":"rgba(200,146,58,0.2)", background: outcome==="win"?"rgba(74,158,106,0.06)":outcome==="loss"?"rgba(184,85,85,0.06)":"rgba(200,146,58,0.05)" }}>
              <div style={{ display:"flex",flexWrap:"wrap",alignItems:"center",gap:12 }}>
                <div>
                  <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.2em",color:"rgba(232,224,208,0.3)",marginBottom:4 }}>
                    {weekdayLabel(trade.createdAt)} · {formatYMD(trade.createdAt)}
                    {trade.tradeTime&&<span style={{ marginLeft:8,color:"rgba(232,224,208,0.25)" }}>{trade.tradeTime}</span>}
                  </div>
                  <div style={{ fontSize:28,fontWeight:900,color:ocColor }}>
                    {outcome==="win"?"✅ Win":outcome==="loss"?"❌ Loss":outcome==="be"?"◻︎ Break Even":"—"}
                  </div>
                </div>
                <div style={{ marginLeft:"auto",display:"flex",flexWrap:"wrap",gap:8,alignItems:"center" }}>
                  {(trade.rr!=null || outcome==="loss") && (
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:9,fontWeight:800,letterSpacing:"0.14em",color:"rgba(232,224,208,0.25)",marginBottom:2 }}>RR</div>
                      <div style={{ fontSize:22,fontWeight:900,color: outcome==="loss" ? "#e08888" : "#7dcb9a" }}>
                        {outcome==="loss" ? (trade.rr!=null && trade.rr < 0 ? `${trade.rr.toFixed(2)}R` : "-1R") : `${trade.rr!.toFixed(2)}R`}
                      </div>
                    </div>
                  )}
                  <Tag color={trade.tradeSide==="BUY"?"#85b0e0":"#e08888"} border={trade.tradeSide==="BUY"?"rgba(74,126,184,0.35)":"rgba(184,85,85,0.35)"} bg={trade.tradeSide==="BUY"?"rgba(74,126,184,0.12)":"rgba(184,85,85,0.12)"}>{trade.tradeSide}</Tag>
                  <Tag>{trade.instrument}</Tag>
                </div>
              </div>
            </div>

            {/* Imagen */}
            {trade.imgUrl && (
              <div style={card}>
                <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.18em",color:"rgba(232,224,208,0.28)",marginBottom:12 }}>CAPTURA</div>
                <div style={{ position:"relative", cursor:"zoom-in" }} onClick={() => setLightbox(true)}>
                  <img src={trade.imgUrl} alt="Chart" style={{ width:"100%",borderRadius:10,border:"1px solid rgba(180,140,80,0.12)",maxHeight:340,objectFit:"cover",background:"rgba(0,0,0,0.3)" }} />
                  <div style={{ position:"absolute",bottom:10,right:10,background:"rgba(10,8,5,0.75)",borderRadius:8,padding:"4px 10px",fontSize:10,fontWeight:700,color:"rgba(232,224,208,0.5)",border:"1px solid rgba(180,140,80,0.2)",backdropFilter:"blur(4px)" }}>
                    🔍 Tap para zoom
                  </div>
                </div>
              </div>
            )}

            {/* Trade info */}
            {trade.tradeTaken==="yes" && (
              <div style={card}>
                <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.18em",color:"rgba(232,224,208,0.28)",marginBottom:4 }}>TRADE</div>
                <div>
                  <Row label="INSTRUMENTO">{trade.instrument}</Row>
                  <Row label="DIRECCIÓN">
                    <Tag color={trade.tradeSide==="BUY"?"#85b0e0":"#e08888"} border={trade.tradeSide==="BUY"?"rgba(74,126,184,0.35)":"rgba(184,85,85,0.35)"} bg={trade.tradeSide==="BUY"?"rgba(74,126,184,0.1)":"rgba(184,85,85,0.1)"}>{trade.tradeSide}</Tag>
                  </Row>
                  <Row label="RESULTADO">
                    <Tag color={ocColor}>{outcome==="win"?"Win":outcome==="loss"?"Loss":outcome==="be"?"BE":"—"}</Tag>
                  </Row>
                  {(trade.rr!=null || outcome==="loss") && (
                    <Row label="RR">
                      {outcome==="loss"
                        ? <Tag color="#e08888" border="rgba(184,85,85,0.3)" bg="rgba(184,85,85,0.08)">{trade.rr!=null && trade.rr < 0 ? `${trade.rr.toFixed(2)}R` : "-1R"}</Tag>
                        : <Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{trade.rr!.toFixed(2)}R</Tag>
                      }
                    </Row>
                  )}
                  {(trade as any).partialRRs?.length>0 && (
                    <Row label="PARCIALES">
                      <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                        {(trade as any).partialRRs.map((rr:number,i:number)=>(
                          <Tag key={i} color="#7dcb9a" border="rgba(74,158,106,0.25)" bg="rgba(74,158,106,0.06)">TP{i+1}: {rr}R</Tag>
                        ))}
                      </div>
                    </Row>
                  )}
                  <Row label="SETUP">
                    {trade.setupTag==="A" ? <Tag color="#c8923a" border="rgba(200,146,58,0.3)" bg="rgba(200,146,58,0.08)">Setup A</Tag>
                    : trade.setupTag==="B" ? <Tag color="#85b0e0" border="rgba(74,126,184,0.3)" bg="rgba(74,126,184,0.08)">Setup B</Tag>
                    : <span style={{ color:"rgba(232,224,208,0.3)" }}>—</span>}
                  </Row>
                  <Row label="PLAN">
                    <Tag color={trade.followedPlan==="yes"?"#7dcb9a":"#e08888"} border={trade.followedPlan==="yes"?"rgba(74,158,106,0.3)":"rgba(184,85,85,0.3)"} bg={trade.followedPlan==="yes"?"rgba(74,158,106,0.08)":"rgba(184,85,85,0.08)"}>
                      {trade.followedPlan==="yes"?"Cumplí el plan":"No cumplí"}
                    </Tag>
                  </Row>
                  {(trade as any).confirmationCandle && (
                    <Row label="CONFIRMACIÓN">
                      <Tag
                        color={(trade as any).confirmationCandle === "sin-confirmacion" ? "#e08888" : "#c8923a"}
                        border={(trade as any).confirmationCandle === "sin-confirmacion" ? "rgba(184,85,85,0.3)" : "rgba(200,146,58,0.3)"}
                        bg={(trade as any).confirmationCandle === "sin-confirmacion" ? "rgba(184,85,85,0.08)" : "rgba(200,146,58,0.08)"}
                      >
                        {(trade as any).confirmationCandle === "sin-confirmacion" ? "Sin confirmación" : (trade as any).confirmationCandle.toUpperCase()}
                      </Tag>
                    </Row>
                  )}
                  {(trade as any).smtStructural !== null && (trade as any).smtStructural !== undefined && (
                    <Row label="SMT ESTRUCTURAL">
                      <Tag color={(trade as any).smtStructural ? "#85b0e0" : "rgba(232,224,208,0.35)"} border={(trade as any).smtStructural ? "rgba(74,126,184,0.3)" : "rgba(180,140,80,0.15)"} bg={(trade as any).smtStructural ? "rgba(74,126,184,0.08)" : "transparent"}>
                        {(trade as any).smtStructural ? "Sí · a favor" : "No"}
                      </Tag>
                    </Row>
                  )}
                  {(trade as any).smtEntry !== null && (trade as any).smtEntry !== undefined && (
                    <Row label="SMT ENTRY">
                      <Tag color={(trade as any).smtEntry ? "#85b0e0" : "rgba(232,224,208,0.35)"} border={(trade as any).smtEntry ? "rgba(74,126,184,0.3)" : "rgba(180,140,80,0.15)"} bg={(trade as any).smtEntry ? "rgba(74,126,184,0.08)" : "transparent"}>
                        {(trade as any).smtEntry ? "Sí · M2/M5" : "No"}
                      </Tag>
                    </Row>
                  )}
                  {(trade as any).amdPresented !== null && (trade as any).amdPresented !== undefined && (
                    <Row label="AMD PREVIO">
                      <Tag color={(trade as any).amdPresented ? "#7dcb9a" : "rgba(232,224,208,0.35)"} border={(trade as any).amdPresented ? "rgba(74,158,106,0.3)" : "rgba(180,140,80,0.15)"} bg={(trade as any).amdPresented ? "rgba(74,158,106,0.08)" : "transparent"}>
                        {(trade as any).amdPresented ? "Sí" : "No"}
                      </Tag>
                    </Row>
                  )}
                </div>
              </div>
            )}

            {trade.tradeTaken==="no" && (
              <div style={{ ...card,color:"rgba(232,224,208,0.35)",fontSize:13,textAlign:"center" }}>
                No se tomó trade — registro de análisis.
              </div>
            )}

            {/* Contexto nuevo */}
            {(trade.amDir || trade.contextTag || trade.htfStruct) && (
              <div style={card}>
                <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.18em", color:"rgba(232,224,208,0.28)", marginBottom:4 }}>CONTEXTO DE SESIÓN</div>
                <div>
                  {trade.contextTag && (
                    <Row label="CATEGORÍA">
                      <Tag color="#c8923a" border="rgba(200,146,58,0.3)" bg="rgba(200,146,58,0.08)">{trade.contextTag}</Tag>
                    </Row>
                  )}
                  {trade.htfAligned !== null && (
                    <Row label="HTF H1/H4">
                      <Tag color={trade.htfAligned ? "#7dcb9a" : "#e08888"} border={trade.htfAligned ? "rgba(74,158,106,0.3)" : "rgba(184,85,85,0.3)"} bg={trade.htfAligned ? "rgba(74,158,106,0.08)" : "rgba(184,85,85,0.08)"}>
                        {trade.htfStruct} · {trade.htfAligned ? "A favor" : "En contra"}
                      </Tag>
                    </Row>
                  )}
                  {trade.amDir && (
                    <Row label="DIRECCIÓN AM">
                      <Tag color={trade.amDir === "alcista" ? "#7dcb9a" : trade.amDir === "bajista" ? "#e08888" : "#c8923a"}>{trade.amDir}</Tag>
                    </Row>
                  )}
                  {trade.amSweepNivel && (
                    <Row label="SWEEP APERTURA">
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        <Tag>{trade.amSweepNivel}</Tag>
                        {trade.amReac && <Tag color={trade.amReac === "acepto" ? "#7dcb9a" : "#c8923a"}>{trade.amReac}</Tag>}
                      </div>
                    </Row>
                  )}
                  {trade.pmSweepNivel && (
                    <Row label="SWEEP SESIÓN">
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        <Tag>{trade.pmSweepNivel}</Tag>
                        {trade.pmReac && <Tag color={trade.pmReac === "acepto" ? "#7dcb9a" : "#c8923a"}>{trade.pmReac}</Tag>}
                      </div>
                    </Row>
                  )}
                  {trade.m15Struct && (
                    <Row label="M15 ESTRUCTURA">
                      <Tag color={trade.m15Struct === "alcista" ? "#7dcb9a" : "#e08888"}>{trade.m15Struct}</Tag>
                    </Row>
                  )}
                  {trade.cisdDir && (
                    <Row label="CISD M15">
                      <Tag color={trade.cisdDir === "alcista" ? "#7dcb9a" : "#e08888"}>{trade.cisdDir}</Tag>
                    </Row>
                  )}
                </div>
              </div>
            )}

            {/* Nota */}
            {trade.note?.trim() && (
              <div style={card}>
                <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.18em",color:"rgba(232,224,208,0.28)",marginBottom:12 }}>NOTA</div>
                <p style={{ fontSize:13,color:"rgba(232,224,208,0.72)",lineHeight:1.75,margin:0,whiteSpace:"pre-wrap" }}>{trade.note.trim()}</p>
              </div>
            )}

            {/* Botones */}
            <div style={{ paddingTop:8, display:"flex", gap:8 }}>
              <button onClick={() => router.push(backUrl)} style={{ height:38,padding:"0 20px",borderRadius:999,cursor:"pointer",border:"1px solid rgba(180,140,80,0.18)",background:"transparent",color:"rgba(200,146,58,0.55)",fontSize:12,fontWeight:700 }}>
                ← Volver
              </button>
              <button onClick={() => router.push(`${backUrl}${backUrl.includes('?') ? '&' : '?'}edit=${trade.id}`)} style={{ height:38,padding:"0 20px",borderRadius:999,cursor:"pointer",border:"1px solid rgba(200,146,58,0.4)",background:"rgba(200,146,58,0.09)",color:"#c8923a",fontSize:12,fontWeight:700 }}>
                ✎ Editar trade
              </button>
            </div>

          </div>
        )}
      </div>
    </>
  );
}