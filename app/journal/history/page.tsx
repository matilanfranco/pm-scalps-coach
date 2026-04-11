"use client";

import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { listTradesSince, deleteTrade, updateTrade } from "@/lib/tradesDb";
import type { TradeEntry, Instrument, TradeSide, FollowedPlan, OutcomeDb, SetupTag } from "@/lib/types";
import { formatYMD, weekdayLabel, startOfDayMs, endOfDayMs, buildTimestamp, normalizeOutcome, outcomeKey, computeKPIs, isValidHHMM } from "@/lib/helpers";

const LS_KEY = "trades_cache_v1";
const LS_OBJECTIVE = "pm_scalps_objectives_v1";
const LS_ANALYSES = "pm_scalps_analyses_v1";

type OutcomeKey = "all" | OutcomeDb;
type Weekday = "ALL" | "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes";
type ChartMode = "none" | "weekly" | "equity" | "marketstate" | "ai";

type SavedAnalysis = {
  id: string;
  date: string;
  timestamp: number;
  scope: string;
  tradeCount: number;
  text: string;
};

// ─── Helpers ──────────────────────────────────────
function weekdayEs(ms: number): Weekday {
  const d = new Date(ms).getDay();
  if (d === 1) return "Lunes"; if (d === 2) return "Martes";
  if (d === 3) return "Miércoles"; if (d === 4) return "Jueves";
  if (d === 5) return "Viernes"; return "ALL";
}

// Muestra RR con color — negativo en rojo, BE en amber, positivo en verde
function RRTag({ t }: { t: TradeEntry }) {
  const ok = outcomeKey(t);
  if (ok === "loss") {
    const rr = t.rr != null && t.rr < 0 ? `${t.rr.toFixed(2)}R` : "-1R";
    return <Tag color="#e08888" border="rgba(184,85,85,0.3)" bg="rgba(184,85,85,0.08)">{rr}</Tag>;
  }
  if (ok === "be") {
    return <Tag color="#c8923a" border="rgba(200,146,58,0.3)" bg="rgba(200,146,58,0.08)">0R</Tag>;
  }
  if (t.rr != null) {
    return <Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{t.rr > 0 ? "+" : ""}{t.rr.toFixed(2)}R</Tag>;
  }
  return null;
}

function safeRR(t: TradeEntry): number | null {
  const n = Number(t.rr); return Number.isFinite(n) ? n : null;
}

function useIsMobile(bp = 768) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const f = () => setM(window.innerWidth < bp);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [bp]);
  return m;
}

