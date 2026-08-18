from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function causalTransmissionForPair(opportunity,economies,marketSignal){\n"
fn="""function reactionFunctionForEconomy(state){
  if(!state)return {available:false,dataPressure:0,policyEvidence:0,gap:0,status:'unavailable',components:{}};
  const inflation=dimensionScore(state,'inflation'),labour=dimensionScore(state,'labour'),growth=dimensionScore(state,'growth'),policy=dimensionScore(state,'policy'),financial=dimensionScore(state,'financial');
  const dataPressure=.48*inflation+.25*labour+.17*growth+.10*financial,gap=dataPressure-policy,status=gap>=18?'hawkish-repricing-risk':gap<=-18?'dovish-repricing-risk':'policy-near-data';
  return {available:true,economy:state.id,currency:state.currency,centralBank:state.centralBank,dataPressure:Math.round(dataPressure),policyEvidence:Math.round(policy),gap:Math.round(gap),status,components:{inflation:Math.round(inflation),labour:Math.round(labour),growth:Math.round(growth),financial:Math.round(financial),policy:Math.round(policy)}};
}
function reactionFunctionGapForPair(opportunity,economies){
  const [base,quote]=currenciesForSymbol(opportunity.symbol),baseState=base==='XAU'?null:economyStateForCurrency(economies,base),quoteState=economyStateForCurrency(economies,quote),baseGap=base==='XAU'?{available:false,currency:'XAU',gap:0,status:'not-applicable'}:reactionFunctionForEconomy(baseState),quoteGap=reactionFunctionForEconomy(quoteState),differential=base==='XAU'?-Number(quoteGap.gap||0):Number(baseGap.gap||0)-Number(quoteGap.gap||0),direction=Math.sign(Number(opportunity?.score||0))||1,alignment=Math.abs(differential)<12?'neutral':Math.sign(differential)===direction?'aligned':'opposed',factor=alignment==='aligned'?clamp(1+Math.min(.06,Math.abs(differential)/1200),1,1.06):alignment==='opposed'?clamp(1-Math.min(.13,Math.abs(differential)/700),.87,1):1;
  return {symbol:opportunity.symbol,base:baseGap,quote:quoteGap,differential:Math.round(differential),alignment,factor:Number(factor.toFixed(3)),status:Math.abs(differential)>=35?(alignment==='aligned'?'strong-repricing-support':'strong-repricing-conflict'):Math.abs(differential)>=15?(alignment==='aligned'?'repricing-support':'repricing-conflict'):'balanced'};
}
"""
text=replace_once(text,anchor,fn+anchor,'reaction function gap functions')

# Add reaction factor to final confidence.
old="""  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),horizonProbability=Number(controls?.horizonCalibration?.overallCalibratedProbability||maxDirectional),horizonFactor=clamp(.78+.22*(horizonProbability/.5),.72,1.08),changeFactor=Number(controls?.decisionChange?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),transitionFactor=Number(controls?.transitionRisk?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);
  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*horizonFactor*changeFactor*counterfactualFactor*temporalFactor*transitionFactor*independenceFactor*uncertaintyPenalty);
"""
new="""  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),horizonProbability=Number(controls?.horizonCalibration?.overallCalibratedProbability||maxDirectional),horizonFactor=clamp(.78+.22*(horizonProbability/.5),.72,1.08),changeFactor=Number(controls?.decisionChange?.factor||1),reactionFactor=Number(controls?.reactionFunctionGap?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),transitionFactor=Number(controls?.transitionRisk?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);
  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*horizonFactor*changeFactor*reactionFactor*counterfactualFactor*temporalFactor*transitionFactor*independenceFactor*uncertaintyPenalty);
"""
text=replace_once(text,old,new,'reaction confidence factor')

# Strong opposed repricing can veto marginal decisions.
old="""  if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}
  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}
"""
new="""  if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}
  if(controls?.reactionFunctionGap?.status==='strong-repricing-conflict'&&Math.abs(Number(refined?.score||0))<50){direction='WAIT';reason.push('Central-bank reaction-function repricing risk materially opposes the directional thesis.');}
  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}
"""
text=replace_once(text,old,new,'reaction function veto')

# Add to pair construction after refined score.
old_fragment="""refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),causalTransmission=causalTransmissionForPair"""
new_fragment="""refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),reactionFunctionGap=reactionFunctionGapForPair(opportunity,economies),causalTransmission=causalTransmissionForPair"""
text=replace_once(text,old_fragment,new_fragment,'pair reaction gap construction')

old_controls="""{scenario,risk,modelHealth,historicalCalibration,horizonCalibration,decisionChange,counterfactual,temporal,transitionRisk,evidenceIndependence,uncertainty}"""
new_controls="""{scenario,risk,modelHealth,historicalCalibration,horizonCalibration,decisionChange,reactionFunctionGap,counterfactual,temporal,transitionRisk,evidenceIndependence,uncertainty}"""
text=replace_once(text,old_controls,new_controls,'reaction gap final controls')

old_return="""refined,causalTransmission,counterfactual"""
new_return="""refined,reactionFunctionGap,causalTransmission,counterfactual"""
text=replace_once(text,old_return,new_return,'reaction gap output')

# Preserve inside governed matrix annotation.
old_annotation="""refinedScore:g.refined.score,expectationGap:g.expectationGap,contradictions:g.contradictions,thesis:g.thesis"""
new_annotation="""refinedScore:g.refined.score,expectationGap:g.expectationGap,reactionFunctionGap:g.reactionFunctionGap,contradictions:g.contradictions,thesis:g.thesis"""
text=replace_once(text,old_annotation,new_annotation,'reaction gap portfolio annotation')
text=text.replace("'fresh directional flips are treated as whipsaw risk until evidence is strong enough'","'fresh directional flips are treated as whipsaw risk until evidence is strong enough','central-bank reaction-function gaps identify future policy repricing risk relative to growth, inflation and labour pressure'",1)
path.write_text(text,encoding='utf-8')
print('Central-bank reaction function gap upgrade applied.')
