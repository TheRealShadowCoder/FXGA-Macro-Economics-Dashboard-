import { useEffect,useMemo,useState,type CSSProperties } from 'react';
import { fetchMT5CacheStatus,MT5_FX_PAIRS,type MT5CacheStatus,type MT5SeriesStatus,type MT5CacheManagement,type MT5DatabaseHealth } from '../lib/mt5-price-cache';
import './MT5PriceCacheDock.css';

const MB=1_000_000;
const fmt=(value:number|null|undefined,digits=1)=>value!=null&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:digits}):'—';
const mb=(value:number|null|undefined)=>`${(Number(value||0)/MB).toFixed(2)} MB`;
const pct=(value:number|null|undefined)=>`${Math.max(0,Math.min(999,Number(value||0))).toFixed(Number(value||0)<10?2:1)}%`;
const ageMs=(ms:number|null|undefined)=>{if(ms==null)return '—';if(ms<60_000)return `${Math.max(0,Math.round(ms/1000))}s`;if(ms<3_600_000)return `${Math.round(ms/60_000)}m`;if(ms<86_400_000)return `${(ms/3_600_000).toFixed(1)}h`;return `${(ms/86_400_000).toFixed(1)}d`;};
const age=(value?:string|null)=>{if(!value)return 'waiting';const ms=Date.now()-Date.parse(value);return `${ageMs(Math.max(0,ms))} ago`;};
const date=(ms?:number|null)=>ms?new Date(ms).toLocaleString():'—';
const tone=(value:number)=>value>=95?'danger':value>=85?'critical':value>=70?'warn':'ok';
const healthTone=(health?:string)=>health==='EXCELLENT'||health==='MARKET_CLOSED'?'excellent':health==='GOOD'?'good':health==='DEGRADED'?'warn':health==='STALE'?'danger':'waiting';
const price=(row?:MT5SeriesStatus)=>row?.latestClose==null?'—':row.latestClose.toLocaleString(undefined,{minimumFractionDigits:row.symbol.includes('JPY')?3:5,maximumFractionDigits:row.symbol.includes('JPY')?3:5});
const EMPTY_HEALTH:MT5DatabaseHealth={state:'WAITING',pairsOnline:0,pairsHealthy:0,pairsExpected:4,integrityIssues:0};
const EMPTY_MANAGEMENT:MT5CacheManagement={governorState:'ARMED',evictionArmed:true,compressionActive:true,deduplicationActive:true,integrityMonitoring:true,nextAction:'Continue rolling ingestion'};

function IntegrityStat({label,value,toneClass=''}:{label:string;value:string|number;toneClass?:string}){return <div className={toneClass}><span>{label}</span><strong>{value}</strong></div>;}

