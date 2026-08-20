import { useEffect,useMemo,useState } from 'react';
import { fetchMT5CacheStatus,fetchMT5Prices,fetchMT5SmcSnapshot,MT5_WEBSITE_ASSETS,type MT5Asset,type MT5Bar,type MT5CacheStatus,type MT5PricePayload,type MT5SeriesStatus,type MT5SmcSnapshot } from '../lib/mt5-price-cache';
import type { TechnicalAssetState,TechnicalBias,TechnicalTimeframeState } from '../lib/types';
import './MT5ExtractedDataView.css';

const TIMEFRAMES=['M1','M5','M15','M30','H1','H4','D1'] as const;
const MB=1_000_000;
const RETENTION_DAYS=60;
const fmt=(value?:number|null,digits=5)=>value==null||!Number.isFinite(value)?'—':value.toLocaleString(undefined,{maximumFractionDigits:digits});
const mb=(value?:number|null)=>`${(Number(value||0)/MB).toFixed(3)} MB`;
const time=(value?:string|null)=>value?new Date(value).toLocaleString():'—';
const timeMs=(value?:number|null)=>value?new Date(value).toLocaleString():'—';
const age=(value?:number|null)=>{if(!value)return '—';const ms=Math.max(0,Date.now()-value);if(ms<60_000)return `${Math.floor(ms/1000)}s`;if(ms<3_600_000)return `${Math.floor(ms/60_000)}m`;if(ms<86_400_000)return `${Math.floor(ms/3_600_000)}h`;return `${Math.floor(ms/86_400_000)}d`;};
const bias=(value?:TechnicalBias)=>value==='bullish'?'BULLISH':value==='bearish'?'BEARISH':'BALANCED';
const healthTone=(value?:string)=>['EXCELLENT','GOOD'].includes(String(value))?'good':value==='MARKET_CLOSED'?'closed':value==='WAITING'?'waiting':'warn';

function CandleChart({bars}:{bars:MT5Bar[]}){
  const rows=bars.slice(-120);
  if(rows.length<2)return <div className="mt5-data-empty">Waiting for enough extracted candles…</div>;
  const high=Math.max(...rows.map(row=>row[2])),low=Math.min(...rows.map(row=>row[3])),span=Math.max(high-low,Number.EPSILON),w=960,h=260,step=w/rows.length;
  const y=(price:number)=>15+((high-price)/span)*(h-35);
  return <svg className="mt5-data-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="MetaTrader extracted OHLC candles">
    {[.25,.5,.75].map(level=><line key={level} className="grid" x1="0" x2={w} y1={h*level} y2={h*level}/>) }
    {rows.map((row,index)=>{const x=index*step+step/2,up=row[4]>=row[1],top=Math.min(y(row[1]),y(row[4])),bottom=Math.max(y(row[1]),y(row[4]));return <g key={`${row[0]}-${index}`} className={up?'up':'down'}><line x1={x} x2={x} y1={y(row[2])} y2={y(row[3])}/><rect x={x-Math.max(1.1,step*.27)} y={top} width={Math.max(2.2,step*.54)} height={Math.max(1.5,bottom-top)} rx=".7"/></g>;})}
    <text x="10" y="14">H {fmt(high)}</text><text x="10" y={h-5}>L {fmt(low)}</text>
  </svg>;
}

function PairHealth({asset,row,selected,onSelect}:{asset:MT5Asset;row?:MT5SeriesStatus;selected:boolean;onSelect:()=>void}){
  const retention=row?.retentionProgressPercent??row?.bootstrapProgressPercent??0;
  return <button className={`mt5-pair-health ${selected?'selected':''} ${healthTone(row?.health)}`} onClick={onSelect}>
    <div className="mt5-pair-top"><div><strong>{asset}</strong><span>{row?.brokerSymbol||'broker symbol not found yet'}</span></div><b>{row?.health||'WAITING'}</b></div>
    <div className="mt5-pair-health-grid"><span><small>Close</small>{fmt(row?.latestClose)}</span><span><small>M1 bars</small>{Number(row?.bars||0).toLocaleString()}</span><span><small>60d fill</small>{retention.toFixed(1)}%</span><span><small>Integrity</small>{row?.integrityScore??0}%</span></div>
  </button>;
}

