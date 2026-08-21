import { useMemo } from 'react';
import type { CalendarEvent, DashboardPayload, MacroAnalysisPayload, MacroDimension } from '../lib/types';
import './EconomicContextReport.css';

type Props={dashboard:DashboardPayload;analysis:MacroAnalysisPayload|null;loading:boolean;error?:string};
type Tone='positive'|'negative'|'neutral'|'caution';

type ContextCard={title:string;status:string;plain:string;why:string;tone:Tone;score:number|null;drivers:string[]};

const directionTone=(dimension?:MacroDimension):Tone=>dimension?.direction==='positive'?'positive':dimension?.direction==='negative'?'negative':'neutral';
const findDimension=(analysis:MacroAnalysisPayload|null,terms:string[])=>analysis?.dimensions.find(d=>terms.some(term=>`${d.id} ${d.label}`.toLowerCase().includes(term)))??null;
const signed=(value:number)=>`${value>0?'+':''}${value.toFixed(1)}`;
const plainScore=(score:number|null)=>score==null?'Not enough verified data':score>=35?'Strong':score>=12?'Improving / supportive':score<=-35?'Weak':score<=-12?'Cooling / restrictive':'Balanced / mixed';

function drivers(dimension:MacroDimension|null){return dimension?.contributors.slice(0,4).map(item=>item.title)||[];}

function nextHighImpact(events:CalendarEvent[]){const now=Date.now();return [...events].filter(event=>event.importance>=3&&Date.parse(event.date)>=now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).slice(0,5);}

function describeRegime(analysis:MacroAnalysisPayload|null){
  if(!analysis)return{headline:'Economic picture is loading',story:'Waiting for the macro engine to assemble the latest verified growth, inflation, labour and policy evidence.',market:'No market conclusion should be drawn until the macro state is available.'};
  const g=analysis.regime.growthScore,i=analysis.regime.inflationScore,r=analysis.regime.recessionRisk;
  if(g<-20&&i>20)return{headline:'Weak growth + stubborn inflation',story:'The economy is losing momentum while inflation pressure remains uncomfortable. This is a difficult mix because central banks have less freedom to support growth.',market:'This kind of environment can keep rates restrictive, pressure rate-sensitive growth assets and increase demand for defensive positioning.'};
  if(g<-20&&i<=20)return{headline:'Growth slowdown + easing inflation',story:'Economic momentum is softening while inflation pressure is becoming less intense. The debate shifts from fighting inflation toward how much the economy is slowing.',market:'Bond yields and rate-cut expectations can become more important. Equities may like lower-rate expectations only if the slowdown does not become a deeper recession.'};
  if(g>=20&&i>20)return{headline:'Firm growth + sticky inflation',story:'Demand is still holding up and inflation is not comfortably under control. Central banks have less reason to rush into easier policy.',market:'Higher-for-longer rate expectations can support yields and the currency of the more hawkish economy while creating valuation pressure for rate-sensitive assets.'};
  if(g>=20&&i<=20)return{headline:'Firm growth + cooling inflation',story:'Growth is holding up while inflation pressure is easing. This is the closest combination to a soft-landing-style backdrop.',market:'Risk assets often prefer this mix because growth remains supportive while the pressure for additional rate tightening falls.'};
  if(r>=65)return{headline:'Late-cycle / recession-risk environment',story:'The evidence is mixed, but recession risk is elevated enough that downside growth scenarios deserve more weight.',market:'Markets can become more sensitive to labour weakness, credit stress and disappointing growth data. Defensive assets and duration can react more strongly to bad data.'};
  return{headline:analysis.regime.name,story:analysis.regime.summary,market:'The market response depends on whether incoming data pushes growth, inflation or policy expectations away from this current balance.'};
}

