import { useMemo, useState } from 'react';
import { fetchDashboard, fetchSessionSignals, fetchTechnicalSnapshot } from '../lib/api';
import { apiGetJson } from '../lib/api-runtime';
import type { DashboardPayload, MarketQuote, SessionSignalsPayload, TechnicalAssetState, TechnicalBar, TechnicalSnapshotPayload, TechnicalTimeframeState } from '../lib/types';
import './CurrentEvidencePack.css';

type Side='BUY'|'SELL'|'WAIT';
type LiveSignal={
  id:string;source?:string;platform?:string;engine?:string;stream?:string;symbol:string;timeframe:string;side:Side;status:string;updatedAt:string;
  marketPrice?:number|null;lastEvent?:string;lastReason?:string|null;methodCode?:string|null;methodFamily?:string|null;
  tradePlan?:{entry?:number|null;stopLoss?:number|null;tp1?:number|null;tp2?:number|null;tp3?:number|null};
  intelligence?:{score?:number;grade?:string;suggestedSignal?:Side;label?:string;explanation?:string};
};
type LiveSignalList={generatedAt:string;count:number;signals:LiveSignal[]};
type AppSourceList={sources:Array<{id:string;name:string;category:string;region:string;status:string;note?:string}>};
type EvidencePack={builtAt:string;dashboard:DashboardPayload;technical:TechnicalSnapshotPayload;sessionSignals:SessionSignalsPayload;liveSignals:LiveSignal[];appSources:AppSourceList['sources']};
type Props={dashboard:DashboardPayload;signals:SessionSignalsPayload|null};
type SourceRow={name:string;className:string;role:string;freshness:string;state:'CURRENT'|'CONNECTED'|'AVAILABLE'|'NOT CONNECTED';evidence:string};

const fmt=(value:number|null|undefined,digits=5)=>value==null||!Number.isFinite(value)?'—':value.toLocaleString(undefined,{maximumFractionDigits:Math.abs(value)>=100?2:digits});
const isoAge=(value?:string|null)=>{if(!value)return'unknown age';const ms=Date.now()-Date.parse(value);if(!Number.isFinite(ms))return'unknown age';const seconds=Math.max(0,Math.round(ms/1000));if(seconds<60)return`${seconds}s old`;const mins=Math.round(seconds/60);if(mins<60)return`${mins}m old`;const hours=Math.round(mins/60);if(hours<48)return`${hours}h old`;return`${Math.round(hours/24)}d old`;};
const sourceText=(quote:MarketQuote)=>`${quote.sourceName??''} ${quote.source??''} ${quote.mode??''}`.toLowerCase();
const signalSourceText=(signal:LiveSignal)=>`${signal.source??''} ${signal.platform??''} ${signal.engine??''} ${signal.stream??''}`.toLowerCase();
const isTestSignal=(signal:LiveSignal)=>String(signal.stream||'').toLowerCase().includes('_test')||String(signal.methodCode||'').toUpperCase()==='SYSTEM_TEST'||String(signal.symbol||'').startsWith('FXGA_TEST_');
const timeframeRank=(value:string)=>{const order=['MN1','W1','D1','H12','H8','H6','H4','H3','H2','H1','M30','M15','M10','M5','M3','M2','M1','S30','S15','S5'];const i=order.indexOf(value.toUpperCase());return i<0?999:i;};
const safeText=(value:unknown)=>String(value??'').replace(/[<>]/g,'');

