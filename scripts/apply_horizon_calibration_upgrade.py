from pathlib import Path


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

# Extend persistent memory summary with latest/previous decisions by symbol.
path=Path('cloud-run-collector/src/decision-memory.js')
text=path.read_text(encoding='utf-8')
old="""  const summary={generatedAt:new Date().toISOString(),sampledDecisions:documents.length,directionalRecorded,waitRecorded,pending,noVerifiedBaseline:noBaseline,horizons:Object.fromEntries(Object.entries(byHorizon).map(([k,v])=>[k,finalize(v)])),bySymbol:Object.fromEntries(Object.entries(symbolAcc).map(([symbol,map])=>[symbol,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),byConfidence:Object.fromEntries(Object.entries(bucketAcc).map(([bucket,map])=>[bucket,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),methodology:'Governed decisions are frozen with verified or derived baseline prices, then evaluated only against persisted market snapshots near fixed horizons. Flat moves receive a neutral 0.5 calibration target. Missing snapshots remain missing.'};
"""
new="""  const latestBySymbol={};for(const document of documents){const symbol=String(document.symbol||'').toUpperCase();if(!symbol)continue;const row=latestBySymbol[symbol]??{latest:null,previous:null};if(!row.latest)row.latest=document;else if(!row.previous)row.previous=document;latestBySymbol[symbol]=row;}
  const compactDecision=document=>document?{id:document.id,symbol:document.symbol,decisionAt:document.decisionAt,direction:document.direction,primaryDirection:document.primaryDirection,refinedScore:Number(document.refinedScore||0),confidence:Number(document.confidence||0),directionProbability:Number(document.directionProbability||0),uncertainty:Number(document.uncertainty||0),scenarioRobustness:Number(document.scenarioRobustness||0),contradictions:Number(document.contradictions||0),evaluationStatus:document.evaluationStatus}:null;
  const decisionChanges=Object.fromEntries(Object.entries(latestBySymbol).map(([symbol,row])=>[symbol,{latest:compactDecision(row.latest),previous:compactDecision(row.previous)}]));
  const summary={generatedAt:new Date().toISOString(),sampledDecisions:documents.length,directionalRecorded,waitRecorded,pending,noVerifiedBaseline:noBaseline,horizons:Object.fromEntries(Object.entries(byHorizon).map(([k,v])=>[k,finalize(v)])),bySymbol:Object.fromEntries(Object.entries(symbolAcc).map(([symbol,map])=>[symbol,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),byConfidence:Object.fromEntries(Object.entries(bucketAcc).map(([bucket,map])=>[bucket,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),decisionChanges,methodology:'Governed decisions are frozen with verified or derived baseline prices, then evaluated only against persisted market snapshots near fixed horizons. Flat moves receive a neutral 0.5 calibration target. Missing snapshots remain missing. The two latest frozen decisions per symbol are retained for change detection and flip-risk governance.'};
"""
text=replace_once(text,old,new,'decision memory change summary')
path.write_text(text,encoding='utf-8')

