from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

# Research layer.
path=Path('cloud-run-collector/src/institutional-research.js')
text=path.read_text(encoding='utf-8')
if 'function buildStructuralBreaks(' not in text:
    anchor="function ar1Forecast(values){\n"
    fn="""function structuralBreakForSeries(item){
  const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite);if(values.length<12)return null;
  const recent=values.slice(-4),prior=values.slice(-12,-4);if(prior.length<6)return null;
  const recentMean=mean(recent),priorMean=mean(prior),priorSd=Math.max(stdev(prior),Math.abs(priorMean)*.003,1e-9),recentSd=stdev(recent),levelShift=Math.abs(recentMean-priorMean)/priorSd,varianceRatio=recentSd*recentSd/Math.max(priorSd*priorSd,1e-12),priorSlope=(prior.at(-1)-prior[0])/Math.max(1,prior.length-1),recentSlope=(recent.at(-1)-recent[0])/Math.max(1,recent.length-1),directionFlip=Math.sign(priorSlope)!==0&&Math.sign(recentSlope)!==0&&Math.sign(priorSlope)!==Math.sign(recentSlope),varianceShock=Math.abs(Math.log(Math.max(varianceRatio,1e-6))),score=Math.round(clamp(24*levelShift+18*varianceShock+(directionFlip?22:0),0,100));
  return {seriesId:item.seriesId,title:item.title,economy:item.economy||item.economies?.[0]||'GLOBAL',family:macroFamily(item),score,status:score>=78?'break':score>=52?'watch':'stable',levelShift:Number(levelShift.toFixed(3)),varianceRatio:Number(varianceRatio.toFixed(3)),directionFlip,recentMean:Number(recentMean.toFixed(6)),priorMean:Number(priorMean.toFixed(6)),recentSlope:Number(recentSlope.toFixed(6)),priorSlope:Number(priorSlope.toFixed(6)),sampleSize:values.length};
}
function buildStructuralBreaks(observations=[]){
  const series=observations.map(structuralBreakForSeries).filter(Boolean).sort((a,b)=>b.score-a.score),groups={};
  for(const row of series){const key=`${row.economy}:${row.family}`;(groups[key]??=[]).push(row);}
  const families=Object.entries(groups).map(([key,rows])=>{const [economy,family]=key.split(':'),maxRisk=Math.max(...rows.map(x=>x.score)),avg=mean(rows.map(x=>x.score)),breaks=rows.filter(x=>x.status==='break').length,watch=rows.filter(x=>x.status==='watch').length,risk=Math.round(clamp(.55*maxRisk+.45*avg,0,100));return {economy,family,risk,status:risk>=72?'break':risk>=48?'watch':'stable',breaks,watch,series:rows.length,topSeries:rows.slice(0,5)};}).sort((a,b)=>b.risk-a.risk);
  const economyMap={};for(const row of families)(economyMap[row.economy]??=[]).push(row);
  const economies=Object.entries(economyMap).map(([economy,rows])=>({economy,risk:Math.round(Math.max(...rows.map(x=>x.risk))),breakFamilies:rows.filter(x=>x.status==='break').length,watchFamilies:rows.filter(x=>x.status==='watch').length,status:rows.some(x=>x.status==='break')?'break':rows.some(x=>x.status==='watch')?'watch':'stable',families:rows})).sort((a,b)=>b.risk-a.risk);
  return {generatedAt:iso(),series:series.slice(0,220),families,economies,breakSeries:series.filter(x=>x.status==='break').length,watchSeries:series.filter(x=>x.status==='watch').length,methodology:'Recent four-observation level, variance and slope behavior is compared with the preceding eight observations. This is a structural-instability diagnostic, not a claim of causal break timing.'};
}

"""
    text=replace_once(text,anchor,fn+anchor,'research structural-break functions')
if 'const structuralBreaks=buildStructuralBreaks(observations);' not in text:
    text=replace_once(text,'  const features=buildFeatures(observations);\n  const turningPoints=buildTurningPoints(features);','  const features=buildFeatures(observations);\n  const structuralBreaks=buildStructuralBreaks(observations);\n  const turningPoints=buildTurningPoints(features);','research structural-break build')
