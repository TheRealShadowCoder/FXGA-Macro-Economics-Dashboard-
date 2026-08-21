import { useEffect, useMemo, useState } from 'react';
import { fetchEconomyAnalysis } from '../lib/api';
import type { DashboardPayload, MacroAnalysisPayload } from '../lib/types';
import type { EconomyAnalysisPayload, EconomyDimension, EconomyMacroState } from '../lib/economy-types';
import './EconomicContextReport.css';
import './EconomicContextGlobal.css';

type Props={dashboard:DashboardPayload;analysis:MacroAnalysisPayload|null;loading:boolean;error?:string};
type Tone='positive'|'negative'|'neutral'|'caution';
type Selection='ALL'|string;

const signed=(value:number)=>`${value>0?'+':''}${value.toFixed(1)}`;
const scoreTone=(score:number):Tone=>score>=20?'positive':score<=-20?'negative':Math.abs(score)>=10?'caution':'neutral';
const plainScore=(score:number)=>score>=40?'Very strong':score>=20?'Strong / improving':score>=8?'Mildly supportive':score<=-40?'Very weak':score<=-20?'Weak / deteriorating':score<=-8?'Mildly restrictive':'Balanced / mixed';
const dimensionHelp:Record<string,{question:string;means:string;high:string;low:string}>={
  growth:{question:'Is the economy expanding or slowing?',means:'Growth tracks production, spending, business activity and demand.',high:'Strong growth usually supports earnings, employment and the local currency, but can keep rates higher.',low:'Weak growth raises slowdown or recession risk and can eventually push a central bank toward easier policy.'},
  inflation:{question:'Are prices getting hotter or cooling?',means:'Inflation measures how quickly the cost of goods and services is changing.',high:'Persistent inflation can keep interest rates high and make central banks more hawkish.',low:'Cooling inflation gives a central bank more freedom to cut rates if growth is weak.'},
  labour:{question:'Are jobs and wages healthy?',means:'Labour data shows whether people are finding work, earning income and supporting consumption.',high:'A strong labour market supports household demand but can also keep wage inflation sticky.',low:'Rapid labour weakness is one of the clearest warnings that an economy may be slowing.'},
  policy:{question:'Is the central bank leaning hawkish or dovish?',means:'Policy combines interest-rate pressure, central-bank stance and rate-market evidence.',high:'A hawkish policy impulse normally supports yields and can support the currency relative to more dovish economies.',low:'A dovish impulse usually means lower-rate expectations and can weaken the currency unless risk-off flows dominate.'},
  financial:{question:'Is money and credit easy or tight?',means:'Financial conditions describe liquidity, credit, funding, spreads and access to money.',high:'Easier conditions can support investment, borrowing and risk appetite.',low:'Tight conditions can slow activity before weakness is fully visible in GDP or employment.'},
};

function dim(state:EconomyMacroState|null,id:string){return state?.dimensions.find(item=>item.id===id)??null;}
function eventMatchesEconomy(event:any,economy:EconomyMacroState|null){if(!economy)return true;const text=`${event.currency||''} ${event.country||''}`.toUpperCase();return text.includes(economy.currency.toUpperCase())||text.includes(economy.label.toUpperCase())||text.includes(economy.id.replaceAll('_',' '));}
function explainRegime(state:EconomyMacroState){
  const growth=dim(state,'growth')?.score??0,inflation=dim(state,'inflation')?.score??0;
  if(growth>20&&inflation>20)return{headline:'Strong growth with inflation pressure',story:`${state.label} is showing firm activity while inflation pressure is still elevated. That gives ${state.centralBank} less reason to rush into easier policy.`,market:`For ${state.currency}, the important question is whether relatively firm growth and a ${state.policyStance} central bank keep local yields attractive.`};
  if(growth>20&&inflation<=20)return{headline:'Healthy growth with cooler inflation',story:`${state.label} has a relatively favourable mix: activity is holding up while inflation is less threatening.`,market:'This is often the closest macro mix to a soft landing. Risk assets can benefit if policy does not need to tighten further.'};
  if(growth<-20&&inflation>20)return{headline:'Weak growth with sticky inflation',story:`${state.label} is facing a difficult mix: activity is weak but inflation pressure is still uncomfortable.`,market:`This can trap ${state.centralBank} between supporting growth and controlling inflation. Markets often become more volatile in this environment.`};
  if(growth<-20&&inflation<=20)return{headline:'Growth slowdown with easing inflation',story:`${state.label} is losing momentum while inflation pressure is becoming less severe.`,market:`Attention usually shifts toward rate cuts, recession risk and whether weaker growth will outweigh easier policy for ${state.currency}.`};
  return{headline:state.regime,story:state.summary,market:`The current data is mixed. The next important move depends on whether growth, inflation or ${state.centralBank} policy breaks away from the current balance.`};
}