export function EconomicContextReport({dashboard,analysis,loading,error}:Props){
  const growth=findDimension(analysis,['growth','activity','output']);
  const inflation=findDimension(analysis,['inflation','prices']);
  const labour=findDimension(analysis,['labour','labor','employment','jobs','wage']);
  const liquidity=findDimension(analysis,['liquidity','financial','credit']);
  const rates=findDimension(analysis,['rates','yield','policy']);
  const regime=describeRegime(analysis);
  const events=useMemo(()=>nextHighImpact(dashboard.calendar),[dashboard.calendar]);
  const assetViews=useMemo(()=>[...(analysis?.assets||[])].sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)).slice(0,8),[analysis]);
  const topSignals=analysis?.topSignals.slice(0,8)||[];

  const cards:ContextCard[]=[
    {title:'Growth',status:plainScore(growth?.score??analysis?.regime.growthScore??null),plain:growth?.description||'Growth tells us whether the economy is expanding strongly, slowing down, or contracting.',why:'Strong growth usually supports earnings and demand. Weak growth increases recession and rate-cut risk.',tone:directionTone(growth||undefined),score:growth?.score??analysis?.regime.growthScore??null,drivers:drivers(growth)},
    {title:'Inflation',status:plainScore(inflation?.score??analysis?.regime.inflationScore??null),plain:inflation?.description||'Inflation tells us whether price pressure is getting hotter, cooling, or staying sticky.',why:'Hot inflation can keep interest rates higher for longer. Cooling inflation gives central banks more room to ease policy.',tone:directionTone(inflation||undefined),score:inflation?.score??analysis?.regime.inflationScore??null,drivers:drivers(inflation)},
    {title:'Jobs & wages',status:plainScore(labour?.score??null),plain:labour?.description||'Jobs and wages show whether households still have enough income and confidence to keep spending.',why:'A strong labour market supports demand but can keep wage inflation sticky. Rapid labour weakness is a classic slowdown warning.',tone:directionTone(labour||undefined),score:labour?.score??null,drivers:drivers(labour)},
    {title:'Central banks & rates',status:analysis?.policy.stance||'Loading',plain:analysis?`The current policy stance is ${analysis.policy.stance.toLowerCase()}. Rates momentum is ${signed(analysis.policy.ratesMomentum)} and the Fed reaction score is ${signed(analysis.policy.fedReactionScore)}.`:'Waiting for policy evidence.',why:'Markets reprice currencies, bonds, gold and equities when expectations for future interest rates change.',tone:(analysis?.policy.fedReactionScore??0)>15?'caution':(analysis?.policy.fedReactionScore??0)<-15?'positive':'neutral',score:analysis?.policy.fedReactionScore??null,drivers:drivers(rates)},
    {title:'Recession / slowdown risk',status:analysis?`${Math.round(analysis.regime.recessionRisk)} / 100`:'Loading',plain:analysis?analysis.regime.recessionRisk>=65?'The current evidence says recession or a serious slowdown deserves significant attention.':analysis.regime.recessionRisk>=40?'Slowdown risk is meaningful, but the evidence is not yet a clear recession signal.':'The current evidence does not point to a high recession probability, although this can change as new data arrives.':'Waiting for recession-risk evidence.',why:'Rising recession risk can shift attention away from inflation and toward growth, employment, credit stress and eventual policy easing.',tone:(analysis?.regime.recessionRisk??0)>=65?'negative':(analysis?.regime.recessionRisk??0)>=40?'caution':'positive',score:analysis?.regime.recessionRisk??null,drivers:[]},
    {title:'Financial conditions',status:plainScore(liquidity?.score??null),plain:liquidity?.description||'Financial conditions describe how easy or difficult it is for households, companies and markets to obtain money and credit.',why:'Tight financial conditions can slow the economy even before official growth data weakens. Easier conditions can support risk-taking and demand.',tone:directionTone(liquidity||undefined),score:liquidity?.score??null,drivers:drivers(liquidity)},
  ];

  return <section className="economic-context-report">
    <section className="economic-context-hero">
      <div><span className="eyebrow">Current Economic Context · Plain English</span><h2>{regime.headline}</h2><p>{regime.story}</p></div>
      <div className="economic-context-confidence"><small>CONFIDENCE</small><strong>{analysis?.confidence??'—'}%</strong><span>{analysis?`${analysis.coverage.observed}/${analysis.coverage.requested} macro inputs observed`:'Macro analysis loading'}</span></div>
    </section>

    {loading&&!analysis?<div className="economic-context-note">Building the latest economic context from verified macro data…</div>:null}
    {error?<div className="economic-context-note warn">Some analysis is temporarily unavailable: {error}. The report is using the verified data currently available.</div>:null}

    <section className="economic-story-grid">
      <article><small>THE ECONOMIC STORY</small><h3>{regime.headline}</h3><p>{regime.story}</p></article>
      <article><small>WHY MARKETS CARE</small><h3>How this environment can affect prices</h3><p>{regime.market}</p></article>
    </section>

    <div className="economic-context-section-head"><div><span className="eyebrow">The economy, piece by piece</span><h3>Six things that explain the current backdrop</h3></div></div>
    <section className="economic-context-cards">{cards.map(card=><article className={`economic-context-card ${card.tone}`} key={card.title}><header><div><small>{card.title.toUpperCase()}</small><h3>{card.status}</h3></div>{card.score!=null?<b>{signed(card.score)}</b>:null}</header><p>{card.plain}</p><div className="economic-why"><strong>Why it matters</strong><span>{card.why}</span></div>{card.drivers.length?<div className="economic-drivers"><small>DATA DRIVING THIS</small>{card.drivers.map(item=><span key={item}>{item}</span>)}</div>:null}</article>)}</section>

    <section className="economic-market-impact"><div className="economic-context-section-head"><div><span className="eyebrow">What this means for markets</span><h3>Current macro bias by asset</h3></div></div>{assetViews.length?<div className="economic-asset-grid">{assetViews.map(asset=><article key={asset.id}><span>{asset.label}</span><strong>{asset.bias}</strong><b className={asset.score>0?'up':asset.score<0?'down':'flat'}>{signed(asset.score)}</b><small>Confidence {asset.confidence}%</small></article>)}</div>:<div className="economic-context-empty">Asset-level macro implications are still loading.</div>}<p className="economic-disclaimer">These are current macro tendencies from the dashboard's evidence model, not guarantees that an asset must rise or fall today. Price confirmation and event risk still matter.</p></section>

    <section className="economic-evidence"><div className="economic-context-section-head"><div><span className="eyebrow">Evidence behind the story</span><h3>Most important macro signals right now</h3></div></div>{topSignals.length?<div className="economic-evidence-list">{topSignals.map(item=><article key={item.seriesId}><div><strong>{item.title}</strong><span>{item.seriesId}</span></div><b className={item.score>0?'up':item.score<0?'down':'flat'}>{signed(item.score)}</b><div><small>Latest</small><strong>{item.value??'—'}</strong><span>{item.date||'No date'}</span></div></article>)}</div>:<div className="economic-context-empty">Waiting for ranked macro evidence.</div>}</section>

    <section className="economic-catalysts"><div className="economic-context-section-head"><div><span className="eyebrow">What could change the outlook next?</span><h3>Upcoming high-impact economic events</h3></div></div>{events.length?<div className="economic-catalyst-list">{events.map(event=><article key={event.id}><time>{new Date(event.date).toLocaleString()}</time><div><strong>{event.currency?`${event.currency} · `:''}{event.event}</strong><span>{event.country} · {event.category}</span></div><div><small>Forecast</small><strong>{event.forecast||'—'}</strong></div><div><small>Previous</small><strong>{event.previous||'—'}</strong></div></article>)}</div>:<div className="economic-context-empty">No high-impact event is currently scheduled in the loaded calendar window.</div>}</section>

    <section className="economic-context-summary"><div><small>ONE-SENTENCE SUMMARY</small><strong>{analysis?`${analysis.regime.name}: ${analysis.regime.summary}`:'The macro context is still loading.'}</strong></div><div><small>POLICY BACKDROP</small><strong>{analysis?.policy.stance||'Loading'}</strong></div><div><small>RECESSION RISK</small><strong>{analysis?`${Math.round(analysis.regime.recessionRisk)} / 100`:'—'}</strong></div></section>
  </section>;
}
