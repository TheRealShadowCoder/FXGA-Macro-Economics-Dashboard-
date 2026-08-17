import { useEffect, useMemo, useState } from 'react';
import type { AcquisitionCatalogPayload } from '../lib/types';
import { DataQualityPanel } from './DataQualityPanel';

type PassiveSource={id:string;name:string;category:string;region:string;status?:'live'|'error'|'stale'|'partial';note?:string};
type SourceCheck={id:string;layer:string;ok:boolean;details?:Record<string,unknown>};
type MacroQuality={requested?:number;liveFetched?:number;retainedLastKnownGood?:number;usableObservations?:number;unresolved?:number;liveCoveragePercent?:number|null;effectiveCoveragePercent?:number|null;status?:string};
type FailureDiagnostics={total?:number;retryable?:number;nonRetryable?:number;unresolved?:number;byType?:Record<string,number>;byEconomy?:Record<string,number>};
type OperationalHealth={status?:'healthy'|'degraded';criticalIssues?:string[];calendarEvents?:number;macroObservations?:number;fredRequested?:number;fredLiveFetched?:number|null;fredFailures?:number;staleMacroRetained?:number;macroQuality?:MacroQuality;failureDiagnostics?:FailureDiagnostics;officialNewsItems?:number;staleNewsRetained?:number;economyCounts?:Record<string,number>;sourceChecks?:SourceCheck[];agesMinutes?:Record<string,number|null>};

function statusFor(source:PassiveSource,health:OperationalHealth|null){
  if(!health)return source.status??'live';
  const checks=health.sourceChecks??[];
  if(source.id==='macro-primary'||source.id==='fred-google')return (health.macroObservations??0)>=100?(health.macroQuality?.status==='degraded'?'partial':'live'):'error';
  if(source.id==='calendar-primary'||source.id==='fxstreet-google')return checks.find(x=>x.id==='fxstreet')?.ok===false?'error':'live';
  if(source.id==='calendar-crosscheck'||source.id==='myfxbook-google')return checks.find(x=>x.id==='myfxbook')?.ok===false?'partial':'live';
  if(source.id==='official-publications'||source.id==='official-news-google'){const news=checks.filter(x=>x.layer==='official-news');return !news.length?'partial':news.every(x=>!x.ok)?'error':news.some(x=>!x.ok)?'partial':'live';}
  if(source.id==='decision-research'||source.id==='super-economist-google')return health.status==='degraded'?'partial':'live';
  return source.status??'live';
}