function PairCard({row,pair}:{row:MT5SeriesStatus|undefined;pair:string}){
  if(!row)return <article className="mt5-db-pair waiting"><div className="mt5-db-pair-head"><div><strong>{pair}</strong><span>Awaiting terminal history</span></div><b>WAITING</b></div><p className="mt5-db-empty">No retained M1 data yet.</p></article>;
  const batch=row.lastBatch,alerts=row.alerts||[],health=row.health||'WAITING',integrity=Number.isFinite(row.integrityScore)?Number(row.integrityScore):0;
  const storedRatio=Number(row.rawBytes||0)>0?Number(row.compressedBytes||0)/Number(row.rawBytes||0):0;
  return <article className={`mt5-db-pair ${healthTone(health)}`}>
    <div className="mt5-db-pair-head"><div><strong>{pair}</strong><span>{row.brokerSymbol||pair} · M1 canonical</span></div><b>{health.replaceAll('_',' ')}</b></div>
    <div className="mt5-db-price"><div><span>Latest MT5 close</span><strong>{price(row)}</strong><small>{row.marketOpen===false?'MARKET CLOSED':'MARKET OPEN'} · latency {ageMs(row.freshnessMs)}</small></div><div className="mt5-db-integrity-orb" style={{'--integrity':`${Math.min(100,integrity)}%`} as CSSProperties}><strong>{fmt(integrity,0)}</strong><span>INTEGRITY</span></div></div>
    <div className="mt5-db-pair-grid">
      <IntegrityStat label="Bars retained" value={fmt(row.bars,0)}/><IntegrityStat label="History" value={`${fmt(row.retainedDays,1)} days`}/><IntegrityStat label="Daily chunks" value={fmt(row.chunks,0)}/><IntegrityStat label="Last sync" value={age(row.lastIngestAt)}/>
      <IntegrityStat label="Compressed" value={mb(row.compressedBytes)}/><IntegrityStat label="Raw equivalent" value={mb(row.rawBytes)}/><IntegrityStat label="Stored ratio" value={storedRatio?`${(storedRatio*100).toFixed(1)}%`:'—'}/><IntegrityStat label="Cache share" value={pct(row.storagePercentOfCache)}/>
    </div>
    <div className="mt5-db-range"><span><small>OLDEST</small>{date(row.oldestMs)}</span><i></i><span><small>NEWEST</small>{date(row.newestMs)}</span></div>
    <div className="mt5-db-audit-head"><span>Latest ingestion audit</span><small>{batch?.at?age(batch.at):'waiting'}</small></div>
    <div className="mt5-db-audit">
      <IntegrityStat label="Received" value={fmt(batch?.receivedBars,0)}/><IntegrityStat label="New" value={fmt(batch?.acceptedBars,0)}/><IntegrityStat label="Deduped" value={fmt(batch?.deduplicatedBars,0)}/><IntegrityStat label="Rejected" value={fmt(batch?.rejectedBars,0)} toneClass={Number(batch?.rejectedBars||0)>0?'bad':''}/>
      <IntegrityStat label="Gap events" value={fmt(batch?.gapEvents,0)} toneClass={Number(batch?.gapEvents||0)>0?'warn':''}/><IntegrityStat label="Missing est." value={fmt(batch?.missingCandleEstimate,0)} toneClass={Number(batch?.missingCandleEstimate||0)>0?'warn':''}/><IntegrityStat label="Out of order" value={fmt(batch?.outOfOrderBars,0)} toneClass={Number(batch?.outOfOrderBars||0)>0?'bad':''}/><IntegrityStat label="Max gap" value={`${fmt(batch?.maxGapMinutes,0)}m`}/>
    </div>
    <div className="mt5-db-cumulative"><span>Lifetime dedupe <b>{fmt(row.deduplicatedBars,0)}</b></span><span>Lifetime missing <b>{fmt(row.missingCandleEstimate,0)}</b></span><span>Rejected OHLC <b>{fmt(row.rejectedBars,0)}</b></span><span>Retired bars <b>{fmt(row.evictedBars,0)}</b></span><span>Retired chunks <b>{fmt(row.evictedChunks,0)}</b></span><span>Broker changes <b>{fmt(row.brokerSymbolChanges,0)}</b></span></div>
    {alerts.length>0?<div className="mt5-db-alerts">{alerts.map((alert,i)=><span key={`${pair}-${i}`}>{alert}</span>)}</div>:<div className="mt5-db-clean">✓ No current integrity alarms</div>}
  </article>;
}

