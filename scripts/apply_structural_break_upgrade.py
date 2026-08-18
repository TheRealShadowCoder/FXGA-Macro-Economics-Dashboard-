from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected one anchor, found {c}')
    return text.replace(old,new,1)

# Institutional structural-break diagnostics.
path=Path('cloud-run-collector/src/institutional-research.js')
text=path.read_text(encoding='utf-8')
anchor="function ar1Forecast(values){\n"
if 'function buildStructuralBreaks(' not in text:
    fn="""function structuralBreakForSeries(item){
  const values=(item?.history||[]).map(x=>num(x?.value)).filter(Number.isFinite);if(values.length<12)return null;const recent=values.slice(-4),prior=values.slice(-12,-4);if(prior.length<6)return null;const recentMean=mean(recent),priorMean=mean(prior),priorSd=Math.max(stdev(prior),Math.abs(priorMean)*.003,1e-9),recentSd=stdev(recent),levelShift=Math.abs(recentMean-priorMean)/priorSd,varianceRatio=recentSd*recentSd/Math.max(priorSd*priorSd,1e-12),priorSlope=prior.length>1?(prior.at(-1)-prior[0])/(prior.length-1):0,recentSlope=recent.length>1?(recent.at(-1)-recent[0])/(recent.length-1):0,directionFlip=Math.sign(priorSlope)!==0&&Math.sign(recentSlope)!==0&&Math.sign(priorSlope)!==Math.sign(recentSlope),varianceShock=Math.abs(Math.log(Math.max(varianceRatio,1e-6))),score=Math.round(clamp(24*levelShift+18*varianceShock+(directionFlip?22:0),0,100));return {seriesId:item.seriesId,title:item.title,economy:item.economy||item.economies?.[0]||'GLOBAL',family:macroFamily(item),score,status:score>=78?'break':score>=52?'watch':'stable',levelShift:Number(levelShift.toFixed(3)),varianceRatio:Number(varianceRatio.toFixed(3)),directionFlip,recentMean:Number(recentMean.toFixed(6)),priorMean:Number(priorMean.toFixed(6)),recentSlope:Number(recentSlope.toFixed(6)),priorSlope:Number(priorSlope.toFixed(6)),sampleSize:values.length};
}
function buildStructuralBreaks(observations=[]){
  const series=observations.map(structuralBreakForSeries).filter(Boolean).sort((a,b)=>b.score-a.score),groups={};for(const row of series){const key=`${row.economy}:${row.family}`;(groups[key]??=[]).push(row);}const families=Object.entries(groups).map(([key,rows])=>{const [economy,family]=key.split(':'),maxRisk=Math.max(...rows.map(x=>x.score)),avg=mean(rows.map(x=>x.score)),breaks=rows.filter(x=>x.status==='break').length,watch=rows.filter(x=>x.status==='watch').length,risk=Math.round(clamp(.55*maxRisk+.45*avg,0,100));return {economy,family,risk,status:risk>=72?'break':risk>=48?'watch':'stable',breaks,watch,series:rows.length,topSeries:rows.slice(0,5)};}).sort((a,b)=>b.risk-a.risk);const economyMap={};for(const row of families)(economyMap[row.economy]??=[]).push(row);const economies=Object.entries(economyMap).map(([economy,rows])=>({economy,risk:Math.round(Math.max(...rows.map(x=>x.risk))),breakFamilies:rows.filter(x=>x.status==='break').length,watchFamilies:rows.filter(x=>x.status==='watch').length,status:rows.some(x=>x.status==='break')?'break':rows.some(x=>x.status==='watch')?'watch':'stable',families:rows})).sort((a,b)=>b.risk-a.risk);return {generatedAt:iso(),series:series.slice(0,220),families,economies,breakSeries:series.filter(x=>x.status==='break').length,watchSeries:series.filter(x=>x.status==='watch').length,methodology:'Recent four-observation level, variance and slope behavior is compared with the preceding eight observations. The score is a robust structural-instability diagnostic, not a claim of causal break timing.'};
}

"""
    text=replace_once(text,anchor,fn+anchor,'structural break functions')

if 'const structuralBreaks=buildStructuralBreaks(observations);' not in text:
    text=replace_once(text,'  const features=buildFeatures(observations);\n','  const features=buildFeatures(observations);\n  const structuralBreaks=buildStructuralBreaks(observations);\n','structural breaks build')