export function AcquisitionView({catalog,loading,error,liveStatus,lastLiveEvent}:{catalog:AcquisitionCatalogPayload|null;loading:boolean;error:string;liveStatus:'connecting'|'connected'|'offline';lastLiveEvent:string}){
  const [health,setHealth]=useState<OperationalHealth|null>(null),[healthError,setHealthError]=useState('');
  useEffect(()=>{let cancelled=false;const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),12000);void fetch('/api/super-economist',{headers:{Accept:'application/json','Cache-Control':'no-cache'},cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error(`Operational health ${r.status}`);return r.json();}).then((x:{operationalHealth?:OperationalHealth})=>{if(!cancelled){setHealth(x.operationalHealth??null);setHealthError('');}}).catch(e=>{if(!cancelled)setHealthError(e instanceof Error?e.message:'Operational health unavailable');}).finally(()=>window.clearTimeout(timer));return()=>{cancelled=true;window.clearTimeout(timer);controller.abort();};},[lastLiveEvent]);
  const sources=(catalog?.sources??[]) as unknown as PassiveSource[];
  const states=useMemo(()=>sources.map(source=>({...source,derivedStatus:statusFor(source,health)})),[catalog,health]);
  const live=states.filter(x=>x.derivedStatus==='live').length,failedChecks=(health?.sourceChecks??[]).filter(x=>!x.ok);
  const effectiveCoverage=health?.macroQuality?.effectiveCoveragePercent;
  if(loading&&!catalog)return <div className="loading-panel">Loading data operations…</div>;
  if(error)return <div className="alert error">{error}</div>;
  if(!catalog)return null;
  return <>
    <section className="acquisition-hero">
      <div className="panel acquisition-summary">
        <span className="eyebrow">Institutional Data Operations</span>
        <h2>Collection integrity and source coverage.</h2>
        <p>Economic data, calendars, official publications and market feeds are collected by the primary data network and delivered through authenticated live updates.</p>
        <div className="guard-grid">
          <div><strong>{health?.macroObservations??'—'}</strong><span>macro observations</span></div>
          <div><strong>{health?.calendarEvents??'—'}</strong><span>calendar events</span></div>
          <div><strong>{health?.officialNewsItems??'—'}</strong><span>official publications</span></div>
          <div><strong>{effectiveCoverage!=null?`${effectiveCoverage.toFixed(1)}%`:`${live}/${states.length}`}</strong><span>{effectiveCoverage!=null?'effective macro coverage':'source groups healthy'}</span></div>
        </div>
      </div>
      <div className="panel browser-budget-card">
        <div className="panel-title"><div><span className="eyebrow">Secure Live Data Channel</span><h2>{liveStatus==='connected'?'Connected':liveStatus}</h2></div><span className={`live-pill ${liveStatus}`}>{liveStatus}</span></div>
        <p>Changed source state is delivered through authenticated live updates and broadcast to the dashboard.</p>
        <small>{lastLiveEvent||'Waiting for the next verified data update.'}</small>
      </div>
    </section>
    {healthError&&<div className="alert warn">{healthError}</div>}
    {health?.criticalIssues?.length?<div className="alert warn">Data collection degraded: {health.criticalIssues.join(' · ')}</div>:null}
    <section className="section-head"><div><span className="eyebrow">Primary Data Sources</span><h2>Functional ingestion dependencies</h2></div><span>{live}/{states.length} healthy</span></section>
    <section className="acquisition-source-grid">{states.map(source=><article className="acquisition-source-card" key={source.id}><div className="acq-source-head"><div><span className="eyebrow">{source.region}</span><h3>{source.name}</h3></div><span className={`source-status ${source.derivedStatus}`}>{source.derivedStatus}</span></div><p>{source.category}</p>{source.note&&<small>{source.note}</small>}<div className="source-guards"><span>Collection: Primary</span><span>Application fetch: disabled</span></div></article>)}</section>
    <DataQualityPanel refreshKey={lastLiveEvent} />
    <section className="panel policy-panel">
      <span className="eyebrow">Collection Diagnostics</span>
      <div className="policy-pills"><span className={(health?.macroObservations??0)>=100?'enabled':'disabled'}>Macro {health?.macroObservations??'—'} / requested {health?.fredRequested??'—'}</span><span className={(health?.failureDiagnostics?.unresolved??health?.fredFailures??0)===0?'enabled':'disabled'}>Unresolved series {health?.failureDiagnostics?.unresolved??health?.fredFailures??'—'}</span><span className={(health?.staleMacroRetained??0)>0?'enabled':'disabled'}>Last-known-good retained {health?.staleMacroRetained??'—'}</span><span className={failedChecks.length?'disabled':'enabled'}>Failed source checks {failedChecks.length}</span>{Object.entries(health?.economyCounts??{}).map(([economy,count])=><span key={economy} className={count>=5?'enabled':'disabled'}>{economy}: {count}</span>)}</div>
      {failedChecks.length>0&&<div className="alert warn">Source failures: {failedChecks.map(x=>`${x.id} (${x.layer})`).join(' · ')}</div>}
      <span className="eyebrow">Operating Controls</span>
      <div className="policy-pills"><span className="enabled">Primary acquisition: active</span><span className="enabled">Research engine: active</span><span className="enabled">Authenticated updates: active</span><span className="disabled">Application-edge acquisition: disabled</span><span className="disabled">Application-edge browser collection: disabled</span><span className="disabled">Application-edge upstream collection: disabled</span></div>
    </section>
  </>;
}
