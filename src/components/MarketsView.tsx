import { useEffect,useMemo,useState } from 'react';
import type { MarketQuote } from '../lib/types';
import { fetchMT5Prices,MT5_FX_PAIRS,type MT5PricePayload } from '../lib/mt5-price-cache';
import { TechnicalStructureView } from './TechnicalStructureView';
import { CrossAssetHistoryProgress } from './CrossAssetHistoryProgress';

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const maximumFractionDigits = abs > 0 && abs < 10 ? Math.max(digits, 5) : digits;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits, minimumFractionDigits: 0 }).format(value);
}
function signed(value: number | null | undefined, suffix = '') {if (value == null || !Number.isFinite(value)) return '—';return `${value > 0 ? '+' : ''}${number(value)}${suffix}`;}
const canonical=(value:string)=>value.toUpperCase().replace(/[^A-Z]/g,'');

export function MarketsView({ assets }: { assets: MarketQuote[] }) {
  const [mt5,setMT5]=useState<Record<string,MT5PricePayload>>({});
  useEffect(()=>{let stopped=false;const load=async()=>{const results=await Promise.allSettled(MT5_FX_PAIRS.map(pair=>fetchMT5Prices(pair,'M1',3)));if(stopped)return;const next:Record<string,MT5PricePayload>={};results.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value.bars.length)next[MT5_FX_PAIRS[index]]=result.value;});setMT5(next);};void load();const timer=window.setInterval(()=>void load(),300_000);return()=>{stopped=true;window.clearInterval(timer);};},[]);
  const displayAssets=useMemo(()=>assets.map(asset=>{const key=canonical(asset.symbol||asset.id),payload=mt5[key],bars=payload?.bars||[];if(!payload||bars.length<1)return asset;const last=bars.at(-1)!,previous=bars.length>1?bars.at(-2)!:null,price=last[4],previousClose=previous?.[4]??last[1],change=price-previousClose,changePercent=previousClose?change/previousClose*100:null,newest=payload.newestMs?new Date(payload.newestMs).toISOString():asset.fetchedAt,stale=payload.newestMs?Date.now()-payload.newestMs>15*60_000:true;return {...asset,price,open:last[1],high:last[2],low:last[3],previousClose,change,changePercent,volume:last[5],fetchedAt:newest,sourceName:'MetaTrader 5 · FXGA rolling cache',source:'MetaTrader 5',sourceUrl:undefined,mode:'mt5-firestore-rolling-cache',stale,staleSince:stale?newest:null};}),[assets,mt5]);

  if (!displayAssets.length) return <div className="empty">Cross-asset prices are awaiting the next verified market update.</div>;

  return <>
    <section className="market-summary panel"><div><span className="eyebrow">Cross Asset Market Feed</span><h2>FX, yields, commodities, equity indices and digital assets</h2><p>FXGA now prefers the bounded MetaTrader 5 rolling cache for EUR/USD, GBP/USD, USD/JPY and USD/ZAR when fresh MT5 bars are available. Other asset classes continue to use the verified Google Cloud market ensemble.</p></div><div className="market-summary-stats"><strong>{displayAssets.filter(item=>item.price!=null).length}</strong><span>priced</span><strong>{displayAssets.filter(item=>item.mode==='mt5-firestore-rolling-cache').length}</strong><span>from MT5 cache</span></div></section>
    <CrossAssetHistoryProgress />
    <section className="market-grid">{displayAssets.map(asset=>{const moveClass=(asset.changePercent??asset.change??0)>0?'positive':(asset.changePercent??asset.change??0)<0?'negative':'flat',priceSuffix=asset.quoteKind==='yield'?'%':'',isMT5=asset.mode==='mt5-firestore-rolling-cache';return <article className={`market-card ${asset.stale?'stale':''} ${isMT5?'mt5-market-card':''}`} key={asset.id}><div className="market-card-head"><div><span className="eyebrow">{asset.assetClass||'Market'} · {asset.symbol}</span><h3>{asset.label}</h3></div><span className={`market-state ${asset.stale?'stale':'live'} ${isMT5?'mt5':''}`}>{isMT5?(asset.stale?'MT5 cached':'MT5 live'):(asset.stale?'Last verified':'Live')}</span></div><div className="market-price-row"><strong>{number(asset.price)}{priceSuffix}</strong><div className={`market-change ${moveClass}`}><span>{signed(asset.change,priceSuffix)}</span><span>{signed(asset.changePercent,'%')}</span></div></div><div className="market-stats"><span><small>Open</small>{number(asset.open)}{asset.quoteKind==='yield'&&asset.open!=null?'%':''}</span><span><small>High</small>{number(asset.high)}{asset.quoteKind==='yield'&&asset.high!=null?'%':''}</span><span><small>Low</small>{number(asset.low)}{asset.quoteKind==='yield'&&asset.low!=null?'%':''}</span><span><small>Previous</small>{number(asset.previousClose)}{asset.quoteKind==='yield'&&asset.previousClose!=null?'%':''}</span></div><div className="market-foot"><span>{asset.fetchedAt?`Updated ${new Date(asset.fetchedAt).toLocaleString()}`:'Awaiting timestamp'}</span><span>{isMT5?'MetaTrader 5 · bounded 200 MB cache':asset.sourceName||'Market feed'}</span></div>{asset.stale&&asset.staleSince?<small className="market-warning">Current refresh is unavailable; showing the last verified observation from {new Date(asset.staleSince).toLocaleString()}.</small>:null}</article>;})}</section>
    <TechnicalStructureView assets={displayAssets} />
  </>;
}
