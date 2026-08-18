from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

# Decision memory: persist state vectors and expose prior realized analogues.
path=Path('cloud-run-collector/src/decision-memory.js')
text=path.read_text(encoding='utf-8')
if 'function pairFeatureVector(' not in text:
    anchor="function confidenceBucket(value){const c=Number(value||0);return c>=80?'80-100':c>=65?'65-79':c>=50?'50-64':'0-49';}\n"
    fn="""function pairFeatureVector(pair){
  const posterior=pair?.bayesian?.posterior||{};
  return {
    refinedScore:Number(pair?.refined?.score||0),
    directionalProbability:Math.max(Number(posterior.buy||0),Number(posterior.sell||0)),
    evidenceQuality:Number(pair?.quality?.score||0),
    uncertainty:Number(pair?.uncertainty?.score||0),
    scenarioRobustness:Number(pair?.scenarioRobustness?.score||0),
    contradictions:Number(pair?.contradictions?.count||0),
    reactionGap:Number(pair?.reactionFunctionGap?.differential||0),
    crossAssetScore:Number(pair?.crossAsset?.score||0),
    evidenceCompleteness:Number(pair?.evidenceCompleteness?.score||0),
    releaseDifferential:Number(pair?.temporalIntelligence?.releaseDifferential||0),
    revisionDifferential:Number(pair?.temporalIntelligence?.revisionDifferential||0),
    communicationGap:Number(pair?.temporalIntelligence?.communicationGap||0),
    transitionRisk:Number(pair?.transitionRisk?.maxRisk||0),
    structuralBreakRisk:Number(pair?.structuralBreak?.risk||0),
    independenceRatio:Number(pair?.evidenceIndependence?.independenceRatio??1),
    modelHealth:Number(pair?.modelHealth?.score||0),
    counterfactualShift:Number(pair?.counterfactual?.minimumAdverseShift||100),
    causalNet:Number(pair?.causalTransmission?.netTransmission||0)
  };
}
"""
    text=replace_once(text,anchor,anchor+fn,'decision feature vector function')

if 'featureVector:pairFeatureVector(pair)' not in text:
    text=replace_once(text,
        "contradictions:Number(pair?.contradictions?.count||0),governanceReasons:pair?.final?.reason||[]",
        "contradictions:Number(pair?.contradictions?.count||0),featureVector:pairFeatureVector(pair),governanceReasons:pair?.final?.reason||[]",
        'record decision feature vector')

if 'analogueLibrary' not in text:
    old="""  const decisionChanges=Object.fromEntries(Object.entries(latestBySymbol).map(([symbol,row])=>[symbol,{latest:compactDecision(row.latest),previous:compactDecision(row.previous)}]));
  const summary={generatedAt:new Date().toISOString(),sampledDecisions:documents.length,directionalRecorded,waitRecorded,pending,noVerifiedBaseline:noBaseline,horizons:Object.fromEntries(Object.entries(byHorizon).map(([k,v])=>[k,finalize(v)])),bySymbol:Object.fromEntries(Object.entries(symbolAcc).map(([symbol,map])=>[symbol,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),byConfidence:Object.fromEntries(Object.entries(bucketAcc).map(([bucket,map])=>[bucket,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),decisionChanges,methodology:'Governed decisions are frozen with verified or derived baseline prices, then evaluated only against persisted market snapshots near fixed horizons. Flat moves receive a neutral 0.5 calibration target. Missing snapshots remain missing. The two latest frozen decisions per symbol are retained for change detection and flip-risk governance.'};
"""
    new="""  const decisionChanges=Object.fromEntries(Object.entries(latestBySymbol).map(([symbol,row])=>[symbol,{latest:compactDecision(row.latest),previous:compactDecision(row.previous)}]));
  const analogueLibrary={};for(const document of documents){const symbol=String(document.symbol||'').toUpperCase();if(!symbol||document.direction==='WAIT'||!document.featureVector)continue;const outcomes=document.outcomes||{},usable=['h1','h4','h24'].some(h=>outcomes[h]);if(!usable)continue;const arr=analogueLibrary[symbol]??[];if(arr.length>=16)continue;arr.push({decisionAt:document.decisionAt,direction:document.direction,confidence:Number(document.confidence||0),featureVector:document.featureVector,outcomes:Object.fromEntries(['m15','h1','h4','h24'].filter(h=>outcomes[h]).map(h=>[h,{outcome:outcomes[h].outcome,signedBps:Number(outcomes[h].signedBps||0),brier:Number(outcomes[h].brier||0)}]))});analogueLibrary[symbol]=arr;}
  const summary={generatedAt:new Date().toISOString(),sampledDecisions:documents.length,directionalRecorded,waitRecorded,pending,noVerifiedBaseline:noBaseline,horizons:Object.fromEntries(Object.entries(byHorizon).map(([k,v])=>[k,finalize(v)])),bySymbol:Object.fromEntries(Object.entries(symbolAcc).map(([symbol,map])=>[symbol,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),byConfidence:Object.fromEntries(Object.entries(bucketAcc).map(([bucket,map])=>[bucket,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),decisionChanges,analogueLibrary,methodology:'Governed decisions are frozen with verified or derived baseline prices, then evaluated only against persisted market snapshots near fixed horizons. Flat moves receive a neutral 0.5 calibration target. Missing snapshots remain missing. Recent completed states retain compact feature vectors for no-lookahead historical analogue reasoning.'};
"""
    text=replace_once(text,old,new,'decision analogue library')