if 'modelHealth,structuralBreaks,turningPoints' not in text:
    text=replace_once(text,'dataQuality,sourceReliability,evidenceIndependence,modelHealth,turningPoints,catalystSequence','dataQuality,sourceReliability,evidenceIndependence,modelHealth,structuralBreaks,turningPoints,catalystSequence','research structural-break output')
path.write_text(text,encoding='utf-8')

# Decision governance layer.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
if 'function structuralBreakControls(' not in text:
    anchor="function transitionRiskControls(research,symbol){\n"
    fn="""function structuralBreakControls(research,symbol){
  const [base,quote]=currenciesForSymbol(symbol),lookup=currency=>research?.structuralBreaks?.economies?.find(x=>x.economy===ECONOMY_BY_CURRENCY[currency])||null,baseRow=base==='XAU'?null:lookup(base),quoteRow=lookup(quote),risks=[baseRow?.risk,quoteRow?.risk].filter(Number.isFinite),risk=risks.length?Math.max(...risks):0,status=risk>=78?'break':risk>=52?'watch':'stable',factor=status==='break'?clamp(1-risk/500,.80,.86):status==='watch'?clamp(1-risk/700,.90,.95):1;
  return {status,risk,factor:Number(factor.toFixed(3)),base:baseRow,quote:quoteRow,breakSeries:Number(research?.structuralBreaks?.breakSeries||0),watchSeries:Number(research?.structuralBreaks?.watchSeries||0)};
}
"""
    text=replace_once(text,anchor,fn+anchor,'decision structural-break function')

if 'breakFactor=Number(controls?.structuralBreak?.factor||1)' not in text:
    text=replace_once(text,
        'transitionFactor=Number(controls?.transitionRisk?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),',
        'transitionFactor=Number(controls?.transitionRisk?.factor||1),breakFactor=Number(controls?.structuralBreak?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),',
        'structural-break factor declaration')
    text=replace_once(text,
        '*counterfactualFactor*temporalFactor*transitionFactor*independenceFactor*',
        '*counterfactualFactor*temporalFactor*transitionFactor*breakFactor*independenceFactor*',
        'structural-break factor multiplication')

veto="if(controls?.structuralBreak?.status==='break'&&Number(controls.structuralBreak.risk||0)>=88&&Math.abs(Number(refined?.score||0))<55){direction='WAIT';reason.push('A major macro structural-break warning makes the historical relationship unstable.');}"
if veto not in text:
    marker="if(controls?.transitionRisk?.status==='high'&&Number(controls.transitionRisk.maxRisk||0)>=82){direction='WAIT';reason.push('Macro turning-point risk is too high for a stable directional thesis.');}"
    text=replace_once(text,marker,marker+'\n  '+veto,'structural-break veto')

if 'structuralBreak=structuralBreakControls(research,opportunity.symbol)' not in text:
    text=replace_once(text,
        'transitionRisk=transitionRiskControls(research,opportunity.symbol),evidenceIndependence=evidenceIndependenceControls',
        'transitionRisk=transitionRiskControls(research,opportunity.symbol),structuralBreak=structuralBreakControls(research,opportunity.symbol),evidenceIndependence=evidenceIndependenceControls',
        'structural-break pair construction')

# Feed structural stability into completeness.
if 'transitionRisk,structuralBreak,reactionFunctionGap' not in text.split('function evidenceCompletenessControls',1)[1].split('){',1)[0]:
    text=replace_once(text,
        'historicalCalibration,transitionRisk,reactionFunctionGap}){',
        'historicalCalibration,transitionRisk,structuralBreak,reactionFunctionGap}){',
        'completeness structural-break signature')
