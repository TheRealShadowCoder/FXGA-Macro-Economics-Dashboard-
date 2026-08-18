import './DecisionMemoryPanel.css';

type HorizonStats={count:number;correct:number;wrong:number;flat:number;hitRate:number|null;nonLossRate:number|null;averageSignedBps:number|null;brier:number|null};
type MemorySummary={generatedAt:string;sampledDecisions:number;directionalRecorded:number;waitRecorded:number;pending:number;noVerifiedBaseline:number;horizons:Record<string,HorizonStats>;bySymbol:Record<string,{horizons:Record<string,HorizonStats>}>;byConfidence:Record<string,{horizons:Record<string,HorizonStats>}>;methodology:string};

const label:Record<string,string>={m15:'+15m',h1:'+1h',h4:'+4h',h24:'+24h'};
const pct=(v:number|null)=>v==null?'—':`${Math.round(v)}%`;
const num=(v:number|null,digits=2)=>v==null?'—':Number(v).toFixed(digits);
const hitClass=(v:number|null)=>v==null?'neutral':v>=55?'positive':v>=45?'neutral':'negative';
const brierClass=(v:number|null)=>v==null?'neutral':v<=.20?'positive':v<=.30?'neutral':'negative';

export function DecisionMemoryPanel({data}:{data?:MemorySummary|null}){
  if(!data)return null;
  const horizonRows=Object.entries(data.horizons||{});
  const symbols=Object.entries(data.bySymbol||{}).map(([symbol,value])=>{
    const rows=Object.values(value.horizons||{}).filter(x=>Number(x.count||0)>0);
    const count=rows.reduce((s,x)=>s+x.count,0),hit=count?rows.reduce((s,x)=>s+Number(x.hitRate||0)*x.count,0)/count:null,brier=count?rows.reduce((s,x)=>s+Number(x.brier||0)*x.count,0)/count:null;
    return {symbol,count,hit,brier};
  }).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,10);
  return <>
    <section className="section-head decision-memory-head"><div><span className="eyebrow">Decision Calibration Memory</span><h2>What happened after previous governed decisions</h2><p>Directional calls are frozen with their real baseline price and scored only against persisted market observations near fixed horizons. The engine uses sufficient historical calibration to shrink confidence or veto a repeatedly weak pair model.</p></div></section>
    <section className="decision-memory-summary">
      <article className="panel"><span>Recorded</span><strong>{data.sampledDecisions}</strong><small>{data.directionalRecorded} directional · {data.waitRecorded} WAIT</small></article>
      <article className="panel"><span>Pending evaluation</span><strong>{data.pending}</strong><small>Waiting for real horizon observations</small></article>
      <article className="panel"><span>No verified baseline</span><strong>{data.noVerifiedBaseline}</strong><small>Excluded from performance scoring</small></article>
      <article className="panel"><span>Evaluated horizons</span><strong>{horizonRows.reduce((s,[,x])=>s+Number(x.count||0),0)}</strong><small>Real outcomes only</small></article>
    </section>
    <section className="decision-memory-grid">
      <article className="panel memory-horizons"><div className="panel-title"><div><span className="eyebrow">Calibration by horizon</span><h2>Hit rate and probability quality</h2></div></div><div className="memory-table">{horizonRows.map(([id,row])=><div key={id}><strong>{label[id]||id}</strong><span>{row.count} samples</span><span className={hitClass(row.hitRate)}>Hit {pct(row.hitRate)}</span><span className={brierClass(row.brier)}>Brier {num(row.brier,3)}</span><span>{row.averageSignedBps==null?'—':`${row.averageSignedBps>0?'+':''}${num(row.averageSignedBps,1)} bps`}</span></div>)}</div></article>
      <article className="panel memory-symbols"><div className="panel-title"><div><span className="eyebrow">Pair calibration</span><h2>Where the engine is learning</h2></div></div>{symbols.length?<div className="memory-table">{symbols.map(row=><div key={row.symbol}><strong>{row.symbol}</strong><span>{row.count} horizons</span><span className={hitClass(row.hit)}>Hit {pct(row.hit)}</span><span className={brierClass(row.brier)}>Brier {num(row.brier,3)}</span></div>)}</div>:<p className="memory-empty">Decision memory is active. Pair-level performance appears after enough real post-decision market observations have accumulated.</p>}</article>
    </section>
  </>;
}
