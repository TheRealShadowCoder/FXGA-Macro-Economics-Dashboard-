import { useEffect,useMemo,useState } from 'react';
import type { MarketQuote } from '../lib/types';
import { fetchMT5Prices,MT5_WEBSITE_ASSETS,type MT5PricePayload } from '../lib/mt5-price-cache';
import { TechnicalStructureView } from './TechnicalStructureView';
import { CrossAssetHistoryProgress } from './CrossAssetHistoryProgress';
import { MT5ExtractedDataView } from './MT5ExtractedDataView';
import './MarketsView.css';

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const maximumFractionDigits = abs > 0 && abs < 10 ? Math.max(digits, 5) : digits;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits, minimumFractionDigits: 0 }).format(value);
}
function signed(value: number | null | undefined, suffix = '') {if (value == null || !Number.isFinite(value)) return '—';return `${value > 0 ? '+' : ''}${number(value)}${suffix}`;}

export function MarketsView({ assets }: { assets: MarketQuote[] }) {
  const [mt5,setMT5]=useState<Record<string,MT5PricePayload>>({});
  const [tab,setTab]=useState<'board'|'mt5'>('board');
  useEffect(()=>{let stopped=false;const load=async()=>{const results=await Promise.allSettled(MT5_WEBSITE_ASSETS.map(asset=>fetchMT5Prices(asset,'M1',3)));if(stopped)return;const next:Record<string,MT5PricePayload>={};results.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value.bars.length)next[MT5_WEBSITE_ASSETS[index]]=result.value;});setMT5(next);};void load();const timer=window.setInterval(()=>void load(),300_000);return()=>{stopped=true;window.clearInterval(timer);};},[]);
  const displayAssets=useMemo(()=>assets.map(asset=>{const payload=mt5[asset.id],bars=payload?.bars||[];if(!payload||bars.length<1)return asset;const last=bars.at(-1)!,previous=bars.length>1?bars.at(-2)!:null,price=last[4],previousClose=previous?.[4]??last[1],change=price-previousClose,changePercent=previousClose?change/previousClose*100:null,newest=payload.newestMs?new Date(payload.newestMs).toISOString():asset.fetchedAt,stale=payload.newestMs?Date.now()-payload.newestMs>15*60_000:true;return {...asset,price,open:last[1],high:last[2],low:last[3],previousClose,change,changePercent,volume:last[5],fetchedAt:newest,sourceName:'MetaTrader 5 · FXGA canonical M1 cache',source:'MetaTrader 5',sourceUrl:undefined,mode:'mt5-firestore-canonical-m1',stale,staleSince:stale?newest:null};}),[assets,mt5]);

  if (!displayAssets.length) return <div className="empty">Cross-asset prices are awaiting the next verified market update.</div>;

  return <>
    <section className="cross-asset-tabs" role="tablist" aria-label="Cross asset workspace tabs"><button className={tab==='board'?'active':''} onClick={()=>setTab('board')}><strong>Cross Asset Board</strong><span>Prices + technical structure</span></button><button className={tab==='mt5'?'active':''} onClick={()=>setTab('mt5')}><strong>MT5 Data + SMC Fusion</strong><span>20K M1 cache · raw data · reconstruction</span></button></section>
    {tab==='mt5'?<MT5ExtractedDataView/>:<>
      <section className="market-summary panel"><div><span className="eyebrow">Cross Asset Market Feed</span><h2>FX, yields, commodities, equity indices and digital assets</h2><p>When MetaTrader has a verified broker instrument, FXGA now prefers its canonical M1 cache for that website asset. The permanent MT5 dataset is M1 only; higher timeframes are reconstructed from M1 instead of duplicating storage.</p></div><div className="market-summary-stats"><strong>{displayAssets.filter(item=>item.price!=null).length}</strong><span>priced</span><strong>{displayAssets.filter(item=>item.mode==='mt5-firestore-canonical-m1').length}</strong><span>from MT5 cache</span></div></section>
      <CrossAssetHistoryProgress />
      <section className="market-grid">{displayAssets.map(asset=>{const moveClass=(asset.changePercent??asset.change??0)>0?'positive':(asset.changePercent??asset.change??0)<0?'negative':'flat',priceSuffix=asset.quoteKind==='yield'?'%':'',isMT5=asset.mode==='mt5-firestore-canonical-m1';return <article className={`market-card ${asset.stale?'stale':''} ${isMT5?'mt5-market-card':''}`} key={asset.id}><div className="market-card-head"><div><span className="eyebrow">{asset.assetClass||'Market'} · {asset.symbol}</span><h3>{asset.label}</h3></div><span className={`market-state ${asset.stale?'stale':'live'} ${isMT5?'mt5':''}`}>{isMT5?(asset.stale?'MT5 cached':'MT5 live'):(asset.stale?'Last verified':'Live')}</span></div><div className="market-price-row"><strong>{number(asset.price)}{priceSuffix}</strong><div className={`market-change ${moveClass}`}><span>{signed(asset.change,priceSuffix)}</span><span>{signed(asset.changePercent,'%')}</span></div></div><div className="market-stats"><span><small>Open</small>{number(asset.open)}{asset.quoteKind==='yield'&&asset.open!=null?'%':''}</span><span><small>High</small>{number(asset.high)}{asset.quoteKind==='yield'&&asset.high!=null?'%':''}</span><span><small>Low</small>{number(asset.low)}{asset.quoteKind==='yield'&&asset.low!=null?'%':''}</span><span><small>Previous</small>{number(asset.previousClose)}{asset.quoteKind==='yield'&&asset.previousClose!=null?'%':''}</span></div><div className="market-foot"><span>{asset.fetchedAt?`Updated ${new Date(asset.fetchedAt).toLocaleString()}`:'Awaiting timestamp'}</span><span>{isMT5?'MetaTrader 5 · canonical M1 · 200 MB governed cache':asset.sourceName||'Market feed'}</span></div>{asset.stale&&asset.staleSince?<small className="market-warning">Current refresh is unavailable; showing the last verified observation from {new Date(asset.staleSince).toLocaleString()}.</small>:null}</article>;})}</section>
      <TechnicalStructureView assets={displayAssets} />
    </>}
  </>;
}
