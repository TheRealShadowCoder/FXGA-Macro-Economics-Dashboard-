from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/institutional-research.js')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"  const rmse=Object.fromEntries(names.map(name=>{const xs=errors[name];return [name,xs.length?Math.sqrt(mean(xs.map(e=>e*e))):null];}));\n",
"  const rmse=Object.fromEntries(names.map(name=>{const xs=errors[name];return [name,xs.length?Math.sqrt(mean(xs.map(e=>e*e))):null];}));\n  const bias=Object.fromEntries(names.map(name=>{const xs=errors[name];return [name,xs.length?mean(xs):null];}));\n  const recentRmse=Object.fromEntries(names.map(name=>{const xs=errors[name],recent=xs.slice(-Math.max(2,Math.ceil(xs.length/2)));return [name,recent.length?Math.sqrt(mean(recent.map(e=>e*e))):null];}));\n  const earlierRmse=Object.fromEntries(names.map(name=>{const xs=errors[name],earlier=xs.slice(0,Math.max(0,xs.length-Math.max(2,Math.ceil(xs.length/2))));return [name,earlier.length?Math.sqrt(mean(earlier.map(e=>e*e))):null];}));\n  const driftRatio=Object.fromEntries(names.map(name=>{const r=recentRmse[name],e=earlierRmse[name];return [name,Number.isFinite(r)&&Number.isFinite(e)&&e>1e-12?r/e:null];}));\n",
'walk-forward error attribution')
text=replace_once(text,
"  return {validationPoints,rmse,weights};\n",
"  return {validationPoints,rmse,bias,recentRmse,earlierRmse,driftRatio,weights};\n",
'calibration return')
text=replace_once(text,
"    const validationSufficiency=clamp(calibration.validationPoints/10,0,1),calibrationConfidence=agreement*(.4+.6*validationSufficiency);\n    const uncertainty=Math.sqrt(residualScale*residualScale+modelDispersion*modelDispersion);\n",
"    const validationSufficiency=clamp(calibration.validationPoints/10,0,1),calibrationConfidence=agreement*(.4+.6*validationSufficiency);\n    const weightedDrift=Object.entries(calibration.weights).reduce((s,[name,w])=>s+Number(w||0)*Math.max(0,Number(calibration.driftRatio[name]??1)-1),0);\n    const driftScore=Math.round(100*clamp(weightedDrift/1.25,0,1)),driftStatus=driftScore>=65?'drifting':driftScore>=35?'watch':'stable';\n    const weightedBias=Object.entries(calibration.weights).reduce((s,[name,w])=>s+Number(w||0)*Number(calibration.bias[name]||0),0);\n    const driftPenalty=clamp(1-driftScore/180,.55,1),effectiveCalibrationConfidence=calibrationConfidence*driftPenalty;\n    const uncertainty=Math.sqrt(residualScale*residualScale+modelDispersion*modelDispersion+(weightedBias*weightedBias));\n",
'drift score')
text=replace_once(text,
"    const probabilityUp=sigmoid(delta/Math.max(uncertainty,1e-9)*(1+.75*calibrationConfidence));\n",
"    const probabilityUp=sigmoid(delta/Math.max(uncertainty,1e-9)*(1+.75*effectiveCalibrationConfidence));\n",
'drift-adjusted probability')
text=replace_once(text,
"      modelWeights:calibration.weights,walkForwardRmse:calibration.rmse,validationPoints:calibration.validationPoints,\n      modelAgreement:Number(agreement.toFixed(4)),calibrationConfidence:Number(calibrationConfidence.toFixed(4)),\n",
"      modelWeights:calibration.weights,walkForwardRmse:calibration.rmse,walkForwardBias:calibration.bias,recentRmse:calibration.recentRmse,earlierRmse:calibration.earlierRmse,driftRatio:calibration.driftRatio,validationPoints:calibration.validationPoints,\n      modelAgreement:Number(agreement.toFixed(4)),calibrationConfidence:Number(effectiveCalibrationConfidence.toFixed(4)),rawCalibrationConfidence:Number(calibrationConfidence.toFixed(4)),driftScore,driftStatus,forecastBias:weightedBias,\n",
'forecast drift output')
anchor="function buildReleaseAnalytics(events=[]){\n"
fn="""function buildModelHealth(forecasts=[]){
  const calibrated=forecasts.filter(f=>Number(f?.validationPoints||0)>0);
  if(!calibrated.length)return {score:0,status:'insufficient',calibratedForecasts:0,totalForecasts:forecasts.length,averageCalibrationConfidence:0,averageDriftScore:0,drifting:0,watch:0,stable:0};
  const avgCalibration=mean(calibrated.map(f=>Number(f.calibrationConfidence||0))),avgDrift=mean(calibrated.map(f=>Number(f.driftScore||0))),validationCoverage=calibrated.length/Math.max(1,forecasts.length),score=Math.round(100*clamp(.50*avgCalibration+.30*(1-avgDrift/100)+.20*validationCoverage,0,1));
  return {score,status:score>=78?'healthy':score>=58?'watch':'degraded',calibratedForecasts:calibrated.length,totalForecasts:forecasts.length,validationCoverage:Number(validationCoverage.toFixed(4)),averageCalibrationConfidence:Number(avgCalibration.toFixed(4)),averageDriftScore:Math.round(avgDrift),drifting:calibrated.filter(f=>f.driftStatus==='drifting').length,watch:calibrated.filter(f=>f.driftStatus==='watch').length,stable:calibrated.filter(f=>f.driftStatus==='stable').length,highestDrift:[...calibrated].sort((a,b)=>Number(b.driftScore||0)-Number(a.driftScore||0)).slice(0,12).map(f=>({seriesId:f.seriesId,title:f.title,driftScore:f.driftScore,driftStatus:f.driftStatus,calibrationConfidence:f.calibrationConfidence,forecastBias:f.forecastBias}))};
}

"""
text=replace_once(text,anchor,fn+anchor,'model health function')
text=replace_once(text,
"  const forecasts=buildForecasts(observations);\n  const releaseAnalytics=buildReleaseAnalytics(events);\n",
"  const forecasts=buildForecasts(observations);\n  const modelHealth=buildModelHealth(forecasts);\n  const releaseAnalytics=buildReleaseAnalytics(events);\n",
'model health build')
text=replace_once(text,
"    dataQuality,sourceReliability,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,\n",
"    dataQuality,sourceReliability,modelHealth,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,\n",
'model health output')
text=text.replace("'model-disagreement-uncertainty','uncertainty-calibration'","'model-disagreement-uncertainty','forecast-error-attribution','model-drift-detection','drift-adjusted-confidence','uncertainty-calibration'",1)
path.write_text(text,encoding='utf-8')

