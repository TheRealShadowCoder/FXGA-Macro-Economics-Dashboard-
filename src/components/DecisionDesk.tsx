import { useEffect, useMemo, useState } from 'react';
import type { SessionSignalsPayload } from '../lib/types';
import './DecisionDesk.css';

type ExpandedSignal={
  symbol:string;direction:'BUY'|'SELL'|'WAIT';score:number;confidence:number;rationale:string[];invalidation:string;catalyst?:string;
  conviction?:number;convictionLabel?:string;risk?:string;executionGate?:string;
  components?:{structuralDivergence?:number;policyDivergence?:number;releaseDivergence?:number;narrativeDivergence?:number;marketConfirmation?:number;baseCurrencyScore?:number;quoteCurrencyScore?:number};
  probabilities?:{buy?:number;sell?:number;wait?:number};
  criticalThinking?:{contradictions?:string[];whatChangesMind?:string[];counterThesis?:string};
};
type Research={
  risk?:{aggregate:number;categories:Array<{id:string;score:number}>;nextHighImpact?:{event:string;currency:string;minutes:number}|null};
  regimes?:Array<{economy:string;family:string;score:number;state:string}>;
  marketAnalytics?:{assets:number;breadth:Record<string,{assets:number;advancing:number;declining:number;averageChangePercent:number|null}>};
};
type MarketAsset={id:string;symbol:string;label:string;price:number|null;changePercent?:number|null;assetClass?:string;stale?:boolean};
type Component={id:string;label:string;weight:number;score:number|null;reason:string};

const ECONOMY:Record<string,string>={USD:'USA',EUR:'EUROPE',GBP:'UK',JPY:'JAPAN',ZAR:'SOUTH_AFRICA',CAD:'CANADA',AUD:'AUSTRALIA',NZD:'NEW_ZEALAND',CHF:'SWITZERLAND',CNY:'CHINA'};
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const title=(v:string)=>v.replaceAll('-',' ').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());
const dirClass=(v:number)=>v>0?'positive':v<0?'negative':'neutral';

