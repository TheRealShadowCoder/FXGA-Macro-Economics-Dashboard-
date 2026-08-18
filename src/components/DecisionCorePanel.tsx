import './DecisionCorePanel.css';

type ProbabilitySet={buy:number;sell:number;wait:number};
type Contradiction={layer:string;value:number;severity:string;reason:string};
type PremortemItem={risk:string;severity:string;condition:string;response:string};
type PairDecision={
  symbol:string;
  originalDirection:string;
  originalScore:number;
  quality:{score:number;status:string};
  bayesian:{posterior:ProbabilitySet};
  expectationGap:{fundamentalExpectation:number;directionalConsensus:number;marketPricing:number|null;gap:number|null;state:string;marketAvailable:boolean};
  contradictions:{items:Contradiction[];count:number;weightedSeverity:number;status:string};
  refined:{score:number};
  scenarioRobustness?:{available:boolean;score:number;status:string;matches:number;flips:number;waits:number;total:number};
  uncertainty?:{score:number;status:string;posteriorEntropy:number;data:number;contradictions:number;market:number;scenario:number;risk:number};
  historicalCalibration?:{status:string;samples:number;score:number|null;hitRate:number|null;brier:number|null};
  modelHealth?:{status:string;score:number;drifting:number;watch:number;calibratedForecasts:number};
  causalTransmission?:{status:string;availableNodes:number;missingNodes:string[];aligned:number;opposed:number;agreement:number;netTransmission:number;nodes:Array<{id:string;label:string;value:number|null;available:boolean}>};
  counterfactual?:{baselineScore:number;minimumAdverseShift:number|null;fragility:string;weakestComponents:string[];whatWouldChangeTheMind:string[]};
  temporalIntelligence?:{status:string;factor:number;conflicts:string[];releaseDifferential:number;revisionDifferential:number;communicationGap:number;catalysts?:{lastHighImpact?:{event:string;currency:string;date:string}|null;nextHighImpact?:{event:string;currency:string;date:string;minutes:number}|null;catalystAgeHours?:number|null}};
  premortem?:PremortemItem[];
  thesis:{statement:string;drivers:Array<{label:string;value:number}>;opposingEvidence:Array<{label:string;value:number}>;invalidations:string[];counterThesis:string};
  final:{direction:string;confidence:number;dynamicThreshold:number;reason:string[];executionGate:string};
};
export type DecisionCorePayload={
  version:string;
  methodology:string;
  evidenceQuality:{score:number;status:string;coverage:number;freshness:number;historyDepth:number;sourceBreadth:number};
  contradictionSummary:{contained:number;material:number;severe:number;total:number};
  audit:{pairCount:number;directionalCount:number;waitCount:number;governanceVetoes:number;severeContradictions:number;averageGovernedConfidence:number};
  pairDecisions:PairDecision[];
};

const pct=(value:number)=>`${Math.round(value*100)}%`;
const sign=(value:number)=>`${value>0?'+':''}${Math.round(value)}`;
const cls=(value:number)=>value>12?'positive':value<-12?'negative':'neutral';
const probabilityClass=(direction:string)=>direction==='BUY'?'positive':direction==='SELL'?'negative':'neutral';

