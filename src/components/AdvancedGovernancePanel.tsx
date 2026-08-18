import './AdvancedGovernancePanel.css';

type StructuralBreakSide={economy?:string;risk?:number;status?:string;breakFamilies?:number;watchFamilies?:number};
type Pair={
  symbol:string;
  reactionFunctionGap?:{differential:number;alignment:string;status:string;base?:{currency?:string;gap?:number;status?:string;centralBank?:string};quote?:{currency?:string;gap?:number;status?:string;centralBank?:string}};
  crossAsset?:{available:boolean;score:number;alignment:string;status:string;availableFactors:number;used?:Array<{id:string;weight:number;score:number;changePercent:number;stale?:boolean}>};
  eventReactionCalibration?:{available:boolean;status:string;factor:number;rawProfileFactor?:number;releaseExposure:number;activeEvents:Array<{event:string;currency:string;category:string;ageHours:number;profileStatus:string;profileAgreement:number|null;reversalRisk:number|null;regimeTransitionRisk:number|null;conditionedFactor:number}>;methodology:string};
  evidenceCompleteness?:{score:number;status:string;mandatoryMissing:string[];missing:string[];available:string[];checks:Array<{id:string;weight:number;mandatory:boolean;available:boolean;score:number}>};
  structuralBreak?:{status:string;risk:number;factor:number;base?:StructuralBreakSide|null;quote?:StructuralBreakSide|null;breakSeries:number;watchSeries:number};
  horizonCalibration?:{status:string;overallCalibratedProbability:number;negativeEdgeHorizons:string[];preferredHorizon:string|null;rows:Record<string,{source:string;samples:number;modelProbability:number;empiricalHitRate:number|null;calibratedProbability:number;brier:number|null;averageSignedBps:number|null;status:string}>};
  decisionChange?:{status:string;ageMinutes:number|null;directionChanged:boolean;scoreDelta:number|null;confidenceDelta:number|null;reasons:string[]};
  historicalAnalogues?:{status:string;samples:number;weightedHitRate:number|null;averageSignedBps:number|null;averageSimilarity:number;score:number|null;analogues:Array<{decisionAt:string;similarity:number;distance:number;outcome:string;signedBps:number}>};
};
type Core={pairDecisions?:Pair[]};

const pct=(v:number)=>`${Math.round(Number(v||0)*100)}%`;
const n=(v:number|null|undefined,d=0)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
const sign=(v:number|null|undefined)=>Number.isFinite(Number(v))?`${Number(v)>0?'+':''}${Math.round(Number(v))}`:'—';
const quality=(status?:string)=>status==='complete'||status==='aligned'||status==='usable'||status==='calibrated'||status==='stable'?'positive':status==='insufficient'||status==='adverse'||status==='fresh-flip'||status==='strong-repricing-conflict'||status==='opposed'||status==='break'?'negative':'neutral';
const horizonLabel:Record<string,string>={m15:'+15m',h1:'+1h',h4:'+4h',h24:'+24h'};