function CompareAll({economies,onSelect}:{economies:EconomyMacroState[];onSelect:(id:string)=>void}){
  const ranked=[...economies].sort((a,b)=>b.currencyScore-a.currencyScore);
  return <>
    <section className="economy-world-summary"><div><span className="eyebrow">All Economies</span><h2>Global economic comparison</h2><p>This view compares every economy currently covered by the macro engine. Higher scores mean a more supportive macro backdrop for that economy's currency; lower scores mean a weaker backdrop. Click any economy for the full lesson and report.</p></div><div className="economy-world-count"><strong>{economies.length}</strong><span>economies currently analysed</span></div></section>
    <section className="economy-comparison-grid">{ranked.map((e,index)=><button key={e.id} onClick={()=>onSelect(e.id)} className="economy-compare-card"><div className="economy-compare-rank">#{index+1}</div><div><small>{e.currency} · {e.centralBank}</small><h3>{e.label}</h3><p>{e.regime}</p></div><div className={`economy-compare-score ${scoreTone(e.currencyScore)}`}><strong>{e.currencyScore>0?'+':''}{e.currencyScore}</strong><span>{e.currencyBias}</span></div><div className="economy-compare-meta"><span>Policy <b>{e.policyStance}</b></span><span>Confidence <b>{e.confidence}%</b></span><span>Data <b>{e.observationCount}</b></span></div></button>)}</section>
    <section className="economic-learning panel"><span className="eyebrow">Beginner lesson</span><h2>How to compare two economies</h2><p>Currency markets are relative. A currency can strengthen even when its own economy is mediocre if the economy on the other side of the pair is worse. Compare growth, inflation, central-bank policy and financial conditions between the two economies instead of looking at one country in isolation.</p><div className="economic-learning-chain"><span>Growth</span><b>→</b><span>Inflation</span><b>→</b><span>Central bank</span><b>→</b><span>Rates / yields</span><b>→</b><span>Currency</span></div></section>
  </>;
}

export function EconomicContextReport({dashboard,analysis,loading,error}:Props){
  const[data,setData]=useState<EconomyAnalysisPayload|null>(null);
  const[economyLoading,setEconomyLoading]=useState(true);
  const[economyError,setEconomyError]=useState('');
  const[selected,setSelected]=useState<Selection>('ALL');
  const[search,setSearch]=useState('');

  useEffect(()=>{let cancelled=false;setEconomyLoading(true);void fetchEconomyAnalysis().then(payload=>{if(!cancelled)setData(payload);}).catch(err=>{if(!cancelled)setEconomyError(err instanceof Error?err.message:'Unable to load global economy analysis');}).finally(()=>{if(!cancelled)setEconomyLoading(false);});return()=>{cancelled=true;};},[]);

  const economies=data?.economies??[];
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return economies;return economies.filter(e=>`${e.label} ${e.id} ${e.currency} ${e.centralBank}`.toLowerCase().includes(q));},[economies,search]);
  const state=selected==='ALL'?null:economies.find(e=>e.id===selected)??null;
  const story=state?explainRegime(state):null;
  const upcoming=useMemo(()=>dashboard.calendar.filter(event=>Date.parse(event.date)>=Date.now()&&event.importance>=2&&eventMatchesEconomy(event,state)).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).slice(0,8),[dashboard.calendar,state]);
  const dimensions=state?.dimensions??[];
  const topSignals=state?.topSignals??[];

  return <section className="economic-context-report">
    <section className="economy-selector-panel">
      <div><span className="eyebrow">Choose an economy</span><h2>Economic Context Report</h2><p>Select <strong>All Economies</strong> for the world comparison or choose one economy for a detailed, beginner-friendly explanation.</p></div>
      <div className="economy-selector-controls"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search economy, currency or central bank…"/><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="ALL">All Economies</option>{filtered.map(e=><option value={e.id} key={e.id}>{e.label} · {e.currency}</option>)}</select></div>
    </section>

    {(loading||economyLoading)&&!data?<div className="economic-context-note">Building global economic context from verified macro data…</div>:null}
    {(error||economyError)?<div className="economic-context-note warn">Some intelligence is temporarily unavailable: {economyError||error}. The report will only use data that is currently verified.</div>:null}

    {selected==='ALL'?<CompareAll economies={economies} onSelect={id=>setSelected(id)}/>:state&&story?<>
      <section className="economic-context-hero"><div><span className="eyebrow">{state.label} · {state.currency} · Plain English</span><h2>{story.headline}</h2><p>{story.story}</p></div><div className="economic-context-confidence"><small>REPORT CONFIDENCE</small><strong>{state.confidence}%</strong><span>{state.observationCount} verified observations</span></div></section>

      <section className="economic-story-grid"><article><small>THE ECONOMIC STORY</small><h3>{state.regime}</h3><p>{state.summary}</p></article><article><small>WHY MARKETS CARE</small><h3>What this can mean for {state.currency}</h3><p>{story.market}</p></article></section>

      <section className="economy-beginner-summary"><article><small>1 · ECONOMY</small><strong>{state.label}</strong><span>{state.regime}</span></article><article><small>2 · CENTRAL BANK</small><strong>{state.centralBank}</strong><span>{state.policyStance} policy stance</span></article><article><small>3 · CURRENCY</small><strong>{state.currency}</strong><span>{state.currencyBias} macro bias · score {state.currencyScore}</span></article><article><small>4 · CONFIDENCE</small><strong>{state.confidence}%</strong><span>based on {state.observationCount} observations</span></article></section>

      <div className="economic-context-section-head"><div><span className="eyebrow">Learn the economy in five blocks</span><h3>What each part means, what the data says, and why you should care</h3></div></div>
      <section className="economic-context-cards educational">{dimensions.map((d:EconomyDimension)=>{const help=dimensionHelp[d.id]??{question:'What is happening?',means:'This is one part of the macro economy.',high:'A high score means supportive evidence.',low:'A low score means weak evidence.'};return <article className={`economic-context-card ${scoreTone(d.score)}`} key={d.id}><header><div><small>{d.label.toUpperCase()}</small><h3>{plainScore(d.score)}</h3></div><b>{signed(d.score)}</b></header><div className="economy-question">{help.question}</div><p>{help.means}</p><div className="economic-why"><strong>What the current score means</strong><span>{d.score>=0?help.high:help.low}</span></div><div className="economy-score-guide"><span>-100 weak</span><div><i style={{left:`${Math.max(0,Math.min(100,(d.score+100)/2))}%`}}/></div><span>+100 strong</span></div>{d.contributors.length?<div className="economic-drivers"><small>DATA DRIVING THIS</small>{d.contributors.slice(0,5).map(item=><span key={item.seriesId} title={item.seriesId}>{item.title}</span>)}</div>:null}</article>;})}</section>

      <section className="economic-learning panel"><span className="eyebrow">How the pieces connect</span><h2>From the economy to the market</h2><p>Economic data does not move markets in isolation. Investors ask how the data changes the expected path of the central bank, interest rates and relative returns versus other countries.</p><div className="economic-learning-chain"><span>Economic data</span><b>→</b><span>{state.centralBank}</span><b>→</b><span>Interest rates</span><b>→</b><span>Bond yields</span><b>→</b><span>{state.currency}</span><b>→</b><span>Risk assets</span></div></section>

      <section className="economic-market-impact"><div className="economic-context-section-head"><div><span className="eyebrow">Currency interpretation</span><h3>How to read the {state.currency} macro score</h3></div></div><div className="currency-teaching-grid"><article><small>SUPPORTIVE SCORE</small><strong>Above +20</strong><p>Macro conditions are relatively supportive. This can help {state.currency}, especially if another economy is weaker or more dovish.</p></article><article><small>MIXED SCORE</small><strong>-20 to +20</strong><p>The economy does not have a clear macro advantage. Market direction may depend more on relative policy, positioning and events.</p></article><article><small>WEAKENING SCORE</small><strong>Below -20</strong><p>Macro conditions are relatively weak. This can pressure {state.currency}, particularly against an economy with stronger growth or tighter policy.</p></article></div><p className="economic-disclaimer">A macro score is context, not a trade entry. Currency markets are relative, and price confirmation still matters.</p></section>

      <section className="economic-evidence"><div className="economic-context-section-head"><div><span className="eyebrow">Evidence behind this report</span><h3>Most important {state.label} macro signals right now</h3></div></div>{topSignals.length?<div className="economic-evidence-list">{topSignals.map(item=><article key={item.seriesId}><div><strong>{item.title}</strong><span>{item.seriesId}</span></div><b className={item.score>0?'up':item.score<0?'down':'flat'}>{signed(item.score)}</b><div><small>Latest value</small><strong>{item.value??'—'}</strong><span>{item.date||'No date'}</span></div></article>)}</div>:<div className="economic-context-empty">The engine does not yet have enough ranked evidence for this economy.</div>}</section>

      <section className="economic-catalysts"><div className="economic-context-section-head"><div><span className="eyebrow">What could change the report?</span><h3>Upcoming {state.label} / {state.currency} economic events</h3></div></div>{upcoming.length?<div className="economic-catalyst-list">{upcoming.map(event=><article key={event.id}><time>{new Date(event.date).toLocaleString()}</time><div><strong>{event.currency?`${event.currency} · `:''}{event.event}</strong><span>{event.country} · {event.category}</span></div><div><small>Forecast</small><strong>{event.forecast||'—'}</strong></div><div><small>Previous</small><strong>{event.previous||'—'}</strong></div></article>)}</div>:<div className="economic-context-empty">No matching medium/high-impact event is currently scheduled in the loaded calendar window.</div>}</section>

      <section className="economic-glossary"><div className="economic-context-section-head"><div><span className="eyebrow">Mini economics school</span><h3>Terms used in this report</h3></div></div><div className="economic-glossary-grid"><article><strong>Hawkish</strong><span>A central bank is more worried about inflation and is more willing to keep rates high or raise them.</span></article><article><strong>Dovish</strong><span>A central bank is more willing to lower rates or support growth because inflation pressure is less threatening.</span></article><article><strong>Soft landing</strong><span>Inflation cools without the economy falling into a serious recession.</span></article><article><strong>Stagflation</strong><span>Growth is weak while inflation remains high — a difficult policy environment.</span></article><article><strong>Financial conditions</strong><span>How easy or difficult it is to borrow, obtain liquidity and finance activity.</span></article><article><strong>Relative macro</strong><span>FX compares two economies. What matters is often which side is stronger, not whether either economy is perfect.</span></article></div></section>
    </>:<div className="economic-context-empty">No verified economy state is available for the selected economy yet.</div>}

    <section className="economic-context-summary"><div><small>GLOBAL DATA ENGINE</small><strong>{data?`${data.economies.length} economies · ${data.observationCount} observations`:'Loading economy engine'}</strong></div><div><small>METHODOLOGY</small><strong>{data?.collectorMode||'Loading'}</strong></div><div><small>US FALLBACK ENGINE</small><strong>{analysis?`${analysis.confidence}% confidence`:'Loading'}</strong></div></section>
  </section>;
}
