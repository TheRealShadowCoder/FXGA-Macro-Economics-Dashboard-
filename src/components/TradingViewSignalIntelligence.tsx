import { useEffect, useMemo, useRef, useState } from 'react';
import './TradingViewSignalIntelligence.css';

type Side='BUY'|'SELL'|'WAIT';
type SignalIntelligence={score:number;grade:string;suggestedSignal:Side;sourceSignal:Side;action:string;label:string;explanation:string;components:Record<string,number>;policy:string};
type TradePlan={side?:Side;tradeMode?:string;orderType?:string;filled?:boolean;entry:number|null;stopLoss:number|null;tp1:number|null;tp2:number|null;tp3:number|null;primaryTargetType?:string|null};
type Signal={
  id:string;symbol:string;tickerId?:string;exchange?:string;timeframe:string;side:Side;status:string;methodId?:number|null;methodCode?:string|null;methodFamily?:string|null;methodScore?:number|null;exactMatches?:number|null;signalTime?:string|null;updatedAt:string;lastEvent:string;lastReason?:string|null;lastMeaning?:string|null;marketPrice?:number|null;lastEventPrice?:number|null;eventCount?:number;
  tradePlan:TradePlan;riskReward:{riskPriceDistance?:number|null;rrTp1?:number|null;rrTp2?:number|null;rrTp3?:number|null};lifecycle:{barsSinceSignal?:number|null;entryFilled?:boolean;tp1Hit?:boolean;tp2Hit?:boolean;finalTargetHit?:boolean};
  timeframeHierarchy?:{model?:string;at_signal?:{h4_major?:string;m15_confirmation?:string;m1_execution?:string;fully_aligned?:boolean;trade_mode?:string};current?:{h4_major?:string;m15_confirmation?:string;m1_execution?:string;fully_aligned?:boolean;major_bias_changed_since_signal?:boolean}};
  smcEvidenceAtSignal?:{context?:string;liquidity_event?:string;structure_trigger?:string;pd_array?:string;confirmation?:string;primary_target?:string;logic_explanation?:string};
  currentMarketEvidence?:Record<string,unknown>;pdArray?:{selected_type?:string;zone_top?:number;zone_bottom?:number;current_price_inside_zone?:boolean};invalidation?:{structural_stop?:number;explanation?:string};intelligence:SignalIntelligence;
};
type SignalList={generatedAt:string;count:number;signals:Signal[]};
type Metrics={totalSignals?:number;buySignals?:number;sellSignals?:number;filled?:number;tp1Hits?:number;tp2Hits?:number;tp3Hits?:number;completed?:number;invalidated?:number;expired?:number;missed?:number;completionRate?:number;tp1Rate?:number;tp2Rate?:number;tp3Rate?:number;updatedAt?:string;latest?:{updatedAt?:string;lastEvent?:string;symbol?:string;side?:string;status?:string;intelligenceScore?:number}};