export function AdvancedGovernancePanel({data}:{data?:Core|null}){
  const pairs=(data?.pairDecisions||[]).filter(p=>p.reactionFunctionGap||p.crossAsset||p.eventReactionCalibration||p.evidenceCompleteness||p.structuralBreak||p.horizonCalibration||p.historicalAnalogues);
  if(!pairs.length)return null;
  return <>
    <section className="section-head advanced-governance-head"><div><span className="eyebrow">Institutional Decision Audit</span><h2>Repricing, completeness, structural stability and realized calibration</h2><p>The second-pass audit separates future policy repricing, independent cross-asset transmission, missing research evidence, structural regime instability and realized historical skill. None of these layers can manufacture confirmation when their underlying evidence is absent.</p></div></section>
    <section className="advanced-governance-grid">{pairs.map(pair=>{
      const reaction=pair.reactionFunctionGap,cross=pair.crossAsset,eventCalibration=pair.eventReactionCalibration,complete=pair.evidenceCompleteness,structural=pair.structuralBreak,horizon=pair.horizonCalibration,change=pair.decisionChange,analogues=pair.historicalAnalogues;
      return <article className="panel advanced-governance-card" key={pair.symbol}>
        <div className="advanced-governance-title"><h3>{pair.symbol}</h3><div>{complete&&<span className={quality(complete.status)}>Evidence {complete.score}%</span>}{structural&&<span className={quality(structural.status)}>Break risk {structural.risk}</span>}{horizon&&<span className={quality(horizon.status)}>Calibration {Math.round(horizon.overallCalibratedProbability*100)}%</span>}</div></div>
        <div className="advanced-governance-facts">
          <div><small>Policy repricing</small><strong className={quality(reaction?.status)}>{reaction?.status?.replaceAll('-',' ')||'Not available'}</strong><span>Gap {sign(reaction?.differential)}</span></div>
          <div><small>Cross asset</small><strong className={quality(cross?.alignment)}>{cross?.available?cross.alignment:'Not available'}</strong><span>{cross?.available?`${sign(cross.score)} · ${cross.availableFactors} factors`:'Insufficient factors'}</span></div>
          <div><small>Release reaction calibration</small><strong className={quality(eventCalibration?.status)}>{eventCalibration?.available?eventCalibration.status.replaceAll('-',' '):'Inactive'}</strong><span>{eventCalibration?.available?`Confidence × ${n(eventCalibration.factor,3)} · release share ${pct(eventCalibration.releaseExposure)}`:'No active measured-release adjustment'}</span></div>
          <div><small>Evidence completeness</small><strong className={quality(complete?.status)}>{complete?`${complete.score}% · ${complete.status}`:'Not measured'}</strong><span>{complete?.mandatoryMissing?.length?`${complete.mandatoryMissing.length} mandatory missing`:`${complete?.missing?.length||0} optional missing`}</span></div>
          <div><small>Structural stability</small><strong className={quality(structural?.status)}>{structural?`${structural.status} · ${structural.risk}`:'Not measured'}</strong><span>{structural?`${structural.breakSeries} break · ${structural.watchSeries} watch series`:'Waiting for research history'}</span></div>
          <div><small>Decision change</small><strong className={quality(change?.status)}>{change?.status?.replaceAll('-',' ')||'No memory'}</strong><span>{change?.ageMinutes!=null?`${change.ageMinutes} min since prior state`:'No prior state'}</span></div>
          <div><small>Historical analogues</small><strong className={quality(analogues?.status)}>{analogues?`${analogues.samples} similar states`:'Building'}</strong><span>{analogues?.weightedHitRate!=null?`Weighted hit ${n(analogues.weightedHitRate,1)}%`:'No realized sample yet'}</span></div>
          <div><small>Preferred horizon</small><strong>{horizon?.preferredHorizon?horizonLabel[horizon.preferredHorizon]||horizon.preferredHorizon:'Building'}</strong><span>{horizon?.negativeEdgeHorizons?.length?`${horizon.negativeEdgeHorizons.length} negative-edge horizons`:'No persistent negative edge'}</span></div>
        </div>
        {horizon&&<div className="advanced-horizon-table">{Object.entries(horizon.rows||{}).map(([id,row])=><div key={id}><b>{horizonLabel[id]||id}</b><span>{row.samples} samples</span><span>{Math.round(row.calibratedProbability*100)}% calibrated</span><span>{row.empiricalHitRate==null?'Hit —':`Hit ${Math.round(row.empiricalHitRate*100)}%`}</span><span>{row.brier==null?'Brier —':`Brier ${n(row.brier,3)}`}</span></div>)}</div>}
        <details className="advanced-governance-details"><summary>Audit evidence</summary><div>
          {reaction&&<><strong>Reaction function</strong><p>{reaction.base?.currency||'Base'} gap {sign(reaction.base?.gap)} ({reaction.base?.status||'unavailable'}) versus {reaction.quote?.currency||'quote'} gap {sign(reaction.quote?.gap)} ({reaction.quote?.status||'unavailable'}).</p></>}
          {eventCalibration?.activeEvents?.length?<><strong>Realized release-reaction calibration</strong>{eventCalibration.activeEvents.slice(0,5).map((x,i)=><p key={i}>{x.currency} {x.category}: {x.event} · profile {x.profileStatus.replaceAll('-',' ')} · agreement {x.profileAgreement==null?'—':pct(x.profileAgreement)} · regime transition {x.regimeTransitionRisk==null?'—':pct(x.regimeTransitionRisk)} · conditioned factor {n(x.conditionedFactor,3)}.</p>)}</>:null}
          {cross?.used?.length?<><strong>Cross asset factors</strong>{cross.used.map(x=><p key={x.id}>{x.id}: change {n(x.changePercent,2)}%, transformed score {sign(x.score)}, model weight {n(x.weight,2)}{x.stale?' · stale haircut':''}.</p>)}</>:null}
          {structural&&<><strong>Structural break audit</strong><p>Pair break risk {structural.risk}; confidence factor {n(structural.factor,3)}. Base {structural.base?.economy||'n/a'} {structural.base?.status||'n/a'} ({structural.base?.risk??'—'}), quote {structural.quote?.economy||'n/a'} {structural.quote?.status||'n/a'} ({structural.quote?.risk??'—'}).</p></>}
          {complete?.missing?.length?<><strong>Missing evidence</strong><p>{complete.missing.join(', ').replaceAll('-',' ')}</p></>:null}
          {change?.reasons?.length?<><strong>Decision change risk</strong>{change.reasons.map((r,i)=><p key={i}>{r}</p>)}</>:null}
          {analogues?.analogues?.length?<><strong>Nearest realized analogues</strong>{analogues.analogues.slice(0,5).map((a,i)=><p key={i}>{new Date(a.decisionAt).toLocaleString()} · similarity {pct(a.similarity)} · {a.outcome} · {a.signedBps>0?'+':''}{n(a.signedBps,1)} bps</p>)}</>:null}
        </div></details>
      </article>;
    })}</section>
  </>;
}
