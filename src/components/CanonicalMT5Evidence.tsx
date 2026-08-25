import { useEffect,useMemo,useState } from 'react';
import { apiGetJson } from '../lib/api-runtime';
import { fetchMT5CacheStatus,fetchMT5Prices,MT5_WEBSITE_ASSETS,type MT5Bar,type MT5PricePayload } from '../lib/mt5-price-cache';
import type { DashboardPayload,SessionSignalsPayload } from '../lib/types';
import './CanonicalMT5Evidence.css';

type LiveSignal={id:string;symbol:string;timeframe?:string;side?:string;status?:string;updatedAt?:string;stream?:string;methodCode?:string;intelligence?:{score?:number}};
type LiveSignalList={signals:LiveSignal[]};
type Props={dashboard:DashboardPayload;signals:SessionSignalsPayload|null};
type Series={symbol:string;timeframe:string;payload:MT5PricePayload|null;error?:string};

const FRAMES=['M1','M5','M15','M30','H1','H4','D1'] as const;
const CORE=['EURUSD','GBPUSD','USDJPY','USDZAR'] as const;
const allowed=new Set<string>(MT5_WEBSITE_ASSETS as readonly string[]);
const mapSymbol=(value:string)=>{const x=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(x==='XAUUSD'||x==='XAU')return'GOLD';if(x==='US500'||x==='SP500'||x==='SPX500')return'SPX';if(x==='NAS100'||x==='USTEC'||x==='NDX')return'NASDAQ';if(x==='US30')return'DJI';if(x==='XTIUSD'||x==='USOIL')return'WTI';if(x==='XBRUSD'||x==='UKOIL')return'BRENT';return x;};
const testSignal=(row:LiveSignal)=>String(row.stream||'').toLowerCase().includes('_test')||String(row.methodCode||'').toUpperCase()==='SYSTEM_TEST'||String(row.symbol||'').startsWith('FXGA_TEST_');
const fmt=(value:number|null|undefined,digits=5)=>value==null||!Number.isFinite(value)?'—':value.toLocaleString(undefined,{maximumFractionDigits:Math.abs(value)>=100?2:digits});
const ts=(ms:number)=>new Date(ms).toLocaleString();

function chartBars(payload:MT5PricePayload|null){return (payload?.bars??[]).filter(row=>Array.isArray(row)&&row.length>=5&&row.slice(0,5).every(Number.isFinite)).slice(-24);}