function uniqueSignals(data:SessionSignalsPayload){
  const map=new Map<string,ExpandedSignal>();
  for(const session of data.sessions){for(const raw of session.signals as ExpandedSignal[]){const current=map.get(raw.symbol);if(!current||Math.abs(raw.score)*raw.confidence>Math.abs(current.score)*current.confidence)map.set(raw.symbol,raw);}}
  return [...map.values()].sort((a,b)=>Math.abs(b.score)*b.confidence-Math.abs(a.score)*a.confidence);
}
function regimeScore(research:Research|null,currency:string,family:string){
  const economy=ECONOMY[currency];if(!economy)return null;
  const item=research?.regimes?.find(x=>x.economy===economy&&x.family===family);
  return item?Number(item.score):null;
}
function riskScore(research:Research|null,id:string){return research?.risk?.categories?.find(x=>x.id===id)?.score??null;}
function signalProbability(signal:ExpandedSignal){
  if(signal.direction==='BUY'&&typeof signal.probabilities?.buy==='number')return signal.probabilities.buy;
  if(signal.direction==='SELL'&&typeof signal.probabilities?.sell==='number')return signal.probabilities.sell;
  if(signal.direction==='WAIT'&&typeof signal.probabilities?.wait==='number')return signal.probabilities.wait;
  return clamp(signal.confidence,0,100)/100;
}
function crossAssetScore(signal:ExpandedSignal,assets:MarketAsset[]){
  const dxy=assets.find(a=>/\bDXY\b|dollar index/i.test(`${a.symbol} ${a.label}`));
  const gold=assets.find(a=>/XAU|gold/i.test(`${a.symbol} ${a.label}`));
  const y2=assets.find(a=>/2.?year|2Y/i.test(`${a.symbol} ${a.label}`));
  const changes=[dxy,gold,y2].map(a=>a&&typeof a.changePercent==='number'?a.changePercent:null);
  if(changes.every(v=>v==null))return {score:null,reason:'Cross-asset change data is not available for this snapshot.'};
  const symbol=signal.symbol,base=symbol.slice(0,3),quote=symbol.slice(3,6);
  let usdBias=0;
  if(symbol==='XAUUSD')usdBias=signal.direction==='BUY'?-1:signal.direction==='SELL'?1:0;
  else if(base==='USD')usdBias=signal.direction==='BUY'?1:signal.direction==='SELL'?-1:0;
  else if(quote==='USD')usdBias=signal.direction==='BUY'?-1:signal.direction==='SELL'?1:0;
  if(!usdBias)return {score:null,reason:'No supported cross-asset currency map is available for this instrument yet.'};
  let checks=0,agree=0;
  if(typeof dxy?.changePercent==='number'){checks++;if(Math.sign(dxy.changePercent)===usdBias)agree++;}
  if(typeof y2?.changePercent==='number'){checks++;if(Math.sign(y2.changePercent)===usdBias)agree++;}
  if(typeof gold?.changePercent==='number'){checks++;if(Math.sign(gold.changePercent)===-usdBias)agree++;}
  if(!checks)return {score:null,reason:'Cross-asset benchmarks are present but no directional change fields are populated.'};
  return {score:Math.round(100*agree/checks),reason:`${agree}/${checks} USD-sensitive cross-asset checks agree with the current direction.`};
}
function components(signal:ExpandedSignal,research:Research|null,assets:MarketAsset[]):Component[]{
  const symbol=signal.symbol,base=symbol.slice(0,3),quote=symbol.slice(3,6),c=signal.components??{};
  const economic=clamp(Math.abs(signal.score)*2.4);
  const policy=typeof c.policyDivergence==='number'?clamp(50+Math.sign(signal.score)*c.policyDivergence/2):null;
  const baseRates=regimeScore(research,base,'rates-credit'),quoteRates=regimeScore(research,quote,'rates-credit');
  const rates=baseRates!=null&&quoteRates!=null?clamp(50+Math.sign(signal.score)*(baseRates-quoteRates)/2):null;
  const cross=crossAssetScore(signal,assets);
  const liquidityRisk=riskScore(research,'liquidity');
  const eventRisk=riskScore(research,'event-gap');
  const execution=clamp((signal.confidence*.62)+(100-(eventRisk??50))*.38);
  return [
    {id:'economic',label:'Economic Edge',weight:20,score:economic,reason:`Directional macro edge ${signal.score>0?'+':''}${signal.score}.`},
    {id:'central-bank',label:'Central Bank Alignment',weight:15,score:policy,reason:policy==null?'Policy differential is not available.':`Policy differential ${c.policyDivergence!>=0?'+':''}${c.policyDivergence}.`},
    {id:'rates',label:'Rates Alignment',weight:15,score:rates,reason:rates==null?'Comparable rates regime is not yet available for both sides.':`${base} and ${quote} rates-credit regimes are compared directly.`},
    {id:'cross-asset',label:'Cross Asset',weight:10,score:cross.score,reason:cross.reason},
    {id:'positioning',label:'Positioning',weight:10,score:null,reason:'No verified institutional positioning feed is currently connected; no proxy is fabricated.'},
    {id:'technical',label:'Technical Structure',weight:15,score:null,reason:'Technical confirmation must come from the technical-analysis layer before execution.'},
    {id:'liquidity',label:'Liquidity',weight:10,score:liquidityRisk==null?null:100-liquidityRisk,reason:liquidityRisk==null?'Liquidity risk is unavailable.':`Current liquidity-risk score ${liquidityRisk}/100.`},
    {id:'execution',label:'Execution',weight:5,score:execution,reason:`Macro confidence ${signal.confidence}% with current event-risk controls.`},
  ];
}
function tradeQuality(parts:Component[]){
  const available=parts.filter(p=>p.score!=null),availableWeight=available.reduce((s,p)=>s+p.weight,0);
  if(!availableWeight)return {raw:0,adjusted:0,coverage:0,label:'WAIT'};
  const raw=available.reduce((s,p)=>s+p.weight*(p.score as number),0)/availableWeight;
  const coverage=availableWeight/100;
  const adjusted=raw*(.6+.4*coverage);
  const label=adjusted>=85?'Exceptional':adjusted>=75?'Strong':adjusted>=65?'Moderate':adjusted>=55?'Weak':'WAIT';
  return {raw,adjusted,coverage,label};
}
function exposure(signals:ExpandedSignal[]){
  const result:Record<string,number>={};
  for(const s of signals.filter(x=>x.direction!=='WAIT')){
    const multiplier=s.direction==='BUY'?1:-1,base=s.symbol.slice(0,3),quote=s.symbol.slice(3,6);
    result[base]=(result[base]??0)+multiplier*(s.confidence/100);
    result[quote]=(result[quote]??0)-multiplier*(s.confidence/100);
  }
  return Object.entries(result).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
}

