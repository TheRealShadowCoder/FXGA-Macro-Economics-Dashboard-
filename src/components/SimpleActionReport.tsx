import { useEffect, useMemo, useState } from 'react';
import type { DashboardPayload, MacroAnalysisPayload, MacroDimension, SessionSignalsPayload, SessionTradeSignal, TechnicalGateStatus } from '../lib/types';
import './SimpleActionReport.css';

type EnhancedSignal=SessionTradeSignal&{conviction?:number;convictionLabel?:string;executionGate?:string;technicalGate?:TechnicalGateStatus;technicalConfidence?:number;technicalModel?:string|null;technicalReason?:string;components?:{structuralDivergence:number;policyDivergence:number;releaseDivergence:number}};
type ActionTone='wait'|'watch'|'ready';
type ContextTone='positive'|'negative'|'neutral'|'caution';
type ContextItem={label:string;status:string;explanation:string;why:string;tone:ContextTone;score?:number|null};

type Props={dashboard:DashboardPayload;analysis:MacroAnalysisPayload|null;signals:SessionSignalsPayload|null;loading:boolean;error?:string};

const clamp=(value:number,min=0,max=100)=>Math.max(min,Math.min(max,value));
const pct=(value:number|null|undefined,digits=2)=>typeof value==='number'&&Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(digits)}%`:'—';
const plainGate=(gate?:TechnicalGateStatus)=>gate==='confirmed'?'Confirmation passed':gate==='context-aligned'?'Direction agrees, entry still needs confirmation':gate==='awaiting-confirmation'?'Waiting for entry confirmation':gate==='conflict'?'Do not trade yet — chart conflicts with the idea':gate==='warming'?'Waiting for enough chart history':'Technical confirmation unavailable';
const gateRank=(gate?:TechnicalGateStatus)=>gate==='confirmed'?5:gate==='context-aligned'?4:gate==='awaiting-confirmation'?3:gate==='warming'?2:gate==='conflict'?0:1;
const countdown=(ms:number)=>{if(ms<=0&&ms>-5*60_000)return'happening now';if(ms<=0)return'already released';const mins=Math.ceil(ms/60_000);if(mins<60)return`in ${mins} min`;const hours=Math.floor(mins/60),rem=mins%60;return`in ${hours}h${rem?` ${rem}m`:''}`;};
const confidenceLabel=(score:number)=>score>=75?'HIGH':score>=55?'MEDIUM':'LOW';
const normalizedRisk=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?clamp(value<=1?value*100:value):null;

function quoteKey(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,'');}
function pickMarkets(dashboard:DashboardPayload){const quotes=dashboard.market??[],needles=['DXY','GOLD','XAU','US10Y','SPX','SP500','VIX','BTCUSD'],seen=new Set<string>(),picked=[] as typeof quotes;for(const needle of needles){const row=quotes.find(item=>{const hay=quoteKey(`${item.id} ${item.symbol} ${item.label}`);return hay.includes(needle);});if(row&&!seen.has(row.id)){seen.add(row.id);picked.push(row);}}for(const row of quotes){if(picked.length>=6)break;if(!seen.has(row.id)&&row.price!=null){seen.add(row.id);picked.push(row);}}return picked.slice(0,6);}
function marketMeaning(change:number|null|undefined){if(typeof change!=='number'||!Number.isFinite(change))return'No clean change reading';if(change>.35)return'Moving clearly higher';if(change<-.35)return'Moving clearly lower';if(change>.08)return'Leaning higher';if(change<-.08)return'Leaning lower';return'Mostly flat';}
function findDimension(analysis:MacroAnalysisPayload|null,terms:string[]){if(!analysis)return null;return analysis.dimensions.find(dimension=>{const text=`${dimension.id} ${dimension.label} ${dimension.description}`.toLowerCase();return terms.some(term=>text.includes(term));})??null;}
function contributorText(dimension:MacroDimension|null){if(!dimension?.contributors?.length)return null;return dimension.contributors.slice(0,2).map(item=>item.title).join(' and ');}
function scoreTone(score:number|null|undefined,positiveIsGood=true):ContextTone{if(typeof score!=='number'||!Number.isFinite(score)||Math.abs(score)<8)return'neutral';const positive=score>0;return positive===positiveIsGood?'positive':'negative';}

function buildEconomicContext(analysis:MacroAnalysisPayload|null):{items:ContextItem[];bottomLine:string;marketMeaning:string;drivers:string[]}{
  if(!analysis)return{items:[],bottomLine:'The economic context is still loading.',marketMeaning:'Wait for the macro engine before drawing a strong conclusion.',drivers:[]};
  const growth=findDimension(analysis,['growth','output','activity','gdp']);
  const inflation=findDimension(analysis,['inflation','price']);
  const labour=findDimension(analysis,['labour','labor','employment','jobs','wage']);
  const financial=findDimension(analysis,['financial','credit','liquidity','conditions']);
  const growthScore=Number.isFinite(analysis.regime.growthScore)?analysis.regime.growthScore:growth?.score??0;
  const inflationScore=Number.isFinite(analysis.regime.inflationScore)?analysis.regime.inflationScore:inflation?.score??0;
  const recessionRisk=normalizedRisk(analysis.regime.recessionRisk)??0;
  const policyText=String(analysis.policy.stance||'Mixed policy stance');
  const policyLower=policyText.toLowerCase();
  const policyTone:ContextTone=/hawk|tight|restrict|higher/.test(policyLower)?'caution':/dov|ease|cut|accommod/.test(policyLower)?'positive':'neutral';
  const growthContributor=contributorText(growth),inflationContributor=contributorText(inflation),labourContributor=contributorText(labour),financialContributor=contributorText(financial);

  const items:ContextItem[]=[
    {
      label:'Growth',score:growthScore,tone:scoreTone(growthScore,true),
      status:growthScore>=18?'Growth is running relatively strong':growthScore<=-18?'Growth is slowing materially':growthScore>=7?'Growth is leaning firmer':growthScore<=-7?'Growth is leaning weaker':'Growth is mixed / close to neutral',
      explanation:growthContributor?`The growth signal is being influenced by ${growthContributor}.`:`The combined growth score is ${growthScore.toFixed(1)}, which is being treated as ${growthScore>7?'expansionary':growthScore<-7?'softening':'mixed'} evidence.`,
      why:growthScore< -7?'Slower growth usually makes markets more sensitive to recession risk and future rate cuts.':'Firm growth can support earnings and the currency, but very strong growth can also keep interest rates higher for longer.'
    },
    {
      label:'Inflation',score:inflationScore,tone:scoreTone(inflationScore,false),
      status:inflationScore>=18?'Inflation pressure is still hot / sticky':inflationScore<=-18?'Inflation pressure is cooling clearly':inflationScore>=7?'Inflation is leaning hotter':inflationScore<=-7?'Inflation is easing':'Inflation is mixed / not giving a strong signal',
      explanation:inflationContributor?`The inflation signal is being influenced by ${inflationContributor}.`:`The combined inflation score is ${inflationScore.toFixed(1)}.`,
      why:inflationScore>7?'Sticky inflation reduces the central bank’s freedom to cut rates and can keep bond yields elevated.':'Cooling inflation gives the central bank more room to ease if growth also weakens.'
    },
    {
      label:'Jobs & wages',score:labour?.score??null,tone:scoreTone(labour?.score,true),
      status:labour?labour.score>=15?'The labour market still looks firm':labour.score<=-15?'The labour market is losing momentum':labour.score>=5?'Jobs are leaning firm':labour.score<=-5?'Jobs are softening':'Jobs are broadly balanced':'No separate labour score is available yet',
      explanation:labourContributor?`Current labour evidence is being driven by ${labourContributor}.`:'Employment and wage data are part of the broader growth/inflation picture when a separate labour dimension is unavailable.',
      why:'Jobs matter because strong employment supports spending and wage pressure, while weakening jobs can quickly increase recession and rate-cut expectations.'
    },
    {
      label:'Central bank & rates',score:analysis.policy.fedReactionScore,tone:policyTone,
      status:`Policy stance: ${policyText}`,
      explanation:`The policy reaction score is ${analysis.policy.fedReactionScore.toFixed(1)} and rates momentum is ${analysis.policy.ratesMomentum.toFixed(1)}.`,
      why:'More restrictive policy usually supports the currency and yields but can pressure rate-sensitive assets. Easier policy tends to do the opposite, all else equal.'
    },
    {
      label:'Recession / slowdown risk',score:recessionRisk,tone:recessionRisk>=65?'negative':recessionRisk>=40?'caution':'positive',
      status:recessionRisk>=65?'Slowdown/recession risk is high':recessionRisk>=40?'Slowdown risk is meaningful':recessionRisk>=20?'Slowdown risk is present but not dominant':'Slowdown risk is currently low',
      explanation:`The macro model currently places recession/slowdown risk around ${Math.round(recessionRisk)}%.`,
      why:'As recession risk rises, markets usually become more defensive and pay more attention to bonds, volatility, safe havens and earnings risk.'
    },
    {
      label:'Financial conditions',score:financial?.score??null,tone:scoreTone(financial?.score,true),
      status:financial?financial.score>=15?'Financial conditions look supportive':financial.score<=-15?'Financial conditions are restrictive / stressed':financial.score>=5?'Conditions are mildly supportive':financial.score<=-5?'Conditions are tightening':'Financial conditions are mixed':'No dedicated financial-conditions score is available yet',
      explanation:financialContributor?`The conditions signal is being influenced by ${financialContributor}.`:'Rates, credit, liquidity and market pricing are used elsewhere in the system to judge how easy or difficult financing conditions are.',
      why:'Tighter financial conditions can slow borrowing, investment and risk appetite even before official economic data visibly deteriorates.'
    }
  ];

  let bottomLine='The economy is sending a mixed signal, so confirmation from markets and upcoming releases matters more than usual.';
  let marketMeaning='Mixed macro conditions usually favour selective trades rather than a broad one-direction market call.';
  if(growthScore>10&&inflationScore>10){bottomLine='The economy looks relatively firm, but inflation is still sticky. That is a “higher-for-longer” type backdrop unless upcoming data cools.';marketMeaning='This mix tends to support yields and can support the currency, while rate-sensitive equities and gold may face pressure when yields rise.';}
  else if(growthScore>10&&inflationScore<=5){bottomLine='Growth is holding up while inflation is not accelerating. This is the friendlier “soft-landing” type combination.';marketMeaning='Risk assets usually prefer this mix, provided central-bank policy does not become unexpectedly tighter.';}
  else if(growthScore<-10&&inflationScore>10){bottomLine='Growth is weakening while inflation remains firm. This is a difficult stagflation-like mix for policy makers.';marketMeaning='Equities can struggle because growth is weak, while bonds may not receive full relief if inflation keeps yields elevated.';}
  else if(growthScore<-10&&inflationScore<=5){bottomLine='Growth is slowing and inflation pressure is easing. The market is more likely to focus on slowdown risk and future policy easing.';marketMeaning='Rate-cut expectations and bonds can become more important, while cyclical/risk assets need evidence that the slowdown is not becoming a recession.';}
  if(recessionRisk>=65){bottomLine+=' Recession risk is high enough that capital preservation should carry more weight.';marketMeaning+=' Defensive positioning and volatility risk deserve extra attention.';}

  const drivers=analysis.topSignals.slice(0,4).map(signal=>`${signal.title}${signal.value==null?'':` = ${signal.value.toLocaleString(undefined,{maximumFractionDigits:2})}`}${signal.date?` (${signal.date})`:''}`);
  return{items,bottomLine,marketMeaning,drivers};
}

export function SimpleActionReport({dashboard,analysis,signals,loading,error}:Props){
  const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30_000);return()=>window.clearInterval(timer);},[]);

  const nextHighImpact=useMemo(()=>[...dashboard.calendar].filter(event=>event.importance>=3&&Date.parse(event.date)>=now-5*60_000).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0]??null,[dashboard.calendar,now]);
  const eventMs=nextHighImpact?Date.parse(nextHighImpact.date)-now:Infinity;
  const eventSoon=Boolean(nextHighImpact&&eventMs>=-5*60_000&&eventMs<=45*60_000);
  const activeSession=signals?.sessions.find(session=>session.active)??signals?.sessions.find(session=>session.state==='upcoming')??null;
  const eventLockout=activeSession?.risk==='event-lockout';
  const economicContext=useMemo(()=>buildEconomicContext(analysis),[analysis]);

  const candidates=useMemo(()=>{
    const rows:(EnhancedSignal&{sessionLabel:string;sessionState:string;sessionRisk:string})[]=[];
    for(const session of signals?.sessions??[]){for(const raw of session.signals){const signal=raw as EnhancedSignal;if(signal.direction==='WAIT')continue;rows.push({...signal,sessionLabel:session.label,sessionState:session.state,sessionRisk:session.risk});}}
    const bestBySymbol=new Map<string,(typeof rows)[number]>();
    for(const row of rows){const current=bestBySymbol.get(row.symbol);const rank=gateRank(row.technicalGate)*1000+(row.sessionState==='active'?500:row.sessionState==='upcoming'?250:0)+row.confidence*2+Math.abs(row.score);const currentRank=current?gateRank(current.technicalGate)*1000+(current.sessionState==='active'?500:current.sessionState==='upcoming'?250:0)+current.confidence*2+Math.abs(current.score):-1;if(rank>currentRank)bestBySymbol.set(row.symbol,row);}
    return [...bestBySymbol.values()].sort((a,b)=>gateRank(b.technicalGate)-gateRank(a.technicalGate)||(b.sessionState==='active'?1:0)-(a.sessionState==='active'?1:0)||b.confidence-a.confidence||Math.abs(b.score)-Math.abs(a.score));
  },[signals]);

  const strongest=candidates[0]??null;
  const confirmed=candidates.find(signal=>signal.technicalGate==='confirmed'&&signal.confidence>=65&&signal.sessionRisk!=='event-lockout')??null;

  let tone:ActionTone='wait',headline='WAIT — no clean trade is confirmed',instruction='Stay patient. The system does not have enough agreement to justify forcing a trade.';
  if(eventLockout||eventSoon){tone='wait';headline='WAIT — important news risk is too close';instruction=nextHighImpact?`Do not open a fresh position before ${nextHighImpact.currency??''} ${nextHighImpact.event}. Let the release happen, then wait for price to settle and technical confirmation to return.`:'Do not open a fresh position until the event-risk lockout clears.';}
  else if(confirmed){tone='ready';headline=`PREPARE ${confirmed.direction} ${confirmed.symbol}`;instruction=`This is the strongest currently confirmed setup. Prepare the trade plan, but only execute at your defined entry trigger and abandon the idea if its invalidation condition is hit.`;}
  else if(strongest){tone='watch';headline=`WATCH ${strongest.symbol} FOR A ${strongest.direction} SETUP`;instruction=`The directional idea exists, but the entry is not fully confirmed. Keep it on the watchlist and wait for the missing chart confirmation instead of entering early.`;}

  const sourceCoverage=dashboard.sources.length?dashboard.sources.filter(source=>source.status==='live').length/dashboard.sources.length*100:0;
  const confidenceInputs=[analysis?.confidence,strongest?.confidence,sourceCoverage].filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  const evidenceConfidence=Math.round(confidenceInputs.length?confidenceInputs.reduce((a,b)=>a+b,0)/confidenceInputs.length:sourceCoverage);
  const markets=useMemo(()=>pickMarkets(dashboard),[dashboard]);
  const nextCatalyst=activeSession?.nextCatalyst||nextHighImpact?.event||'No immediate high-impact catalyst in the current window';

  const actions=eventLockout||eventSoon?
    ['Do not open a new trade immediately before the high-impact release.','Keep the strongest symbols on the watchlist instead of guessing the news outcome.','After the release, wait for the first reaction to settle and require technical confirmation again.','If the original setup invalidates, discard it — do not rescue it.']:
    confirmed?
      [`Focus first on ${confirmed.symbol}. The current bias is ${confirmed.direction}.`,`Write down the entry trigger, stop/invalidation and target before entering.`,`Only execute if the confirmation remains valid when price reaches your entry area.`,`If ${confirmed.invalidation||'the structural invalidation'} occurs, cancel the trade idea.`]:
      strongest?
        [`Watch ${strongest.symbol}; do not enter just because the bias says ${strongest.direction}.`,`Wait for the technical gate to change to confirmed.`,`Use ${strongest.invalidation||'the stated invalidation'} as the condition that kills the idea.`,`If no clean trigger appears, do nothing. Missing a trade is better than forcing one.`]:
        ['No trade is required right now.','Watch the next economic catalyst and the active market session.','Wait for macro direction and chart confirmation to agree.','Only move from WAIT to action when a defined setup appears.'];

  const happening=[
    analysis?`Macro picture: ${analysis.regime.name}. ${analysis.regime.summary}`:'Macro picture is still loading.',
    analysis?`Central-bank/rates view: ${analysis.policy.stance}.`:'Policy view is still loading.',
    activeSession?`${activeSession.label} session: ${activeSession.risk.replaceAll('-',' ')} risk. ${activeSession.eventCount} tracked event${activeSession.eventCount===1?'':'s'}.`:'No active session summary is available yet.',
    nextHighImpact?`Next major event: ${nextHighImpact.currency??''} ${nextHighImpact.event} ${countdown(eventMs)}.`:'No major event is close in the current calendar window.',
  ];

  return <section className="simple-report">
    <div className={`simple-report-hero ${tone}`}>
      <div className="simple-report-main"><span className="eyebrow">Simple Action Report · Plain English</span><h2>{headline}</h2><p>{instruction}</p><div className="simple-report-chips"><span>Confidence <strong>{evidenceConfidence}% · {confidenceLabel(evidenceConfidence)}</strong></span><span>Session <strong>{activeSession?.label??'No active session'}</strong></span><span>Next catalyst <strong>{nextCatalyst}</strong></span></div></div>
      <div className="simple-report-verdict"><small>WHAT DO I DO NOW?</small><strong>{tone==='wait'?'WAIT':tone==='ready'?'PREPARE':'WATCH'}</strong><span>{tone==='wait'?'Protect capital and wait for clarity.':tone==='ready'?'Build the trade plan and require the entry trigger.':'Track the setup. Do not enter early.'}</span></div>
    </div>

    {loading?<div className="simple-report-note">Refreshing macro and signal intelligence…</div>:null}
    {error?<div className="simple-report-note warn">Some advanced intelligence is unavailable: {error}. The report is using the data that is currently verified.</div>:null}

    <div className="simple-report-grid">
      <article className="simple-report-card"><header><span>1</span><div><small>WHAT IS HAPPENING?</small><h3>The situation in normal words</h3></div></header><div className="simple-report-list">{happening.map(item=><p key={item}>{item}</p>)}</div></article>
      <article className="simple-report-card action"><header><span>2</span><div><small>WHAT SHOULD I DO?</small><h3>Action checklist</h3></div></header><ol>{actions.map(item=><li key={item}>{item}</li>)}</ol></article>
    </div>

    <section className="simple-economic-context">
      <div className="simple-report-section-head"><div><span className="eyebrow">CURRENT ECONOMIC CONTEXT · EXPLAINED SIMPLY</span><h3>What kind of economy are markets dealing with right now?</h3></div><span>{analysis?`${analysis.regime.name} · ${analysis.confidence}% confidence`:'Loading macro context…'}</span></div>
      <div className="simple-economic-summary"><div><small>THE ECONOMIC STORY</small><strong>{economicContext.bottomLine}</strong></div><div><small>WHY MARKETS CARE</small><strong>{economicContext.marketMeaning}</strong></div></div>
      {economicContext.items.length?<div className="simple-context-grid">{economicContext.items.map(item=><article key={item.label} className={item.tone}><div className="simple-context-head"><span>{item.label}</span><b>{item.status}</b></div><p>{item.explanation}</p><small><strong>Why it matters:</strong> {item.why}</small></article>)}</div>:<div className="simple-report-empty">The macro engine is still loading the current economic context.</div>}
      {economicContext.drivers.length?<div className="simple-context-drivers"><span>Key data currently driving the story</span>{economicContext.drivers.map(driver=><b key={driver}>{driver}</b>)}</div>:null}
    </section>

    <section className="simple-report-watch"><div className="simple-report-section-head"><div><span className="eyebrow">3 · WHAT SHOULD I WATCH?</span><h3>Current trade ideas ranked from clearest to weakest</h3></div><span>{candidates.length} directional idea{candidates.length===1?'':'s'}</span></div>
      {candidates.length?<div className="simple-watch-list">{candidates.slice(0,6).map(signal=><article key={signal.symbol} className={`simple-watch-row ${signal.technicalGate??'unknown'}`}><div><strong>{signal.symbol}</strong><span>{signal.sessionLabel}</span></div><b className={signal.direction.toLowerCase()}>{signal.direction}</b><div><small>Confidence</small><strong>{signal.confidence}%</strong></div><div><small>Entry status</small><strong>{plainGate(signal.technicalGate)}</strong></div><div className="simple-watch-reason"><small>Why?</small><span>{signal.rationale[0]||signal.technicalReason||'Directional evidence is present.'}</span></div></article>)}</div>:<div className="simple-report-empty">No directional setup is strong enough to put on the action board right now.</div>}
    </section>

    <section className="simple-report-watch"><div className="simple-report-section-head"><div><span className="eyebrow">4 · WHAT ARE THE BIG MARKETS DOING?</span><h3>Quick market temperature check</h3></div></div><div className="simple-market-grid">{markets.map(item=><article key={item.id}><span>{item.label||item.symbol}</span><strong>{item.price==null?'—':item.price.toLocaleString(undefined,{maximumFractionDigits:Math.abs(item.price)<10?5:2})}</strong><b className={(item.changePercent??0)>0?'up':(item.changePercent??0)<0?'down':'flat'}>{pct(item.changePercent)}</b><small>{marketMeaning(item.changePercent)}</small></article>)}</div></section>

    <section className="simple-report-conditions"><div><span className="eyebrow">5 · WHAT WOULD CHANGE THE ANSWER?</span><h3>Conditions that can flip the report</h3></div><div className="simple-condition-grid"><article><strong>Major economic release</strong><span>A high-impact surprise can invalidate the pre-news bias. Re-check the report after the release.</span></article><article><strong>Technical conflict</strong><span>If the chart changes to conflict, treat the trade idea as blocked even when macro still points the same way.</span></article><article><strong>Invalidation level breaks</strong><span>Once a setup invalidates, the old trade idea is dead. Do not move the stop just to keep the idea alive.</span></article><article><strong>Data quality falls</strong><span>If important sources become stale or unavailable, confidence should fall and the correct action becomes WAIT.</span></article></div></section>

    <details className="simple-report-details"><summary>Show the numbers behind this simple report</summary><div className="simple-detail-grid"><div><small>Macro regime</small><strong>{analysis?.regime.name??'Loading'}</strong><span>Macro confidence {analysis?.confidence??'—'}%</span></div><div><small>Growth / inflation</small><strong>{analysis?`${analysis.regime.growthScore} / ${analysis.regime.inflationScore}`:'—'}</strong><span>Recession risk {analysis?`${Math.round(normalizedRisk(analysis.regime.recessionRisk)??0)}%`:'—'}</span></div><div><small>Policy</small><strong>{analysis?.policy.stance??'Loading'}</strong><span>Fed reaction score {analysis?.policy.fedReactionScore??'—'}</span></div><div><small>Data network</small><strong>{dashboard.sources.filter(source=>source.status==='live').length}/{dashboard.sources.length} live</strong><span>{Math.round(sourceCoverage)}% source coverage</span></div>{strongest?<div><small>Strongest setup</small><strong>{strongest.symbol} · {strongest.direction}</strong><span>Signal {strongest.score} · {strongest.confidence}% confidence</span></div>:null}{nextHighImpact?<div><small>Next high-impact event</small><strong>{nextHighImpact.currency} · {nextHighImpact.event}</strong><span>{new Date(nextHighImpact.date).toLocaleString()} · {countdown(eventMs)}</span></div>:null}</div><p className="simple-method-note">This screen is a decision aid, not a guarantee of profit. WAIT is a valid action. A BUY or SELL bias is only promoted when the existing macro/signal engine produces it; the simple report does not invent trades. “Market meaning” statements describe typical macro relationships and are not guarantees of how price must react today.</p></details>
  </section>;
}
