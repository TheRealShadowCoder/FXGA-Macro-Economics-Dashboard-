import { useEffect, useMemo, useState } from 'react';
import './ResearchView.css';

type RiskCategory={id:string;score:number;severity:string;confidenceHaircut:number;warning:boolean;stressMultiplier:number};
type Scenario={id:string;label:string;confidenceChange:number;currencies:Record<string,number>;pairs:Array<{symbol:string;score:number;direction:'BUY'|'SELL'|'WAIT'}>;assets:Record<string,number>};
type Forecast={seriesId:string;title:string;economy:string;family:string;latest:number;forecast:number;delta:number;interval80:[number,number];interval95:[number,number];probabilities:{up:number;down:number};sampleSize:number};
type ReleaseProfile={currency:string;family:string;count:number;bullishRate:number;bearishRate:number;meanAbsSurprise:number;meanWeightedSurprise:number};
type Regime={economy:string;family:string;score:number;state:string;transitionProbability:number;sampleSize:number};
type ResearchPayload={
  generatedAt:string;
  dataQuality:{overall:number;severity:string;scores:Record<string,number>;diagnostics:Record<string,number>;outliers:Array<{id:string;robustZ:number;value:number}>};
  forecasts:Forecast[];
  releaseAnalytics:{completed:number;profiles:ReleaseProfile[]};
  risk:{aggregate:number;severity:string;confidenceAfterRisk:number;nextHighImpact?:{event:string;currency:string;date:string;minutes:number}|null;categories:RiskCategory[]};
  scenarios:Scenario[];
  regimes:Regime[];
  operatingStandards:{slos:Array<{id:string;target:number;window:string;errorBudget:number}>;storageTiers:Record<string,{retention:string;purpose:string}>;validationState:string};
  notes?:Record<string,string>;
};

const title=(value:string)=>value.replaceAll('-',' ').replace(/\b\w/g,(m)=>m.toUpperCase());
const scoreClass=(value:number)=>value>=65?'positive':value>=40?'neutral':'negative';
const riskClass=(value:number)=>value>=70?'negative':value>=45?'neutral':'positive';
const pct=(value:number)=>`${Math.round(value*100)}%`;