export function DecisionDesk({data}:{data:SessionSignalsPayload}){
  const [research,setResearch]=useState<Research|null>(null),[assets,setAssets]=useState<MarketAsset[]>([]),[selected,setSelected]=useState('');
  useEffect(()=>{let cancelled=false;void Promise.all([
    fetch('/api/research',{headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null),
    fetch('/api/market-prices',{headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null),
  ]).then(([r,m])=>{if(cancelled)return;setResearch(r);setAssets(Array.isArray(m?.assets)?m.assets:[]);}).catch(()=>{});return()=>{cancelled=true};},[data.generatedAt]);
  const signals=useMemo(()=>uniqueSignals(data),[data]);
  useEffect(()=>{if(!selected&&signals[0])setSelected(signals[0].symbol);},[signals,selected]);
  const signal=signals.find(x=>x.symbol===selected)??signals[0];
  const parts=useMemo(()=>signal?components(signal,research,assets):[],[signal,research,assets]);
  const quality=useMemo(()=>tradeQuality(parts),[parts]);
  const factorExposure=useMemo(()=>exposure(signals),[signals]);
  if(!signal)return null;
  const probability=signalProbability(signal),technicalMissing=parts.find(x=>x.id==='technical')?.score==null;
  const executable=signal.direction!=='WAIT'&&!technicalMissing&&quality.adjusted>=65&&signal.executionGate!=='WAIT_EVENT';
  const action=executable?signal.direction:'WAIT';
  const nextEvent=research?.risk?.nextHighImpact;
  return <>
    <section className="section-head decision-desk-head"><div><span className="eyebrow">Trade Selection</span><h2>Decision desk</h2><p>Signals are ranked by independent macro evidence, then gated by rates, cross-asset confirmation, liquidity, execution quality and technical confirmation. Missing evidence reduces confidence instead of being guessed.</p></div></section>
    <section className="decision-desk panel">
      <div className="desk-tabs">{signals.map(item=><button key={item.symbol} className={item.symbol===signal.symbol?'active':''} onClick={()=>setSelected(item.symbol)}><strong>{item.symbol}</strong><span className={`signal-direction ${item.direction.toLowerCase()}`}>{item.direction}</span></button>)}</div>
      <div className="desk-summary">
        <div><span className="eyebrow">Final Action</span><strong className={`desk-action ${action.toLowerCase()}`}>{action}</strong><small>{action==='WAIT'&&signal.direction!=='WAIT'?'Macro thesis exists, but execution remains locked until required confirmation is available.':'Decision after evidence and execution gates.'}</small></div>
        <div><span>Probability</span><b>{Math.round(probability*100)}%</b></div>
        <div><span>Trade Quality</span><b>{quality.adjusted.toFixed(0)}</b><small>{quality.label}</small></div>
        <div><span>Evidence coverage</span><b>{Math.round(quality.coverage*100)}%</b></div>
        <div><span>Macro score</span><b className={dirClass(signal.score)}>{signal.score>0?'+':''}{signal.score}</b></div>
        <div><span>Event risk</span><b>{title(signal.risk??'normal')}</b></div>
      </div>
      <div className="quality-components">{parts.map(part=><article key={part.id} className={part.score==null?'unavailable':''}><div><span>{part.label}</span><small>{part.weight}%</small></div><strong>{part.score==null?'N/A':Math.round(part.score)}</strong><p>{part.reason}</p><div className="component-meter"><i style={{width:`${part.score??0}%`}} /></div></article>)}</div>
      <div className="execution-grid">
        <article><span className="eyebrow">Fundamental thesis</span><p>{signal.rationale?.slice(0,3).join(' ')||'No supported thesis is available.'}</p></article>
        <article><span className="eyebrow">Entry condition</span><p>{signal.executionGate==='WAIT_EVENT'?'Wait until the event lockout clears and the market reprices.':'Require technical structure confirmation in the direction of the macro thesis before execution.'}</p></article>
        <article><span className="eyebrow">Preferred entry style</span><p>Confirmation entry after structure, displacement and liquidity conditions align. No blind market entry is generated from macro evidence alone.</p></article>
        <article><span className="eyebrow">Stop / invalidation</span><p>{signal.invalidation}</p></article>
        <article><span className="eyebrow">Target framework</span><p>Use verified market structure and liquidity objectives. Exact targets are withheld when the execution layer cannot support authoritative prices.</p></article>
        <article><span className="eyebrow">Event risk</span><p>{nextEvent?`${nextEvent.currency} · ${nextEvent.event} ${nextEvent.minutes>=0?`in ${nextEvent.minutes} minutes`:`${Math.abs(nextEvent.minutes)} minutes ago`}.`:'No immediate high-impact event is inside the active risk window.'}</p></article>
        <article><span className="eyebrow">What cancels the setup</span><p>{signal.criticalThinking?.whatChangesMind?.slice(0,2).join(' ')||signal.criticalThinking?.counterThesis||signal.invalidation}</p></article>
        <article><span className="eyebrow">Time horizon</span><p>Session to short swing horizon unless a major catalyst, policy repricing or regime transition invalidates the thesis.</p></article>
      </div>
    </section>

    <section className="two-col exposure-section">
      <article className="panel"><div className="panel-title"><div><span className="eyebrow">Factor Concentration</span><h2>Signal exposure</h2></div><span>Directional candidates</span></div><div className="exposure-list">{factorExposure.map(([ccy,value])=><div key={ccy}><strong>{ccy}</strong><span className={dirClass(value)}>{value>0?'+':''}{value.toFixed(2)}</span><div><i style={{width:`${Math.min(100,Math.abs(value)*45)}%`}} /></div></div>)}</div><p className="desk-note">This is the common-factor exposure implied by current directional signals, not a position-size recommendation. Correlated expressions should not be stacked at full risk.</p></article>
      <article className="panel"><div className="panel-title"><div><span className="eyebrow">Invalidation Discipline</span><h2>Do not force a trade</h2></div></div><div className="invalidation-list"><span>Macro direction can exist while the executable action remains WAIT.</span><span>Unverified positioning is left unavailable rather than inferred.</span><span>Technical confirmation is required before entry.</span><span>Event lockouts override directional conviction.</span><span>Exact prices are not manufactured when the verified execution feed cannot support them.</span></div></article>
    </section>
  </>;
}