# Feed model health into the governance confidence layer.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function researchRiskControls(research){\n"
fn="""function modelHealthControls(research){
  const health=research?.modelHealth||{},score=Number(health.score||0),status=String(health.status||'insufficient');
  const factor=score>0?clamp(.55+.45*score/100,.55,1):.82;
  return {score,status,factor:Number(factor.toFixed(3)),drifting:Number(health.drifting||0),watch:Number(health.watch||0),calibratedForecasts:Number(health.calibratedForecasts||0),averageDriftScore:Number(health.averageDriftScore||0)};
}
"""
text=replace_once(text,anchor,fn+anchor,'model health governance')
text=replace_once(text,
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*uncertaintyPenalty);\n",
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*uncertaintyPenalty);\n",
'model health confidence factor')
text=replace_once(text,
"  if(Number(controls?.risk?.aggregate||0)>=78){direction='WAIT';reason.push('Research risk state is too elevated for directional execution.');}\n",
"  if(Number(controls?.risk?.aggregate||0)>=78){direction='WAIT';reason.push('Research risk state is too elevated for directional execution.');}\n  if(controls?.modelHealth?.status==='degraded'&&Number(controls.modelHealth.calibratedForecasts||0)>=5){direction='WAIT';reason.push('Forecast model health is degraded across validated series.');}\n",
'model health veto')
text=replace_once(text,
"    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,scenarioRobustness:scenario,riskControls:risk,uncertainty,premortem,thesis,final};\n",
"    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,scenarioRobustness:scenario,riskControls:risk,modelHealth,uncertainty,premortem,thesis,final};\n",
'pair model health')
text=text.replace("'research risk applies an explicit haircut'","'research risk applies an explicit haircut','forecast models lose confidence when walk-forward errors deteriorate'",1)
path.write_text(text,encoding='utf-8')
print('Model drift and forecast error attribution upgrade applied.')