path.write_text(text,encoding='utf-8')

# Decision core: nearest-neighbour analogue governance.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function confidenceBucketForCalibration(value){const c=Number(value||0);return c>=80?'80-100':c>=65?'65-79':c>=50?'50-64':'0-49';}\n"
if 'function historicalAnalogueControls(' not in text:
    fn="""function analogueVector({refined,bayesian,quality,uncertainty,scenario,contradictions,reactionFunctionGap,crossAsset,evidenceCompleteness,temporal,transitionRisk,evidenceIndependence,modelHealth,counterfactual,causalTransmission}){
  const p=bayesian?.posterior||{};return {refinedScore:Number(refined?.score||0),directionalProbability:Math.max(Number(p.buy||0),Number(p.sell||0)),evidenceQuality:Number(quality?.score||0),uncertainty:Number(uncertainty?.score||0),scenarioRobustness:Number(scenario?.score||0),contradictions:Number(contradictions?.count||0),reactionGap:Number(reactionFunctionGap?.differential||0),crossAssetScore:Number(crossAsset?.score||0),evidenceCompleteness:Number(evidenceCompleteness?.score||0),releaseDifferential:Number(temporal?.releaseDifferential||0),revisionDifferential:Number(temporal?.revisionDifferential||0),communicationGap:Number(temporal?.communicationGap||0),transitionRisk:Number(transitionRisk?.maxRisk||0),independenceRatio:Number(evidenceIndependence?.independenceRatio??1),modelHealth:Number(modelHealth?.score||0),counterfactualShift:Number(counterfactual?.minimumAdverseShift||100),causalNet:Number(causalTransmission?.netTransmission||0)};
}
const ANALOGUE_SCALES={refinedScore:100,directionalProbability:1,evidenceQuality:100,uncertainty:100,scenarioRobustness:100,contradictions:5,reactionGap:100,crossAssetScore:100,evidenceCompleteness:100,releaseDifferential:100,revisionDifferential:100,communicationGap:100,transitionRisk:100,independenceRatio:1,modelHealth:100,counterfactualShift:100,causalNet:100};
function analogueDistance(a,b){let sum=0,count=0;for(const [key,scale] of Object.entries(ANALOGUE_SCALES)){const av=Number(a?.[key]),bv=Number(b?.[key]);if(!Number.isFinite(av)||!Number.isFinite(bv))continue;const d=(av-bv)/scale;sum+=d*d;count++;}return count?Math.sqrt(sum/count):1;}
function historicalAnalogueControls(decisionMemory,symbol,direction,vector){
  const candidates=(decisionMemory?.analogueLibrary?.[String(symbol||'').toUpperCase()]||[]).filter(x=>x.direction===direction).map(row=>{const distance=analogueDistance(vector,row.featureVector),similarity=Math.exp(-2.8*distance),outcome=row.outcomes?.h4||row.outcomes?.h1||row.outcomes?.h24||row.outcomes?.m15||null;return {...row,distance:Number(distance.toFixed(4)),similarity:Number(similarity.toFixed(4)),selectedOutcome:outcome};}).filter(x=>x.selectedOutcome&&x.similarity>=.30).sort((a,b)=>b.similarity-a.similarity).slice(0,8);
  const weight=candidates.reduce((s,x)=>s+x.similarity,0),hit=weight?candidates.reduce((s,x)=>s+x.similarity*(x.selectedOutcome.outcome==='correct'?1:x.selectedOutcome.outcome==='flat'?.5:0),0)/weight:null,avgBps=weight?candidates.reduce((s,x)=>s+x.similarity*Number(x.selectedOutcome.signedBps||0),0)/weight:null,avgSimilarity=candidates.length?mean(candidates.map(x=>x.similarity)):0,samples=candidates.length,score=hit==null?null:Math.round(100*clamp(.65*hit+.35*clamp((Number(avgBps||0)+5)/12,0,1),0,1)),factor=samples>=5?clamp(.84+.20*Number(score||50)/100,.84,1.04):1,status=samples>=6&&(Number(hit||0)<.38||Number(avgBps||0)<-2)?'adverse':samples>=4?'usable':'building';
  return {status,samples,factor:Number(factor.toFixed(3)),weightedHitRate:hit==null?null:Number((100*hit).toFixed(1)),averageSignedBps:avgBps==null?null:Number(avgBps.toFixed(2)),averageSimilarity:Number(avgSimilarity.toFixed(3)),score,analogues:candidates.map(x=>({decisionAt:x.decisionAt,similarity:x.similarity,distance:x.distance,outcome:x.selectedOutcome.outcome,signedBps:Number(x.selectedOutcome.signedBps||0)}))};
}
"""
    text=replace_once(text,anchor,anchor+fn,'historical analogue functions')

