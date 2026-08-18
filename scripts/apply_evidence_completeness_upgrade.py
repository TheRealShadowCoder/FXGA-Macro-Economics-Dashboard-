from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function evidenceIndependenceControls(research,symbol){\n"
if 'function evidenceCompletenessControls(' not in text:
    fn="""function evidenceCompletenessControls({quality,causalTransmission,counterfactual,scenario,modelHealth,evidenceIndependence,temporal,marketSignal,crossAsset,historicalCalibration,transitionRisk,reactionFunctionGap}){
  const checks=[
    {id:'macro-quality',weight:18,mandatory:true,score:clamp(Number(quality?.score||0)/75,0,1),available:Number(quality?.score||0)>=45},
    {id:'causal-chain',weight:14,mandatory:true,score:clamp(Number(causalTransmission?.availableNodes||0)/5,0,1),available:Number(causalTransmission?.availableNodes||0)>=3},
    {id:'counterfactual-stress',weight:9,mandatory:true,score:clamp(Number(counterfactual?.tests?.length||0)/4,0,1),available:Number(counterfactual?.tests?.length||0)>=3},
    {id:'scenario-robustness',weight:8,mandatory:false,score:scenario?.available?clamp(Number(scenario.score||0)/70,0,1):.45,available:Boolean(scenario?.available)},
    {id:'adaptive-models',weight:10,mandatory:false,score:Number(modelHealth?.calibratedForecasts||0)>0?clamp(Number(modelHealth?.score||0)/80,0,1):.45,available:Number(modelHealth?.calibratedForecasts||0)>0},
    {id:'independent-evidence',weight:10,mandatory:false,score:clamp(Number(evidenceIndependence?.independenceRatio??.5),0,1),available:Boolean(evidenceIndependence)},
    {id:'temporal-history',weight:7,mandatory:false,score:((Number(temporal?.base?.release?.count||0)+Number(temporal?.quote?.release?.count||0))>=2)?1:.5,available:((Number(temporal?.base?.release?.count||0)+Number(temporal?.quote?.release?.count||0))>=2)},
    {id:'market-confirmation',weight:8,mandatory:false,score:(crossAsset?.available||marketSignal?.available)?1:.45,available:Boolean(crossAsset?.available||marketSignal?.available)},
    {id:'historical-calibration',weight:6,mandatory:false,score:Number(historicalCalibration?.samples||0)>=8?1:Number(historicalCalibration?.samples||0)>0?.65:.4,available:Number(historicalCalibration?.samples||0)>0},
    {id:'transition-state',weight:5,mandatory:false,score:transitionRisk?1:.5,available:Boolean(transitionRisk)},
    {id:'reaction-function',weight:5,mandatory:false,score:(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)?1:.5,available:Boolean(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)},
  ];
  const totalWeight=checks.reduce((s,x)=>s+x.weight,0),earned=checks.reduce((s,x)=>s+x.weight*x.score,0),score=Math.round(100*earned/Math.max(1,totalWeight)),mandatoryMissing=checks.filter(x=>x.mandatory&&!x.available).map(x=>x.id),missing=checks.filter(x=>!x.available).map(x=>x.id),available=checks.filter(x=>x.available).map(x=>x.id),factor=clamp(.80+.20*score/100,.80,1),status=mandatoryMissing.length?'insufficient':score>=82?'complete':score>=68?'adequate':score>=55?'partial':'thin';
  return {score,status,factor:Number(factor.toFixed(3)),mandatoryMissing,missing,available,checks:checks.map(x=>({id:x.id,weight:x.weight,mandatory:x.mandatory,available:x.available,score:Number(x.score.toFixed(3))}))};
}
"""
    text=replace_once(text,anchor,fn+anchor,'evidence completeness function')

if 'completenessFactor=Number(controls?.evidenceCompleteness?.factor||1)' not in text:
    text=replace_once(text,
        "independenceFactor=Number(controls?.evidenceIndependence?.factor||1),uncertaintyPenalty=",
        "independenceFactor=Number(controls?.evidenceIndependence?.factor||1),completenessFactor=Number(controls?.evidenceCompleteness?.factor||1),uncertaintyPenalty=",
        'completeness factor declaration')
    text=replace_once(text,
        "*transitionFactor*independenceFactor*uncertaintyPenalty",
        "*transitionFactor*independenceFactor*completenessFactor*uncertaintyPenalty",
        'completeness confidence multiplication')

veto="if((controls?.evidenceCompleteness?.mandatoryMissing||[]).length||Number(controls?.evidenceCompleteness?.score||100)<50){direction='WAIT';reason.push('Mandatory research evidence is incomplete for directional execution.');}"
if veto not in text:
    marker="if(controls?.transitionRisk?.status==='high'&&Number(controls.transitionRisk.maxRisk||0)>=82){direction='WAIT';reason.push('Macro turning-point risk is too high for a stable directional thesis.');}"
    text=replace_once(text,marker,marker+'\n  '+veto,'evidence completeness veto')

# Construct completeness after all underlying controls exist and before final decision.
if 'evidenceCompleteness=evidenceCompletenessControls(' not in text:
    marker="premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair"
    replacement="evidenceCompleteness=evidenceCompletenessControls({quality,causalTransmission,counterfactual,scenario,modelHealth,evidenceIndependence,temporal,marketSignal,crossAsset,historicalCalibration,transitionRisk,reactionFunctionGap:(typeof reactionFunctionGap==='undefined'?null:reactionFunctionGap)}),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair"
    text=replace_once(text,marker,replacement,'evidence completeness pair construction')

# Add to final control object using the stable uncertainty tail.
if 'evidenceIndependence,evidenceCompleteness,uncertainty' not in text:
    text=replace_once(text,'evidenceIndependence,uncertainty','evidenceIndependence,evidenceCompleteness,uncertainty','evidence completeness final controls')
if 'evidenceIndependence,evidenceCompleteness,scenarioRobustness' not in text:
    text=replace_once(text,'evidenceIndependence,scenarioRobustness','evidenceIndependence,evidenceCompleteness,scenarioRobustness','evidence completeness pair output')
if 'evidenceCompleteness:g.evidenceCompleteness' not in text:
    text=replace_once(text,'evidenceIndependence:g.evidenceIndependence,','evidenceIndependence:g.evidenceIndependence,evidenceCompleteness:g.evidenceCompleteness,','evidence completeness governed annotation')
principle="'evidence completeness penalizes missing mandatory research layers instead of rewarding only the evidence that happened to be available'"
if principle not in text:
    marker="'highly correlated macro series are clustered so apparent breadth cannot masquerade as independent evidence'"
    text=replace_once(text,marker,marker+','+principle,'evidence completeness principle')
path.write_text(text,encoding='utf-8')
print('Evidence completeness governance upgrade applied.')
