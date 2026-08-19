import { useEffect,useMemo,useState,type CSSProperties } from 'react';
import { fetchMT5CacheStatus,MT5_FX_PAIRS,type MT5CacheStatus } from '../lib/mt5-price-cache';
import './MT5PriceCacheDock.css';

const MB=1_000_000;
const fmt=(value:number,digits=1)=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:digits}):'—';
const mb=(value:number)=>`${(Number(value||0)/MB).toFixed(2)} MB`;
const pct=(value:number)=>`${Math.max(0,Math.min(999,Number(value||0))).toFixed(value<10?2:1)}%`;
const age=(value?:string|null)=>{if(!value)return 'waiting';const ms=Date.now()-Date.parse(value);if(ms<60_000)return `${Math.max(0,Math.floor(ms/1000))}s ago`;if(ms<3_600_000)return `${Math.floor(ms/60_000)}m ago`;if(ms<86_400_000)return `${Math.floor(ms/3_600_000)}h ago`;return `${Math.floor(ms/86_400_000)}d ago`;};
const date=(ms?:number|null)=>ms?new Date(ms).toLocaleString():'—';
const tone=(value:number)=>value>=95?'danger':value>=85?'critical':value>=70?'warn':'ok';

export function MT5PriceCacheDock(){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<MT5CacheStatus|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=async()=>{try{setStatus(await fetchMT5CacheStatus());setError('');}catch(err){setError(err instanceof Error?err.message:'MT5 price cache unavailable');}finally{setLoading(false);}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60_000);const focus=()=>void load();window.addEventListener('focus',focus);return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
  const utilization=useMemo(()=>status?Number(status.totalCompressedBytes||0)/Math.max(1,status.cacheEnvelopeBytes)*100:0,[status]);
  const compression=useMemo(()=>status&&status.totalRawBytes>0?status.totalCompressedBytes/status.totalRawBytes:0,[status]);
  const state=tone(utilization);
  return <div className={`mt5-cache-dock ${open?'open':''} ${state}`}>
    <button className="mt5-cache-toggle" onClick={()=>setOpen(v=>!v)} title="MT5 rolling FX price cache"><span className="mt5-cache-pulse"></span><div><strong>MT5 PRICE CACHE</strong><small>{loading?'SYNCING':status?`${pct(utilization)} · ${fmt(status.totalBars,0)} bars`:'OFFLINE'}</small></div><b>{open?'×':'FX'}</b></button>
    {open&&<div className="mt5-cache-panel"><div className="mt5-cache-head"><div><span>METATRADER 5 · FOUR-PAIR ROLLING DATABASE</span><h3>200 MB Price Cache Governor</h3></div><button onClick={()=>void load()}>REFRESH</button></div>
      {error&&<div className="mt5-cache-error">{error}</div>}
      {!status?<div className="mt5-cache-loading">Waiting for MT5 price-cache state…</div>:<>
        <div className="mt5-cache-hero"><div><span>Compressed payload</span><strong>{mb(status.totalCompressedBytes)} <small>/ 200.00 MB envelope</small></strong><p>Hard payload ceiling {mb(status.payloadHardBytes)} · FIFO trims toward {mb(status.evictTargetBytes)} before the envelope is threatened.</p></div><div className={`mt5-cache-ring ${state}`} style={{'--p':`${Math.min(100,utilization)}%`} as CSSProperties}><b>{pct(utilization)}</b><small>USED</small></div></div>
        <div className="mt5-cache-kpis"><div><span>Raw OHLCV equivalent</span><strong>{mb(status.totalRawBytes)}</strong><small>{compression?`${(compression*100).toFixed(1)}% stored after gzip`:'awaiting data'}</small></div><div><span>Bars retained</span><strong>{fmt(status.totalBars,0)}</strong><small>{fmt(status.totalChunks,0)} UTC-day chunks</small></div><div><span>FIFO evictions</span><strong>{fmt(status.evictedChunks||0,0)}</strong><small>{fmt(status.evictedBars||0,0)} bars retired</small></div><div><span>Last ingest</span><strong>{age(status.lastIngestAt)}</strong><small>{status.baseTimeframe} source · HTF derived</small></div></div>
        <div className="mt5-cache-policy"><span><b>INGEST</b> M1 OHLCV from terminal</span><span><b>DEDUPE</b> candle open time</span><span><b>COMPRESS</b> gzip level 9</span><span><b>EVICT</b> global oldest-first</span></div>
        <div className="mt5-cache-series">{MT5_FX_PAIRS.map(pair=>{const row=status.series?.[`${pair}_M1`];const fresh=row?.lastIngestAt&&Date.now()-Date.parse(row.lastIngestAt)<15*60_000;return <div key={pair} className={fresh?'fresh':row?'stale':'waiting'}><div><strong>{pair}</strong><span>{row?.brokerSymbol||'awaiting MT5'}</span></div><b>{row?fmt(row.bars,0):'—'} <small>bars</small></b><p><span>{row?`${fmt(row.chunks,0)} chunks · newest ${age(row.lastIngestAt)}`:'No cache yet'}</span><span>{row?`${date(row.oldestMs)} → ${date(row.newestMs)}`:'Attach CloudBridge v9.3+'}</span></p></div>;})}</div>
        <div className="mt5-cache-foot"><span>M1 stored once</span><span>M5 · M15 · M30 · H1 · H4 · D1 derived on request</span><span>Automatic FIFO never intentionally writes beyond the protected payload ceiling</span></div>
      </>}
    </div>}
  </div>;
}