function SMCFrame({name,frame}:{name:string;frame?:TechnicalTimeframeState}){
  const latest=[frame?.structure?.latestBos,frame?.structure?.latestChoch].filter(Boolean).sort((a,b)=>Date.parse(a?.time||'')-Date.parse(b?.time||'')).at(-1);
  const fvg=frame?.bias==='bearish'?frame?.imbalance?.latestBearishFvg:frame?.imbalance?.latestBullishFvg;
  const sweep=frame?.bias==='bearish'?frame?.liquidity?.latestBearishSweep:frame?.liquidity?.latestBullishSweep;
  return <article className={`mt5-smc-frame ${frame?.status||'unavailable'} ${frame?.bias||'neutral'}`}>
    <header><span>{name}</span><strong>{bias(frame?.bias)}</strong><b>{frame?.confidence??0}%</b></header>
    <div><span>Canonical history</span><b>{frame?`${frame.bars}/${frame.requiredBars}`:'—'}</b></div>
    <div><span>Data quality</span><b>{frame?.quality?.grade??'unavailable'}{frame?.quality?.providerOhlc?' · MT5 OHLC':''}</b></div>
    <div><span>Structure</span><b>{latest?`${latest.type} · ${bias(latest.direction)}`:'none confirmed'}</b></div>
    <div><span>Liquidity</span><b>{sweep?'sweep observed':'no active sweep'}</b></div>
    <div><span>Imbalance</span><b>{fvg?'FVG observed':'no active FVG'}</b></div>
    <div><span>PD location</span><b>{frame?.dealingRange?.zone??'—'}</b></div>
  </article>;
}

function SMCFusion({state}:{state?:TechnicalAssetState}){
  if(!state)return <section className="panel mt5-smc-empty"><span className="eyebrow">SMC Fusion</span><h3>Waiting for derived SMC state</h3><p>The engine will populate as canonical M1 batches arrive from MetaTrader.</p></section>;
  return <section className="mt5-smc-section">
    <div className="section-head"><div><span className="eyebrow">Canonical M1 → SMC Fusion</span><h2>{state.id} multi-timeframe reconstruction</h2><p>Every structure layer below is rebuilt from retained M1 OHLCV. No higher-timeframe candle database is permanently duplicated.</p></div><div className={`mt5-decision ${state.decisionGate.status}`}><span>{state.decisionGate.status.replaceAll('-',' ')}</span><strong>{bias(state.decisionGate.direction)}</strong><b>{state.decisionGate.confidence}%</b></div></div>
    <div className="mt5-smc-grid">{['D1','H4','H1','M30','M15','M5','M1'].map(tf=><SMCFrame key={tf} name={tf} frame={state.timeframes?.[tf]}/>)}</div>
    <div className="mt5-model-grid">{Object.values(state.models||{}).map(model=><article key={model.name} className={`mt5-model ${model.status}`}><span>{model.name}</span><strong>{model.status.replaceAll('-',' ')}</strong><p>{model.reason}</p></article>)}</div>
    <div className="panel mt5-decision-reason"><span className="eyebrow">Decision gate</span><p>{state.decisionGate.reason}</p></div>
  </section>;
}