function toCSV(trades: TradeEntry[], name: string) {
  const hdr = ["id","date","time","instrument","side","outcome","rr","plan","setup","note"];
  const rows = trades.map(t => [
    t.id, formatYMD(t.createdAt), t.tradeTime, t.instrument, t.tradeSide,
    outcomeKey(t), t.rr, t.followedPlan, t.setupTag,
    (t.note || "").replace(/"/g, '""'),
  ].map(v => `"${v ?? ""}"`).join(","));
  const blob = new Blob([[hdr.join(","), ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

// ─── Styles ───────────────────────────────────────
const card: React.CSSProperties = {
  background: "rgba(10,8,5,0.82)", border: "1px solid rgba(180,140,80,0.14)",
  borderRadius: 16, padding: "18px 20px",
  backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
};

function pill(active = false, variant: "default" | "green" | "red" | "amber" = "default"): React.CSSProperties {
  const c = {
    default: { b: "rgba(180,140,80,0.35)", bg: "rgba(200,146,58,0.08)", t: "#c8923a" },
    green:   { b: "rgba(74,158,106,0.5)",  bg: "rgba(74,158,106,0.12)", t: "#7dcb9a" },
    red:     { b: "rgba(184,85,85,0.5)",   bg: "rgba(184,85,85,0.12)", t: "#e08888" },
    amber:   { b: "rgba(200,146,58,0.5)",  bg: "rgba(200,146,58,0.1)", t: "#c8923a" },
  }[variant];
  return {
    height: 32, padding: "0 14px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? c.b : "rgba(180,140,80,0.12)"}`,
    background: active ? c.bg : "rgba(255,255,255,0.02)",
    color: active ? c.t : "rgba(232,224,208,0.35)",
    fontSize: 11, fontWeight: 700, transition: "all 0.15s", whiteSpace: "nowrap" as const,
  };
}

function oc(k: OutcomeDb) { return k === "win" ? "#7dcb9a" : k === "loss" ? "#e08888" : k === "be" ? "#c8923a" : "rgba(232,224,208,0.35)"; }
function ob(k: OutcomeDb) { return k === "win" ? "rgba(74,158,106,0.12)" : k === "loss" ? "rgba(184,85,85,0.12)" : k === "be" ? "rgba(200,146,58,0.1)" : "rgba(255,255,255,0.04)"; }
function obdr(k: OutcomeDb) { return k === "win" ? "rgba(74,158,106,0.35)" : k === "loss" ? "rgba(184,85,85,0.35)" : k === "be" ? "rgba(200,146,58,0.3)" : "rgba(180,140,80,0.12)"; }

function Tag({ children, color = "rgba(232,224,208,0.35)", bg = "rgba(255,255,255,0.04)", border = "rgba(180,140,80,0.12)" }: {
  children: React.ReactNode; color?: string; bg?: string; border?: string;
}) {
  return (
    <span style={{ height: 24, padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: 999, border: `1px solid ${border}`, background: bg, fontSize: 11, fontWeight: 700, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// ─── Weekly Summary ────────────────────────────────
function WeeklySummary({ trades }: { trades: TradeEntry[] }): React.ReactElement {
  // Agrupar trades por semana ISO
  const weeks = useMemo(() => {
    function getWeekKey(ms: number): string {
      const d = new Date(ms);
      const day = d.getDay() === 0 ? 7 : d.getDay(); // lunes = 1
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day - 1));
      return monday.toISOString().slice(0, 10);
    }

    function formatWeekLabel(mondayStr: string): string {
      const monday = new Date(mondayStr + "T12:00:00");
      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);
      const fmt = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
      return `${fmt(monday)} — ${fmt(friday)}`;
    }

    const map = new Map<string, TradeEntry[]>();
    trades.forEach(t => {
      const k = getWeekKey(t.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    });

    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // más reciente primero
      .map(([key, ts]) => {
        const wins = ts.filter(t => outcomeKey(t) === "win");
        const losses = ts.filter(t => outcomeKey(t) === "loss");
        const bes = ts.filter(t => outcomeKey(t) === "be");
        const winRRs = wins.map(t => safeRR(t)).filter((v): v is number => v !== null);
        const netRR = winRRs.reduce((a, b) => a + b, 0) - losses.length;
        const wr = wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) * 100 : 0;
        const avgWinRR = winRRs.length ? winRRs.reduce((a, b) => a + b, 0) / winRRs.length : 0;
        const notFollowed = ts.filter(t => t.followedPlan === "no").length;
        return { key, label: formatWeekLabel(key), ts, wins, losses, bes, netRR, wr, avgWinRR, notFollowed };
      });
  }, [trades]);

  if (weeks.length === 0) return <div style={{ color: "rgba(232,224,208,0.3)", fontSize: 12, padding: "20px 0" }}>No hay trades aún.</div>;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(232,224,208,0.28)", marginBottom: 16 }}>RESUMEN SEMANAL</div>
      <div style={{ display: "grid", gap: 10 }}>
        {weeks.map(w => {
          const isGreen = w.netRR > 0;
          const isRed = w.netRR < 0;
          const borderColor = isGreen ? "rgba(74,158,106,0.3)" : isRed ? "rgba(184,85,85,0.3)" : "rgba(180,140,80,0.15)";
          const bgColor = isGreen ? "rgba(74,158,106,0.05)" : isRed ? "rgba(184,85,85,0.05)" : "rgba(0,0,0,0.1)";
          const rrColor = isGreen ? "#7dcb9a" : isRed ? "#e08888" : "rgba(232,224,208,0.5)";

          return (
            <div key={w.key} style={{ borderRadius: 12, border: `1px solid ${borderColor}`, background: bgColor, padding: "14px 16px" }}>
              {/* Header semana */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(232,224,208,0.7)" }}>{w.label}</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: rrColor }}>
                    {w.netRR >= 0 ? "+" : ""}{w.netRR.toFixed(2)}R
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(232,224,208,0.4)", fontWeight: 700 }}>
                    {w.wr.toFixed(0)}% WR
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {/* Trades */}
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(180,140,80,0.1)" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 2 }}>TRADES</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(232,224,208,0.7)" }}>{w.ts.length}</div>
                </div>

                {/* W/L/BE */}
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(180,140,80,0.1)" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 2 }}>W / L / BE</div>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>
                    <span style={{ color: "#7dcb9a" }}>{w.wins.length}</span>
                    <span style={{ color: "rgba(232,224,208,0.3)" }}> / </span>
                    <span style={{ color: "#e08888" }}>{w.losses.length}</span>
                    <span style={{ color: "rgba(232,224,208,0.3)" }}> / </span>
                    <span style={{ color: "#c8923a" }}>{w.bes.length}</span>
                  </div>
                </div>

                {/* AVG RR wins */}
                {w.avgWinRR > 0 && (
                  <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(180,140,80,0.1)" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 2 }}>AVG WIN</div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#7dcb9a" }}>{w.avgWinRR.toFixed(2)}R</div>
                  </div>
                )}

                {/* Fuera de plan */}
                {w.notFollowed > 0 && (
                  <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(184,85,85,0.08)", border: "1px solid rgba(184,85,85,0.2)" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(184,85,85,0.6)", marginBottom: 2 }}>FUERA PLAN</div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#e08888" }}>{w.notFollowed}</div>
                  </div>
                )}

                {/* Mejor trade */}
                {w.wins.length > 0 && (() => {
                  const best = w.wins.reduce((a, b) => (safeRR(a) ?? 0) > (safeRR(b) ?? 0) ? a : b);
                  const bestRR = safeRR(best);
                  if (!bestRR) return null;
                  return (
                    <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(74,158,106,0.08)", border: "1px solid rgba(74,158,106,0.2)" }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(74,158,106,0.6)", marginBottom: 2 }}>MEJOR TRADE</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#7dcb9a" }}>+{bestRR.toFixed(2)}R · {best.instrument} {best.tradeSide}</div>
                    </div>
                  );
                })()}
              </div>

              {/* Barra visual de progreso semanal */}
              {w.wins.length + w.losses.length > 0 && (
                <div style={{ marginTop: 10, height: 4, borderRadius: 999, background: "rgba(180,140,80,0.1)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 999,
                    width: `${w.wr}%`,
                    background: w.wr >= 60 ? "#4a9e6a" : w.wr >= 40 ? "#c8923a" : "#b85555",
                    transition: "width 0.4s ease",
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI Analysis ──────────────────────────────────
function AIAnalysis({ trades }: { trades: TradeEntry[] }): React.ReactElement {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [analysis, setAnalysis] = useState("");
  const [scope, setScope] = useState<"last10" | "last20" | "all">("last20");
  const [showHistory, setShowHistory] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [selectedSaved, setSelectedSaved] = useState<SavedAnalysis | null>(null);

  const scopeLabel: Record<string, string> = {
    last10: "últimos 10",
    last20: "últimos 20",
    all: `todos (${trades.length})`,
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_ANALYSES) || "[]") as SavedAnalysis[];
      setSavedAnalyses(saved.sort((a, b) => b.timestamp - a.timestamp));
    } catch {}
  }, []);

  function saveAnalysis(text: string, scopeUsed: string, count: number) {
    const entry: SavedAnalysis = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      timestamp: Date.now(),
      scope: scopeUsed,
      tradeCount: count,
      text,
    };
    try {
      const existing = JSON.parse(localStorage.getItem(LS_ANALYSES) || "[]") as SavedAnalysis[];
      const updated = [entry, ...existing].slice(0, 20);
      localStorage.setItem(LS_ANALYSES, JSON.stringify(updated));
      setSavedAnalyses(updated);
    } catch {}
  }

  function deleteAnalysis(id: string) {
    const updated = savedAnalyses.filter(a => a.id !== id);
    localStorage.setItem(LS_ANALYSES, JSON.stringify(updated));
    setSavedAnalyses(updated);
    if (selectedSaved?.id === id) setSelectedSaved(null);
  }

  function buildPrompt(ts: TradeEntry[]): string {
    const sorted = [...ts].sort((a, b) => a.createdAt - b.createdAt);
    const rows = sorted.map((t, i) => {
      const ok = outcomeKey(t);
      const date = new Date(t.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
      const rr = t.rr != null ? `${t.rr}R` : "—";
      const note = (t.note || "").slice(0, 300).replace(/\n/g, " ");
      const ctx = (t as any);
      // Contexto de sesión
      const ctxParts = [
        ctx.contextTag ? `Cat:${ctx.contextTag}` : null,
        ctx.htfStruct ? `HTF:${ctx.htfStruct}${ctx.htfAligned !== null ? (ctx.htfAligned ? "(favor)" : "(contra)") : ""}` : null,
        ctx.amDir ? `AM:${ctx.amDir}` : null,
        ctx.amSweepNivel ? `SweepAp:${ctx.amSweepNivel}/${ctx.amReac || "?"}` : null,
        ctx.pmSweepNivel ? `SweepSes:${ctx.pmSweepNivel}/${ctx.pmReac || "?"}` : null,
        ctx.m15Struct ? `M15:${ctx.m15Struct}` : null,
        ctx.cisdDir ? `CISD:${ctx.cisdDir}` : null,
      ].filter(Boolean).join(" | ");
      return `${i + 1}. [${date} ${t.tradeTime || "??:??"}] ${t.instrument} ${t.tradeSide} | ${ok.toUpperCase()} ${rr} | Plan:${t.followedPlan}${ctxParts ? ` | [${ctxParts}]` : ""} | "${note}"`;
    }).join("\n");

    return `Sos el coach de trading de Mati. Lo conocés hace tiempo, sabés cómo piensa y sobre todo — sabés lo que es capaz de hacer cuando está afilado.

Tu estilo: directo, claro, con energía real. Hablás de igual a igual — sin formalismos, sin rodeos, sin palmaditas vacías.
Cuando algo estuvo bien lo celebrás en serio y con convicción.
Cuando algo no estuvo bien lo decís claro, sin vueltas, pero siempre desde "esto es lo que podés mejorar" y no desde "mirá todo lo que hiciste mal".
No le endulcés las cosas — Mati quiere escuchar la verdad, no que todo estuvo bárbaro cuando no fue así.
La diferencia entre vos y un análisis frío es que sabés que del otro lado hay una persona que laburó, que se esforzó, y que tiene todo para hacerlo bien.
Nunca usés "problema", "error grave" ni "deberías". Usá "la próxima", "esto no es lo tuyo", "acá faltó X".
El análisis termina siempre con energía hacia adelante — que cuando lo lea tenga ganas de abrir la plataforma mañana.

═══ LA ESTRATEGIA DE MATI ═══

VENTANA OPERATIVA: 14:00 a 16:00 hs NY — antes de las 14:00 no existe el trade, punto.

PROCESO:
1. Analiza H1 y M15 — qué hizo el precio en la AM, qué liquidez tomó, si absorbió o aceptó
2. Define dirección según CISD M15 vigente — si M15 no está alineado, no hay trade
3. Identifica objetivos de liquidez reales (extremos con liquidez, no RR fijo)
4. Marca zonas: FVG M5/M15, OB, Breaker, SOB, SiOB
5. Espera vela envolvente M5 o M2 para confirmar — limit en apertura de la vela envuelta
6. Gestiona con 2-3 parciales, el primero siempre en un extremo con liquidez

CONFLUENCIAS (de mayor a menor peso):
→ SMT entre NQ y ES — su señal más poderosa, especialmente combinada con zona
→ CISD M15 confirmado
→ FVG M15 o M5 en la zona
→ OB o Breaker M15
→ SOB / SiOB
→ Vela envolvente limpia M5 o M2

TRADE IDEAL DE MATI:
CISD M15 previo claro + SMT entre NQ y ES + zona con FVG M15 y OB o Breaker + vela envolvente limpia M5 o M2 + objetivo de liquidez identificado antes de entrar. Cuando tiene todo eso, el trade suele tener poco drawdown y sale contento independientemente del resultado.

REGLAS QUE MATI MISMO SE PUSO:
- Ventana operativa: 14:00 a 16:00 hs NY. Antes de las 14 no existe el trade.
- A favor del CISD M15 siempre — si no está alineado, no existe el trade
- Primer parcial en extremo con liquidez identificado antes de entrar
- Si ganó el primer trade del día → pantalla abajo, día terminado
- Dos SLs en el día → plataforma cerrada
- Sin objetivo HTF claro en la dirección → no hay trade
- Siempre en la compu, solo, sin público

═══ BANDERAS ROJAS DE MATI ═══

🚩 CISD M15 no confirmado
"el CISD fue en M5", "me dejé llevar sin ver realmente un CISD en M15"
→ "Mati, el CISD fue en M5 — eso no cuenta, vos lo sabés"

🚩 Sin objetivo HTF claro
"no sé si quedaban objetivos", "el precio había bajado toda la jornada"
→ "¿A dónde iba el precio? Si no tenés respuesta antes de entrar, no hay trade"

🚩 Reentrada inmediata post-SL
"ni bien me sacó entré de nuevo sin esperar ni un minuto"
→ "La reentrada de revancha no es lo tuyo. Eso ya lo sabemos."

🚩 M5 vs M15 desalineados
"M15 todavía era alcista, M5 era bajista"
→ "M15 manda siempre. Si M5 está en contra, te estás inventando el trade"

🚩 Confirmación impura
"no fue una reacción limpia, tenía mechas, pero entré igual"
→ "La vela envolvente tiene que ser limpia. Si tenés dudas, no es la tuya"

🚩 Contexto ambiguo
"liquidez en ambos lados", "desde la mañana no tuvo dirección"
→ "Mercado sin dirección clara en AM = día de observación, no de trading"

🚩 Zona macro adversa
"estaba en premium del rango", "fue venta en discount"
→ "Compras en premium y ventas en discount — el mercado te está poniendo en la trampa"

🚩 Presencia de terceros
"compartir la operativa con alguien que daba opiniones me sacó del trade"
→ "Solo y en la compu. Siempre."

🚩 Impaciencia de apertura
Si hay un SL antes de las 14:10 → preguntarle si esperó suficiente contexto de la PM o saltó al primer movimiento
→ "¿Esperaste que la PM te diera contexto, o entraste con lo primero que se movió?"

═══ EL ANÁLISIS ═══

Leé los trades y escribí en estas secciones. Sin estadísticas, sin números — eso ya lo tiene en la app. Solo patrones, observaciones y energía.

**CUANDO MATI ESTÁ ENCHUFADO 🔥**
El escenario donde estuvo en su mejor versión en este período. Qué había, qué hizo diferente, qué se siente en las notas. Celebralo con convicción — esto es lo que tiene que repetir.

**LO QUE ESTÁ CONSTRUYENDO BIEN**
Patrones positivos concretos. Decisiones que estuvo bien aunque el trade haya salido en SL. Sé específico — nombrá el trade, la fecha, qué hizo bien.

**BANDERAS ROJAS DETECTADAS**
¿Cuál de las 9 apareció? ¿Una vez, varias? Nombrá el trade (fecha + instrumento + dirección) y qué bandera fue. Claro, directo, sin drama pero sin endulzar.

**EL SMT — ¿LO ESTÁS USANDO?**
SMT es su confluencia más poderosa. ¿Apareció en los ganadores? ¿Hubo trades donde había condiciones pero no lo esperó? Solo el espejo — sin juicio, con claridad.

**UNA SOLA COSA PARA ESTA SEMANA**
No una lista. Una. Concreta, específica, que arranque con acción.
"Antes de entrar...", "La próxima vez que veas...", "Cuando M15..."
Terminá con algo que lo deje con ganas de abrir la plataforma mañana.

IMPORTANTE: El análisis completo no debe superar 1200 palabras. No repitas información entre secciones. Si en una sección hay poco para decir, sé breve — no rellenes. Si hay mucho, expandite. Priorizá siempre ejemplos concretos sobre explicaciones genéricas.

IMPORTANTE: Cada trade puede tener un bloque de contexto entre corchetes con estos campos:
- Cat: categoría del trade (CONT-AM / CONT-AM-SWEEP / REVERSAL-SWEEP / REVERSAL-NO-SWEEP)
- HTF: estructura H1/H4 y si el trade fue a favor o en contra
- AM: dirección que tuvo el precio en la sesión AM
- SweepAp: nivel tomado en la apertura + reacción (absorbio/acepto)
- SweepSes: nivel tomado en la sesión + reacción
- M15: estructura M15 al momento de entrar
- CISD: dirección del CISD M15 si hubo cambio de delivery

Usá estos datos para detectar patrones específicos, por ejemplo:
- ¿En qué categorías ganó más? ¿Cuándo falló más?
- ¿Hay correlación entre SweepAp + SweepSes en extremos opuestos y los mejores trades?
- ¿Cuándo el HTF estaba en contra, cómo le fue?
- ¿Los CISD bajistas con AM bajista dieron mejores resultados que sin CISD?

IMPORTANTE: Cada trade puede tener o no tener contexto. Los que no tienen [contexto] son trades viejos sin datos de sesión — no los uses para sacar conclusiones de contexto, solo de resultado y nota.

═══ LOS TRADES ═══

${rows}`;
  }

  async function runAnalysis() {
    setStatus("loading");
    setAnalysis("");
    setSelectedSaved(null);

    const subset =
      scope === "last10" ? [...trades].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10) :
      scope === "last20" ? [...trades].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20) :
      trades;

    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 2500,
          messages: [{ role: "user", content: buildPrompt(subset) }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text || "";
      setAnalysis(text);
      setStatus("done");
      saveAnalysis(text, scopeLabel[scope], subset.length);
    } catch {
      setStatus("error");
    }
  }

  function renderMarkdown(text: string): React.ReactNode[] {
    return text.split("\n").map((line, i) => {
      const parts = line.split(/\*\*(.*?)\*\*/g).map((part, j) =>
        j % 2 === 1
          ? <strong key={j} style={{ color: "rgba(232,224,208,0.9)", fontWeight: 800 }}>{part}</strong>
          : <span key={j}>{part}</span>
      );
      return (
        <p key={i} style={{
          margin: line.startsWith("**") ? "16px 0 4px" : "0 0 6px",
          fontSize: line.startsWith("**") ? 12 : 13,
          color: "rgba(232,224,208,0.72)",
          lineHeight: 1.7,
        }}>
          {parts}
        </p>
      );
    });
  }

  const displayText = selectedSaved?.text || analysis;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(232,224,208,0.28)", marginBottom: 4 }}>✦ ANÁLISIS CON IA</div>
          <div style={{ fontSize: 11, color: "rgba(232,224,208,0.35)" }}>Claude analiza tus trades y te da feedback de coach ICT</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {savedAnalyses.length > 0 && (
            <button onClick={() => { setShowHistory(v => !v); setSelectedSaved(null); }} style={{
              height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer",
              border: `1px solid ${showHistory ? "rgba(200,146,58,0.5)" : "rgba(180,140,80,0.15)"}`,
              background: showHistory ? "rgba(200,146,58,0.1)" : "transparent",
              color: showHistory ? "#c8923a" : "rgba(232,224,208,0.4)",
              fontSize: 11, fontWeight: 700,
            }}>
              📋 {savedAnalyses.length} guardado{savedAnalyses.length !== 1 ? "s" : ""}
            </button>
          )}
          {!showHistory && (
            <div style={{ display: "flex", gap: 6 }}>
              {(["last10", "last20", "all"] as const).map(s => (
                <button key={s} onClick={() => setScope(s)} style={{
                  height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${scope === s ? "rgba(74,158,106,0.5)" : "rgba(180,140,80,0.12)"}`,
                  background: scope === s ? "rgba(74,158,106,0.12)" : "transparent",
                  color: scope === s ? "#7dcb9a" : "rgba(232,224,208,0.35)",
                  fontSize: 11, fontWeight: 700,
                }}>{scopeLabel[s]}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Historial guardado */}
      {showHistory && (
        <div style={{ marginBottom: 16 }}>
          {savedAnalyses.length === 0 ? (
            <div style={{ fontSize: 12, color: "rgba(232,224,208,0.3)", padding: "12px 0" }}>No hay análisis guardados aún.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {savedAnalyses.map(a => (
                <div key={a.id} onClick={() => setSelectedSaved(selectedSaved?.id === a.id ? null : a)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${selectedSaved?.id === a.id ? "rgba(200,146,58,0.4)" : "rgba(180,140,80,0.12)"}`,
                    background: selectedSaved?.id === a.id ? "rgba(200,146,58,0.07)" : "rgba(0,0,0,0.15)",
                    transition: "all 0.15s",
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(232,224,208,0.75)" }}>{a.date}</div>
                    <div style={{ fontSize: 11, color: "rgba(232,224,208,0.35)", marginTop: 2 }}>{a.tradeCount} trades · {a.scope}</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteAnalysis(a.id); }} style={{
                    width: 24, height: 24, borderRadius: 999,
                    border: "1px solid rgba(184,85,85,0.2)", background: "rgba(184,85,85,0.06)",
                    color: "rgba(224,136,136,0.5)", fontSize: 10, cursor: "pointer", flexShrink: 0,
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Idle */}
      {!showHistory && status === "idle" && !selectedSaved && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <button onClick={runAnalysis} style={{
            height: 42, padding: "0 28px", borderRadius: 999, cursor: "pointer",
            border: "1px solid rgba(74,158,106,0.4)", background: "rgba(74,158,106,0.1)",
            color: "#7dcb9a", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em",
          }}>
            ✦ Analizar {scopeLabel[scope]} trades
          </button>
          <div style={{ marginTop: 10, fontSize: 11, color: "rgba(232,224,208,0.28)" }}>El análisis tarda ~10 segundos</div>
        </div>
      )}

      {/* Loading */}
      {status === "loading" && (
        <div style={{ padding: "32px 0", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "rgba(74,158,106,0.6)", fontWeight: 700, marginBottom: 8 }}>Analizando tus trades…</div>
          <div style={{ fontSize: 11, color: "rgba(232,224,208,0.3)" }}>Claude está leyendo tus notas y buscando patrones</div>
          <div style={{ marginTop: 16, height: 2, background: "rgba(180,140,80,0.1)", borderRadius: 999, overflow: "hidden", maxWidth: 200, margin: "16px auto 0" }}>
            <div style={{ height: "100%", background: "rgba(74,158,106,0.6)", borderRadius: 999, animation: "pm-loading 2s ease-in-out infinite", width: "40%" }} />
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div style={{ padding: "20px", borderRadius: 12, border: "1px solid rgba(184,85,85,0.25)", background: "rgba(184,85,85,0.06)", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#e08888", marginBottom: 8 }}>Error al conectar con la IA</div>
          <button onClick={() => setStatus("idle")} style={{ height: 32, padding: "0 16px", borderRadius: 999, border: "1px solid rgba(184,85,85,0.3)", background: "transparent", color: "#e08888", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Reintentar</button>
        </div>
      )}

      {/* Resultado */}
      {(status === "done" || selectedSaved) && displayText && (
        <div>
          {selectedSaved && (
            <div style={{ fontSize: 11, color: "rgba(200,146,58,0.5)", fontWeight: 700, marginBottom: 10 }}>
              📋 {selectedSaved.date} · {selectedSaved.tradeCount} trades · {selectedSaved.scope}
            </div>
          )}
          <div style={{ borderRadius: 12, border: "1px solid rgba(74,158,106,0.15)", background: "rgba(74,158,106,0.04)", padding: "18px 20px" }}>
            {renderMarkdown(displayText)}
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => { setStatus("idle"); setAnalysis(""); setSelectedSaved(null); setShowHistory(false); }} style={{
              height: 32, padding: "0 16px", borderRadius: 999, cursor: "pointer",
              border: "1px solid rgba(180,140,80,0.15)", background: "transparent",
              color: "rgba(232,224,208,0.4)", fontSize: 11, fontWeight: 700,
            }}>Nuevo análisis</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Equity Curve ──────────────────────────────────
function EquityCurve({ trades }: { trades: TradeEntry[] }): React.ReactElement {
  const points = useMemo(() => {
    const sorted = [...trades].filter(t => t.outcome && t.outcome !== "unknown" && t.createdAt).sort((a, b) => a.createdAt - b.createdAt);
    let cum = 0;
    const pts: [number, number, TradeEntry, number][] = sorted.length ? [[0, 0, sorted[0], 0]] : [];
    sorted.forEach((t, i) => {
      const ok = outcomeKey(t);
      const rr = safeRR(t);
      if (ok === "win" && rr) cum += rr;
      else if (ok === "loss") cum -= 1;
      pts.push([i + 1, cum, t, cum]);
    });
    return pts;
  }, [trades]);

  if (points.length < 2) return <div style={{ color: "rgba(232,224,208,0.3)", fontSize: 12, padding: "20px 0" }}>No hay suficientes trades para mostrar la curva.</div>;

  const W = 800, H = 200, PAD = 42;
  const ys = points.map(p => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;
  const rangeX = Math.max(...points.map(p => p[0])) || 1;

  const px = (x: number) => PAD + (x / rangeX) * (W - PAD * 2);
  const py = (y: number) => H - PAD - ((y - minY) / rangeY) * (H - PAD * 2);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${px(p[0])} ${py(p[1])}`).join(" ");
  const areaD = `${pathD} L ${px(points[points.length - 1][0])} ${py(minY)} L ${px(0)} ${py(minY)} Z`;
  const finalRR = points[points.length - 1][1];
  const isPos = finalRR >= 0;

  const monthPts: { x: number; label: string }[] = [];
  let lastM = "";
  points.forEach(p => {
    if (!p[2]?.createdAt) return;
    const m = new Date(p[2].createdAt).toLocaleDateString("es-AR", { month: "short" });
    if (m !== lastM) { monthPts.push({ x: p[0], label: m }); lastM = m; }
  });

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(232,224,208,0.28)" }}>CURVA DE EQUITY — NET RR ACUMULADO</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "rgba(232,224,208,0.35)" }}>
            <span style={{ color: isPos ? "#7dcb9a" : "#e08888", fontWeight: 900, fontSize: 16 }}>{finalRR >= 0 ? "+" : ""}{finalRR.toFixed(1)}R</span> total
          </div>
          <div style={{ fontSize: 11, color: "rgba(232,224,208,0.28)" }}>{points.length - 1} trades</div>
        </div>
      </div>
      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 320 }} xmlns="http://www.w3.org/2000/svg">
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={PAD} y1={PAD + f * (H - PAD * 2)} x2={W - PAD} y2={PAD + f * (H - PAD * 2)} stroke="rgba(180,140,80,0.06)" strokeWidth="1" />
          ))}
          {minY < 0 && maxY > 0 && (
            <line x1={PAD} y1={py(0)} x2={W - PAD} y2={py(0)} stroke="rgba(232,224,208,0.1)" strokeWidth="1" strokeDasharray="4,4" />
          )}
          <defs>
            <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPos ? "#4a9e6a" : "#b85555"} stopOpacity="0.22" />
              <stop offset="100%" stopColor={isPos ? "#4a9e6a" : "#b85555"} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#eg)" />
          <path d={pathD} fill="none" stroke={isPos ? "#4a9e6a" : "#b85555"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {points.slice(1).map((p, i) => {
            const k = outcomeKey(p[2]);
            const col = k === "win" ? "#7dcb9a" : k === "loss" ? "#e08888" : k === "be" ? "#c8923a" : "rgba(232,224,208,0.3)";
            return <circle key={i} cx={px(p[0])} cy={py(p[1])} r="3" fill={col} stroke="rgba(10,8,5,0.8)" strokeWidth="1.5" />;
          })}
          {monthPts.map((mp, i) => (
            <text key={i} x={px(mp.x)} y={H - 6} textAnchor="middle" fontSize="9" fill="rgba(232,224,208,0.25)" fontFamily="monospace">{mp.label}</text>
          ))}
          {Array.from(new Set([minY, 0, maxY])).map((v, i) => (
            <text key={i} x={PAD - 4} y={py(v) + 4} textAnchor="end" fontSize="9" fill="rgba(232,224,208,0.3)" fontFamily="monospace">{v.toFixed(0)}R</text>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ─── Context Tag Stats ────────────────────────────
function MarketStateStats({ trades }: { trades: TradeEntry[] }): React.ReactElement {
  const tags = ["CONT-AM", "CONT-AM-SWEEP", "REVERSAL-SWEEP", "REVERSAL-NO-SWEEP"] as const;
  const tagColors: Record<string, { col: string; bg: string; border: string }> = {
    "CONT-AM":           { col: "#85b0e0", bg: "rgba(74,126,184,0.06)",  border: "rgba(74,126,184,0.2)" },
    "CONT-AM-SWEEP":     { col: "#7dcb9a", bg: "rgba(74,158,106,0.06)",  border: "rgba(74,158,106,0.2)" },
    "REVERSAL-SWEEP":    { col: "#c8923a", bg: "rgba(200,146,58,0.06)",  border: "rgba(200,146,58,0.2)" },
    "REVERSAL-NO-SWEEP": { col: "#e08888", bg: "rgba(184,85,85,0.06)",   border: "rgba(184,85,85,0.2)" },
  };

  const withTag = trades.filter(t => (t as any).contextTag);
  const noTag = trades.length - withTag.length;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(232,224,208,0.28)", marginBottom: 12 }}>
        RENDIMIENTO POR CATEGORÍA DE TRADE
      </div>

      {noTag > 0 && (
        <div style={{ fontSize: 11, color: "rgba(232,224,208,0.28)", marginBottom: 12 }}>
          {noTag} trade{noTag !== 1 ? "s" : ""} sin categoría aún — editálos desde el ✎ para completar el contexto.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px,1fr))", gap: 8, marginBottom: 12 }}>
        {tags.map(tag => {
          const g = trades.filter(t => (t as any).contextTag === tag);
          const w = g.filter(t => outcomeKey(t) === "win");
          const l = g.filter(t => outcomeKey(t) === "loss");
          const winRRs = w.map(t => safeRR(t)).filter((v): v is number => v !== null);
          const netRR = winRRs.reduce((a, b) => a + b, 0) - l.length;
          const wr = w.length + l.length > 0 ? w.length / (w.length + l.length) * 100 : 0;
          const { col, bg, border } = tagColors[tag];

          if (g.length === 0) return (
            <div key={tag} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${border}`, background: bg, opacity: 0.4 }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: col, marginBottom: 8 }}>{tag}</div>
              <div style={{ fontSize: 13, color: "rgba(232,224,208,0.3)" }}>Sin datos</div>
            </div>
          );

          return (
            <div key={tag} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${border}`, background: bg }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: col, marginBottom: 8 }}>{tag}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "rgba(232,224,208,0.9)", marginBottom: 4 }}>{wr.toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: "rgba(232,224,208,0.35)", marginBottom: 2 }}>{w.length}W · {l.length}L · {g.length - w.length - l.length}BE</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: netRR >= 0 ? "#7dcb9a" : "#e08888" }}>{netRR >= 0 ? "+" : ""}{netRR.toFixed(1)}R net</div>
            </div>
          );
        })}
      </div>

      {/* BUY vs SELL */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {(["BUY", "SELL"] as const).map(side => {
          const g = trades.filter(t => t.tradeSide === side);
          const w = g.filter(t => outcomeKey(t) === "win");
          const l = g.filter(t => outcomeKey(t) === "loss");
          const wr = w.length + l.length > 0 ? w.length / (w.length + l.length) * 100 : 0;
          const winRRs = w.map(t => safeRR(t)).filter((v): v is number => v !== null);
          const netRR = winRRs.reduce((a, b) => a + b, 0) - l.length;
          const sc = side === "BUY" ? "#85b0e0" : "#e08888";
          const sb = side === "BUY" ? "rgba(74,126,184,0.06)" : "rgba(184,85,85,0.06)";
          const sborder = side === "BUY" ? "rgba(74,126,184,0.2)" : "rgba(184,85,85,0.2)";
          return (
            <div key={side} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${sborder}`, background: sb }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: sc, marginBottom: 6 }}>{side}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "rgba(232,224,208,0.9)" }}>{wr.toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: "rgba(232,224,208,0.35)", marginTop: 2 }}>{w.length}W · {l.length}L</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: netRR >= 0 ? "#7dcb9a" : "#e08888", marginTop: 2 }}>{netRR >= 0 ? "+" : ""}{netRR.toFixed(1)}R</div>
            </div>
          );
        })}
      </div>

      {/* Horario */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "rgba(232,224,208,0.28)", marginBottom: 8 }}>POR HORARIO</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {([
            ["13:xx", (t: TradeEntry) => (t.tradeTime || "") >= "13:00" && (t.tradeTime || "") < "14:00"],
            ["14:xx", (t: TradeEntry) => (t.tradeTime || "") >= "14:00" && (t.tradeTime || "") < "15:00"],
            ["15:xx", (t: TradeEntry) => (t.tradeTime || "") >= "15:00"],
          ] as [string, (t: TradeEntry) => boolean][]).map(([label, fn]) => {
            const g = trades.filter(fn);
            const w = g.filter(t => outcomeKey(t) === "win").length;
            const l = g.filter(t => outcomeKey(t) === "loss").length;
            const wr = w + l > 0 ? w / (w + l) * 100 : 0;
            const col = wr >= 55 ? "#7dcb9a" : wr <= 40 ? "#e08888" : "#c8923a";
            return (
              <div key={label} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.1)", background: "rgba(0,0,0,0.15)", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.3)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: col }}>{wr.toFixed(0)}%</div>
                <div style={{ fontSize: 10, color: "rgba(232,224,208,0.3)", marginTop: 2 }}>{w}W {l}L</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Día de semana */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: "rgba(232,224,208,0.28)", marginBottom: 8 }}>POR DÍA DE SEMANA</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map(day => {
            const g = trades.filter(t => weekdayEs(t.createdAt) === day);
            const w = g.filter(t => outcomeKey(t) === "win").length;
            const l = g.filter(t => outcomeKey(t) === "loss").length;
            const wr = w + l > 0 ? w / (w + l) * 100 : 0;
            const col = wr >= 55 ? "#7dcb9a" : wr <= 40 ? "#e08888" : "#c8923a";
            return (
              <div key={day} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.1)", background: "rgba(0,0,0,0.12)", textAlign: "center", minWidth: 65 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(232,224,208,0.3)", marginBottom: 3 }}>{day.slice(0, 3).toUpperCase()}</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: col }}>{wr.toFixed(0)}%</div>
                <div style={{ fontSize: 9, color: "rgba(232,224,208,0.25)" }}>{g.length} trades</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Daily Objective ───────────────────────────────
