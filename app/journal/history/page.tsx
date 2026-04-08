"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { listTradesSince, deleteTrade, updateTrade } from "@/lib/tradesDb";
import type { TradeEntry, Instrument, TradeSide, FollowedPlan, OutcomeDb, SetupTag } from "@/lib/types";
import { formatYMD, weekdayLabel, startOfDayMs, endOfDayMs, buildTimestamp, normalizeOutcome, outcomeKey, computeKPIs, isValidHHMM } from "@/lib/helpers";

const LS_KEY = "trades_cache_v1";
const LS_OBJECTIVE = "pm_scalps_objectives_v1";

type OutcomeKey = "all" | OutcomeDb;
type Weekday = "ALL" | "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes";
type ChartMode = "none" | "equity" | "marketstate";

function weekdayEs(ms: number): Weekday {
  const d = new Date(ms).getDay();
  if (d===1) return "Lunes"; if (d===2) return "Martes";
  if (d===3) return "Miércoles"; if (d===4) return "Jueves";
  if (d===5) return "Viernes"; return "ALL";
}

function safeRR(t: TradeEntry): number | null {
  const n = Number(t.rr); return Number.isFinite(n) ? n : null;
}

function useIsMobile(bp = 768) {
  const [m, setM] = useState(false);
  useEffect(() => { const f = () => setM(window.innerWidth < bp); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return m;
}

function toCSV(trades: TradeEntry[], name: string) {
  const hdr = ["id","date","time","instrument","side","outcome","rr","plan","setup","bias","marketState","note"];
  const rows = trades.map(t => [t.id,formatYMD(t.createdAt),t.tradeTime,t.instrument,t.tradeSide,outcomeKey(t),t.rr,t.followedPlan,t.setupTag,t.biasShown,t.marketState,(t.note||"").replace(/"/g,'""')].map(v=>`"${v??""}"` ).join(","));
  const blob = new Blob([[hdr.join(","), ...rows].join("\n")], { type:"text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

// ─── Styles ───────────────────────────────────────
const card: React.CSSProperties = {
  background:"rgba(10,8,5,0.82)", border:"1px solid rgba(180,140,80,0.14)",
  borderRadius:16, padding:"18px 20px",
  backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)",
};

function pill(active=false, variant:"default"|"green"|"red"|"amber"="default"): React.CSSProperties {
  const c = {
    default:{b:"rgba(180,140,80,0.35)",bg:"rgba(200,146,58,0.08)",t:"#c8923a"},
    green:  {b:"rgba(74,158,106,0.5)", bg:"rgba(74,158,106,0.12)",t:"#7dcb9a"},
    red:    {b:"rgba(184,85,85,0.5)",  bg:"rgba(184,85,85,0.12)", t:"#e08888"},
    amber:  {b:"rgba(200,146,58,0.5)", bg:"rgba(200,146,58,0.1)", t:"#c8923a"},
  }[variant];
  return {height:32,padding:"0 14px",borderRadius:999,cursor:"pointer",border:`1px solid ${active?c.b:"rgba(180,140,80,0.12)"}`,background:active?c.bg:"rgba(255,255,255,0.02)",color:active?c.t:"rgba(232,224,208,0.35)",fontSize:11,fontWeight:700,transition:"all 0.15s",whiteSpace:"nowrap" as const};
}

function oc(k:OutcomeDb){return k==="win"?"#7dcb9a":k==="loss"?"#e08888":k==="be"?"#c8923a":"rgba(232,224,208,0.35)";}
function ob(k:OutcomeDb){return k==="win"?"rgba(74,158,106,0.12)":k==="loss"?"rgba(184,85,85,0.12)":k==="be"?"rgba(200,146,58,0.1)":"rgba(255,255,255,0.04)";}
function obdr(k:OutcomeDb){return k==="win"?"rgba(74,158,106,0.35)":k==="loss"?"rgba(184,85,85,0.35)":k==="be"?"rgba(200,146,58,0.3)":"rgba(180,140,80,0.12)";}

function Tag({children,color="rgba(232,224,208,0.35)",bg="rgba(255,255,255,0.04)",border="rgba(180,140,80,0.12)"}:{children:React.ReactNode;color?:string;bg?:string;border?:string}){
  return <span style={{height:24,padding:"0 10px",display:"inline-flex",alignItems:"center",borderRadius:999,border:`1px solid ${border}`,background:bg,fontSize:11,fontWeight:700,color,whiteSpace:"nowrap"}}>{children}</span>;
}

// ─── Equity Curve ──────────────────────────────────
function EquityCurve({trades}:{trades:TradeEntry[]}) {
  const points = useMemo(() => {
    const sorted = [...trades].filter(t=>t.outcome&&t.outcome!=="unknown"&&t.createdAt).sort((a,b)=>a.createdAt-b.createdAt);
    let cum = 0;
    const pts:[number,number,TradeEntry,number][] = [[0,0,sorted[0],0]];
    sorted.forEach((t,i) => {
      const ok = outcomeKey(t);
      const rr = safeRR(t);
      if (ok==="win"&&rr) cum+=rr;
      else if (ok==="loss") cum-=1;
      pts.push([i+1,cum,t,cum]);
    });
    return pts;
  },[trades]);

  if (points.length<2) return null;

  const W=800,H=200,PAD=42;
  const ys=points.map(p=>p[1]);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  const rangeY=maxY-minY||1;
  const rangeX=Math.max(...points.map(p=>p[0]))||1;

  const px=(x:number)=>PAD+(x/rangeX)*(W-PAD*2);
  const py=(y:number)=>H-PAD-((y-minY)/rangeY)*(H-PAD*2);

  const pathD=points.map((p,i)=>`${i===0?"M":"L"} ${px(p[0])} ${py(p[1])}`).join(" ");
  const areaD=`${pathD} L ${px(points[points.length-1][0])} ${py(minY)} L ${px(0)} ${py(minY)} Z`;

  const finalRR=points[points.length-1][1];
  const isPos=finalRR>=0;

  // Month labels
  const monthPts:{x:number,label:string}[]=[];
  let lastM="";
  points.forEach(p=>{
    if(!p[2]?.createdAt) return;
    const m=new Date(p[2].createdAt).toLocaleDateString("es-AR",{month:"short"});
    if(m!==lastM){monthPts.push({x:p[0],label:m});lastM=m;}
  });

  return (
    <div style={{marginTop:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.18em",color:"rgba(232,224,208,0.28)"}}>CURVA DE EQUITY — NET RR ACUMULADO</div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div style={{fontSize:11,color:"rgba(232,224,208,0.35)"}}>
            <span style={{color:isPos?"#7dcb9a":"#e08888",fontWeight:900,fontSize:16}}>{finalRR>=0?"+":""}{finalRR.toFixed(1)}R</span>{" "}total
          </div>
          <div style={{fontSize:11,color:"rgba(232,224,208,0.28)"}}>{points.length-1} trades</div>
        </div>
      </div>
      <div style={{width:"100%",overflowX:"auto"}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",minWidth:320}} xmlns="http://www.w3.org/2000/svg">
          {/* Grid */}
          {[0.25,0.5,0.75].map(f=>(
            <line key={f} x1={PAD} y1={PAD+f*(H-PAD*2)} x2={W-PAD} y2={PAD+f*(H-PAD*2)} stroke="rgba(180,140,80,0.06)" strokeWidth="1"/>
          ))}
          {/* Zero line */}
          {minY<0&&maxY>0&&(
            <line x1={PAD} y1={py(0)} x2={W-PAD} y2={py(0)} stroke="rgba(232,224,208,0.1)" strokeWidth="1" strokeDasharray="4,4"/>
          )}
          {/* Area */}
          <defs>
            <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPos?"#4a9e6a":"#b85555"} stopOpacity="0.22"/>
              <stop offset="100%" stopColor={isPos?"#4a9e6a":"#b85555"} stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#eg)"/>
          {/* Line */}
          <path d={pathD} fill="none" stroke={isPos?"#4a9e6a":"#b85555"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
          {/* Dots */}
          {points.slice(1).map((p,i)=>{
            const k=outcomeKey(p[2]);
            const col=k==="win"?"#7dcb9a":k==="loss"?"#e08888":k==="be"?"#c8923a":"rgba(232,224,208,0.3)";
            return <circle key={i} cx={px(p[0])} cy={py(p[1])} r="3" fill={col} stroke="rgba(10,8,5,0.8)" strokeWidth="1.5"/>;
          })}
          {/* Month labels */}
          {monthPts.map((mp,i)=>(
            <text key={i} x={px(mp.x)} y={H-6} textAnchor="middle" fontSize="9" fill="rgba(232,224,208,0.25)" fontFamily="monospace">{mp.label}</text>
          ))}
          {/* Y labels */}
          {Array.from(new Set([minY,0,maxY])).map((v,i)=>(
            <text key={i} x={PAD-4} y={py(v)+4} textAnchor="end" fontSize="9" fill="rgba(232,224,208,0.3)" fontFamily="monospace">{v.toFixed(0)}R</text>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ─── Market State Stats ────────────────────────────
function MarketStateStats({trades}:{trades:TradeEntry[]}) {
  const states=["EXPANSION","TRANSITION","DELIVERY_CONDITIONAL","WAIT"] as const;

  return (
    <div style={{marginTop:16}}>
      <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.18em",color:"rgba(232,224,208,0.28)",marginBottom:12}}>RENDIMIENTO POR MARKET STATE</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(155px,1fr))",gap:8}}>
        {states.map(ms=>{
          const g=trades.filter(t=>t.marketState===ms);
          const w=g.filter(t=>outcomeKey(t)==="win");
          const l=g.filter(t=>outcomeKey(t)==="loss");
          const winRRs=w.map(t=>safeRR(t)).filter((v):v is number=>v!==null);
          const netRR=winRRs.reduce((a,b)=>a+b,0)-l.length;
          const wr=w.length+l.length>0?w.length/(w.length+l.length)*100:0;
          const msCol=ms==="EXPANSION"?"#85b0e0":ms==="TRANSITION"?"#e08888":ms==="DELIVERY_CONDITIONAL"?"#7dcb9a":"#c8923a";
          const msBg=ms==="EXPANSION"?"rgba(74,126,184,0.06)":ms==="TRANSITION"?"rgba(184,85,85,0.06)":ms==="DELIVERY_CONDITIONAL"?"rgba(74,158,106,0.06)":"rgba(200,146,58,0.05)";
          return (
            <div key={ms} style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${msCol}22`,background:msBg}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:"0.1em",color:msCol,marginBottom:8}}>{ms}</div>
              <div style={{fontSize:20,fontWeight:900,color:"rgba(232,224,208,0.9)",marginBottom:4}}>{wr.toFixed(0)}%</div>
              <div style={{fontSize:10,color:"rgba(232,224,208,0.35)",marginBottom:2}}>{w.length}W · {l.length}L · {g.length-w.length-l.length}BE</div>
              <div style={{fontSize:11,fontWeight:800,color:netRR>=0?"#7dcb9a":"#e08888"}}>{netRR>=0?"+":""}{netRR.toFixed(1)}R net</div>
            </div>
          );
        })}
      </div>

      {/* BUY vs SELL */}
      <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {(["BUY","SELL"] as const).map(side=>{
          const g=trades.filter(t=>t.tradeSide===side);
          const w=g.filter(t=>outcomeKey(t)==="win");
          const l=g.filter(t=>outcomeKey(t)==="loss");
          const wr=w.length+l.length>0?w.length/(w.length+l.length)*100:0;
          const winRRs=w.map(t=>safeRR(t)).filter((v):v is number=>v!==null);
          const netRR=winRRs.reduce((a,b)=>a+b,0)-l.length;
          const sc=side==="BUY"?"#85b0e0":"#e08888";
          const sb=side==="BUY"?"rgba(74,126,184,0.06)":"rgba(184,85,85,0.06)";
          return (
            <div key={side} style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${sc}33`,background:sb}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:"0.1em",color:sc,marginBottom:6}}>{side}</div>
              <div style={{fontSize:18,fontWeight:900,color:"rgba(232,224,208,0.9)"}}>{wr.toFixed(0)}%</div>
              <div style={{fontSize:10,color:"rgba(232,224,208,0.35)",marginTop:2}}>{w.length}W · {l.length}L</div>
              <div style={{fontSize:11,fontWeight:800,color:netRR>=0?"#7dcb9a":"#e08888",marginTop:2}}>{netRR>=0?"+":""}{netRR.toFixed(1)}R</div>
            </div>
          );
        })}
      </div>

      {/* Horario */}
      <div style={{marginTop:12}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.15em",color:"rgba(232,224,208,0.28)",marginBottom:8}}>POR HORARIO</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          {([
            ["13:xx",(t:TradeEntry)=>(t.tradeTime||"")>="13:00"&&(t.tradeTime||"")<"14:00"],
            ["14:xx",(t:TradeEntry)=>(t.tradeTime||"")>="14:00"&&(t.tradeTime||"")<"15:00"],
            ["15:xx",(t:TradeEntry)=>(t.tradeTime||"")>="15:00"],
          ] as [string,(t:TradeEntry)=>boolean][]).map(([label,fn])=>{
            const g=trades.filter(fn);
            const w=g.filter(t=>outcomeKey(t)==="win").length;
            const l=g.filter(t=>outcomeKey(t)==="loss").length;
            const wr=w+l>0?w/(w+l)*100:0;
            const col=wr>=55?"#7dcb9a":wr<=40?"#e08888":"#c8923a";
            return (
              <div key={label} style={{padding:"10px 12px",borderRadius:10,border:"1px solid rgba(180,140,80,0.1)",background:"rgba(0,0,0,0.15)",textAlign:"center"}}>
                <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.3)",marginBottom:4}}>{label}</div>
                <div style={{fontSize:16,fontWeight:900,color:col}}>{wr.toFixed(0)}%</div>
                <div style={{fontSize:10,color:"rgba(232,224,208,0.3)",marginTop:2}}>{w}W {l}L</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Día de semana */}
      <div style={{marginTop:12}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.15em",color:"rgba(232,224,208,0.28)",marginBottom:8}}>POR DÍA DE SEMANA</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {["Lunes","Martes","Miércoles","Jueves","Viernes"].map(day=>{
            const g=trades.filter(t=>weekdayEs(t.createdAt)===day);
            const w=g.filter(t=>outcomeKey(t)==="win").length;
            const l=g.filter(t=>outcomeKey(t)==="loss").length;
            const wr=w+l>0?w/(w+l)*100:0;
            const col=wr>=55?"#7dcb9a":wr<=40?"#e08888":"#c8923a";
            return (
              <div key={day} style={{padding:"8px 12px",borderRadius:10,border:"1px solid rgba(180,140,80,0.1)",background:"rgba(0,0,0,0.12)",textAlign:"center",minWidth:65}}>
                <div style={{fontSize:9,fontWeight:800,color:"rgba(232,224,208,0.3)",marginBottom:3}}>{day.slice(0,3).toUpperCase()}</div>
                <div style={{fontSize:14,fontWeight:900,color:col}}>{wr.toFixed(0)}%</div>
                <div style={{fontSize:9,color:"rgba(232,224,208,0.25)"}}>{g.length} trades</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Daily Objective ───────────────────────────────
function DailyObjective() {
  const todayKey = new Date().toISOString().slice(0,10);
  const [objective, setObjective] = useState("");
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(()=>{
    try{
      const all=JSON.parse(localStorage.getItem(LS_OBJECTIVE)||"{}");
      if(all[todayKey]){setObjective(all[todayKey]);setSaved(true);}
    }catch{}
  },[]);

  function save(){
    if(!objective.trim()) return;
    try{
      const all=JSON.parse(localStorage.getItem(LS_OBJECTIVE)||"{}");
      all[todayKey]=objective.trim();
      localStorage.setItem(LS_OBJECTIVE,JSON.stringify(all));
    }catch{}
    setSaved(true); setEditing(false);
  }

  if(saved&&!editing){
    return (
      <div style={{...card,marginBottom:12,display:"flex",alignItems:"center",gap:14,padding:"12px 18px"}}>
        <div>
          <div style={{fontSize:9,fontWeight:800,letterSpacing:"0.18em",color:"rgba(200,146,58,0.45)",marginBottom:3}}>OBJETIVO HTF HOY</div>
          <div style={{fontSize:13,fontWeight:700,color:"rgba(232,224,208,0.8)"}}>{objective}</div>
        </div>
        <button onClick={()=>setEditing(true)} style={{marginLeft:"auto",fontSize:11,color:"rgba(200,146,58,0.5)",background:"none",border:"none",cursor:"pointer",fontWeight:700}}>Editar</button>
      </div>
    );
  }

  return (
    <div style={{...card,marginBottom:12,padding:"14px 18px"}}>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:"0.18em",color:"rgba(200,146,58,0.45)",marginBottom:8}}>OBJETIVO HTF HOY</div>
      <div style={{display:"flex",gap:8}}>
        <input
          value={objective} onChange={e=>setObjective(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&save()}
          placeholder="Ej: PDL de NQ pendiente + London H de ES…"
          autoFocus={editing}
          style={{flex:1,height:34,padding:"0 12px",borderRadius:10,border:"1px solid rgba(180,140,80,0.2)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.85)",fontSize:12,fontWeight:600,outline:"none",fontFamily:"inherit"}}
        />
        <button onClick={save} style={{height:34,padding:"0 16px",borderRadius:999,border:"1px solid rgba(200,146,58,0.4)",background:"rgba(200,146,58,0.09)",color:"#c8923a",fontSize:11,fontWeight:800,cursor:"pointer"}}>Guardar</button>
      </div>
      {editing&&<button onClick={()=>setEditing(false)} style={{marginTop:6,fontSize:11,color:"rgba(232,224,208,0.3)",background:"none",border:"none",cursor:"pointer"}}>Cancelar</button>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────
export default function HistoryPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseClient>|null>(null);
  useEffect(()=>{setSupabase(getSupabaseClient());},[]);

  const [allTrades, setAllTrades] = useState<TradeEntry[]>([]);
  const [userId, setUserId] = useState<string|null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("none");

  const [fOutcome, setFOutcome] = useState<OutcomeKey>("all");
  const [fSide, setFSide] = useState<"all"|TradeSide>("all");
  const [fWeekday, setFWeekday] = useState<Weekday>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [editTrade, setEditTrade] = useState<TradeEntry|null>(null);
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

  useEffect(()=>{
    if(!supabase) return;
    let alive=true;
    try{const c=localStorage.getItem(LS_KEY);if(c)setAllTrades(JSON.parse(c));}catch{}
    (async()=>{
      try{
        const {data}=await supabase.auth.getSession();
        const uid=data.session?.user?.id;
        if(!uid) return;
        if(alive) setUserId(uid);
        const raw=await listTradesSince(uid,0,500);
        const norm=(raw as any[]).map(t=>({...t,instrument:["ES","NQ"].includes(t.instrument)?t.instrument:"ES"})).sort((a:any,b:any)=>a.createdAt-b.createdAt);
        if(!alive) return;
        setAllTrades(norm as TradeEntry[]);
        localStorage.setItem(LS_KEY,JSON.stringify(norm));
      }catch(e){console.error(e);}
    })();
    return()=>{alive=false;};
  },[supabase]);

  useEffect(()=>{setPage(1);},[fOutcome,fSide,fWeekday,from,to,q]);

  const filtered = useMemo(()=>{
    const ql=q.trim().toLowerCase();
    const fMs=from?startOfDayMs(from):null;
    const tMs=to?endOfDayMs(to):null;
    return allTrades.filter(t=>{
      if(fMs!=null&&t.createdAt<fMs) return false;
      if(tMs!=null&&t.createdAt>tMs) return false;
      if(fWeekday!=="ALL"&&weekdayEs(t.createdAt)!==fWeekday) return false;
      if(fOutcome!=="all"&&outcomeKey(t)!==fOutcome) return false;
      if(fSide!=="all"&&t.tradeSide!==fSide) return false;
      if(ql){const blob=[t.note||"",t.marketState||"",t.biasShown||"",t.instrument||"",t.setupTag||"",t.tradeSide||""].join(" ").toLowerCase();if(!blob.includes(ql)) return false;}
      return true;
    }).sort((a,b)=>b.createdAt-a.createdAt);
  },[allTrades,fOutcome,fSide,fWeekday,from,to,q]);

  const kpis = useMemo(()=>computeKPIs(filtered),[filtered]);
  const totalPages = Math.max(1,Math.ceil(filtered.length/pageSize));
  const pageSafe = Math.min(Math.max(1,page),totalPages);
  const pageItems = useMemo(()=>filtered.slice((pageSafe-1)*pageSize,pageSafe*pageSize),[filtered,pageSafe]);

  function openEdit(t:TradeEntry){
    setEditTrade(t);setEditDate(formatYMD(t.createdAt));setEditTime(t.tradeTime||"");
    setEditSide(t.tradeSide);setEditFollowed(t.followedPlan);
    setEditRR(t.rr!=null?String(t.rr):"");
    setEditOutcome(normalizeOutcome(t.outcome));setEditSetup(t.setupTag??"unknown");
    setEditNote(t.note??"");setEditInstrument(t.instrument??"NQ");
  }

  async function saveEdit(){
    if(!editTrade) return;
    setEditSaving(true);
    try{
      const ts=buildTimestamp(editDate,editTime);
      const rrV=(()=>{const n=Number(String(editRR).replace(",","."));return Number.isFinite(n)?n:null;})();
      await updateTrade(editTrade.id,{createdAt:ts,tradeTime:editTime,tradeSide:editSide,followedPlan:editFollowed,rr:rrV,outcome:editOutcome,setupTag:editSetup,note:editNote,instrument:editInstrument});
      setAllTrades(prev=>{const next=prev.map(t=>t.id!==editTrade.id?t:{...t,createdAt:ts,tradeTime:editTime,tradeSide:editSide,followedPlan:editFollowed,rr:rrV,outcome:editOutcome,setupTag:editSetup as SetupTag,note:editNote,instrument:editInstrument});localStorage.setItem(LS_KEY,JSON.stringify(next));return next;});
      setEditTrade(null);
    }catch{alert("No se pudo guardar.");}
    finally{setEditSaving(false);}
  }

  async function handleDelete(e:React.MouseEvent,t:TradeEntry){
    e.stopPropagation();
    if(!userId) return;
    if(!window.confirm(`¿Borrar?\n${formatYMD(t.createdAt)} · ${t.instrument} · ${t.tradeSide}`)) return;
    try{
      await deleteTrade(userId,t.id);
      setAllTrades(prev=>{const next=prev.filter(x=>x.id!==t.id);localStorage.setItem(LS_KEY,JSON.stringify(next));return next;});
    }catch{alert("No se pudo borrar.");}
  }

  if(!supabase) return <div style={{minHeight:"100vh",background:"#0c0a07",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(232,224,208,0.3)",fontSize:13}}>Cargando…</div>;

  return (
    <>
      <div style={{position:"fixed",inset:0,zIndex:0,backgroundImage:"url('/PM_SCALPS_BG.png')",backgroundSize:"cover",backgroundPosition:"center"}}/>
      <div style={{position:"fixed",inset:0,zIndex:1,background:"rgba(6,4,2,0.78)",backgroundImage:"radial-gradient(ellipse 100% 45% at 50% 0%, rgba(150,90,20,0.22) 0%, transparent 60%)"}}/>

      <div style={{position:"relative",zIndex:2,maxWidth:1000,margin:"0 auto",padding:"24px 20px 48px"}}>

        {/* Header */}
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"flex-end",justifyContent:"space-between",gap:12,marginBottom:20}}>
          <div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.22em",color:"rgba(200,146,58,0.45)"}}>JOURNAL</div>
            <div style={{fontSize:22,fontWeight:900,color:"rgba(232,224,208,0.9)",marginTop:2}}>History</div>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            <button onClick={()=>toCSV(allTrades,"pm-ALL.csv")} style={pill()}>Export ALL</button>
            <button onClick={()=>toCSV(filtered,"pm-filtrado.csv")} style={pill()}>Export filtrado</button>
          </div>
        </div>

        {/* Objetivo */}
        <DailyObjective/>

        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(165px,1fr))",gap:10,marginBottom:12}}>
          {[
            {label:"TOTAL TRADES",val:kpis.total,sub:`${kpis.totalWithRR} con RR`},
            {label:"WINRATE",val:`${kpis.winrate.toFixed(1)}%`,sub:`W ${kpis.winCount} · L ${kpis.lossCount} · BE ${kpis.beCount}`},
            {label:"NET RR",val:kpis.netRR.toFixed(2),sub:`Exp: ${kpis.expectancy.toFixed(2)}`,color:kpis.netRR>=0?"#7dcb9a":"#e08888"},
            {label:"AVG RR WIN",val:kpis.avgRR.toFixed(2),sub:`PF: ${kpis.profitFactor===Infinity?"∞":kpis.profitFactor.toFixed(2)}`},
          ].map(({label,val,sub,color})=>(
            <div key={label} style={card}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:"0.18em",color:"rgba(232,224,208,0.28)",marginBottom:8}}>{label}</div>
              <div style={{fontSize:24,fontWeight:900,color:color??"rgba(232,224,208,0.9)"}}>{val}</div>
              <div style={{fontSize:11,color:"rgba(232,224,208,0.35)",marginTop:4}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Toggle charts */}
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <button onClick={()=>setChartMode(chartMode==="equity"?"none":"equity")} style={pill(chartMode==="equity","amber")}>
            {chartMode==="equity"?"▲":"▼"} Curva de equity
          </button>
          <button onClick={()=>setChartMode(chartMode==="marketstate"?"none":"marketstate")} style={pill(chartMode==="marketstate","amber")}>
            {chartMode==="marketstate"?"▲":"▼"} Stats por contexto
          </button>
        </div>

        {/* Chart panel */}
        {chartMode!=="none"&&(
          <div style={{...card,marginBottom:12}}>
            {chartMode==="equity"&&<EquityCurve trades={allTrades}/>}
            {chartMode==="marketstate"&&<MarketStateStats trades={filtered}/>}
          </div>
        )}

        {/* Filtros */}
        <div style={{...card,marginBottom:12}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
            {([{v:"all",l:"Todos"},{v:"win",l:"✅ Wins"},{v:"loss",l:"❌ Losses"},{v:"be",l:"◻︎ BE"}] as {v:OutcomeKey,l:string}[]).map(({v,l})=>(
              <button key={v} onClick={()=>setFOutcome(v)} style={pill(fOutcome===v,v==="win"?"green":v==="loss"?"red":v==="be"?"amber":"default")}>{l}</button>
            ))}
            <div style={{width:1,height:20,background:"rgba(180,140,80,0.1)"}}/>
            {([{v:"all",l:"±"},{v:"BUY",l:"BUY"},{v:"SELL",l:"SELL"}] as {v:string,l:string}[]).map(({v,l})=>(
              <button key={v} onClick={()=>setFSide(v as any)} style={pill(fSide===v)}>{l}</button>
            ))}
            <div style={{width:1,height:20,background:"rgba(180,140,80,0.1)"}}/>
            <select value={fWeekday} onChange={e=>setFWeekday(e.target.value as Weekday)} style={{height:32,padding:"0 10px",borderRadius:999,cursor:"pointer",border:"1px solid rgba(180,140,80,0.12)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.4)",fontSize:11,fontWeight:700,outline:"none"}}>
              <option value="ALL">Todos los días</option>
              {["Lunes","Martes","Miércoles","Jueves","Viernes"].map(d=><option key={d} value={d}>{d}</option>)}
            </select>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,color:"rgba(232,224,208,0.28)",fontWeight:700}}>De</span>
              <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{height:32,padding:"0 10px",borderRadius:10,border:"1px solid rgba(180,140,80,0.12)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.5)",fontSize:11,outline:"none"}}/>
              <span style={{fontSize:10,color:"rgba(232,224,208,0.28)",fontWeight:700}}>a</span>
              <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{height:32,padding:"0 10px",borderRadius:10,border:"1px solid rgba(180,140,80,0.12)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.5)",fontSize:11,outline:"none"}}/>
            </div>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar…" style={{height:32,padding:"0 12px",borderRadius:999,border:"1px solid rgba(180,140,80,0.12)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.5)",fontSize:11,fontWeight:600,outline:"none",width:120}}/>
            <button onClick={()=>{setFOutcome("all");setFSide("all");setFWeekday("ALL");setFrom("");setTo("");setQ("");}} style={{...pill(),marginLeft:"auto"}}>Clear</button>
          </div>
        </div>

        {/* Lista */}
        <div style={card}>
          {isMobile?(
            <div style={{display:"grid",gap:10}}>
              {pageItems.length===0?(
                <div style={{padding:"32px 0",textAlign:"center",color:"rgba(232,224,208,0.3)",fontSize:13}}>No hay trades con esos filtros.</div>
              ):pageItems.map((t,idx)=>{
                const ok=outcomeKey(t);
                const gi=(pageSafe-1)*pageSize+idx+1;
                return (
                  <div key={t.id} onClick={()=>router.push(`/journal/history/${t.id}`)}
                    style={{position:"relative",padding:"14px 16px",borderRadius:14,cursor:"pointer",border:`1px solid ${obdr(ok)}`,background:ob(ok)}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                      <span style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.35)"}}>#{gi} · {formatYMD(t.createdAt)} · {t.tradeTime||"—"}</span>
                      <span style={{fontSize:13,fontWeight:900,color:oc(ok)}}>{ok==="win"?"✅":ok==="loss"?"❌":ok==="be"?"◻︎":"—"}</span>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      <Tag color={t.tradeSide==="BUY"?"#85b0e0":"#e08888"} border={t.tradeSide==="BUY"?"rgba(74,126,184,0.35)":"rgba(184,85,85,0.35)"} bg={t.tradeSide==="BUY"?"rgba(74,126,184,0.12)":"rgba(184,85,85,0.12)"}>{t.tradeSide}</Tag>
                      <Tag>{t.instrument}</Tag>
                      {t.rr!=null&&<Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{t.rr.toFixed(2)}R</Tag>}
                      {t.setupTag&&t.setupTag!=="unknown"&&<Tag>{t.setupTag==="A"?"Setup A":t.setupTag==="B"?"Setup B":t.setupTag}</Tag>}
                    </div>
                    {t.note?.trim()&&<div style={{marginTop:8,fontSize:11,color:"rgba(232,224,208,0.35)",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical" as any}}>{t.note.trim()}</div>}
                    <div style={{position:"absolute",top:10,right:10,display:"flex",gap:4}}>
                      <button onClick={e=>{e.stopPropagation();openEdit(t);}} style={{width:28,height:28,borderRadius:999,border:"1px solid rgba(180,140,80,0.15)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.4)",fontSize:11,cursor:"pointer"}}>✎</button>
                      <button onClick={e=>handleDelete(e,t)} style={{width:28,height:28,borderRadius:999,border:"1px solid rgba(184,85,85,0.2)",background:"rgba(184,85,85,0.06)",color:"rgba(224,136,136,0.5)",fontSize:11,cursor:"pointer"}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ):(
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{borderBottom:"1px solid rgba(180,140,80,0.1)"}}>
                    {["#","FECHA","DÍA","HORA","INSTR","DIR","RESULTADO","RR","PLAN","SETUP","BIAS",""].map(h=>(
                      <th key={h} style={{padding:"10px 12px 10px 0",textAlign:"left",fontSize:9,fontWeight:800,letterSpacing:"0.15em",color:"rgba(232,224,208,0.28)",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length===0?(
                    <tr><td colSpan={12} style={{padding:"32px 0",textAlign:"center",color:"rgba(232,224,208,0.3)",fontSize:13}}>No hay trades con esos filtros.</td></tr>
                  ):pageItems.map((t,idx)=>{
                    const ok=outcomeKey(t);
                    const gi=(pageSafe-1)*pageSize+idx+1;
                    return (
                      <tr key={t.id} onClick={()=>router.push(`/journal/history/${t.id}`)}
                        style={{borderBottom:"1px solid rgba(180,140,80,0.07)",cursor:"pointer",transition:"background 0.1s"}}
                        onMouseEnter={e=>(e.currentTarget.style.background="rgba(200,146,58,0.04)")}
                        onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                        <td style={{padding:"12px 12px 12px 0",fontSize:12}}>
                          <Link href={`/journal/history/${t.id}`} onClick={e=>e.stopPropagation()} style={{color:"rgba(200,146,58,0.6)",fontWeight:800,textDecoration:"none"}}>{gi}</Link>
                        </td>
                        <td style={{padding:"12px 12px 12px 0",fontSize:12,color:"rgba(232,224,208,0.6)",whiteSpace:"nowrap"}}>{formatYMD(t.createdAt)}</td>
                        <td style={{padding:"12px 12px 12px 0",fontSize:12,color:"rgba(232,224,208,0.4)"}}>{weekdayLabel(t.createdAt)}</td>
                        <td style={{padding:"12px 12px 12px 0",fontSize:12,color:"rgba(232,224,208,0.5)"}}>{t.tradeTime||"—"}</td>
                        <td style={{padding:"12px 12px 12px 0",fontSize:12,fontWeight:800,color:"rgba(232,224,208,0.7)"}}>{t.instrument}</td>
                        <td style={{padding:"12px 12px 12px 0"}}>
                          <Tag color={t.tradeSide==="BUY"?"#85b0e0":"#e08888"} border={t.tradeSide==="BUY"?"rgba(74,126,184,0.35)":"rgba(184,85,85,0.35)"} bg={t.tradeSide==="BUY"?"rgba(74,126,184,0.1)":"rgba(184,85,85,0.1)"}>{t.tradeSide}</Tag>
                        </td>
                        <td style={{padding:"12px 12px 12px 0"}}>
                          <Tag color={oc(ok)} border={obdr(ok)} bg={ob(ok)}>{ok==="win"?"✅ Win":ok==="loss"?"❌ Loss":ok==="be"?"◻︎ BE":"—"}</Tag>
                        </td>
                        <td style={{padding:"12px 12px 12px 0"}}>
                          {t.rr!=null?<Tag color="#7dcb9a" border="rgba(74,158,106,0.3)" bg="rgba(74,158,106,0.08)">{t.rr.toFixed(2)}R</Tag>:<span style={{color:"rgba(232,224,208,0.25)",fontSize:12}}>—</span>}
                        </td>
                        <td style={{padding:"12px 12px 12px 0"}}>
                          <Tag color={t.followedPlan==="yes"?"#7dcb9a":"#e08888"} border={t.followedPlan==="yes"?"rgba(74,158,106,0.3)":"rgba(184,85,85,0.3)"} bg={t.followedPlan==="yes"?"rgba(74,158,106,0.08)":"rgba(184,85,85,0.08)"}>{t.followedPlan==="yes"?"Sí":"No"}</Tag>
                        </td>
                        <td style={{padding:"12px 12px 12px 0"}}>
                          {t.setupTag&&t.setupTag!=="unknown"?<Tag>{t.setupTag==="A"?"Setup A":t.setupTag==="B"?"Setup B":t.setupTag}</Tag>:<span style={{color:"rgba(232,224,208,0.2)",fontSize:12}}>—</span>}
                        </td>
                        <td style={{padding:"12px 12px 12px 0"}}>
                          <Tag color={t.biasShown==="LONG"?"#7dcb9a":t.biasShown==="SHORT"?"#e08888":"rgba(232,224,208,0.4)"}>{t.biasShown}</Tag>
                        </td>
                        <td style={{padding:"12px 0",textAlign:"right"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
                            <button onClick={e=>{e.stopPropagation();openEdit(t);}} style={{width:28,height:28,borderRadius:999,border:"1px solid rgba(180,140,80,0.15)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.4)",fontSize:11,cursor:"pointer"}}>✎</button>
                            <button onClick={e=>handleDelete(e,t)} style={{width:28,height:28,borderRadius:999,border:"1px solid rgba(184,85,85,0.2)",background:"rgba(184,85,85,0.06)",color:"rgba(224,136,136,0.5)",fontSize:11,cursor:"pointer"}}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{marginTop:16,display:"flex",alignItems:"center",gap:10}}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={pageSafe<=1} style={{...pill(),opacity:pageSafe<=1?0.3:1}}>← Prev</button>
            <span style={{fontSize:12,color:"rgba(232,224,208,0.35)",fontWeight:600}}>{pageSafe} / {totalPages} <span style={{color:"rgba(232,224,208,0.2)"}}>({filtered.length} trades)</span></span>
            <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={pageSafe>=totalPages} style={{...pill(),opacity:pageSafe>=totalPages?0.3:1}}>Next →</button>
          </div>
        </div>
      </div>

      {/* Modal edición */}
      {editTrade&&(
        <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(4,3,1,0.88)",backdropFilter:"blur(12px)",padding:20}}>
          <div style={{...card,width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontSize:14,fontWeight:900,color:"rgba(232,224,208,0.88)",marginBottom:4}}>Editar trade</div>
            <div style={{fontSize:10,color:"rgba(232,224,208,0.25)",marginBottom:20}}>{editTrade.id.slice(0,8)}…</div>
            <div style={{display:"grid",gap:14}}>
              <div>
                <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>FECHA</div>
                <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)} style={{height:36,padding:"0 12px",borderRadius:10,border:"1px solid rgba(180,140,80,0.18)",background:"rgba(0,0,0,0.35)",color:"rgba(232,224,208,0.9)",fontSize:13,fontWeight:600,outline:"none",width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>HORA</div>
                <input value={editTime} onChange={e=>setEditTime(e.target.value)} placeholder="HH:MM" style={{height:36,padding:"0 12px",borderRadius:10,border:`1px solid ${editTime&&!isValidHHMM(editTime)?"rgba(184,85,85,0.5)":"rgba(180,140,80,0.18)"}`,background:"rgba(0,0,0,0.35)",color:"rgba(232,224,208,0.9)",fontSize:13,fontWeight:600,outline:"none",width:100}}/>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:14}}>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>INSTRUMENTO</div>
                  <div style={{display:"flex",gap:6}}>
                    {(["NQ","ES"] as Instrument[]).map(ins=>(<button key={ins} onClick={()=>setEditInstrument(ins)} style={pill(editInstrument===ins)}>{ins}</button>))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>DIRECCIÓN</div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>setEditSide("BUY")} style={pill(editSide==="BUY")}>BUY</button>
                    <button onClick={()=>setEditSide("SELL")} style={pill(editSide==="SELL")}>SELL</button>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:14}}>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>RESULTADO</div>
                  <select value={editOutcome} onChange={e=>setEditOutcome(e.target.value as OutcomeDb)} style={{height:36,padding:"0 10px",borderRadius:10,border:"1px solid rgba(180,140,80,0.18)",background:"rgba(0,0,0,0.4)",color:"rgba(232,224,208,0.8)",fontSize:12,fontWeight:700,outline:"none"}}>
                    <option value="unknown">—</option><option value="win">Win</option><option value="loss">Loss</option><option value="be">BE</option>
                  </select>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>RR</div>
                  <input value={editRR} onChange={e=>setEditRR(e.target.value)} placeholder="2.5" style={{height:36,padding:"0 12px",borderRadius:10,border:"1px solid rgba(180,140,80,0.18)",background:"rgba(0,0,0,0.35)",color:"rgba(232,224,208,0.9)",fontSize:13,fontWeight:600,outline:"none",width:80}}/>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>SETUP</div>
                  <select value={editSetup} onChange={e=>setEditSetup(e.target.value)} style={{height:36,padding:"0 10px",borderRadius:10,border:"1px solid rgba(180,140,80,0.18)",background:"rgba(0,0,0,0.4)",color:"rgba(232,224,208,0.8)",fontSize:12,fontWeight:700,outline:"none"}}>
                    <option value="unknown">—</option><option value="A">Setup A</option><option value="B">Setup B</option><option value="none">Sin setup</option>
                  </select>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>PLAN</div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setEditFollowed("yes")} style={pill(editFollowed==="yes","green")}>Cumplí ✓</button>
                  <button onClick={()=>setEditFollowed("no")} style={pill(editFollowed==="no","red")}>No cumplí ✗</button>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:800,color:"rgba(232,224,208,0.28)",marginBottom:6,letterSpacing:"0.15em"}}>NOTA</div>
                <textarea value={editNote} onChange={e=>setEditNote(e.target.value)} rows={4} style={{width:"100%",padding:"12px",borderRadius:10,border:"1px solid rgba(180,140,80,0.15)",background:"rgba(0,0,0,0.3)",color:"rgba(232,224,208,0.85)",fontSize:13,fontWeight:500,outline:"none",resize:"vertical",lineHeight:1.7,fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
            </div>
            <div style={{marginTop:20,display:"flex",gap:8}}>
              <button onClick={saveEdit} disabled={editSaving} style={{flex:1,height:40,borderRadius:999,cursor:"pointer",border:"1px solid rgba(200,146,58,0.38)",background:"rgba(200,146,58,0.09)",color:"#c8923a",fontSize:12,fontWeight:800,opacity:editSaving?0.5:1}}>{editSaving?"Guardando…":"Guardar cambios"}</button>
              <button onClick={()=>setEditTrade(null)} style={{height:40,padding:"0 18px",borderRadius:999,cursor:"pointer",border:"1px solid rgba(180,140,80,0.12)",background:"transparent",color:"rgba(232,224,208,0.35)",fontSize:12,fontWeight:700}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}