function CandleSnapshot({asset,timeframe,frame}:{asset:TechnicalAssetState;timeframe:string;frame:TechnicalTimeframeState}){
  const bars=(frame.history??[]).filter(bar=>[bar.open,bar.high,bar.low,bar.close].every(Number.isFinite)).slice(-64);
  const width=1120,height=430,padL=64,padR=82,padT=30,padB=54,plotW=width-padL-padR,plotH=height-padT-padB;
  if(!bars.length)return <div className="evidence-chart-empty">No verified OHLC history is stored for {asset.symbol} {timeframe}.</div>;
  const lows=bars.map(bar=>bar.low),highs=bars.map(bar=>bar.high),min=Math.min(...lows),max=Math.max(...highs),span=Math.max(max-min,Number.EPSILON);
  const y=(price:number)=>padT+(max-price)/span*plotH;
  const step=plotW/bars.length,bodyW=Math.max(2,Math.min(10,step*.58));
  const ticks=Array.from({length:6},(_,i)=>max-(span*i/5));
  const latest=bars[bars.length-1];
  return <figure className="evidence-chart-frame">
    <figcaption><div><strong>{asset.symbol} · {timeframe}</strong><span>{frame.bias.toUpperCase()} · {Math.round(frame.confidence)}% technical confidence · {frame.quality.grade} quality</span></div><div><b>{fmt(latest.close)}</b><small>{new Date(latest.end||latest.start).toLocaleString()}</small></div></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${asset.symbol} ${timeframe} candlestick chart snapshot`}>
      <rect x="0" y="0" width={width} height={height} className="chart-bg"/>
      {ticks.map((price,i)=><g key={price}><line x1={padL} x2={width-padR} y1={y(price)} y2={y(price)} className="chart-grid"/><text x={width-padR+8} y={y(price)+4} className="chart-price">{fmt(price)}</text></g>)}
      {bars.map((bar,i)=>{const x=padL+step*(i+.5),up=bar.close>=bar.open,top=y(Math.max(bar.open,bar.close)),bottom=y(Math.min(bar.open,bar.close));return <g key={`${bar.start}-${i}`} className={up?'candle-up':'candle-down'}><line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} className="wick"/><rect x={x-bodyW/2} y={top} width={bodyW} height={Math.max(1,bottom-top)} className="body"/></g>;})}
      <line x1={padL} x2={width-padR} y1={y(latest.close)} y2={y(latest.close)} className="last-line"/>
      <text x={padL} y={height-18} className="chart-time">{new Date(bars[0].start).toLocaleString()}</text>
      <text x={width-padR} y={height-18} textAnchor="end" className="chart-time">{new Date(latest.end||latest.start).toLocaleString()}</text>
    </svg>
  </figure>;
}

function PriceDataTable({bars}:{bars:TechnicalBar[]}){
  const rows=(bars??[]).slice(-64);
  return <div className="evidence-price-data"><div className="evidence-subhead"><strong>Exact price data used for this chart</strong><span>{rows.length} most recent stored bars</span></div><table><thead><tr><th>Start</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Samples</th><th>Source</th></tr></thead><tbody>{rows.map((bar,index)=><tr key={`${bar.start}-${index}`}><td>{new Date(bar.start).toLocaleString()}</td><td>{fmt(bar.open)}</td><td>{fmt(bar.high)}</td><td>{fmt(bar.low)}</td><td>{fmt(bar.close)}</td><td>{bar.samples}</td><td>{bar.source|| (bar.providerOhlc?'provider OHLC':bar.synthetic?'synthetic aggregation':'FXGA stored bars')}</td></tr>)}</tbody></table></div>;
}

function CurrentSignals({pack}:{pack:EvidencePack}){
  const live=pack.liveSignals.filter(signal=>!isTestSignal(signal)).sort((a,b)=>(b.intelligence?.score??0)-(a.intelligence?.score??0));
  const session=pack.sessionSignals.sessions.flatMap(session=>session.signals.filter(signal=>signal.direction!=='WAIT').map(signal=>({...signal,session:session.label,risk:session.risk})));
  return <section className="evidence-section evidence-current-signals"><header><div><span className="evidence-kicker">CURRENT SIGNAL SEARCH</span><h3>Signals found across the connected FXGA network</h3></div><span>{live.length} live indicator signals · {session.length} session ideas</span></header>
    <div className="evidence-signal-grid">
      {live.slice(0,20).map(signal=><article key={signal.id} className={`signal-${signal.side.toLowerCase()}`}><div><b>{signal.side}</b><strong>{signal.symbol}</strong><span>{signal.timeframe}</span></div><p>{signal.intelligence?.label||signal.lastReason||signal.lastEvent||'Current indicator evidence'}</p><dl><div><dt>Score</dt><dd>{signal.intelligence?.score??'—'}</dd></div><div><dt>Now</dt><dd>{fmt(signal.marketPrice)}</dd></div><div><dt>Entry</dt><dd>{fmt(signal.tradePlan?.entry)}</dd></div><div><dt>Stop</dt><dd>{fmt(signal.tradePlan?.stopLoss)}</dd></div><div><dt>TP1</dt><dd>{fmt(signal.tradePlan?.tp1)}</dd></div><div><dt>Updated</dt><dd>{isoAge(signal.updatedAt)}</dd></div></dl><small>{signal.platform||signal.source||'FXGA signal feed'} · {signal.status}</small></article>)}
      {!live.length?<div className="evidence-empty">No non-test MT5/TradingView lifecycle signal is currently stored. The PDF records that absence rather than inventing a signal.</div>:null}
    </div>
    <div className="evidence-session-table"><table><thead><tr><th>Session</th><th>Symbol</th><th>Direction</th><th>Confidence</th><th>Technical gate</th><th>Risk</th><th>Invalidation</th></tr></thead><tbody>{session.map((row,index)=><tr key={`${row.session}-${row.symbol}-${index}`}><td>{row.session}</td><td>{row.symbol}</td><td>{row.direction}</td><td>{Math.round(row.confidence)}%</td><td>{row.technicalGate||'unavailable'}</td><td>{row.risk}</td><td>{row.invalidation}</td></tr>)}</tbody></table></div>
  </section>;
}

function buildSourceRows(pack:EvidencePack):SourceRow[]{
  const market=pack.dashboard.market??[],live=pack.liveSignals.filter(signal=>!isTestSignal(signal));
  const hasMarket=(...terms:string[])=>market.some(row=>terms.some(term=>sourceText(row).includes(term.toLowerCase())));
  const hasSignal=(...terms:string[])=>live.some(row=>terms.some(term=>signalSourceText(row).includes(term.toLowerCase())));
  const currentSources=new Set(pack.appSources.filter(source=>source.status==='live').map(source=>source.name));
  const rows:SourceRow[]=[
    {name:'FXGA MT5 Live / CloudBridge',className:'First-party execution telemetry',role:'Price, OHLC, indicator telemetry, SMC lifecycle evidence',freshness:'seconds/minutes',state:hasSignal('mt5','metatrader')?'CURRENT':'CONNECTED',evidence:hasSignal('mt5','metatrader')?'Live MT5 signal(s) found in this export':'Connected source; no live MT5 signal found in this export'},
    {name:'FXGA TradingView Webhooks',className:'First-party indicator alerts',role:'Current indicator signal lifecycle, entry/SL/TP and alert telemetry',freshness:'event driven',state:hasSignal('tradingview')?'CURRENT':'CONNECTED',evidence:hasSignal('tradingview')?'Live TradingView signal(s) found in this export':'Webhook service connected; no current non-test signal found'},
    {name:'FXGA Technical Engine',className:'Internal multi-timeframe model',role:'Every stored timeframe, structure, liquidity, imbalance and execution gate',freshness:'collector cadence',state:Object.keys(pack.technical.assets||{}).length?'CURRENT':'CONNECTED',evidence:`${Object.keys(pack.technical.assets||{}).length} technical assets in this snapshot`},
    {name:'FXGA Market Data Ensemble',className:'Cross-provider price confirmation',role:'Current quote, OHLC, volume and provider provenance',freshness:'provider dependent',state:currentSources.has('FXGA Market Data Ensemble')?'CURRENT':'CONNECTED',evidence:`${market.filter(row=>row.price!=null).length} priced assets in this snapshot`},
    {name:'Twelve Data',className:'Independent FX / market data',role:'Real-time FX quote and OHLC cross-check',freshness:'near real time when configured',state:hasMarket('twelve data')?'CURRENT':'AVAILABLE',evidence:hasMarket('twelve data')?'Current market row found':'Supported by the private collector; requires configured API key'},
    {name:'Alpha Vantage',className:'Independent market data',role:'FX quote and independent indicator/price confirmation',freshness:'provider/quota dependent',state:hasMarket('alpha vantage')?'CURRENT':'AVAILABLE',evidence:hasMarket('alpha vantage')?'Current market row found':'Supported by the private collector; requires configured API key'},
    {name:'Finnhub',className:'Independent risk-asset data',role:'Equity/ETF risk proxies and quote confirmation',freshness:'near real time when configured',state:hasMarket('finnhub')?'CURRENT':'AVAILABLE',evidence:hasMarket('finnhub')?'Current market row found':'Supported by the private collector; requires configured API key'},
    {name:'Financial Modeling Prep',className:'Independent cross-asset data',role:'Batched quote confirmation for market proxies',freshness:'provider dependent',state:hasMarket('financial modeling prep','fmp')?'CURRENT':'AVAILABLE',evidence:hasMarket('financial modeling prep','fmp')?'Current market row found':'Supported by the private collector; requires configured API key'},
    {name:'Marketstack',className:'Independent market data',role:'End-of-day cross-check and historical context',freshness:'daily/EOD on current collector policy',state:hasMarket('marketstack')?'CURRENT':'AVAILABLE',evidence:hasMarket('marketstack')?'Current market row found':'Supported by the private collector; requires configured API key'},
    {name:'Bybit / public derivatives',className:'Public crypto derivatives',role:'Perpetual price, book, open interest and funding signals',freshness:'near real time',state:hasMarket('bybit')?'CURRENT':'AVAILABLE',evidence:hasMarket('bybit')?'Current public derivatives row found':'Collector supports public endpoints; current row not present in this snapshot'},
    {name:'CFTC Commitments of Traders',className:'Public institutional positioning',role:'Weekly futures positioning / crowdedness context for currencies and rates',freshness:'weekly',state:'AVAILABLE',evidence:'Official public source; slower positioning signal, not an intraday entry signal'},
    {name:'OANDA v20',className:'Broker-grade optional confirmation',role:'Streaming pricing and multi-timeframe candles',freshness:'streaming',state:'NOT CONNECTED',evidence:'Available integration candidate; account/API token required'},
    {name:'Trading Economics',className:'Macro + market optional confirmation',role:'Live markets, rates, commodities and economic calendar cross-check',freshness:'provider dependent',state:'NOT CONNECTED',evidence:'Available integration candidate; API access required for automated current data'},
    {name:'IG Client Sentiment',className:'Retail positioning optional confirmation',role:'Long/short crowd sentiment as a contrarian/context signal',freshness:'continuously updated by provider',state:'NOT CONNECTED',evidence:'Available integration candidate; use only through authorized access/API'},
  ];
  return rows;
}

function SourceSearch({pack}:{pack:EvidencePack}){
  const rows=buildSourceRows(pack);const current=rows.filter(row=>row.state==='CURRENT').length;
  return <section className="evidence-section evidence-sources"><header><div><span className="evidence-kicker">SOURCE SEARCH & PROVENANCE</span><h3>Where current signal evidence can come from</h3></div><span>{current} sources have current evidence in this export</span></header>
    <p className="evidence-policy">The report distinguishes evidence actually present now from sources that are merely available to integrate. A source is never counted as confirming a trade unless this export contains its current data.</p>
    <table><thead><tr><th>Source</th><th>Class</th><th>Signal role</th><th>Freshness</th><th>Status now</th><th>Evidence in this export</th></tr></thead><tbody>{rows.map(row=><tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.className}</td><td>{row.role}</td><td>{row.freshness}</td><td><b className={`source-state ${row.state.toLowerCase().replace(' ','-')}`}>{row.state}</b></td><td>{row.evidence}</td></tr>)}</tbody></table>
  </section>;
}

function MarketPrices({pack}:{pack:EvidencePack}){
  const rows=(pack.dashboard.market??[]).filter(row=>row.price!=null);
  return <section className="evidence-section"><header><div><span className="evidence-kicker">CURRENT PRICE TAPE</span><h3>Market prices frozen into this PDF</h3></div><span>{rows.length} priced assets</span></header><table><thead><tr><th>Asset</th><th>Price</th><th>Change %</th><th>Open</th><th>High</th><th>Low</th><th>Volume</th><th>Provider</th><th>Fetched</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.symbol||row.id}</strong><small>{row.label}</small></td><td>{fmt(row.price)}</td><td>{fmt(row.changePercent,2)}%</td><td>{fmt(row.open)}</td><td>{fmt(row.high)}</td><td>{fmt(row.low)}</td><td>{fmt(row.volume,2)}</td><td>{row.sourceName||row.source||'FXGA ensemble'}</td><td>{row.fetchedAt?`${new Date(row.fetchedAt).toLocaleString()} · ${isoAge(row.fetchedAt)}`:'—'}</td></tr>)}</tbody></table></section>;
}

function TechnicalPages({pack}:{pack:EvidencePack}){
  const signalSymbols=new Set<string>([
    ...pack.liveSignals.filter(signal=>!isTestSignal(signal)).map(signal=>signal.symbol.toUpperCase()),
    ...pack.sessionSignals.sessions.flatMap(session=>session.signals.filter(signal=>signal.direction!=='WAIT').map(signal=>signal.symbol.toUpperCase())),
  ]);
  const assets=Object.values(pack.technical.assets||{}).filter(asset=>Object.values(asset.timeframes||{}).some(frame=>(frame.history??[]).length)).sort((a,b)=>Number(signalSymbols.has(b.symbol.toUpperCase()))-Number(signalSymbols.has(a.symbol.toUpperCase()))||a.symbol.localeCompare(b.symbol));
  return <>{assets.map(asset=>{const frames=Object.entries(asset.timeframes||{}).filter(([,frame])=>(frame.history??[]).length).sort(([a],[b])=>timeframeRank(a)-timeframeRank(b));return <section className="evidence-asset" key={asset.id}><div className="evidence-asset-cover"><span className="evidence-kicker">MULTI-TIMEFRAME PRICE EVIDENCE</span><h2>{asset.label} · {asset.symbol}</h2><p>Last price {fmt(asset.lastPrice)} · Decision gate <strong>{asset.decisionGate.status}</strong> · Direction <strong>{asset.decisionGate.direction}</strong> · {Math.round(asset.decisionGate.confidence)}% confidence.</p><div>{frames.map(([timeframe,frame])=><span key={timeframe}>{timeframe} · {frame.bias} · {Math.round(frame.confidence)}%</span>)}</div></div>{frames.map(([timeframe,frame])=><article className="evidence-timeframe" key={`${asset.id}-${timeframe}`}><CandleSnapshot asset={asset} timeframe={timeframe} frame={frame}/><div className="evidence-frame-facts"><span>Bars <strong>{frame.bars}</strong></span><span>Required <strong>{frame.requiredBars}</strong></span><span>Quality <strong>{frame.quality.grade} / {Math.round(frame.quality.score)}</strong></span><span>Provider OHLC <strong>{frame.quality.providerOhlc?'yes':'no'}</strong></span><span>Structure <strong>{frame.structure?.latestBos?.type||frame.structure?.latestChoch?.type||'no recent BOS/CHOCH'}</strong></span><span>Range zone <strong>{frame.dealingRange?.zone||'—'}</strong></span></div><PriceDataTable bars={frame.history??[]}/></article>)}</section>;})}</>;
}

export function CurrentEvidencePack({dashboard,signals}:Props){
  const[pack,setPack]=useState<EvidencePack|null>(null),[building,setBuilding]=useState(false),[error,setError]=useState('');
  const previewSources=useMemo(()=>new Set((dashboard.market??[]).map(row=>row.sourceName||row.source).filter(Boolean)).size,[dashboard]);

  const build=async(printAfter=false)=>{
    if(building)return;setBuilding(true);setError('');
    try{
      const [freshDashboard,technical,freshSessions,signalFeed,appSourceResponse]=await Promise.all([
        fetchDashboard(),fetchTechnicalSnapshot(),fetchSessionSignals(),
        apiGetJson<LiveSignalList>('/api/tradingview/signals/live?limit=160','critical').catch(()=>({generatedAt:new Date().toISOString(),count:0,signals:[]})),
        apiGetJson<AppSourceList>('/api/sources').catch(()=>({sources:[]})),
      ]);
      const next:EvidencePack={builtAt:new Date().toISOString(),dashboard:freshDashboard,technical,sessionSignals:freshSessions,liveSignals:signalFeed.signals??[],appSources:appSourceResponse.sources??[]};
      setPack(next);
      if(printAfter){window.setTimeout(()=>printPack(next),180);}
    }catch(caught){setError(caught instanceof Error?caught.message:'Unable to build the current evidence pack');}
    finally{setBuilding(false);}
  };

  const printPack=(current=pack)=>{
    if(!current)return;
    const oldTitle=document.title;const stamp=new Date(current.builtAt).toISOString().replace(/[:.]/g,'-');
    document.title=`FXGA_Current_Market_Evidence_${stamp}`;
    document.body.classList.add('fxga-evidence-printing');
    const cleanup=()=>{document.body.classList.remove('fxga-evidence-printing');document.title=oldTitle;window.removeEventListener('afterprint',cleanup);};
    window.addEventListener('afterprint',cleanup);
    window.print();
    window.setTimeout(()=>{if(document.body.classList.contains('fxga-evidence-printing'))cleanup();},30000);
  };

  return <section className="current-evidence-pack" id="fxga-current-evidence-pack">
    <div className="evidence-controls">
      <div><span className="eyebrow">PDF EVIDENCE PACK</span><h3>Current prices + every stored timeframe + current signal-source scan</h3><p>The export refreshes all evidence first, freezes one timestamp, then prints the exact chart bars and source provenance used.</p></div>
      <div><button type="button" onClick={()=>void build(false)} disabled={building}>{building?'Refreshing evidence…':'Build current evidence pack'}</button><button type="button" className="primary" onClick={()=>pack?printPack():void build(true)} disabled={building}>{building?'Building…':'Export current PDF'}</button></div>
    </div>
    {!pack?<div className="evidence-preview"><strong>Ready to build.</strong><span>{(dashboard.market??[]).filter(row=>row.price!=null).length} current priced assets · {previewSources} visible market providers · {signals?.sessions.flatMap(session=>session.signals).filter(signal=>signal.direction!=='WAIT').length??0} current session ideas.</span></div>:null}
    {error?<div className="evidence-error">Evidence pack could not be completed: {safeText(error)}</div>:null}
    {pack?<div className="evidence-document">
      <section className="evidence-cover"><span className="evidence-kicker">FX GLOBAL AVENGERS TRADING ACADEMY</span><h1>Current Market Evidence Pack</h1><p>Multi-timeframe chart snapshots, exact OHLC price data, live signal search and source provenance.</p><dl><div><dt>Evidence frozen</dt><dd>{new Date(pack.builtAt).toLocaleString()}</dd></div><div><dt>Market snapshot</dt><dd>{new Date(pack.dashboard.generatedAt).toLocaleString()}</dd></div><div><dt>Technical snapshot</dt><dd>{pack.technical.generatedAt?new Date(pack.technical.generatedAt).toLocaleString():'Unavailable'}</dd></div><div><dt>Policy</dt><dd>Only current stored evidence is counted. Missing or stale sources are labeled, never inferred.</dd></div></dl></section>
      <CurrentSignals pack={pack}/><SourceSearch pack={pack}/><MarketPrices pack={pack}/><TechnicalPages pack={pack}/>
      <footer className="evidence-final-note"><strong>Evidence integrity note</strong><p>This PDF is a timestamped analytical record, not a guarantee of future price direction or profitability. Charts are rendered from the same stored OHLC bars printed underneath them. External sources listed as AVAILABLE or NOT CONNECTED did not contribute a current directional confirmation to this export.</p></footer>
    </div>:null}
  </section>;
}
