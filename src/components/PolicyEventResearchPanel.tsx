import './PolicyEventResearchPanel.css';

type ReactionProfile={studies:number;measurements:number;effectiveSamples:number;agreement:number;rawAgreement:number|null;meanMovePct:number|null;reversalRisk:number|null;bestHorizon:string|null;status:string;byHorizon:Record<string,{measurements:number;effectiveSamples:number;agreement:number;rawAgreement:number;meanMovePct:number|null}>};
type EventReactionResearch={generatedAt:string;studyCount:number;global:ReactionProfile;byCurrency:Record<string,ReactionProfile>;byCategory:Record<string,ReactionProfile>;byCurrencyCategory:Record<string,ReactionProfile>;methodology:string};
type DecisionWindow={window:number;label:string;date:string|null;probabilities:{hike:number;hold:number;cut:number}};
type SequenceTree={depth:number;decisionWindows:DecisionWindow[];topPaths:Array<{sequence:string;probability:number;netSteps:number}>;expectedNetSteps:number;probabilityAtLeastOneHike:number;probabilityAtLeastOneCut:number;probabilityAllHold:number;stepDefinition:string};
type PolicyEconomy={economy:string;currency:string;centralBank:string;currentStance:string;dataPressure:number;currentPolicyEvidence:number;reactionGap:number;probabilities:{hike:number;hold:number;cut:number};pathPressure:{nextMeeting:number;threeMonth:number;sixMonth:number};nextMeeting:{event:string;date:string;forecast:string|null;previous:string|null}|null;scheduledDecisionEvents?:Array<{event:string;date:string;forecast:string|null;previous:string|null}>;sequenceTree?:SequenceTree;scenarios:{inflationPersistence:number;growthScare:number;softLanding:number};confidence:number;interpretation:string;components:{growth:number;inflation:number;labour:number;financial:number;policy:number}};
type PolicyPathResearch={generatedAt:string;type:string;marketPricingAvailable:boolean;economies:PolicyEconomy[];methodology:string};

const pct=(value:number|null|undefined)=>Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:'—';
const signed=(value:number|null|undefined,digits=0)=>Number.isFinite(Number(value))?`${Number(value)>0?'+':''}${Number(value).toFixed(digits)}`:'—';
const statusClass=(value?:string)=>/reliable|tightening|support|hawkish/.test(String(value))?'positive':/low-follow|easing|adverse|dovish/.test(String(value))?'negative':'neutral';
const pretty=(value:string)=>value.replaceAll('-',' ').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());

export function PolicyEventResearchPanel({eventReaction,policyPath}:{eventReaction?:EventReactionResearch|null;policyPath?:PolicyPathResearch|null}){
  if(!eventReaction&&!policyPath)return null;
  const currencies=Object.entries(eventReaction?.byCurrency||{}).sort((a,b)=>b[1].effectiveSamples-a[1].effectiveSamples).slice(0,6);
  const policies=[...(policyPath?.economies||[])].sort((a,b)=>Math.abs(b.pathPressure.threeMonth)-Math.abs(a.pathPressure.threeMonth));
  return <>
    <section className="section-head policy-event-head"><div><span className="eyebrow">Release Reaction & Policy Path Research</span><h2>What data did to markets, and what policy pressure implies next</h2><p>Release reaction research uses measured post-event market behavior only. Policy probabilities and multi-decision trees are model-implied from current economic evidence and remain explicitly separate from futures or swap-market pricing.</p></div></section>
    <section className="policy-event-grid">
      <article className="panel reaction-research-panel">
        <div className="panel-title"><div><span className="eyebrow">Realized Release Reactions</span><h2>Follow-through memory</h2></div><span>{eventReaction?.studyCount||0} studies</span></div>
        <div className="reaction-summary">
          <div><small>Global agreement</small><strong>{pct(eventReaction?.global?.agreement)}</strong></div>
          <div><small>Measured reactions</small><strong>{eventReaction?.global?.measurements||0}</strong></div>
          <div><small>Reversal risk</small><strong>{pct(eventReaction?.global?.reversalRisk)}</strong></div>
          <div><small>Best horizon</small><strong>{eventReaction?.global?.bestHorizon||'Building'}</strong></div>
        </div>
        <div className="reaction-currency-list">{currencies.map(([currency,row])=><div className="reaction-currency-row" key={currency}><div><strong>{currency}</strong><small>{row.studies} releases · {row.measurements} measured horizons</small></div><b className={statusClass(row.status)}>{pct(row.agreement)}</b><span>{pretty(row.status)} · best {row.bestHorizon||'—'} · reversal {pct(row.reversalRisk)}</span></div>)}</div>
        <details className="policy-event-details"><summary>Methodology</summary><p>{eventReaction?.methodology}</p></details>
      </article>

      <article className="panel policy-path-panel">
        <div className="panel-title"><div><span className="eyebrow">Central Bank Path Research</span><h2>Five-economy policy pressure</h2></div><span>{policyPath?.economies.length||0} banks</span></div>
        <div className="policy-path-list">{policies.map(row=><div className="policy-path-row" key={row.currency}>
          <div className="policy-bank"><strong>{row.currency}</strong><span>{row.centralBank}</span><small>{pretty(row.interpretation)} · confidence {row.confidence}%</small></div>
          <div className="policy-probabilities"><span>Hike <b>{pct(row.probabilities.hike)}</b></span><span>Hold <b>{pct(row.probabilities.hold)}</b></span><span>Cut <b>{pct(row.probabilities.cut)}</b></span></div>
          <div className="policy-pressure"><span>Reaction gap <b className={row.reactionGap>12?'positive':row.reactionGap<-12?'negative':'neutral'}>{signed(row.reactionGap)}</b></span><span>3M pressure <b className={row.pathPressure.threeMonth>12?'positive':row.pathPressure.threeMonth<-12?'negative':'neutral'}>{signed(row.pathPressure.threeMonth)}</b></span><span>6M pressure <b>{signed(row.pathPressure.sixMonth)}</b></span></div>
          {row.sequenceTree&&<div className="policy-sequence-tree"><div className="policy-tree-summary"><span>Any hike <b>{pct(row.sequenceTree.probabilityAtLeastOneHike)}</b></span><span>Any cut <b>{pct(row.sequenceTree.probabilityAtLeastOneCut)}</b></span><span>All hold <b>{pct(row.sequenceTree.probabilityAllHold)}</b></span><span>Expected net steps <b>{signed(row.sequenceTree.expectedNetSteps,2)}</b></span></div><div className="policy-tree-windows">{row.sequenceTree.decisionWindows.map(window=><div key={window.window}><small>{window.label}{window.date?` · ${new Date(window.date).toLocaleDateString([], {month:'short',day:'numeric'})}`:''}</small><span>H {pct(window.probabilities.hike)}</span><span>Hold {pct(window.probabilities.hold)}</span><span>C {pct(window.probabilities.cut)}</span></div>)}</div><div className="policy-top-paths">{row.sequenceTree.topPaths.slice(0,3).map(path=><span key={path.sequence}><b>{path.sequence}</b> {pct(path.probability)} · net {signed(path.netSteps)}</span>)}</div></div>}
          {row.nextMeeting&&<div className="policy-meeting"><small>Next scheduled policy catalyst</small><span>{row.nextMeeting.event} · {new Date(row.nextMeeting.date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>}
        </div>)}</div>
        <div className="policy-model-note"><strong>Model-implied, not market-implied.</strong><span>{policyPath?.methodology}</span></div>
      </article>
    </section>
  </>;
}