export function MT5ExtractedDataView(){
  const [asset,setAsset]=useState<MT5Asset>('EURUSD');
  const [timeframe,setTimeframe]=useState<(typeof TIMEFRAMES)[number]>('M1');
  const [status,setStatus]=useState<MT5CacheStatus|null>(null);
  const [prices,setPrices]=useState<MT5PricePayload|null>(null);
  const [smc,setSmc]=useState<MT5SmcSnapshot|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');

  useEffect(()=>{let stopped=false;const load=async()=>{try{const [s,m]=await Promise.all([fetchMT5CacheStatus(),fetchMT5SmcSnapshot()]);if(!stopped){setStatus(s);setSmc(m);setError('');}}catch(e){if(!stopped)setError(e instanceof Error?e.message:'Unable to load MT5 database state');}finally{if(!stopped)setLoading(false);}};void load();const timer=window.setInterval(()=>void load(),300_000);return()=>{stopped=true;window.clearInterval(timer);};},[]);
  useEffect(()=>{let stopped=false;setLoading(true);void fetchMT5Prices(asset,timeframe,500).then(value=>{if(!stopped){setPrices(value);setError('');}}).catch(e=>{if(!stopped)setError(e instanceof Error?e.message:'Unable to load MT5 candles');}).finally(()=>{if(!stopped)setLoading(false);});return()=>{stopped=true;};},[asset,timeframe]);

  const row=status?.series?.[`${asset}_M1`];
  const selectedSmc=smc?.assets?.[asset];
  const bars=prices?.bars||[];
  const latest=bars.at(-1),first=bars[0];
  const calculator=status?.sizeCalculator;
  const seriesRows=useMemo(()=>MT5_WEBSITE_ASSETS.map(id=>({id,row:status?.series?.[`${id}_M1`]})),[status]);
  const measured=seriesRows.filter(item=>(item.row?.bars||0)>0).length;
  const retentionProgress=row?.retentionProgressPercent??row?.bootstrapProgressPercent??0;
  const retainedDays=row?.retainedDays??0;

  return <div className="mt5-data-workspace">
    {error?<div className="alert warn">{error}</div>:null}
    <section className="panel mt5-data-hero">
      <div><span className="eyebrow">MetaTrader 5 Canonical Market Database</span><h2>Rolling 60-day M1 history · 160-bar safety overlap every 300 seconds</h2><p>The permanent hot dataset is M1 only and is retired by time-based FIFO after 60 calendar days. M5, M15, M30, H1, H4 and D1 are reconstructed deterministically whenever the website, SMC engine or economic-event research needs them.</p></div>
      <div className="mt5-data-hero-stats"><span><strong>{measured}/{MT5_WEBSITE_ASSETS.length}</strong><small>assets found on broker</small></span><span><strong>{Number(status?.totalBars||0).toLocaleString()}</strong><small>canonical M1 bars stored</small></span><span><strong>{(status?.utilizationPercent??0).toFixed(3)}%</strong><small>200 MB envelope used</small></span><span><strong>{status?.management?.governorState||'—'}</strong><small>storage governor</small></span></div>
    </section>

    <section className="mt5-size-grid">
      <article className="panel mt5-size-card"><span className="eyebrow">Exact Stored Size</span><strong>{mb(calculator?.exactStoredCompressedBytes)}</strong><p>Compressed Firestore payload</p><small>Raw JSON equivalent {mb(calculator?.exactStoredRawBytes)}</small></article>
      <article className="panel mt5-size-card"><span className="eyebrow">Measured Bytes / M1 Bar</span><strong>{calculator?.averageCompressedBytesPerBar?.toFixed(2)??'—'} B</strong><p>Average compressed</p><small>Raw {calculator?.averageRawBytesPerBar?.toFixed(2)??'—'} B/bar</small></article>
      <article className="panel mt5-size-card"><span className="eyebrow">Projected 60-day Max × All Assets</span><strong>{calculator?.projectedInitialCompressedBytesAllAssets==null?'Awaiting sample':mb(calculator.projectedInitialCompressedBytesAllAssets)}</strong><p>86,400 bars is the 24/7 ceiling per asset; session-limited markets retain fewer</p><small>{calculator?.projectedInitialCompressedPercentOf200MB?.toFixed(2)??'—'}% of the 200 MB envelope at the theoretical maximum</small></article>
      <article className="panel mt5-size-card"><span className="eyebrow">Compression Saving</span><strong>{calculator?.compressionSavingPercent?.toFixed(1)??'0'}%</strong><p>{mb(calculator?.compressionSavingBytes)} saved</p><small>{calculator?.measurement||'Actual byte measurement'}</small></article>
    </section>

    <section className="mt5-asset-strip">{seriesRows.map(item=><PairHealth key={item.id} asset={item.id} row={item.row} selected={asset===item.id} onSelect={()=>setAsset(item.id)}/>)}</section>

    <section className="panel mt5-selected-head"><div><span className="eyebrow">Extracted from MetaTrader</span><h2>{asset}</h2><p>{row?.brokerSymbol||'Broker instrument has not been resolved yet'} · rolling 60-day canonical M1 database</p></div><div className={`mt5-health-badge ${healthTone(row?.health)}`}><strong>{row?.health||'WAITING'}</strong><span>{row?.integrityScore??0}% integrity</span></div></section>

    <section className="mt5-detail-grid">
      <article className="panel"><span className="eyebrow">Retention Window</span><div className="mt5-progress"><i style={{width:`${Math.min(100,retentionProgress)}%`}}/></div><strong>{retainedDays.toFixed(2)} / {RETENTION_DAYS} calendar days</strong><p>{retentionProgress.toFixed(2)}% window coverage · {Number(row?.bars||0).toLocaleString()} M1 bars retained</p></article>
      <article className="panel"><span className="eyebrow">Per Asset Storage</span><strong>{mb(row?.compressedBytes)}</strong><p>compressed · {mb(row?.rawBytes)} raw</p><small>{row?.size?.compressedBytesPerBar?.toFixed(2)??'—'} B compressed / bar</small></article>
      <article className="panel"><span className="eyebrow">Data Window</span><strong>{retainedDays.toFixed(2)} days</strong><p>{timeMs(row?.oldestMs)} → {timeMs(row?.newestMs)}</p><small>Newest candle age {age(row?.newestMs)} · FIFO target {row?.retentionDays??RETENTION_DAYS} days</small></article>
      <article className="panel"><span className="eyebrow">Ingestion</span><strong>{Number(row?.ingestBatches||0).toLocaleString()} batches</strong><p>{Number(row?.deduplicatedBars||0).toLocaleString()} duplicates safely removed</p><small>Last sync {time(row?.lastIngestAt)}</small></article>
    </section>

    <section className="panel mt5-chart-panel">
      <div className="panel-title"><div><span className="eyebrow">Reconstructed Price Data</span><h2>{asset} · {timeframe}</h2><p>{timeframe==='M1'?'Direct canonical M1 candles':'Derived on demand from canonical M1 candles'}</p></div><div className="mt5-timeframes">{TIMEFRAMES.map(tf=><button key={tf} className={timeframe===tf?'active':''} onClick={()=>setTimeframe(tf)}>{tf}</button>)}</div></div>
      {loading&&!bars.length?<div className="loading-panel">Loading MT5 candles…</div>:<CandleChart bars={bars}/>} 
      <div className="mt5-chart-stats"><span><small>Candles returned</small>{bars.length}</span><span><small>Oldest</small>{first?timeMs(first[0]):'—'}</span><span><small>Newest</small>{latest?timeMs(latest[0]):'—'}</span><span><small>Latest close</small>{latest?fmt(latest[4]):'—'}</span><span><small>Tick volume</small>{latest?Number(latest[5]).toLocaleString():'—'}</span><span><small>Spread</small>{latest?latest[6]:'—'}</span></div>
    </section>

    <section className="panel mt5-integrity-panel"><div className="panel-title"><div><span className="eyebrow">Data Integrity</span><h2>Latest batch + lifetime diagnostics</h2></div><span>{row?.alerts?.length||0} active notices</span></div><div className="mt5-integrity-grid"><span><small>Received</small>{Number(row?.receivedBars||0).toLocaleString()}</span><span><small>Accepted new</small>{Number(row?.acceptedBars||0).toLocaleString()}</span><span><small>Deduplicated</small>{Number(row?.deduplicatedBars||0).toLocaleString()}</span><span><small>Rejected OHLC</small>{Number(row?.rejectedBars||0).toLocaleString()}</span><span><small>Gap events</small>{Number(row?.gapEvents||0).toLocaleString()}</span><span><small>Missing estimate</small>{Number(row?.missingCandleEstimate||0).toLocaleString()}</span><span><small>Out of order</small>{Number(row?.outOfOrderBars||0).toLocaleString()}</span><span><small>Max gap</small>{Number(row?.maxGapMinutes||0).toLocaleString()}m</span></div>{row?.alerts?.length?<div className="mt5-alerts">{row.alerts.map((message,index)=><span key={`${message}-${index}`}>{message}</span>)}</div>:<p className="mt5-clean">No active integrity warnings for this asset.</p>}</section>

    <SMCFusion state={selectedSmc}/>

    <section className="panel mt5-raw-panel"><div className="panel-title"><div><span className="eyebrow">Raw Extract</span><h2>Last 40 returned rows</h2></div><span>[UTC ms, O, H, L, C, tick volume, spread, real volume]</span></div><div className="mt5-raw-table"><div className="head"><span>UTC</span><span>Open</span><span>High</span><span>Low</span><span>Close</span><span>Ticks</span><span>Spread</span><span>Real vol</span></div>{bars.slice(-40).reverse().map(row=><div key={row[0]}><span>{new Date(row[0]).toLocaleString()}</span><span>{fmt(row[1])}</span><span>{fmt(row[2])}</span><span>{fmt(row[3])}</span><span>{fmt(row[4])}</span><span>{row[5]}</span><span>{row[6]}</span><span>{row[7]}</span></div>)}</div></section>
  </div>;
}