export function DecisionCorePanel({data}:{data?:DecisionCorePayload|null}){
  if(!data)return null;
  const ranked=[...data.pairDecisions].sort((a,b)=>Math.max(b.bayesian.posterior.buy,b.bayesian.posterior.sell)-Math.max(a.bayesian.posterior.buy,a.bayesian.posterior.sell));
  return <>
    <section className="section-head decision-core-head" aria-label="Decision governance research"><div><span className="eyebrow">Decision Governance</span><h2>Second-pass evidence reconciliation before execution</h2><p>Each directional view is challenged by probability updating, causal transmission, expectation gaps, counterfactual fragility, temporal evidence, scenario robustness, uncertainty, historical calibration and explicit invalidation rules. A disagreement becomes WAIT rather than an automatic reversal.</p></div></section>
    <section className="decision-core-summary">
      <article className="panel decision-core-kpi"><span>Evidence quality</span><strong className={data.evidenceQuality.score>=75?'positive':data.evidenceQuality.score>=55?'neutral':'negative'}>{data.evidenceQuality.score}</strong><small>{data.evidenceQuality.status} · freshness {pct(data.evidenceQuality.freshness)}</small></article>
      <article className="panel decision-core-kpi"><span>Directional</span><strong>{data.audit.directionalCount}</strong><small>{data.audit.waitCount} held at WAIT</small></article>
      <article className="panel decision-core-kpi"><span>Governance vetoes</span><strong className={data.audit.governanceVetoes?'neutral':'positive'}>{data.audit.governanceVetoes}</strong><small>Primary ideas blocked by second-pass evidence</small></article>
      <article className="panel decision-core-kpi"><span>Contradictions</span><strong className={data.contradictionSummary.severe?'negative':data.contradictionSummary.material?'neutral':'positive'}>{data.contradictionSummary.total}</strong><small>{data.contradictionSummary.severe} severe · {data.contradictionSummary.material} material</small></article>
    </section>
    <section className="decision-core-grid">
      {ranked.map(item=>{
        const p=item.bayesian.posterior;
        const best=Math.max(p.buy,p.sell,p.wait);
        return <article className="panel decision-pair-card" key={item.symbol}>
          <div className="decision-pair-top"><div><span className="eyebrow">{item.originalDirection} → governed</span><h3>{item.symbol}</h3></div><div className={`decision-final ${probabilityClass(item.final.direction)}`}><b>{item.final.direction}</b><small>{item.final.confidence}% confidence</small></div></div>
          <div className="decision-score-row"><span>Primary <b className={cls(item.originalScore)}>{sign(item.originalScore)}</b></span><span>Refined <b className={cls(item.refined.score)}>{sign(item.refined.score)}</b></span><span>Threshold <b>{item.final.dynamicThreshold}</b></span></div>
          <div className="posterior-bars">
            <div><span>BUY</span><i aria-label={`BUY probability ${pct(p.buy)}`}><b style={{width:`${p.buy*100}%`}}></b></i><strong>{pct(p.buy)}</strong></div>
            <div><span>SELL</span><i aria-label={`SELL probability ${pct(p.sell)}`}><b style={{width:`${p.sell*100}%`}}></b></i><strong>{pct(p.sell)}</strong></div>
            <div><span>WAIT</span><i aria-label={`WAIT probability ${pct(p.wait)}`}><b style={{width:`${p.wait*100}%`}}></b></i><strong>{pct(p.wait)}</strong></div>
          </div>
          <div className="decision-facts">
            <span>Expectation gap <b>{item.expectationGap.gap==null?'Not priced':sign(item.expectationGap.gap)}</b></span>
            <span>Contradictions <b>{item.contradictions.count}</b></span>
            <span>Evidence <b>{item.quality.score}</b></span>
            <span>Posterior peak <b>{pct(best)}</b></span>
            <span>Scenario robustness <b>{item.scenarioRobustness?.available?`${item.scenarioRobustness.score}%`:'Not measured'}</b></span>
            <span>Uncertainty <b className={(item.uncertainty?.score??0)>=60?'negative':(item.uncertainty?.score??0)>=40?'neutral':'positive'}>{item.uncertainty?.score??'—'}</b></span>
            <span>Causal chain <b>{item.causalTransmission?.status??'—'}</b></span>
            <span>Counterfactual <b className={item.counterfactual?.fragility==='high'?'negative':item.counterfactual?.fragility==='medium'?'neutral':'positive'}>{item.counterfactual?.fragility??'—'}</b></span>
            <span>Temporal evidence <b>{item.temporalIntelligence?.status??'—'}</b></span>
            <span>History calibration <b>{item.historicalCalibration?.status??'building'}</b></span>
          </div>
          <p className="decision-thesis">{item.thesis.statement}</p>
          {item.thesis.drivers.length>0&&<div className="decision-chip-row">{item.thesis.drivers.map(driver=><span key={driver.label}>{driver.label} {sign(driver.value)}</span>)}</div>}
          {item.contradictions.items.length>0&&<div className="decision-warning"><strong>Opposing evidence</strong>{item.contradictions.items.slice(0,2).map((c,index)=><span key={`${c.layer}-${index}`}>{c.reason}</span>)}</div>}
          <details className="decision-details"><summary>Decision audit</summary><div>
            <strong>Governance</strong>{item.final.reason.map((reason,index)=><p key={`g-${index}`}>{reason}</p>)}
            <strong>Causal transmission</strong><p>{item.causalTransmission?`${item.causalTransmission.status}; ${item.causalTransmission.aligned} aligned, ${item.causalTransmission.opposed} opposed, ${item.causalTransmission.availableNodes} verified nodes.`:'Not available.'}</p>
            {item.counterfactual?.whatWouldChangeTheMind?.length?<><strong>Counterfactual stress</strong>{item.counterfactual.whatWouldChangeTheMind.map((rule,index)=><p key={`c-${index}`}>{rule}</p>)}</>:null}
            {item.temporalIntelligence?<><strong>Temporal evidence</strong><p>Release differential {sign(item.temporalIntelligence.releaseDifferential)} · revision differential {sign(item.temporalIntelligence.revisionDifferential)} · communication gap {Math.round(item.temporalIntelligence.communicationGap)}.</p>{item.temporalIntelligence.conflicts.map((conflict,index)=><p key={`t-${index}`}>Conflict: {conflict.replaceAll('-',' ')}</p>)}</>:null}
            <strong>Counter thesis</strong><p>{item.thesis.counterThesis}</p>
            <strong>Invalidation</strong>{item.thesis.invalidations.slice(0,4).map((rule,index)=><p key={`i-${index}`}>{rule}</p>)}
            {item.premortem?.length?<><strong>Pre-mortem</strong>{item.premortem.slice(0,4).map((risk,index)=><p key={`p-${index}`}>{risk.condition} Response: {risk.response}</p>)}</>:null}
          </div></details>
        </article>;
      })}
    </section>
  </>;
}