function DailyObjective(): React.ReactElement {
  const todayKey = new Date().toISOString().slice(0, 10);
  const [objective, setObjective] = useState("");
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(LS_OBJECTIVE) || "{}");
      if (all[todayKey]) { setObjective(all[todayKey]); setSaved(true); }
    } catch {}
  }, []);

  function save() {
    if (!objective.trim()) return;
    try {
      const all = JSON.parse(localStorage.getItem(LS_OBJECTIVE) || "{}");
      all[todayKey] = objective.trim();
      localStorage.setItem(LS_OBJECTIVE, JSON.stringify(all));
    } catch {}
    setSaved(true); setEditing(false);
  }

  if (saved && !editing) {
    return (
      <div style={{ ...card, marginBottom: 12, display: "flex", alignItems: "center", gap: 14, padding: "12px 18px" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(200,146,58,0.45)", marginBottom: 3 }}>OBJETIVO HTF HOY</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(232,224,208,0.8)" }}>{objective}</div>
        </div>
        <button onClick={() => setEditing(true)} style={{ marginLeft: "auto", fontSize: 11, color: "rgba(200,146,58,0.5)", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Editar</button>
      </div>
    );
  }

  return (
    <div style={{ ...card, marginBottom: 12, padding: "14px 18px" }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(200,146,58,0.45)", marginBottom: 8 }}>OBJETIVO HTF HOY</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={objective} onChange={e => setObjective(e.target.value)}
          onKeyDown={e => e.key === "Enter" && save()}
          placeholder="Ej: PDL de NQ pendiente + London H de ES…"
          autoFocus={editing}
          style={{ flex: 1, height: 34, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.2)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.85)", fontSize: 12, fontWeight: 600, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={save} style={{ height: 34, padding: "0 16px", borderRadius: 999, border: "1px solid rgba(200,146,58,0.4)", background: "rgba(200,146,58,0.09)", color: "#c8923a", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>Guardar</button>
      </div>
      {editing && <button onClick={() => setEditing(false)} style={{ marginTop: 6, fontSize: 11, color: "rgba(232,224,208,0.3)", background: "none", border: "none", cursor: "pointer" }}>Cancelar</button>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────
function HistoryPageInner(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseClient> | null>(null);
  useEffect(() => { setSupabase(getSupabaseClient()); }, []);

  const [allTrades, setAllTrades] = useState<TradeEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("none");

  const [fOutcome, setFOutcome] = useState<OutcomeKey>((searchParams?.get("outcome") as OutcomeKey) || "all");
  const [fSide, setFSide] = useState<"all" | TradeSide>((searchParams?.get("side") as TradeSide) || "all");
  const [fWeekday, setFWeekday] = useState<Weekday>((searchParams?.get("day") as Weekday) || "ALL");
  const [from, setFrom] = useState(searchParams?.get("from") || "");
  const [to, setTo] = useState(searchParams?.get("to") || "");
  const [q, setQ] = useState(searchParams?.get("q") || "");
  const [page, setPage] = useState(Number(searchParams?.get("p") || 1));
  const pageSize = 15;

  const updateUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (fOutcome !== "all") params.set("outcome", fOutcome);
    if (fSide !== "all") params.set("side", fSide);
    if (fWeekday !== "ALL") params.set("day", fWeekday);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    if (page > 1) params.set("p", String(page));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [fOutcome, fSide, fWeekday, from, to, q, page, pathname]);

  useEffect(() => { updateUrl(); }, [fOutcome, fSide, fWeekday, from, to, q, page]);

  const [editTrade, setEditTrade] = useState<TradeEntry | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editSide, setEditSide] = useState<TradeSide>("BUY");
  const [editFollowed, setEditFollowed] = useState<FollowedPlan>("yes");
  const [editRR, setEditRR] = useState("");
  const [editOutcome, setEditOutcome] = useState<OutcomeDb>("unknown");
  const [editSetup, setEditSetup] = useState("unknown");
  const [editNote, setEditNote] = useState("");
  const [editInstrument, setEditInstrument] = useState<Instrument>("NQ");
  const [editSaving, setEditSaving] = useState(false);
  // Contexto nuevo
  const [editAmSweep, setEditAmSweep] = useState<"si"|"no"|null>(null);
  const [editAmSweepNivel, setEditAmSweepNivel] = useState<import("@/lib/types").LevelLabel>(null);
  const [editAmReac, setEditAmReac] = useState<import("@/lib/types").AmReac>(null);
  const [editAmDir, setEditAmDir] = useState<import("@/lib/types").AmDir>(null);
  const [editHtfStruct, setEditHtfStruct] = useState<import("@/lib/types").HtfStruct>(null);
  const [editPmSweep, setEditPmSweep] = useState<"si"|"no"|null>(null);
  const [editPmSweepNivel, setEditPmSweepNivel] = useState<import("@/lib/types").LevelLabel>(null);
  const [editPmReac, setEditPmReac] = useState<import("@/lib/types").AmReac>(null);
  const [editM15Struct, setEditM15Struct] = useState<import("@/lib/types").M15Struct>(null);
  const [editHasCisd, setEditHasCisd] = useState<"si"|"no"|null>(null);
  const [editCisdDir, setEditCisdDir] = useState<import("@/lib/types").CisdDir>(null);
  const [editModalTab, setEditModalTab] = useState<"trade"|"contexto">("trade");

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    try { const c = localStorage.getItem(LS_KEY); if (c) setAllTrades(JSON.parse(c)); } catch {}
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;
        if (!uid) return;
        if (alive) setUserId(uid);
        const raw = await listTradesSince(uid, 0, 500);
        const norm = (raw as any[]).map(t => ({ ...t, instrument: ["ES", "NQ"].includes(t.instrument) ? t.instrument : "ES" })).sort((a: any, b: any) => a.createdAt - b.createdAt);
        if (!alive) return;
        setAllTrades(norm as TradeEntry[]);
        localStorage.setItem(LS_KEY, JSON.stringify(norm));
      } catch (e) { console.error(e); }
    })();
    return () => { alive = false; };
  }, [supabase]);

  useEffect(() => { setPage(1); }, [fOutcome, fSide, fWeekday, from, to, q]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fMs = from ? startOfDayMs(from) : null;
    const tMs = to ? endOfDayMs(to) : null;
    return allTrades.filter(t => {
      if (fMs != null && t.createdAt < fMs) return false;
      if (tMs != null && t.createdAt > tMs) return false;
      if (fWeekday !== "ALL" && weekdayEs(t.createdAt) !== fWeekday) return false;
      if (fOutcome !== "all" && outcomeKey(t) !== fOutcome) return false;
      if (fSide !== "all" && t.tradeSide !== fSide) return false;
      if (ql) {
        const blob = [t.note || "", t.instrument || "", t.setupTag || "", t.tradeSide || ""].join(" ").toLowerCase();
        if (!blob.includes(ql)) return false;
      }
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [allTrades, fOutcome, fSide, fWeekday, from, to, q]);

  const kpis = useMemo(() => computeKPIs(filtered), [filtered]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(() => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize), [filtered, pageSafe]);

  const backUrl = useCallback((tradeId: string) => {
    const params = new URLSearchParams();
    if (fOutcome !== "all") params.set("outcome", fOutcome);
    if (fSide !== "all") params.set("side", fSide);
    if (fWeekday !== "ALL") params.set("day", fWeekday);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    if (page > 1) params.set("p", String(page));
    const qs = params.toString();
    const returnUrl = qs ? `/journal/history?${qs}` : "/journal/history";
    return `/journal/history/${tradeId}?back=${encodeURIComponent(returnUrl)}`;
  }, [fOutcome, fSide, fWeekday, from, to, q, page]);

  function openEdit(t: TradeEntry) {
    setEditTrade(t); setEditDate(formatYMD(t.createdAt)); setEditTime(t.tradeTime || "");
    setEditSide(t.tradeSide); setEditFollowed(t.followedPlan);
    setEditRR(t.rr != null ? String(t.rr) : "");
    setEditOutcome(normalizeOutcome(t.outcome)); setEditSetup(t.setupTag ?? "unknown");
    setEditNote(t.note ?? ""); setEditInstrument(t.instrument ?? "NQ");
    setEditModalTab("trade");
    // Contexto
    setEditAmSweep(t.amSweepNivel ? "si" : t.amDir ? "no" : null);
    setEditAmSweepNivel(t.amSweepNivel ?? null);
    setEditAmReac(t.amReac ?? null);
    setEditAmDir(t.amDir ?? null);
    setEditHtfStruct(t.htfStruct ?? null);
    setEditPmSweep(t.pmSweepNivel ? "si" : t.m15Struct ? "no" : null);
    setEditPmSweepNivel(t.pmSweepNivel ?? null);
    setEditPmReac(t.pmReac ?? null);
    setEditM15Struct(t.m15Struct ?? null);
    setEditHasCisd(t.cisdDir ? "si" : null);
    setEditCisdDir(t.cisdDir ?? null);
  }

  async function saveEdit() {
    if (!editTrade) return;
    setEditSaving(true);
    try {
      const ts = buildTimestamp(editDate, editTime);
      const rrV = (() => { const n = Number(String(editRR).replace(",", ".")); return Number.isFinite(n) ? n : null; })();
      // Calcular contextTag y htfAligned automáticamente
      const { computeContextTag } = await import("@/lib/journalLogic");
      const ctxResult = computeContextTag({
        amDir: editAmDir, amSweepNivel: editAmSweepNivel, amReac: editAmReac,
        htfStruct: editHtfStruct, pmSweepNivel: editPmSweepNivel, pmReac: editPmReac,
        m15Struct: editM15Struct, cisdDir: editCisdDir,
      }, editSide);
      await updateTrade(editTrade.id, {
        createdAt: ts, tradeTime: editTime, tradeSide: editSide,
        followedPlan: editFollowed, rr: rrV, outcome: editOutcome,
        setupTag: editSetup, note: editNote, instrument: editInstrument,
        amDir: editAmDir, amSweepNivel: editAmSweepNivel, amReac: editAmReac,
        htfStruct: editHtfStruct, pmSweepNivel: editPmSweepNivel, pmReac: editPmReac,
        m15Struct: editM15Struct, cisdDir: editCisdDir,
        contextTag: ctxResult.contextTag, htfAligned: ctxResult.htfAligned,
      });
      setAllTrades(prev => {
        const next = prev.map(t => t.id !== editTrade.id ? t : {
          ...t, createdAt: ts, tradeTime: editTime, tradeSide: editSide,
          followedPlan: editFollowed, rr: rrV, outcome: editOutcome,
          setupTag: editSetup as SetupTag, note: editNote, instrument: editInstrument,
          amDir: editAmDir, amSweepNivel: editAmSweepNivel, amReac: editAmReac,
          htfStruct: editHtfStruct, pmSweepNivel: editPmSweepNivel, pmReac: editPmReac,
          m15Struct: editM15Struct, cisdDir: editCisdDir,
          contextTag: ctxResult.contextTag, htfAligned: ctxResult.htfAligned,
        });
        localStorage.setItem(LS_KEY, JSON.stringify(next)); return next;
      });
      setEditTrade(null);
    } catch { alert("No se pudo guardar."); }
    finally { setEditSaving(false); }
  }

  async function handleDelete(e: React.MouseEvent, t: TradeEntry) {
    e.stopPropagation();
    if (!userId) return;
    if (!window.confirm(`¿Borrar?\n${formatYMD(t.createdAt)} · ${t.instrument} · ${t.tradeSide}`)) return;
    try {
      await deleteTrade(userId, t.id);
      setAllTrades(prev => { const next = prev.filter(x => x.id !== t.id); localStorage.setItem(LS_KEY, JSON.stringify(next)); return next; });
    } catch { alert("No se pudo borrar."); }
  }

  if (!supabase) return <div style={{ minHeight: "100vh", background: "#0c0a07", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(232,224,208,0.3)", fontSize: 13 }}>Cargando…</div>;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 0, backgroundImage: "url('/PM_SCALPS_BG.png')", backgroundSize: "cover", backgroundPosition: "center" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1, background: "rgba(6,4,2,0.78)", backgroundImage: "radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.22) 0%, transparent 60%)" }} />

      <div style={{ position: "relative", zIndex: 2, maxWidth: 1000, margin: "0 auto", padding: "24px 20px 48px" }}>

        {/* Header */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.22em", color: "rgba(200,146,58,0.45)" }}>JOURNAL</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "rgba(232,224,208,0.9)", marginTop: 2 }}>History</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button onClick={() => toCSV(allTrades, "pm-ALL.csv")} style={pill()}>Export ALL</button>
            <button onClick={() => toCSV(filtered, "pm-filtrado.csv")} style={pill()}>Export filtrado</button>
          </div>
        </div>

        <DailyObjective />

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px,1fr))", gap: 10, marginBottom: 12 }}>
          {[
            { label: "TOTAL TRADES", val: kpis.total, sub: `W ${kpis.winCount} · L ${kpis.lossCount} · BE ${kpis.beCount}` },
            { label: "WINRATE", val: `${kpis.winrate.toFixed(1)}%`, sub: `${kpis.totalWithRR} trades con RR` },
            { label: "NET RR", val: kpis.netRR.toFixed(2), sub: `Profit Factor: ${kpis.profitFactor === Infinity ? "∞" : kpis.profitFactor.toFixed(2)}`, color: kpis.netRR >= 0 ? "#7dcb9a" : "#e08888" },
            { label: "AVG RR EN WINS", val: kpis.avgRR.toFixed(2) + "R", sub: `Solo trades ganadores` },
          ].map(({ label, val, sub, color }) => (
            <div key={label} style={card}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(232,224,208,0.28)", marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: color ?? "rgba(232,224,208,0.9)" }}>{val}</div>
              <div style={{ fontSize: 11, color: "rgba(232,224,208,0.35)", marginTop: 4 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Toggles */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={() => setChartMode(chartMode === "weekly" ? "none" : "weekly")} style={pill(chartMode === "weekly", "amber")}>
            {chartMode === "weekly" ? "▲" : "▼"} Resumen semanal
          </button>
          <button onClick={() => setChartMode(chartMode === "equity" ? "none" : "equity")} style={pill(chartMode === "equity", "amber")}>
            {chartMode === "equity" ? "▲" : "▼"} Curva de equity
          </button>
          <button onClick={() => setChartMode(chartMode === "marketstate" ? "none" : "marketstate")} style={pill(chartMode === "marketstate", "amber")}>
            {chartMode === "marketstate" ? "▲" : "▼"} Stats por contexto
          </button>
          <button onClick={() => setChartMode(chartMode === "ai" ? "none" : "ai")} style={pill(chartMode === "ai", "green")}>
            {chartMode === "ai" ? "▲" : "▼"} ✦ Análisis IA
          </button>
        </div>

        {chartMode !== "none" && (
          <div style={{ ...card, marginBottom: 12 }}>
            {chartMode === "weekly" && <WeeklySummary trades={allTrades} />}
            {chartMode === "equity" && <EquityCurve trades={allTrades} />}
            {chartMode === "marketstate" && <MarketStateStats trades={filtered} />}
            {chartMode === "ai" && <AIAnalysis trades={filtered.length > 0 ? filtered : allTrades} />}
          </div>
        )}

        {/* Filtros */}
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {([{ v: "all", l: "Todos" }, { v: "win", l: "✅ Wins" }, { v: "loss", l: "❌ Losses" }, { v: "be", l: "◻︎ BE" }] as { v: OutcomeKey; l: string }[]).map(({ v, l }) => (
              <button key={v} onClick={() => setFOutcome(v)} style={pill(fOutcome === v, v === "win" ? "green" : v === "loss" ? "red" : v === "be" ? "amber" : "default")}>{l}</button>
            ))}
            <div style={{ width: 1, height: 20, background: "rgba(180,140,80,0.1)" }} />
            {([{ v: "all", l: "±" }, { v: "BUY", l: "BUY" }, { v: "SELL", l: "SELL" }] as { v: string; l: string }[]).map(({ v, l }) => (
              <button key={v} onClick={() => setFSide(v as any)} style={pill(fSide === v)}>{l}</button>
            ))}
            <div style={{ width: 1, height: 20, background: "rgba(180,140,80,0.1)" }} />
            <select value={fWeekday} onChange={e => setFWeekday(e.target.value as Weekday)} style={{ height: 32, padding: "0 10px", borderRadius: 999, cursor: "pointer", border: "1px solid rgba(180,140,80,0.12)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.4)", fontSize: 11, fontWeight: 700, outline: "none" }}>
              <option value="ALL">Todos los días</option>
              {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "rgba(232,224,208,0.28)", fontWeight: 700 }}>De</span>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ height: 32, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.12)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.5)", fontSize: 11, outline: "none" }} />
              <span style={{ fontSize: 10, color: "rgba(232,224,208,0.28)", fontWeight: 700 }}>a</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ height: 32, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.12)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.5)", fontSize: 11, outline: "none" }} />
            </div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(180,140,80,0.12)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.5)", fontSize: 11, fontWeight: 600, outline: "none", width: 120 }} />
            <button onClick={() => { setFOutcome("all"); setFSide("all"); setFWeekday("ALL"); setFrom(""); setTo(""); setQ(""); }} style={{ ...pill(), marginLeft: "auto" }}>Clear</button>
          </div>
        </div>

        {/* Lista */}
        <div style={card}>
          {isMobile ? (
            <div style={{ display: "grid", gap: 10 }}>
              {pageItems.length === 0 ? (
                <div style={{ padding: "32px 0", textAlign: "center", color: "rgba(232,224,208,0.3)", fontSize: 13 }}>No hay trades con esos filtros.</div>
              ) : pageItems.map((t, idx) => {
                const ok = outcomeKey(t);
                const gi = (pageSafe - 1) * pageSize + idx + 1;
                return (
                  <div key={t.id} onClick={() => router.push(backUrl(t.id))}
                    style={{ position: "relative", padding: "14px 16px", borderRadius: 14, cursor: "pointer", border: `1px solid ${obdr(ok)}`, background: ob(ok) }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.35)" }}>#{gi} · {formatYMD(t.createdAt)} · {t.tradeTime || "—"}</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: oc(ok) }}>{ok === "win" ? "✅" : ok === "loss" ? "❌" : ok === "be" ? "◻︎" : "—"}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <Tag color={t.tradeSide === "BUY" ? "#85b0e0" : "#e08888"} border={t.tradeSide === "BUY" ? "rgba(74,126,184,0.35)" : "rgba(184,85,85,0.35)"} bg={t.tradeSide === "BUY" ? "rgba(74,126,184,0.12)" : "rgba(184,85,85,0.12)"}>{t.tradeSide}</Tag>
                      <Tag>{t.instrument}</Tag>
                      {t.rr != null && <RRTag t={t} />}
                      {t.setupTag && t.setupTag !== "unknown" && <Tag>{t.setupTag === "A" ? "Setup A" : t.setupTag === "B" ? "Setup B" : t.setupTag}</Tag>}
                    </div>
                    {t.note?.trim() && <div style={{ marginTop: 8, fontSize: 11, color: "rgba(232,224,208,0.35)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{t.note.trim()}</div>}
                    <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 4 }}>
                      <button onClick={e => { e.stopPropagation(); openEdit(t); }} style={{ width: 28, height: 28, borderRadius: 999, border: "1px solid rgba(180,140,80,0.15)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.4)", fontSize: 11, cursor: "pointer" }}>✎</button>
                      <button onClick={e => handleDelete(e, t)} style={{ width: 28, height: 28, borderRadius: 999, border: "1px solid rgba(184,85,85,0.2)", background: "rgba(184,85,85,0.06)", color: "rgba(224,136,136,0.5)", fontSize: 11, cursor: "pointer" }}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(180,140,80,0.1)" }}>
                    {["#", "FECHA", "DÍA", "HORA", "INSTR", "DIR", "RESULTADO", "RR", "PLAN", "SETUP", ""].map(h => (
                      <th key={h} style={{ padding: "10px 12px 10px 0", textAlign: "left", fontSize: 9, fontWeight: 800, letterSpacing: "0.15em", color: "rgba(232,224,208,0.28)", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr><td colSpan={12} style={{ padding: "32px 0", textAlign: "center", color: "rgba(232,224,208,0.3)", fontSize: 13 }}>No hay trades con esos filtros.</td></tr>
                  ) : pageItems.map((t, idx) => {
                    const ok = outcomeKey(t);
                    const gi = (pageSafe - 1) * pageSize + idx + 1;
                    return (
                      <tr key={t.id} onClick={() => router.push(backUrl(t.id))}
                        style={{ borderBottom: "1px solid rgba(180,140,80,0.07)", cursor: "pointer", transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(200,146,58,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding: "12px 12px 12px 0", fontSize: 12 }}>
                          <Link href={backUrl(t.id)} onClick={e => e.stopPropagation()} style={{ color: "rgba(200,146,58,0.6)", fontWeight: 800, textDecoration: "none" }}>{gi}</Link>
                        </td>
                        <td style={{ padding: "12px 12px 12px 0", fontSize: 12, color: "rgba(232,224,208,0.6)", whiteSpace: "nowrap" }}>{formatYMD(t.createdAt)}</td>
                        <td style={{ padding: "12px 12px 12px 0", fontSize: 12, color: "rgba(232,224,208,0.4)" }}>{weekdayLabel(t.createdAt)}</td>
                        <td style={{ padding: "12px 12px 12px 0", fontSize: 12, color: "rgba(232,224,208,0.5)" }}>{t.tradeTime || "—"}</td>
                        <td style={{ padding: "12px 12px 12px 0", fontSize: 12, fontWeight: 800, color: "rgba(232,224,208,0.7)" }}>{t.instrument}</td>
                        <td style={{ padding: "12px 12px 12px 0" }}>
                          <Tag color={t.tradeSide === "BUY" ? "#85b0e0" : "#e08888"} border={t.tradeSide === "BUY" ? "rgba(74,126,184,0.35)" : "rgba(184,85,85,0.35)"} bg={t.tradeSide === "BUY" ? "rgba(74,126,184,0.1)" : "rgba(184,85,85,0.1)"}>{t.tradeSide}</Tag>
                        </td>
                        <td style={{ padding: "12px 12px 12px 0" }}>
                          <Tag color={oc(ok)} border={obdr(ok)} bg={ob(ok)}>{ok === "win" ? "✅ Win" : ok === "loss" ? "❌ Loss" : ok === "be" ? "◻︎ BE" : "—"}</Tag>
                        </td>
                        <td style={{ padding: "12px 12px 12px 0" }}>
                          <RRTag t={t} />
                        </td>
                        <td style={{ padding: "12px 12px 12px 0" }}>
                          <Tag color={t.followedPlan === "yes" ? "#7dcb9a" : "#e08888"} border={t.followedPlan === "yes" ? "rgba(74,158,106,0.3)" : "rgba(184,85,85,0.3)"} bg={t.followedPlan === "yes" ? "rgba(74,158,106,0.08)" : "rgba(184,85,85,0.08)"}>{t.followedPlan === "yes" ? "Sí" : "No"}</Tag>
                        </td>
                        <td style={{ padding: "12px 12px 12px 0" }}>
                          {t.setupTag && t.setupTag !== "unknown" ? <Tag>{t.setupTag === "A" ? "Setup A" : t.setupTag === "B" ? "Setup B" : t.setupTag}</Tag> : <span style={{ color: "rgba(232,224,208,0.2)", fontSize: 12 }}>—</span>}
                        </td>

                        <td style={{ padding: "12px 0", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            <button onClick={e => { e.stopPropagation(); openEdit(t); }} style={{ width: 28, height: 28, borderRadius: 999, border: "1px solid rgba(180,140,80,0.15)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.4)", fontSize: 11, cursor: "pointer" }}>✎</button>
                            <button onClick={e => handleDelete(e, t)} style={{ width: 28, height: 28, borderRadius: 999, border: "1px solid rgba(184,85,85,0.2)", background: "rgba(184,85,85,0.06)", color: "rgba(224,136,136,0.5)", fontSize: 11, cursor: "pointer" }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe <= 1} style={{ ...pill(), opacity: pageSafe <= 1 ? 0.3 : 1 }}>← Prev</button>
            <span style={{ fontSize: 12, color: "rgba(232,224,208,0.35)", fontWeight: 600 }}>{pageSafe} / {totalPages} <span style={{ color: "rgba(232,224,208,0.2)" }}>({filtered.length} trades)</span></span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages} style={{ ...pill(), opacity: pageSafe >= totalPages ? 0.3 : 1 }}>Next →</button>
          </div>
        </div>
      </div>

      {/* Modal edición */}
      {editTrade && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,3,1,0.88)", backdropFilter: "blur(12px)", padding: 20 }}>
          <div style={{ ...card, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(232,224,208,0.88)", marginBottom: 4 }}>Editar trade</div>
            <div style={{ fontSize: 10, color: "rgba(232,224,208,0.25)", marginBottom: 16 }}>{editTrade.id.slice(0, 8)}…</div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              {(["trade", "contexto"] as const).map(tab => (
                <button key={tab} onClick={() => setEditModalTab(tab)} style={{
                  height: 30, padding: "0 16px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${editModalTab === tab ? "rgba(200,146,58,0.45)" : "rgba(180,140,80,0.12)"}`,
                  background: editModalTab === tab ? "rgba(200,146,58,0.09)" : "transparent",
                  color: editModalTab === tab ? "#c8923a" : "rgba(232,224,208,0.35)",
                  fontSize: 11, fontWeight: 700,
                }}>{tab === "trade" ? "Trade" : "Contexto ICT"}</button>
              ))}
            </div>

            {/* Tab: Trade */}
            {editModalTab === "trade" && (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>FECHA</div>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.18)", background: "rgba(0,0,0,0.35)", color: "rgba(232,224,208,0.9)", fontSize: 13, fontWeight: 600, outline: "none", width: "100%", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>HORA</div>
                  <input value={editTime} onChange={e => setEditTime(e.target.value)} placeholder="HH:MM" style={{ height: 36, padding: "0 12px", borderRadius: 10, border: `1px solid ${editTime && !isValidHHMM(editTime) ? "rgba(184,85,85,0.5)" : "rgba(180,140,80,0.18)"}`, background: "rgba(0,0,0,0.35)", color: "rgba(232,224,208,0.9)", fontSize: 13, fontWeight: 600, outline: "none", width: 100 }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>INSTRUMENTO</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["NQ", "ES"] as Instrument[]).map(ins => (
                        <button key={ins} onClick={() => setEditInstrument(ins)} style={pill(editInstrument === ins)}>{ins}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>DIRECCIÓN</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditSide("BUY")} style={pill(editSide === "BUY")}>BUY</button>
                      <button onClick={() => setEditSide("SELL")} style={pill(editSide === "SELL")}>SELL</button>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>RESULTADO</div>
                    <select value={editOutcome} onChange={e => setEditOutcome(e.target.value as OutcomeDb)} style={{ height: 36, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.18)", background: "rgba(0,0,0,0.4)", color: "rgba(232,224,208,0.8)", fontSize: 12, fontWeight: 700, outline: "none" }}>
                      <option value="unknown">—</option><option value="win">Win</option><option value="loss">Loss</option><option value="be">BE</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>RR</div>
                    <input value={editRR} onChange={e => setEditRR(e.target.value)} placeholder="2.5" style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.18)", background: "rgba(0,0,0,0.35)", color: "rgba(232,224,208,0.9)", fontSize: 13, fontWeight: 600, outline: "none", width: 80 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>SETUP</div>
                    <select value={editSetup} onChange={e => setEditSetup(e.target.value)} style={{ height: 36, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.18)", background: "rgba(0,0,0,0.4)", color: "rgba(232,224,208,0.8)", fontSize: 12, fontWeight: 700, outline: "none" }}>
                      <option value="unknown">—</option><option value="A">Setup A</option><option value="B">Setup B</option><option value="none">Sin setup</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>PLAN</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditFollowed("yes")} style={pill(editFollowed === "yes", "green")}>Cumplí ✓</button>
                    <button onClick={() => setEditFollowed("no")} style={pill(editFollowed === "no", "red")}>No cumplí ✗</button>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.15em" }}>NOTA</div>
                  <textarea value={editNote} onChange={e => setEditNote(e.target.value)} rows={4} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid rgba(180,140,80,0.15)", background: "rgba(0,0,0,0.3)", color: "rgba(232,224,208,0.85)", fontSize: 13, fontWeight: 500, outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
            )}

            {/* Tab: Contexto ICT */}
            {editModalTab === "contexto" && (
              <div style={{ display: "grid", gap: 18 }}>

                {/* Sección 1 — Apertura */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(200,146,58,0.6)", marginBottom: 12, letterSpacing: "0.1em" }}>1 · CONTEXTO APERTURA</div>

                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>¿HUBO SWEEP HTF EN LA APERTURA?</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    <button onClick={() => setEditAmSweep(editAmSweep === "si" ? null : "si")} style={pill(editAmSweep === "si", "green")}>Sí</button>
                    <button onClick={() => { setEditAmSweep(editAmSweep === "no" ? null : "no"); setEditAmSweepNivel(null); setEditAmReac(null); }} style={pill(editAmSweep === "no", "red")}>No</button>
                  </div>

                  {editAmSweep === "si" && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>NIVEL MÁS IMPORTANTE</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                        {(["PDH","PDL","London H","London L","Asia H","Asia L","Weekly H","Weekly L"] as const).map(l => (
                          <button key={l} onClick={() => setEditAmSweepNivel(editAmSweepNivel === l ? null : l)} style={pill(editAmSweepNivel === l)}>{l}</button>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>REACCIÓN</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                        <button onClick={() => setEditAmReac(editAmReac === "absorbio" ? null : "absorbio")} style={pill(editAmReac === "absorbio", "amber")}>Absorbió</button>
                        <button onClick={() => setEditAmReac(editAmReac === "acepto" ? null : "acepto")} style={pill(editAmReac === "acepto", "green")}>Aceptó</button>
                      </div>
                    </>
                  )}

                  <div style={{ height: 1, background: "rgba(180,140,80,0.09)", margin: "12px 0" }} />

                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>DIRECCIÓN DE LA AM</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    <button onClick={() => setEditAmDir(editAmDir === "alcista" ? null : "alcista")} style={pill(editAmDir === "alcista", "green")}>Alcista</button>
                    <button onClick={() => setEditAmDir(editAmDir === "bajista" ? null : "bajista")} style={pill(editAmDir === "bajista", "red")}>Bajista</button>
                    <button onClick={() => setEditAmDir(editAmDir === "sin-dir" ? null : "sin-dir")} style={pill(editAmDir === "sin-dir", "amber")}>Sin dir.</button>
                  </div>

                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>HTF H1/H4</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditHtfStruct(editHtfStruct === "alcista" ? null : "alcista")} style={pill(editHtfStruct === "alcista", "green")}>Alcista</button>
                    <button onClick={() => setEditHtfStruct(editHtfStruct === "bajista" ? null : "bajista")} style={pill(editHtfStruct === "bajista", "red")}>Bajista</button>
                  </div>
                </div>

                {/* Sección 2 — Estado actual */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(200,146,58,0.6)", marginBottom: 12, letterSpacing: "0.1em" }}>2 · ESTADO ACTUAL DE SESIÓN</div>

                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>¿SE TOMÓ NIVEL HTF EN LA SESIÓN?</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    <button onClick={() => setEditPmSweep(editPmSweep === "si" ? null : "si")} style={pill(editPmSweep === "si", "green")}>Sí</button>
                    <button onClick={() => { setEditPmSweep(editPmSweep === "no" ? null : "no"); setEditPmSweepNivel(null); setEditPmReac(null); }} style={pill(editPmSweep === "no", "red")}>No</button>
                  </div>

                  {editPmSweep === "si" && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>NIVEL MÁS RECIENTE</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                        {(["PDH","PDL","London H","London L","Asia H","Asia L","Weekly H","Weekly L"] as const).map(l => (
                          <button key={l} onClick={() => setEditPmSweepNivel(editPmSweepNivel === l ? null : l)} style={pill(editPmSweepNivel === l)}>{l}</button>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>REACCIÓN</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                        <button onClick={() => setEditPmReac(editPmReac === "absorbio" ? null : "absorbio")} style={pill(editPmReac === "absorbio", "amber")}>Absorbió</button>
                        <button onClick={() => setEditPmReac(editPmReac === "acepto" ? null : "acepto")} style={pill(editPmReac === "acepto", "green")}>Aceptó</button>
                      </div>
                    </>
                  )}

                  <div style={{ height: 1, background: "rgba(180,140,80,0.09)", margin: "12px 0" }} />

                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>ESTRUCTURA M15 AHORA</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditM15Struct(editM15Struct === "alcista" ? null : "alcista")} style={pill(editM15Struct === "alcista", "green")}>Alcista</button>
                    <button onClick={() => setEditM15Struct(editM15Struct === "bajista" ? null : "bajista")} style={pill(editM15Struct === "bajista", "red")}>Bajista</button>
                  </div>
                </div>

                {/* Sección 3 — CISD */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(200,146,58,0.6)", marginBottom: 12, letterSpacing: "0.1em" }}>3 · UPDATE DELIVERY</div>

                  <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>¿HAY CISD M15 ACTIVO?</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    <button onClick={() => setEditHasCisd(editHasCisd === "si" ? null : "si")} style={pill(editHasCisd === "si", "green")}>Sí</button>
                    <button onClick={() => { setEditHasCisd(editHasCisd === "no" ? null : "no"); setEditCisdDir(null); }} style={pill(editHasCisd === "no", "red")}>No</button>
                  </div>

                  {editHasCisd === "si" && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(232,224,208,0.28)", marginBottom: 6, letterSpacing: "0.12em" }}>CISD M15 DIRECCIÓN</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setEditCisdDir(editCisdDir === "alcista" ? null : "alcista")} style={pill(editCisdDir === "alcista", "green")}>Alcista</button>
                        <button onClick={() => setEditCisdDir(editCisdDir === "bajista" ? null : "bajista")} style={pill(editCisdDir === "bajista", "red")}>Bajista</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
              <button onClick={saveEdit} disabled={editSaving} style={{ flex: 1, height: 40, borderRadius: 999, cursor: "pointer", border: "1px solid rgba(200,146,58,0.38)", background: "rgba(200,146,58,0.09)", color: "#c8923a", fontSize: 12, fontWeight: 800, opacity: editSaving ? 0.5 : 1 }}>{editSaving ? "Guardando…" : "Guardar cambios"}</button>
              <button onClick={() => setEditTrade(null)} style={{ height: 40, padding: "0 18px", borderRadius: 999, cursor: "pointer", border: "1px solid rgba(180,140,80,0.12)", background: "transparent", color: "rgba(232,224,208,0.35)", fontSize: 12, fontWeight: 700 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0c0a07" }} />}>
      <HistoryPageInner />
    </Suspense>
  );
}