const fmt=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?'—':Math.abs(value)>=100?value.toLocaleString(undefined,{maximumFractionDigits:2}):value.toLocaleString(undefined,{maximumFractionDigits:5});
const pct=(value:number|null|undefined)=>`${Math.round(Number(value)||0)}%`;
const age=(date?:string|null)=>{if(!date)return '—';const ms=Date.now()-Date.parse(date);if(!Number.isFinite(ms))return '—';const mins=Math.max(0,Math.floor(ms/60000));return mins<1?'just now':mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ${mins%60}m ago`:`${Math.floor(mins/1440)}d ago`;};
const sideClass=(side?:string)=>String(side||'WAIT').toLowerCase();
const isActive=(signal:Signal)=>signal.status==='PENDING_ENTRY'||signal.status==='ACTIVE_FILLED';

async function getJson<T>(path:string):Promise<T>{const response=await fetch(path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}});const text=await response.text();if(!response.ok)throw new Error(text||`${path} failed with ${response.status}`);return JSON.parse(text) as T;}

function ScoreRing({score}:{score:number}){return <div className="tv-score-ring" style={{'--score':`${Math.max(0,Math.min(100,score))}%`} as React.CSSProperties}><div><strong>{score}</strong><span>/100</span></div></div>;}

function TradePlanVisual({signal}:{signal:Signal}){
  const levels=[['TP3',signal.tradePlan.tp3],['TP2',signal.tradePlan.tp2],['TP1',signal.tradePlan.tp1],['ENTRY',signal.tradePlan.entry],['STOP',signal.tradePlan.stopLoss]] as const;
  const numeric=levels.map(([,v])=>v).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
  const min=numeric.length?Math.min(...numeric):0,max=numeric.length?Math.max(...numeric):1,span=Math.max(max-min,Number.EPSILON);
  const current=signal.marketPrice;
  return <div className="tv-plan-visual" data-explain-key="risk reward">
    <div className="tv-plan-scale">
      {levels.map(([label,value])=>value==null?null:<div key={label} className={`tv-level ${label.toLowerCase()}`} style={{bottom:`${8+((value-min)/span)*84}%`}}><span>{label}</span><i></i><strong>{fmt(value)}</strong></div>)}
      {typeof current==='number'&&<div className="tv-current" style={{bottom:`${8+((Math.max(min,Math.min(max,current))-min)/span)*84}%`}}><b></b><span>NOW {fmt(current)}</span></div>}
    </div>
    <div className="tv-plan-facts">
      <div><span>Order</span><strong>{signal.tradePlan.orderType||'—'}</strong></div><div><span>Mode</span><strong>{signal.tradePlan.tradeMode?.replaceAll('_',' ')||'—'}</strong></div><div><span>Target</span><strong>{signal.tradePlan.primaryTargetType||'—'}</strong></div><div><span>RR to TP3</span><strong>{signal.riskReward.rrTp3?.toFixed(2)??'—'}R</strong></div>
    </div>
  </div>;
}

function Hierarchy({signal}:{signal:Signal}){
  const at=signal.timeframeHierarchy?.at_signal,cur=signal.timeframeHierarchy?.current;
  return <div className="tv-hierarchy" data-explain-key="market bias">
    {[['H4 Direction',at?.h4_major,cur?.h4_major],['M15 Confirmation',at?.m15_confirmation,cur?.m15_confirmation],['M1 Execution',at?.m1_execution,cur?.m1_execution]].map(([label,start,now])=><div key={String(label)}><span>{label}</span><strong className={sideClass(String(now))}>{String(now||'—')}</strong><small>{start===now?'unchanged':`signal: ${start||'—'}`}</small></div>)}
    <div><span>Hierarchy</span><strong className={cur?.fully_aligned?'buy':'wait'}>{cur?.fully_aligned?'ALIGNED':'MIXED'}</strong><small>{cur?.major_bias_changed_since_signal?'H4 changed':'H4 stable'}</small></div>
  </div>;
}

function SignalCard({signal,selected,onSelect}:{signal:Signal;selected:boolean;onSelect:()=>void}){
  return <button className={`tv-feed-card ${sideClass(signal.side)} ${selected?'selected':''}`} onClick={onSelect}>
    <div className="tv-feed-top"><span className={`tv-side ${sideClass(signal.side)}`}>{signal.side}</span><div><strong>{signal.symbol}</strong><small>{signal.timeframe} · {signal.methodCode||`Method ${signal.methodId??'—'}`}</small></div><time>{age(signal.updatedAt)}</time></div>
    <div className="tv-feed-bottom"><span>{signal.intelligence.label}</span><strong>{signal.intelligence.score}</strong></div>
    <div className="tv-feed-progress"><i style={{width:`${signal.intelligence.score}%`}} /></div>
  </button>;
}

export function TradingViewSignalIntelligence(){
  const [live,setLive]=useState<Signal[]>([]),[history,setHistory]=useState<Signal[]>([]),[metrics,setMetrics]=useState<Metrics>({});
  const [selectedId,setSelectedId]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[socketState,setSocketState]=useState<'connecting'|'live'|'offline'>('connecting');
  const [symbol,setSymbol]=useState('ALL'),[timeframe,setTimeframe]=useState('ALL'),[side,setSide]=useState('ALL');
  const reloadRef=useRef<number|null>(null);

  const load=async()=>{try{const [l,h,m]=await Promise.all([getJson<SignalList>('/api/tradingview/signals/live?limit=80'),getJson<SignalList>('/api/tradingview/signals?limit=160'),getJson<Metrics>('/api/tradingview/signals/metrics')]);setLive(l.signals);setHistory(h.signals);setMetrics(m);setError('');setSelectedId(current=>current||l.signals[0]?.id||h.signals[0]?.id||'');}catch(caught){setError(caught instanceof Error?caught.message:'TradingView signal feed unavailable');}finally{setLoading(false);}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),15_000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{let stopped=false,socket:WebSocket|null=null,retry:number|undefined;const connect=()=>{if(stopped)return;setSocketState('connecting');const protocol=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(`${protocol}//${location.host}/api/live`);socket.onopen=()=>setSocketState('live');socket.onmessage=event=>{try{const message=JSON.parse(String(event.data));if(message.type==='tradingview-signal'){if(reloadRef.current)window.clearTimeout(reloadRef.current);reloadRef.current=window.setTimeout(()=>void load(),250);}}catch{}};socket.onclose=()=>{if(stopped)return;setSocketState('offline');retry=window.setTimeout(connect,3000);};socket.onerror=()=>socket?.close();};connect();return()=>{stopped=true;if(retry)window.clearTimeout(retry);if(reloadRef.current)window.clearTimeout(reloadRef.current);socket?.close();};},[]);

  const all=history;
  const symbols=useMemo(()=>['ALL',...Array.from(new Set(all.map(x=>x.symbol))).sort()],[all]);
  const timeframes=useMemo(()=>['ALL',...Array.from(new Set(all.map(x=>x.timeframe))).sort()],[all]);
  const filtered=useMemo(()=>all.filter(x=>(symbol==='ALL'||x.symbol===symbol)&&(timeframe==='ALL'||x.timeframe===timeframe)&&(side==='ALL'||x.side===side)),[all,symbol,timeframe,side]);
  const selected=all.find(x=>x.id===selectedId)||live[0]||all[0]||null;
  const activeCount=live.filter(isActive).length;
  const sourceScore=selected?.methodScore??0;

  if(loading&&!all.length)return <section className="tv-shell"><div className="tv-empty"><span className="tv-pulse"></span><h2>Connecting to FXGA TradingView Signal Intelligence</h2><p>Google Cloud is opening the live SMC2000 signal ledger and WebSocket channel.</p></div></section>;

  return <section className="tv-shell">
    <div className="tv-command-bar">
      <div><span className="eyebrow">FXGA SMC2000 · fxga.smc.signal.v3</span><h2>TradingView Signal Intelligence</h2><p>Live indicator lifecycle, trade geometry and contextual signal guidance. Google Cloud processes and stores every event; Cloudflare only serves this interface.</p></div>
      <div className={`tv-live-state ${socketState}`}><span></span><strong>{socketState==='live'?'LIVE':'CONNECTING'}</strong><small>{activeCount} active setups</small></div>
    </div>
    {error&&<div className="alert error">{error}</div>}

    {!selected?<div className="tv-empty"><span className="tv-pulse"></span><h2>Awaiting the first TradingView signal</h2><p>Your indicator already emits SIGNAL_NEW and full lifecycle telemetry. Once its alert webhook points to the Google Cloud endpoint, the first setup will appear here automatically.</p><code>POST /api/tradingview/webhook</code></div>:<>
      <div className={`tv-hero ${sideClass(selected.side)}`}>
        <div className="tv-hero-main">
          <div className="tv-hero-heading"><div><span className={`tv-side large ${sideClass(selected.intelligence.suggestedSignal)}`}>{selected.intelligence.suggestedSignal}</span><span className="tv-source-signal">Indicator {selected.side}</span></div><div><h2>{selected.symbol} <em>{selected.timeframe}</em></h2><p>{selected.methodFamily||'SMC2000'} · {selected.methodCode||`Method ${selected.methodId??'—'}`}</p></div></div>
          <div className="tv-guidance"><span className="eyebrow">FXGA contextual view</span><h3>{selected.intelligence.label}</h3><p>{selected.intelligence.explanation}</p><div className="tv-state-row"><span>{selected.status.replaceAll('_',' ')}</span><span>{selected.lastEvent.replaceAll('_',' ')}</span><span>{age(selected.signalTime)}</span></div></div>
          <Hierarchy signal={selected}/>
        </div>
        <div className="tv-hero-score" data-explain-key="confidence"><ScoreRing score={selected.intelligence.score}/><div><span>Contextual quality</span><strong>{selected.intelligence.grade}</strong><small>Indicator method score {pct(sourceScore)}</small></div></div>
        <TradePlanVisual signal={selected}/>
      </div>

      <div className="tv-metrics">
        <div><span>Signals received</span><strong>{metrics.totalSignals??0}</strong><small>{metrics.buySignals??0} buy · {metrics.sellSignals??0} sell</small></div>
        <div data-explain-key="hit rate"><span>TP1 hit rate</span><strong>{metrics.tp1Rate??0}%</strong><small>{metrics.tp1Hits??0} lifecycle hits</small></div>
        <div data-explain-key="hit rate"><span>TP2 hit rate</span><strong>{metrics.tp2Rate??0}%</strong><small>{metrics.tp2Hits??0} lifecycle hits</small></div>
        <div data-explain-key="hit rate"><span>TP3 completion</span><strong>{metrics.tp3Rate??0}%</strong><small>{metrics.completed??0} completed</small></div>
        <div><span>Invalidated</span><strong>{metrics.invalidated??0}</strong><small>{metrics.expired??0} expired · {metrics.missed??0} missed</small></div>
      </div>

      <div className="tv-grid">
        <div className="tv-panel tv-feed-panel"><div className="tv-panel-head"><div><span className="eyebrow">Live stream</span><h3>Active signal feed</h3></div><span>{live.length} live</span></div><div className="tv-feed">{live.length?live.map(item=><SignalCard key={item.id} signal={item} selected={item.id===selected.id} onSelect={()=>setSelectedId(item.id)}/>):<div className="tv-mini-empty">No active setups. Completed and invalidated signals remain in history.</div>}</div></div>
        <div className="tv-panel tv-evidence-panel"><div className="tv-panel-head"><div><span className="eyebrow">Signal anatomy</span><h3>Why the indicator fired</h3></div><span>{selected.exactMatches??'—'} exact matches</span></div>
          <div className="tv-evidence-list">
            <div><span>Context</span><strong>{selected.smcEvidenceAtSignal?.context||'—'}</strong></div><div><span>Liquidity</span><strong>{selected.smcEvidenceAtSignal?.liquidity_event||'—'}</strong></div><div><span>Structure trigger</span><strong>{selected.smcEvidenceAtSignal?.structure_trigger||'—'}</strong></div><div><span>PD Array</span><strong>{selected.smcEvidenceAtSignal?.pd_array||selected.pdArray?.selected_type||'—'}</strong></div><div><span>Confirmation</span><strong>{selected.smcEvidenceAtSignal?.confirmation||'—'}</strong></div><div><span>Primary target</span><strong>{selected.smcEvidenceAtSignal?.primary_target||selected.tradePlan.primaryTargetType||'—'}</strong></div>
          </div>
          {selected.smcEvidenceAtSignal?.logic_explanation&&<p className="tv-logic">{selected.smcEvidenceAtSignal.logic_explanation}</p>}
          <div className="tv-component-bars">{Object.entries(selected.intelligence.components).map(([key,value])=><div key={key}><span>{key.replace(/([A-Z])/g,' $1')}</span><i><b style={{width:`${value}%`}}/></i><strong>{Math.round(value)}</strong></div>)}</div>
        </div>
      </div>

      <div className="tv-panel tv-history-panel"><div className="tv-panel-head"><div><span className="eyebrow">Audit trail</span><h3>Signal history</h3></div><div className="tv-filters"><select value={symbol} onChange={e=>setSymbol(e.target.value)}>{symbols.map(x=><option key={x}>{x}</option>)}</select><select value={timeframe} onChange={e=>setTimeframe(e.target.value)}>{timeframes.map(x=><option key={x}>{x}</option>)}</select><select value={side} onChange={e=>setSide(e.target.value)}><option>ALL</option><option>BUY</option><option>SELL</option></select></div></div>
        <div className="tv-table"><div className="tv-table-row head"><span>Signal</span><span>Method</span><span>Entry</span><span>SL</span><span>TP3</span><span>RR</span><span>FXGA score</span><span>Status</span><span>Updated</span></div>{filtered.map(item=><button key={item.id} className={`tv-table-row ${item.id===selected.id?'active':''}`} onClick={()=>setSelectedId(item.id)}><span><b className={sideClass(item.side)}>{item.side}</b> {item.symbol} · {item.timeframe}</span><span>{item.methodCode||item.methodId||'—'}</span><span>{fmt(item.tradePlan.entry)}</span><span>{fmt(item.tradePlan.stopLoss)}</span><span>{fmt(item.tradePlan.tp3)}</span><span>{item.riskReward.rrTp3?.toFixed(2)??'—'}R</span><span><strong>{item.intelligence.score}</strong> {item.intelligence.grade}</span><span>{item.status.replaceAll('_',' ')}</span><span>{age(item.updatedAt)}</span></button>)}</div>
      </div>

      <div className="tv-risk-note" data-explain-key="invalidation"><strong>Invalidation discipline</strong><span>{selected.invalidation?.explanation||`Structural stop ${fmt(selected.tradePlan.stopLoss)} defines where the indicator setup is no longer valid.`}</span><small>Signals are indicator-derived decision support. The dashboard tracks evidence and lifecycle state; it does not guarantee outcomes or place orders.</small></div>
    </>}
  </section>;
}