# Add horizon calibration + change detection to decision core.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function historicalCalibrationControls(decisionMemory,symbol){\n"
functions="""function confidenceBucketForCalibration(value){const c=Number(value||0);return c>=80?'80-100':c>=65?'65-79':c>=50?'50-64':'0-49';}
function horizonCalibrationControls(decisionMemory,symbol,confidence,directionalProbability){
  const horizons=['m15','h1','h4','h24'],pair=decisionMemory?.bySymbol?.[String(symbol||'').toUpperCase()]?.horizons||{},bucket=decisionMemory?.byConfidence?.[confidenceBucketForCalibration(confidence)]?.horizons||{},global=decisionMemory?.horizons||{},rows={};
  for(const horizon of horizons){const candidates=[{level:'pair',stats:pair[horizon],min:8},{level:'confidence',stats:bucket[horizon],min:12},{level:'global',stats:global[horizon],min:18}],selected=candidates.find(x=>Number(x.stats?.count||0)>=x.min)||candidates.find(x=>Number(x.stats?.count||0)>0),stats=selected?.stats||null,samples=Number(stats?.count||0),empiricalHit=Number(stats?.hitRate)/100,validHit=Number.isFinite(empiricalHit),reliability=selected?.level==='pair'?Math.min(.45,samples/40*.45):selected?.level==='confidence'?Math.min(.32,samples/55*.32):Math.min(.22,samples/80*.22),calibrated=validHit?(1-reliability)*Number(directionalProbability||0)+reliability*empiricalHit:Number(directionalProbability||0);rows[horizon]={horizon,source:selected?.level||'none',samples,modelProbability:Number(directionalProbability||0),empiricalHitRate:validHit?empiricalHit:null,calibratedProbability:Number(clamp(calibrated,.01,.99).toFixed(4)),brier:Number.isFinite(Number(stats?.brier))?Number(stats.brier):null,averageSignedBps:Number.isFinite(Number(stats?.averageSignedBps))?Number(stats.averageSignedBps):null,reliability:Number(reliability.toFixed(3)),status:samples>=18?'calibrated':samples>=6?'building':'insufficient'};}
  const useful=Object.values(rows).filter(x=>x.samples>=6),weighted=useful.reduce((s,x)=>s+x.calibratedProbability*Math.max(1,x.samples),0),weight=useful.reduce((s,x)=>s+Math.max(1,x.samples),0),overall=weight?weighted/weight:Number(directionalProbability||0),negativeEdge=Object.values(rows).filter(x=>x.samples>=18&&Number.isFinite(x.averageSignedBps)&&x.averageSignedBps<-1.5),positive=Object.values(rows).filter(x=>x.samples>=10&&Number.isFinite(x.averageSignedBps)&&x.averageSignedBps>1.5).sort((a,b)=>b.averageSignedBps-a.averageSignedBps),preferredHorizon=positive[0]?.horizon||null;
  return {confidenceBucket:confidenceBucketForCalibration(confidence),rows,overallCalibratedProbability:Number(clamp(overall,.01,.99).toFixed(4)),negativeEdgeHorizons:negativeEdge.map(x=>x.horizon),preferredHorizon,status:useful.length>=3?'calibrated':useful.length?'building':'insufficient'};
}
function decisionChangeControls(decisionMemory,symbol,currentDirection,currentScore,currentConfidence,nowMs){
  const history=decisionMemory?.decisionChanges?.[String(symbol||'').toUpperCase()]||{},previous=history.latest||null;if(!previous)return {status:'new',factor:1,previous:null,ageMinutes:null,directionChanged:false,scoreDelta:null,confidenceDelta:null,reasons:[]};const ageMinutes=Math.max(0,(nowMs-Date.parse(previous.decisionAt||0))/60000),directionChanged=previous.direction&&currentDirection&&previous.direction!==currentDirection&&previous.direction!=='WAIT'&&currentDirection!=='WAIT',scoreDelta=Number(currentScore||0)-Number(previous.refinedScore||0),confidenceDelta=Number(currentConfidence||0)-Number(previous.confidence||0),reasons=[];let factor=1,status='stable';if(directionChanged&&ageMinutes<=30){factor=.78;status='fresh-flip';reasons.push('Directional state flipped within 30 minutes.');}else if(directionChanged&&ageMinutes<=120){factor=.90;status='recent-flip';reasons.push('Directional state changed within the last two hours.');}if(Math.abs(scoreDelta)>=35){factor*=.95;reasons.push('Refined score changed materially from the prior frozen decision.');}if(confidenceDelta<=-20){factor*=.96;reasons.push('Governed confidence deteriorated sharply from the prior decision.');}return {status,factor:Number(clamp(factor,.70,1).toFixed(3)),previous,ageMinutes:Math.round(ageMinutes),directionChanged,scoreDelta:Math.round(scoreDelta),confidenceDelta:Math.round(confidenceDelta),reasons};
}
"""
text=replace_once(text,anchor,functions+anchor,'horizon and change controls')