export function MT5PriceCacheDock(){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<MT5CacheStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=async()=>{try{setStatus(await fetchMT5CacheStatus());setError('');}catch(err){setError(err instanceof Error?err.message:'MT5 price cache unavailable');}finally{setLoading(false);}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60_000);const focus=()=>void load();window.addEventListener('focus',focus);return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
  const utilization=useMemo(()=>status?Number(status.totalCompressedBytes||0)/Math.max(1,status.cacheEnvelopeBytes)*100:0,[status]);
  const compression=useMemo(()=>status&&status.totalRawBytes>0?status.totalCompressedBytes/status.totalRawBytes:0,[status]);
  const savings=useMemo(()=>compression?Math.max(0,(1-compression)*100):0,[compression]);
  const state=tone(utilization),dbHealth=status?.databaseHealth||EMPTY_HEALTH,management=status?.management||EMPTY_MANAGEMENT,health=dbHealth.state;
  const hardMarker=status?status.payloadHardBytes/status.cacheEnvelopeBytes*100:95,evictMarker=status?status.evictTargetBytes/status.cacheEnvelopeBytes*100:87.5;
  return <div className={`mt5-cache-dock ${open?'open':''} ${state}`}>
    <button className="mt5-cache-toggle" onClick={()=>setOpen(v=>!v)} title="MT5 rolling FX database operations"><span className={`mt5-cache-pulse ${healthTone(health)}`}></span><div><strong>MT5 PRICE DATABASE</strong><small>{loading?'SYNCING':status?`${dbHealth.pairsOnline}/4 LIVE · ${pct(utilization)}`:'OFFLINE'}</small></div><b>{open?'×':'DB'}</b></button>
    {open&&<div className="mt5-cache-panel"><div className="mt5-cache-head"><div><span>FXGA · METATRADER 5 · DATABASE OPERATIONS</span><h3>Rolling Price Data Management Console</h3><p>Four-pair M1 canonical store · HTF derived on demand · bounded FIFO retention</p></div><div className="mt5-cache-head-actions"><span className={`mt5-db-health ${healthTone(health)}`}>{health.replaceAll('_',' ')}</span><button onClick={()=>void load()}>REFRESH</button></div></div>
      {error&&<div className="mt5-cache-error">{error}</div>}
      {!status?<div className="mt5-cache-loading">Waiting for MT5 database state…</div>:<>
        <section className="mt5-cache-hero"><div><span>Compressed database payload</span><strong>{mb(status.totalCompressedBytes)} <small>/ 200.00 MB envelope</small></strong><p>{mb(status.freeEnvelopeBytes)} free in application envelope · {mb(status.freeToHardBytes)} before protected payload ceiling.</p><div className="mt5-db-governor-label"><b>{management.governorState}</b><span>{management.nextAction}</span></div></div><div className={`mt5-cache-ring ${state}`} style={{'--p':`${Math.min(100,utilization)}%`} as CSSProperties}><b>{pct(utilization)}</b><small>USED</small></div></section>
        <div className="mt5-db-capacity-rail"><div className="mt5-db-capacity-fill" style={{width:`${Math.min(100,utilization)}%`}}></div><i className="target" style={{left:`${evictMarker}%`}}><b>175 MB</b><span>TRIM TARGET</span></i><i className="hard" style={{left:`${hardMarker}%`}}><b>190 MB</b><span>HARD PAYLOAD</span></i><i className="envelope"><b>200 MB</b><span>ENVELOPE</span></i></div>
        <div className="mt5-cache-kpis upgraded"><div><span>Bars retained</span><strong>{fmt(status.totalBars,0)}</strong><small>{fmt(status.totalChunks,0)} UTC-day chunks</small></div><div><span>Raw OHLCV equivalent</span><strong>{mb(status.totalRawBytes)}</strong><small>{savings.toFixed(1)}% compression saving</small></div><div><span>FIFO retired</span><strong>{fmt(status.evictedBars||0,0)} bars</strong><small>{fmt(status.evictedChunks||0,0)} chunks · {mb(status.evictedBytes||0)}</small></div><div><span>Pair health</span><strong>{dbHealth.pairsHealthy}/{dbHealth.pairsExpected}</strong><small>{dbHealth.integrityIssues} active notices</small></div><div><span>Last ingest</span><strong>{age(status.lastIngestAt)}</strong><small>{status.baseTimeframe} source</small></div><div><span>Derived frames</span><strong>{status.derivedTimeframes?.length||0}</strong><small>{status.derivedTimeframes?.filter(x=>x!=='M1').join(' · ')}</small></div></div>
        <div className="mt5-cache-policy upgraded"><span className={management.compressionActive?'on':''}><b>COMPRESS</b> gzip level 9</span><span className={management.deduplicationActive?'on':''}><b>DEDUPE</b> timestamp-safe</span><span className={management.evictionArmed?'on':''}><b>FIFO</b> oldest-first armed</span><span className={management.integrityMonitoring?'on':''}><b>INTEGRITY</b> automatic audit</span><span className="on"><b>HTF</b> derived, not duplicated</span></div>
        <div className="mt5-db-section-head"><div><span>PAIR DATABASES</span><h4>Price, retention, storage and integrity</h4></div><small>Freshness is market-session aware</small></div>
        <div className="mt5-cache-series upgraded">{MT5_FX_PAIRS.map(pair=><PairCard key={pair} pair={pair} row={status.series?.[`${pair}_M1`]}/>)}</div>
        <div className="mt5-db-governance"><div><span>Capacity contract</span><strong>200 MB envelope</strong><p>Application payload is blocked at 190 MB if FIFO cannot create safe room. Normal eviction trims toward 175 MB.</p></div><div><span>Data-quality contract</span><strong>Reject, dedupe, diagnose</strong><p>Malformed OHLC, duplicate timestamps, ordering anomalies, continuous-session gaps, stale feeds and broker-symbol changes are surfaced.</p></div><div><span>Storage contract</span><strong>M1 once · HTF on demand</strong><p>M5/M15/M30/H1/H4/D1 are aggregated from retained M1 history instead of consuming duplicate database space.</p></div></div>
        <div className="mt5-cache-foot"><span>Google Cloud Run ingestion</span><span>Firestore compressed UTC-day chunks</span><span>Global FIFO retention governor</span><span>Automatic terminal re-sync every 300 seconds</span></div>
      </>}
    </div>}
  </div>;
}