if "id:'structural-stability'" not in text:
    text=replace_once(text,
        "    {id:'transition-state',weight:5,mandatory:false,score:transitionRisk?1:.5,available:Boolean(transitionRisk)},\n    {id:'reaction-function',weight:5,mandatory:false,score:(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)?1:.5,available:Boolean(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)},",
        "    {id:'transition-state',weight:5,mandatory:false,score:transitionRisk?1:.5,available:Boolean(transitionRisk)},\n    {id:'structural-stability',weight:5,mandatory:false,score:structuralBreak?clamp(1-Number(structuralBreak.risk||0)/100,0,1):.5,available:Boolean(structuralBreak)},\n    {id:'reaction-function',weight:5,mandatory:false,score:(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)?1:.5,available:Boolean(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)},",
        'completeness structural stability check')
if 'historicalCalibration,transitionRisk,structuralBreak,reactionFunctionGap})' not in text:
    text=replace_once(text,
        'crossAsset,historicalCalibration,transitionRisk,reactionFunctionGap})',
        'crossAsset,historicalCalibration,transitionRisk,structuralBreak,reactionFunctionGap})',
        'completeness structural-break call')

# Feed structural state into historical analogues.
if 'temporal,transitionRisk,structuralBreak,evidenceIndependence' not in text.split('function analogueVector',1)[1].split('}){',1)[0]:
    text=replace_once(text,
        'evidenceCompleteness,temporal,transitionRisk,evidenceIndependence,modelHealth',
        'evidenceCompleteness,temporal,transitionRisk,structuralBreak,evidenceIndependence,modelHealth',
        'analogue structural-break signature')
if 'structuralBreakRisk:Number(structuralBreak?.risk||0)' not in text:
    text=replace_once(text,
        'transitionRisk:Number(transitionRisk?.maxRisk||0),independenceRatio:',
        'transitionRisk:Number(transitionRisk?.maxRisk||0),structuralBreakRisk:Number(structuralBreak?.risk||0),independenceRatio:',
        'analogue structural-break vector')
if 'structuralBreakRisk:100' not in text:
    text=replace_once(text,
        'transitionRisk:100,independenceRatio:1,',
        'transitionRisk:100,structuralBreakRisk:100,independenceRatio:1,',
        'analogue structural-break scale')
if 'temporal,transitionRisk,structuralBreak,evidenceIndependence,modelHealth' not in text:
    text=replace_once(text,
        'evidenceCompleteness,temporal,transitionRisk,evidenceIndependence,modelHealth,counterfactual,causalTransmission}),historicalAnalogues=',
        'evidenceCompleteness,temporal,transitionRisk,structuralBreak,evidenceIndependence,modelHealth,counterfactual,causalTransmission}),historicalAnalogues=',
        'analogue structural-break call')

if 'temporal,transitionRisk,structuralBreak,evidenceIndependence,evidenceCompleteness,uncertainty' not in text:
    text=replace_once(text,
        'counterfactual,temporal,transitionRisk,evidenceIndependence,evidenceCompleteness,uncertainty',
        'counterfactual,temporal,transitionRisk,structuralBreak,evidenceIndependence,evidenceCompleteness,uncertainty',
        'final controls structural-break')
if 'temporalIntelligence:temporal,transitionRisk,structuralBreak,evidenceIndependence' not in text:
    text=replace_once(text,
        'temporalIntelligence:temporal,transitionRisk,evidenceIndependence,evidenceCompleteness',
        'temporalIntelligence:temporal,transitionRisk,structuralBreak,evidenceIndependence,evidenceCompleteness',
        'pair output structural-break')
if 'structuralBreak:g.structuralBreak' not in text:
    text=replace_once(text,
        'temporalIntelligence:g.temporalIntelligence,transitionRisk:g.transitionRisk,evidenceIndependence:g.evidenceIndependence,',
        'temporalIntelligence:g.temporalIntelligence,transitionRisk:g.transitionRisk,structuralBreak:g.structuralBreak,evidenceIndependence:g.evidenceIndependence,',
        'governed structural-break audit')
principle="'structural-break warnings reduce reliance on historical relationships when recent levels, variance or slope behavior changes abruptly'"
if principle not in text:
    marker="'turning-point risk and catalyst density reduce confidence when a stable regime assumption is unsafe'"
    text=replace_once(text,marker,marker+','+principle,'structural-break principle')
path.write_text(text,encoding='utf-8')
print('Structural-break v2 integration applied.')