# Confidence formula gains historical horizon and change factors.
old="""  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),transitionFactor=Number(controls?.transitionRisk?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);
  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*counterfactualFactor*temporalFactor*transitionFactor*independenceFactor*uncertaintyPenalty);
"""
new="""  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),horizonProbability=Number(controls?.horizonCalibration?.overallCalibratedProbability||maxDirectional),horizonFactor=clamp(.78+.22*(horizonProbability/.5),.72,1.08),changeFactor=Number(controls?.decisionChange?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),transitionFactor=Number(controls?.transitionRisk?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);
  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*horizonFactor*changeFactor*counterfactualFactor*temporalFactor*transitionFactor*independenceFactor*uncertaintyPenalty);
"""
text=replace_once(text,old,new,'horizon confidence formula')

# Add vetoes for repeated negative realized edge and fragile fresh flips.
old="""  if(controls?.historicalCalibration?.status==='degraded'&&Number(controls.historicalCalibration.samples||0)>=20){direction='WAIT';reason.push('Historical decision calibration for this pair is degraded and requires revalidation.');}
  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}
"""
new="""  if(controls?.historicalCalibration?.status==='degraded'&&Number(controls.historicalCalibration.samples||0)>=20){direction='WAIT';reason.push('Historical decision calibration for this pair is degraded and requires revalidation.');}
  if((controls?.horizonCalibration?.negativeEdgeHorizons||[]).length>=2){direction='WAIT';reason.push('Multiple sufficiently sampled decision horizons show negative realized directional edge.');}
  if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}
  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}
"""
text=replace_once(text,old,new,'horizon and flip vetoes')

# Add controls to pair construction. Find current advanced line after v4.13 additions.
old_fragment="""historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition"""
new_fragment="""historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),directionalProbability=Math.max(bayesian.posterior.buy,bayesian.posterior.sell),horizonCalibration=horizonCalibrationControls(decisionMemory,opportunity.symbol,Number(opportunity.confidence||0),directionalProbability),decisionChange=decisionChangeControls(decisionMemory,opportunity.symbol,preferred,refined.score,Number(opportunity.confidence||0),nowMs),uncertainty=uncertaintyDecomposition"""
text=replace_once(text,old_fragment,new_fragment,'pair horizon control construction')

old_controls="""{scenario,risk,modelHealth,historicalCalibration,counterfactual,temporal,transitionRisk,evidenceIndependence,uncertainty}"""
new_controls="""{scenario,risk,modelHealth,historicalCalibration,horizonCalibration,decisionChange,counterfactual,temporal,transitionRisk,evidenceIndependence,uncertainty}"""
text=replace_once(text,old_controls,new_controls,'final decision horizon controls')

old_return="""modelHealth,historicalCalibration,uncertainty,premortem,thesis,final"""
new_return="""modelHealth,historicalCalibration,horizonCalibration,decisionChange,uncertainty,premortem,thesis,final"""
text=replace_once(text,old_return,new_return,'pair horizon output')

text=text.replace("'highly correlated macro series are clustered so apparent breadth cannot masquerade as independent evidence'","'highly correlated macro series are clustered so apparent breadth cannot masquerade as independent evidence','historical calibration is horizon-specific and hierarchically backs off from pair to confidence bucket to global samples','fresh directional flips are treated as whipsaw risk until evidence is strong enough'",1)
path.write_text(text,encoding='utf-8')

# Ensure portfolio annotation preserves the new controls.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
old="""historicalCalibration:g.historicalCalibration,uncertainty:g.uncertainty,premortem:g.premortem"""
new="""historicalCalibration:g.historicalCalibration,horizonCalibration:g.horizonCalibration,decisionChange:g.decisionChange,uncertainty:g.uncertainty,premortem:g.premortem"""
text=replace_once(text,old,new,'portfolio horizon annotation')
path.write_text(text,encoding='utf-8')
print('Horizon calibration and decision change memory upgrade applied.')