if 'structuralBreaks,turningPoints' not in text:
    text=replace_once(text,'modelHealth,turningPoints','modelHealth,structuralBreaks,turningPoints','structural breaks output')
if "'structural-break-detection'" not in text:
    marker="'turning-point-detection'"
    text=replace_once(text,marker,"'structural-break-detection',"+marker,'structural break method registry')
path.write_text(text,encoding='utf-8')

# Pair-level structural break governance.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function transitionRiskControls(research,symbol){\n"
if 'function structuralBreakControls(' not in text:
    fn="""function structuralBreakControls(research,symbol){
  const [base,quote]=currenciesForSymbol(symbol),lookup=currency=>research?.structuralBreaks?.economies?.find(x=>x.economy===ECONOMY_BY_CURRENCY[currency])||null,baseRow=base==='XAU'?null:lookup(base),quoteRow=lookup(quote),risks=[baseRow?.risk,quoteRow?.risk].filter(Number.isFinite),risk=risks.length?Math.max(...risks):0,status=risk>=78?'break':risk>=52?'watch':'stable',factor=status==='break'?clamp(1-risk/500,.80,.86):status==='watch'?clamp(1-risk/700,.90,.95):1;return {status,risk,factor:Number(factor.toFixed(3)),base:baseRow,quote:quoteRow,breakSeries:Number(research?.structuralBreaks?.breakSeries||0),watchSeries:Number(research?.structuralBreaks?.watchSeries||0)};
}
"""
    text=replace_once(text,anchor,fn+anchor,'structural break governance function')

if 'breakFactor=Number(controls?.structuralBreak?.factor||1)' not in text:
    text=replace_once(text,'transitionFactor=Number(controls?.transitionRisk?.factor||1),','transitionFactor=Number(controls?.transitionRisk?.factor||1),breakFactor=Number(controls?.structuralBreak?.factor||1),','structural break factor declaration')
    text=replace_once(text,'*temporalFactor*transitionFactor*','*temporalFactor*transitionFactor*breakFactor*','structural break confidence multiplication')

veto="if(controls?.structuralBreak?.status==='break'&&Number(controls.structuralBreak.risk||0)>=88&&Math.abs(Number(refined?.score||0))<55){direction='WAIT';reason.push('A major macro structural-break warning makes the historical relationship unstable.');}"
if veto not in text:
    marker="if(controls?.transitionRisk?.status==='high'&&Number(controls.transitionRisk.maxRisk||0)>=82){direction='WAIT';reason.push('Macro turning-point risk is too high for a stable directional thesis.');}"
    text=replace_once(text,marker,marker+'\n  '+veto,'structural break veto')

if 'structuralBreak=structuralBreakControls(research,opportunity.symbol)' not in text:
    text=replace_once(text,'transitionRisk=transitionRiskControls(research,opportunity.symbol),','transitionRisk=transitionRiskControls(research,opportunity.symbol),structuralBreak=structuralBreakControls(research,opportunity.symbol),','structural break pair construction')
if 'transitionRisk,structuralBreak,evidenceIndependence' not in text:
    text=replace_once(text,'transitionRisk,evidenceIndependence','transitionRisk,structuralBreak,evidenceIndependence','structural break final controls')
if 'temporalIntelligence:temporal,transitionRisk,structuralBreak,' not in text:
    text=replace_once(text,'temporalIntelligence:temporal,transitionRisk,','temporalIntelligence:temporal,transitionRisk,structuralBreak,','structural break pair output')
if 'structuralBreak:g.structuralBreak' not in text:
    text=replace_once(text,'transitionRisk:g.transitionRisk,','transitionRisk:g.transitionRisk,structuralBreak:g.structuralBreak,','structural break governed audit')
principle="'structural-break warnings reduce reliance on historical relationships when recent levels, variance or slope behavior changes abruptly'"
if principle not in text:
    marker="'turning-point risk and catalyst density reduce confidence when a stable regime assumption is unsafe'"
    text=replace_once(text,marker,marker+','+principle,'structural break principle')
path.write_text(text,encoding='utf-8')
print('Structural-break governance upgrade applied.')