export function ResearchView(){
  const [data,setData]=useState<ResearchPayload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [scenarioId,setScenarioId]=useState('risk-off');

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/research',{headers:{Accept:'application/json','Cache-Control':'no-cache'}});
      const text=await response.text();
      if(!response.ok)throw new Error(text||`Research request failed (${response.status})`);
      setData(JSON.parse(text));
    }catch(caught){setError(caught instanceof Error?caught.message:'Research data is unavailable');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);
  const scenario=useMemo(()=>data?.scenarios.find(item=>item.id===scenarioId)??data?.scenarios[0],[data,scenarioId]);
  const forecasts=useMemo(()=>[...(data?.forecasts??[])].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,18),[data]);
  const profiles=useMemo(()=>[...(data?.releaseAnalytics.profiles??[])].sort((a,b)=>b.count-a.count).slice(0,18),[data]);

  if(loading&&!data)return <div className="loading-panel">Preparing institutional research…</div>;
  if(error&&!data)return <div className="alert error">{error}</div>;
  if(!data)return null;

  return <>
    <section className="research-hero">
      <article className="panel research-quality">
        <span className="eyebrow">Research Integrity</span>
        <div className="research-score-row"><h2>Data quality</h2><strong className={scoreClass(data.dataQuality.overall)}>{data.dataQuality.overall}</strong></div>
        <p>Coverage, freshness, historical depth and robust anomaly screening are combined into one quality gate before research outputs are used.</p>
        <div className="research-mini-grid">{Object.entries(data.dataQuality.scores).map(([key,value])=><div key={key}><small>{title(key)}</small><b>{value}</b></div>)}</div>
      </article>
      <article className="panel research-risk">
        <span className="eyebrow">Portfolio Risk State</span>
        <div className="research-score-row"><h2>{title(data.risk.severity)}</h2><strong className={riskClass(data.risk.aggregate)}>{data.risk.aggregate}</strong></div>
        <p>{data.risk.nextHighImpact?`${data.risk.nextHighImpact.currency} · ${data.risk.nextHighImpact.event} in ${Math.max(0,data.risk.nextHighImpact.minutes)} minutes`:'No immediate high-impact release is inside the active risk window.'}</p>
        <div className="research-confidence"><span>Confidence after risk controls</span><b>{data.risk.confidenceAfterRisk}%</b></div>
      </article>
    </section>

    <section className="section-head"><div><span className="eyebrow">Risk Decomposition</span><h2>Independent risk controls</h2><p>Every risk family applies its own warning threshold and confidence haircut before a directional view is considered actionable.</p></div></section>
    <section className="risk-grid">{data.risk.categories.map(item=><article className="risk-card" key={item.id}><div><span>{title(item.id)}</span><strong className={riskClass(item.score)}>{item.score}</strong></div><div className="risk-meter"><i style={{width:`${Math.min(100,item.score)}%`}}></i></div><small>{title(item.severity)} · confidence haircut {item.confidenceHaircut} pts</small></article>)}</section>

    <section className="section-head"><div><span className="eyebrow">Scenario Analysis</span><h2>Macro stress laboratory</h2><p>Compare currency and pair rankings under alternative macro shocks without changing the live baseline.</p></div></section>
    <section className="panel scenario-panel">
      <div className="scenario-tabs">{data.scenarios.map(item=><button key={item.id} className={scenario?.id===item.id?'active':''} onClick={()=>setScenarioId(item.id)}>{item.label}</button>)}</div>
      {scenario&&<div className="scenario-body">
        <div className="scenario-block"><span className="eyebrow">Currency response</span><div className="scenario-currencies">{Object.entries(scenario.currencies).sort((a,b)=>b[1]-a[1]).map(([ccy,score])=><div key={ccy}><b>{ccy}</b><strong className={score>10?'positive':score<-10?'negative':'neutral'}>{score>0?'+':''}{Math.round(score)}</strong></div>)}</div></div>
        <div className="scenario-block"><span className="eyebrow">Pair ranking</span><div className="scenario-pairs">{scenario.pairs.slice(0,8).map(pair=><div key={pair.symbol}><b>{pair.symbol}</b><span className={`signal-direction ${pair.direction.toLowerCase()}`}>{pair.direction}</span><strong>{pair.score>0?'+':''}{pair.score}</strong></div>)}</div></div>
        <div className="scenario-block"><span className="eyebrow">Cross asset shock</span><div className="scenario-assets">{Object.entries(scenario.assets).map(([asset,score])=><div key={asset}><span>{title(asset)}</span><b className={score>0?'positive':score<0?'negative':'neutral'}>{score>0?'+':''}{score}</b></div>)}</div><small>Confidence adjustment {scenario.confidenceChange} pts</small></div>
      </div>}
    </section>

    <section className="two-col research-columns">
      <article className="panel">
        <div className="panel-title"><div><span className="eyebrow">Econometric Ensemble</span><h2>Highest forecast movements</h2></div><span>{data.forecasts.length} models</span></div>
        <div className="research-table">{forecasts.map(row=><div className="research-table-row" key={row.seriesId}><div><strong>{row.seriesId}</strong><small>{row.title} · {row.economy}</small></div><span>{row.latest.toLocaleString(undefined,{maximumFractionDigits:3})}</span><span className={row.delta>0?'positive':row.delta<0?'negative':'neutral'}>{row.delta>0?'+':''}{row.delta.toLocaleString(undefined,{maximumFractionDigits:3})}</span><span>P↑ {pct(row.probabilities.up)}</span></div>)}</div>
      </article>
      <article className="panel">
        <div className="panel-title"><div><span className="eyebrow">Release Memory</span><h2>Historical surprise profiles</h2></div><span>{data.releaseAnalytics.completed} completed</span></div>
        <div className="research-table">{profiles.map(row=><div className="research-table-row profile" key={`${row.currency}-${row.family}`}><div><strong>{row.currency} · {title(row.family)}</strong><small>{row.count} observations</small></div><span>Bull {Math.round(row.bullishRate)}%</span><span>Bear {Math.round(row.bearishRate)}%</span><span>|Z| {row.meanAbsSurprise.toFixed(2)}</span></div>)}</div>
      </article>
    </section>

    <section className="section-head"><div><span className="eyebrow">Regime Map</span><h2>Growth, inflation, policy and financial-state transitions</h2></div></section>
    <section className="regime-grid">{data.regimes.slice(0,30).map((item,index)=><article key={`${item.economy}-${item.family}-${index}`} className="regime-mini"><div><b>{item.economy}</b><span>{title(item.family)}</span></div><strong className={item.score>15?'positive':item.score<-15?'negative':'neutral'}>{item.score>0?'+':''}{Math.round(item.score)}</strong><small>{title(item.state)} · transition {Math.round(item.transitionProbability*100)}%</small></article>)}</section>

    <section className="panel standards-panel">
      <div className="panel-title"><div><span className="eyebrow">Research Controls</span><h2>Service-level objectives and data retention</h2></div><button onClick={()=>void load()}>{loading?'Refreshing…':'Refresh research'}</button></div>
      <div className="slo-grid">{data.operatingStandards.slos.map(item=><div key={item.id}><span>{title(item.id)}</span><b>{item.target}%</b><small>{item.window} window · {item.errorBudget}% budget</small></div>)}</div>
      <div className="storage-grid">{Object.entries(data.operatingStandards.storageTiers).map(([tier,item])=><div key={tier}><span className="eyebrow">{tier}</span><b>{item.retention}</b><small>{item.purpose}</small></div>)}</div>
    </section>
  </>;
}
