import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import './FirestoreCapacityDock.css';

type UsageMetric={used:number;limit:number;remaining:number;percent:number};
type FirestoreUsage={
  generatedAt:string;metricTimestamp?:string;monitoringAvailable:boolean;monitoringMode?:'cloud-monitoring'|'firestore-ledger-fallback';monitoringError?:string|null;monitoringNotice?:string|null;monitoringDiagnostic?:string|null;projectId:string;databaseId:string;quotaTimezone:string;quotaDayStart?:string;
  storage:UsageMetric&{usedGiB:number;limitGiB:number;remainingGiB:number;growthBytesPerDay?:number|null;projectedDaysRemaining?:number|null};
  reads:UsageMetric;writes:UsageMetric;deletes:UsageMetric;
  outbound:{limitBytes:number;limitGiB:number;usedBytes?:number|null;note:string};
  signalPipeline:{totalEvents:number;mt5Events:number;totalSignals:number;mt5Signals:number;estimatedWritesPerAcceptedEvent:number;remainingAcceptedEventsAtCurrentWriteHeadroom:number|null};
  notes:string[];
};

const fmt=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:1}):'—';
const pct=(value:number)=>`${Math.max(0,Math.min(999,Math.round(value||0)))}%`;
const tone=(percent:number)=>percent>=100?'danger':percent>=85?'critical':percent>=70?'warn':'ok';
const time=(value?:string)=>value?new Date(value).toLocaleString():'—';

async function getUsage():Promise<FirestoreUsage>{
  const response=await fetch('/api/tradingview/firestore-usage',{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
  const body=await response.text();
  if(!response.ok)throw new Error(`Firestore telemetry unavailable (${response.status})`);
  return JSON.parse(body) as FirestoreUsage;
}

function Gauge({label,metric,detail}:{label:string;metric:UsageMetric;detail:string}){
  const state=tone(metric.percent);
  return <div className={`fs-cap-gauge ${state}`}><div><span>{label}</span><strong>{pct(metric.percent)}</strong></div><i><b style={{width:`${Math.min(100,Math.max(0,metric.percent))}%`}}/></i><div><small>{fmt(metric.used)} used</small><small>{fmt(metric.remaining)} remaining</small></div><p>{detail}</p></div>;
}

export function FirestoreCapacityDock(){
  const [open,setOpen]=useState(false),[usage,setUsage]=useState<FirestoreUsage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const load=async()=>{try{setUsage(await getUsage());setError('');}catch(err){setError(err instanceof Error?err.message:'Usage telemetry unavailable');}finally{setLoading(false);}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),300_000);const focus=()=>void load();window.addEventListener('focus',focus);return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
  const maxPercent=useMemo(()=>usage?.monitoringAvailable?Math.max(usage.storage.percent,usage.reads.percent,usage.writes.percent,usage.deletes.percent):0,[usage]);
  const state=usage?.monitoringAvailable?tone(maxPercent):'ok';
  return <div className={`fs-cap-dock ${open?'open':''} ${state}`}>
    <button className="fs-cap-toggle" onClick={()=>setOpen(v=>!v)} title="Firestore capacity and signal ledger"><span className="fs-cap-dot"></span><div><strong>FIRESTORE</strong><small>{loading?'SYNCING':usage?(usage.monitoringAvailable?`${pct(maxPercent)} peak quota`:'LEDGER LIVE'):'MONITOR'}</small></div><b>{open?'×':'DB'}</b></button>
    {open&&<div className="fs-cap-panel"><div className="fs-cap-head"><div><span>GOOGLE CLOUD · DEFAULT DATABASE</span><h3>Capacity & Signal Ledger</h3></div><button onClick={()=>void load()}>REFRESH</button></div>
      {error&&<div className="fs-cap-error">{error}</div>}
      {!usage?<div className="fs-cap-loading">Reading Firestore telemetry…</div>:<>
        {usage.monitoringAvailable?<>
          <div className="fs-cap-storage"><div><span>Data + index storage</span><strong>{usage.storage.usedGiB.toFixed(3)} <small>/ {usage.storage.limitGiB} GiB</small></strong></div><div className={`fs-cap-ring ${tone(usage.storage.percent)}`} style={{'--p':`${Math.min(100,usage.storage.percent)}%`} as CSSProperties}><b>{pct(usage.storage.percent)}</b></div></div>
          <div className="fs-cap-storage-foot"><span>{usage.storage.remainingGiB.toFixed(3)} GiB free</span><span>{usage.storage.projectedDaysRemaining==null?'No positive 7-day storage trend':`≈ ${fmt(usage.storage.projectedDaysRemaining)} days at recent growth`}</span></div>
          <div className="fs-cap-grid">
            <Gauge label="Reads today" metric={usage.reads} detail="50,000/day free quota"/>
            <Gauge label="Writes today" metric={usage.writes} detail="20,000/day free quota"/>
            <Gauge label="Deletes today" metric={usage.deletes} detail="20,000/day free quota"/>
          </div>
        </>:<div className="fs-cap-warning"><strong>Internal Firestore telemetry active</strong><span>{usage.monitoringNotice||'Project-wide quota gauges are unavailable, but the FXGA signal ledger remains live and no raw Google IAM error is exposed to the dashboard.'}</span></div>}
        <div className="fs-cap-signal"><div><span>FXGA lifecycle events</span><strong>{fmt(usage.signalPipeline.totalEvents)}</strong><small>{fmt(usage.signalPipeline.mt5Events)} from MT5</small></div><div><span>Signal setups</span><strong>{fmt(usage.signalPipeline.totalSignals)}</strong><small>{fmt(usage.signalPipeline.mt5Signals)} from MT5</small></div><div><span>Write headroom model</span><strong>{fmt(usage.signalPipeline.remainingAcceptedEventsAtCurrentWriteHeadroom)}</strong><small>{usage.monitoringAvailable?'more 4-write events at measured quota headroom':'available when Cloud Monitoring metrics are readable'}</small></div></div>
        <div className="fs-cap-meta"><span>Mode: {usage.monitoringAvailable?'Cloud Monitoring + Firestore ledger':'Firestore ledger fallback'}</span><span>{usage.monitoringAvailable?`Metric sample: ${time(usage.metricTimestamp)}`:`Ledger sample: ${time(usage.generatedAt)}`}</span><span>10 GiB/month outbound free</span></div>
        <p className="fs-cap-note">Signal lifecycle counts come directly from Firestore. Project-wide storage/read/write gauges are displayed only when Google Cloud Monitoring provides verified metrics.</p>
      </>}
    </div>}
  </div>;
}