if 'analogueFactor=Number(controls?.historicalAnalogues?.factor||1)' not in text:
    text=replace_once(text,
        "changeFactor=Number(controls?.decisionChange?.factor||1),crossAssetFactorValue=Number(controls?.crossAsset?.factor||1),",
        "changeFactor=Number(controls?.decisionChange?.factor||1),analogueFactor=Number(controls?.historicalAnalogues?.factor||1),crossAssetFactorValue=Number(controls?.crossAsset?.factor||1),",
        'analogue factor declaration')
    text=replace_once(text,
        "*historyFactor*horizonFactor*changeFactor*crossAssetFactorValue*",
        "*historyFactor*horizonFactor*changeFactor*analogueFactor*crossAssetFactorValue*",
        'analogue confidence multiplication')

veto="if(controls?.historicalAnalogues?.status==='adverse'&&Number(controls.historicalAnalogues.samples||0)>=6){direction='WAIT';reason.push('Nearest historical analogues show adverse realized outcomes for this directional state.');}"
if veto not in text:
    marker="if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}"
    text=replace_once(text,marker,marker+'\n  '+veto,'analogue veto')

if 'historicalAnalogues=historicalAnalogueControls(' not in text:
    old="""uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),evidenceCompleteness=evidenceCompletenessControls({quality,causalTransmission,counterfactual,scenario,modelHealth,evidenceIndependence,temporal,marketSignal,crossAsset,historicalCalibration,transitionRisk,reactionFunctionGap}),premortem=buildPremortem"""
    new="""uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),evidenceCompleteness=evidenceCompletenessControls({quality,causalTransmission,counterfactual,scenario,modelHealth,evidenceIndependence,temporal,marketSignal,crossAsset,historicalCalibration,transitionRisk,reactionFunctionGap}),analogueState=analogueVector({refined,bayesian,quality,uncertainty,scenario,contradictions,reactionFunctionGap,crossAsset,evidenceCompleteness,temporal,transitionRisk,evidenceIndependence,modelHealth,counterfactual,causalTransmission}),historicalAnalogues=historicalAnalogueControls(decisionMemory,opportunity.symbol,preferred,analogueState),premortem=buildPremortem"""
    text=replace_once(text,old,new,'analogue pair construction')

if 'decisionChange,historicalAnalogues,crossAsset,reactionFunctionGap' not in text:
    text=replace_once(text,
        'historicalCalibration,horizonCalibration,decisionChange,crossAsset,reactionFunctionGap',
        'historicalCalibration,horizonCalibration,decisionChange,historicalAnalogues,crossAsset,reactionFunctionGap',
        'analogue final controls')

if 'modelHealth,historicalCalibration,horizonCalibration,decisionChange,historicalAnalogues,uncertainty' not in text:
    text=replace_once(text,
        'modelHealth,historicalCalibration,horizonCalibration,decisionChange,uncertainty,premortem',
        'modelHealth,historicalCalibration,horizonCalibration,decisionChange,historicalAnalogues,uncertainty,premortem',
        'analogue pair output')

if 'historicalAnalogues:g.historicalAnalogues' not in text:
    text=replace_once(text,
        'historicalCalibration:g.historicalCalibration,horizonCalibration:g.horizonCalibration,decisionChange:g.decisionChange,uncertainty:g.uncertainty',
        'historicalCalibration:g.historicalCalibration,horizonCalibration:g.horizonCalibration,decisionChange:g.decisionChange,historicalAnalogues:g.historicalAnalogues,uncertainty:g.uncertainty',
        'analogue governed annotation')

principle="'nearest historical analogues can influence confidence only when they use prior frozen states with realized market outcomes'"
if principle not in text:
    marker="'evidence completeness penalizes missing mandatory research layers instead of rewarding only the evidence that happened to be available'"
    text=replace_once(text,marker,marker+','+principle,'analogue principle')

path.write_text(text,encoding='utf-8')
print('Historical analogue v2 applied.')