function MT5Chart({series}:{series:Series}){
  const rows=chartBars(series.payload);const width=1120,height=420,padL=62,padR=84,padT=28,padB=52,plotW=width-padL-padR,plotH=height-padT-padB;
  if(!rows.length)return <div className="mt5-evidence-missing"><strong>{series.symbol} · {series.timeframe}</strong><span>{series.error||'No canonical MT5 bars are currently stored for this timeframe.'}</span></div>;
  const lows=rows.map(r=>r[3]),highs=rows.map(r=>r[2]),lo=Math.min(...lows),hi=Math.max(...highs),span=Math.max(hi-lo,Number.EPSILON),y=(p:number)=>padT+(hi-p)/span*plotH,step=plotW/rows.length,bodyW=Math.max(3,Math.min(12,step*.55)),latest=rows[rows.length-1];
  const ticks=Array.from({length:6},(_,i)=>hi-span*i/5);
  return <figure className="mt5-evidence-chart"><figcaption><div><span>CHART SNAPSHOT · CANONICAL METATRADER 5</span><strong>{series.symbol} · {series.timeframe}</strong><small>{series.payload?.derived?`Derived on demand from ${series.payload.baseTimeframe}`:`Native ${series.payload?.baseTimeframe||'M1'} source bars`} · {series.payload?.reconstructionSource||'canonical rolling MT5 cache'}</small></div><div><b>{fmt(latest[4])}</b><small>{ts(latest[0])}</small></div></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.symbol} ${series.timeframe} MT5 price chart screenshot`}><rect width={width} height={height} className="mt5-chart-bg"/>{ticks.map(price=><g key={price}><line x1={padL} x2={width-padR} y1={y(price)} y2={y(price)} className="mt5-chart-grid"/><text x={width-padR+8} y={y(price)+4} className="mt5-chart-label">{fmt(price)}</text></g>)}{rows.map((r,i)=>{const x=padL+step*(i+.5),up=r[4]>=r[1],top=y(Math.max(r[1],r[4])),bottom=y(Math.min(r[1],r[4]));return <g key={`${r[0]}-${i}`} className={up?'mt5-up':'mt5-down'}><line x1={x} x2={x} y1={y(r[2])} y2={y(r[3])}/><rect x={x-bodyW/2} y={top} width={bodyW} height={Math.max(1,bottom-top)}/></g>;})}<line x1={padL} x2={width-padR} y1={y(latest[4])} y2={y(latest[4])} className="mt5-last-line"/><text x={padL} y={height-17} className="mt5-chart-label">{ts(rows[0][0])}</text><text x={width-padR} y={height-17} textAnchor="end" className="mt5-chart-label">{ts(latest[0])}</text></svg></figure>;
}

function PriceRows({payload}:{payload:MT5PricePayload|null}){
  const rows=chartBars(payload);if(!rows.length)return null;
  return <div className="mt5-price-table"><div><strong>Exact OHLCV data used in the screenshot</strong><span>{rows.length} bars · source {payload?.source||'MetaTrader5'}</span></div><table><thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Tick vol.</th><th>Spread</th><th>Real vol.</th></tr></thead><tbody>{rows.map((r:MT5Bar)=><tr key={r[0]}><td>{ts(r[0])}</td><td>{fmt(r[1])}</td><td>{fmt(r[2])}</td><td>{fmt(r[3])}</td><td>{fmt(r[4])}</td><td>{fmt(r[5],0)}</td><td>{fmt(r[6],0)}</td><td>{fmt(r[7],0)}</td></tr>)}</tbody></table></div>;
}

export function CanonicalMT5Evidence({dashboard,signals}:Props){
  const[liveSignals,setLiveSignals]=useState<LiveSignal[]>([]),[series,setSeries]=useState<Series[]>([]),[loading,setLoading]=useState(true),[updatedAt,setUpdatedAt]=useState(''),[cacheNote,setCacheNote]=useState('');
  const directional=useMemo(()=>signals?.sessions.flatMap(session=>session.signals.filter(signal=>signal.direction!=='WAIT').map(signal=>signal.symbol))??[],[signals]);
  useEffect(()=>{let cancelled=false;(async()=>{setLoading(true);try{
    const [live,status]=await Promise.all([
      apiGetJson<LiveSignalList>('/api/tradingview/signals/live?limit=160','critical').catch(()=>({signals:[]})),
      fetchMT5CacheStatus().catch(()=>null),
    ]);
    if(cancelled)return;const actual=(live.signals??[]).filter(row=>!testSignal(row));setLiveSignals(actual);
    const ranked=[...actual].sort((a,b)=>(b.intelligence?.score??0)-(a.intelligence?.score??0)).map(row=>row.symbol);
    const market=(dashboard.market??[]).filter(row=>row.price!=null).map(row=>row.symbol||row.id);
    const online=status?new Set(Object.values(status.series||{}).filter(row=>row.bars>0).map(row=>row.symbol)):null;
    const chosen:string[]=[];for(const raw of [...ranked,...directional,...market,...CORE]){const symbol=mapSymbol(raw);if(!allowed.has(symbol)||chosen.includes(symbol)||(online&&!online.has(symbol)))continue;chosen.push(symbol);if(chosen.length>=4)break;}
    setCacheNote(status?`${status.totalBars.toLocaleString()} canonical M1 bars retained · ${status.databaseHealth?.assetsOnline??status.databaseHealth?.pairsOnline??0} assets online`:'MT5 cache status unavailable; direct series queries attempted');
    const jobs=chosen.flatMap(symbol=>FRAMES.map(timeframe=>({symbol,timeframe})));
    const settled=await Promise.all(jobs.map(async job=>{try{return {symbol:job.symbol,timeframe:job.timeframe,payload:await fetchMT5Prices(job.symbol,job.timeframe,24)} as Series;}catch(error){return {symbol:job.symbol,timeframe:job.timeframe,payload:null,error:error instanceof Error?error.message:'MT5 series unavailable'} as Series;}}));
    if(!cancelled){setSeries(settled);setUpdatedAt(new Date().toISOString());}
  }finally{if(!cancelled)setLoading(false);}})();return()=>{cancelled=true;};},[dashboard,directional]);
  const symbols=useMemo(()=>[...new Set(series.map(row=>row.symbol))],[series]);
  return <section className="canonical-mt5-evidence" data-pdf-section="canonical-mt5-every-timeframe"><header className="mt5-evidence-cover"><span>CANONICAL PRICE EVIDENCE · METATRADER 5</span><h2>Every supported timeframe for the strongest current symbols</h2><p>This section searches the current MT5 cache after prioritising live indicator signals, session signals and then the current market tape. Every chart uses the exact OHLCV rows printed immediately below it.</p><div><b>{loading?'Refreshing MT5 series…':`${symbols.length} symbols · ${FRAMES.length} timeframes each`}</b><span>{cacheNote}</span><small>{updatedAt?`Evidence refreshed ${new Date(updatedAt).toLocaleString()}`:'Waiting for current scan'}</small></div></header>
    {symbols.map(symbol=><section className="mt5-symbol-evidence" key={symbol}><div className="mt5-symbol-cover"><span>CURRENT MULTI-TIMEFRAME EVIDENCE</span><h2>{symbol}</h2><p>{liveSignals.some(row=>mapSymbol(row.symbol)===symbol)?'Selected because a current non-test live indicator signal references this symbol.':'Selected from the current FXGA session/market evidence universe.'}</p><div>{FRAMES.map(frame=><b key={frame}>{frame}</b>)}</div></div>{FRAMES.map(timeframe=>{const row=series.find(item=>item.symbol===symbol&&item.timeframe===timeframe)??{symbol,timeframe,payload:null};return <article className="mt5-timeframe-page" key={`${symbol}-${timeframe}`}><MT5Chart series={row}/><PriceRows payload={row.payload}/><footer><span>Source: {row.payload?.source||'MetaTrader5'}</span><span>Base: {row.payload?.baseTimeframe||'M1'}</span><span>{row.payload?.derived?'Reconstructed from canonical M1':'Canonical M1'}</span><span>Generated: {row.payload?.generatedAt?new Date(row.payload.generatedAt).toLocaleString():'unavailable'}</span></footer></article>;})}</section>)}
    {!loading&&!symbols.length?<div className="mt5-evidence-empty">No canonical MT5 price series is currently available for the selected signal universe. The PDF records this rather than synthesising bars.</div>:null}
  </section>;
}
