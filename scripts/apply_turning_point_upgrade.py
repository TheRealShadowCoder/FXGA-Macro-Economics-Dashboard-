from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/institutional-research.js')
text=path.read_text(encoding='utf-8')

# Enrich feature engineering with slope, acceleration and turning-point diagnostics.
text=replace_once(text,
"    const short=values.slice(-4),long=values.slice(-12);\n    const shortMean=mean(short),longMean=mean(long);\n",
"    const short=values.slice(-4),long=values.slice(-12);\n    const shortMean=mean(short),longMean=mean(long),diffs=[];for(let i=1;i<values.length;i++)diffs.push(values[i]-values[i-1]);\n    const recentSlope=diffs.length?mean(diffs.slice(-3)):0,priorSlope=diffs.length>=4?mean(diffs.slice(-6,-3)):0,acceleration=recentSlope-priorSlope,slopeScale=Math.max(stdev(diffs.slice(-12)),Math.abs(mean(diffs.slice(-12)))*.25,1e-9),normalizedAcceleration=clamp(acceleration/slopeScale,-4,4),slopeReversal=recentSlope&&priorSlope&&Math.sign(recentSlope)!==Math.sign(priorSlope),turningPointScore=clamp((slopeReversal?55:0)+Math.min(35,Math.abs(normalizedAcceleration)*12)+Math.min(10,Math.abs(rz)*1.5),0,100);\n",
'feature turning diagnostics')
text=replace_once(text,
"      shortMean,longMean,trend:shortMean>longMean?'rising':shortMean<longMean?'falling':'flat',\n      volatility:stdev(values.slice(-12)),sampleSize:values.length,\n",
"      shortMean,longMean,trend:shortMean>longMean?'rising':shortMean<longMean?'falling':'flat',recentSlope,priorSlope,acceleration,normalizedAcceleration,slopeReversal:Boolean(slopeReversal),turningPointScore:Math.round(turningPointScore),\n      volatility:stdev(values.slice(-12)),sampleSize:values.length,\n",
'feature turning output')

anchor="function ar1Forecast(values){\n"
turning_fn="""function buildTurningPoints(features=[]){
  const groups={};
  for(const feature of features){const key=`${feature.economy}:${feature.family}`;(groups[key]??=[]).push(feature);}
  const rows=[];
  for(const [key,items] of Object.entries(groups)){
    const [economy,family]=key.split(':'),eligible=items.filter(x=>Number(x.sampleSize||0)>=5),reversals=eligible.filter(x=>x.slopeReversal).length,averageTurning=eligible.length?mean(eligible.map(x=>Number(x.turningPointScore||0))):0,averageAcceleration=eligible.length?mean(eligible.map(x=>Number(x.normalizedAcceleration||0))):0,rising=eligible.filter(x=>Number(x.recentSlope||0)>0).length,falling=eligible.filter(x=>Number(x.recentSlope||0)<0).length,breadth=eligible.length?(rising-falling)/eligible.length:0,risk=Math.round(clamp(.55*averageTurning+.25*Math.abs(averageAcceleration)*18+.20*(eligible.length?100*reversals/eligible.length:0),0,100));
    rows.push({economy,family,series:eligible.length,risk,status:risk>=70?'high':risk>=45?'watch':'stable',reversals,averageAcceleration:Number(averageAcceleration.toFixed(3)),breadth:Number(breadth.toFixed(3)),direction:breadth>.2?'improving':breadth<-.2?'weakening':'mixed',topSeries:[...eligible].sort((a,b)=>Number(b.turningPointScore||0)-Number(a.turningPointScore||0)).slice(0,5).map(x=>({seriesId:x.seriesId,title:x.title,turningPointScore:x.turningPointScore,recentSlope:x.recentSlope,priorSlope:x.priorSlope,acceleration:x.normalizedAcceleration,slopeReversal:x.slopeReversal}))});
  }
  const economySummary={};for(const row of rows){const arr=economySummary[row.economy]??=[];arr.push(row);economySummary[row.economy]=arr;}
  const economies=Object.entries(economySummary).map(([economy,items])=>({economy,risk:Math.round(mean(items.map(x=>x.risk))),highFamilies:items.filter(x=>x.status==='high').length,watchFamilies:items.filter(x=>x.status==='watch').length,direction:mean(items.map(x=>x.breadth))>.15?'improving':mean(items.map(x=>x.breadth))<-.15?'weakening':'mixed',families:items.sort((a,b)=>b.risk-a.risk)})).sort((a,b)=>b.risk-a.risk);
  return {generatedAt:iso(),economies,rows:rows.sort((a,b)=>b.risk-a.risk),highRisk:rows.filter(x=>x.status==='high').length,watch:rows.filter(x=>x.status==='watch').length};
}

"""
text=replace_once(text,anchor,turning_fn+anchor,'turning point function')

# Release persistence / streak / acceleration inside release analytics.
text=replace_once(text,
"  const profiles=Object.values(groups).map(g=>({\n    currency:g.currency,family:g.family,count:g.count,bullish:g.bullish||0,bearish:g.bearish||0,neutral:g.neutral||0,\n    bullishRate:pct(g.bullish||0,g.count),bearishRate:pct(g.bearish||0,g.count),\n    meanAbsSurprise:g.meanAbsSurprise/Math.max(1,g.count),meanWeightedSurprise:mean(g.weighted),\n  })).sort((a,b)=>b.count-a.count);\n  return {generatedAt:iso(),completed:enriched.length,events:enriched.slice(-250),profiles};\n",
"  const profiles=Object.values(groups).map(g=>({\n    currency:g.currency,family:g.family,count:g.count,bullish:g.bullish||0,bearish:g.bearish||0,neutral:g.neutral||0,\n    bullishRate:pct(g.bullish||0,g.count),bearishRate:pct(g.bearish||0,g.count),\n    meanAbsSurprise:g.meanAbsSurprise/Math.max(1,g.count),meanWeightedSurprise:mean(g.weighted),\n  })).sort((a,b)=>b.count-a.count);\n  const persistence=[];\n  for(const profile of profiles){const rows=enriched.filter(x=>x.currency===profile.currency&&x.family===profile.family).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,12),signed=rows.map(x=>Math.sign(Number(x.importanceWeightedSurprise||0))).filter(Boolean);let streak=0,sign=signed[0]||0;for(const value of signed){if(value===sign)streak++;else break;}const recent=rows.slice(0,3),prior=rows.slice(3,6),recentMean=recent.length?mean(recent.map(x=>Number(x.importanceWeightedSurprise||0))):0,priorMean=prior.length?mean(prior.map(x=>Number(x.importanceWeightedSurprise||0))):0,acceleration=recentMean-priorMean,consistency=rows.length?Math.abs(mean(rows.map(x=>Math.sign(Number(x.importanceWeightedSurprise||0))))):0;persistence.push({currency:profile.currency,family:profile.family,count:rows.length,streak:sign*streak,recentMean:Number(recentMean.toFixed(3)),priorMean:Number(priorMean.toFixed(3)),acceleration:Number(acceleration.toFixed(3)),consistency:Number(consistency.toFixed(3)),status:streak>=3?'persistent-positive':streak<=-3?'persistent-negative':Math.abs(acceleration)>=1?'accelerating':'mixed'});}\n  return {generatedAt:iso(),completed:enriched.length,events:enriched.slice(-250),profiles,persistence:persistence.sort((a,b)=>Math.abs(b.streak)-Math.abs(a.streak)||Math.abs(b.acceleration)-Math.abs(a.acceleration))};\n",
'release persistence output')

# Catalyst sequence and event density.
anchor="function buildMarketAnalytics(market=[]){\n"
catalyst_fn="""function buildCatalystSequence(events=[]){
  const now=Date.now(),upcoming=(events||[]).filter(e=>{const t=Date.parse(e?.date||'');return Number.isFinite(t)&&t>=now&&t<=now+72*3600000;}).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)),byCurrency={};for(const e of upcoming){const c=String(e.currency||'NA').toUpperCase();(byCurrency[c]??=[]).push(e);}
  const currencies=Object.entries(byCurrency).map(([currency,items])=>{let nearestGap=null,clusters=0;for(let i=1;i<items.length;i++){const gap=(Date.parse(items[i].date)-Date.parse(items[i-1].date))/60000;if(nearestGap==null||gap<nearestGap)nearestGap=gap;if(gap<=90)clusters++;}const high=items.filter(x=>Number(x.importance||1)>=3),densityScore=Math.round(clamp(items.length*7+high.length*13+clusters*10+(nearestGap!=null&&nearestGap<=30?15:0),0,100));return {currency,events:items.length,highImpact:high.length,clusters,nearestGapMinutes:nearestGap,densityScore,status:densityScore>=70?'dense':densityScore>=40?'active':'light',next:items.slice(0,8).map(x=>({event:x.event,date:x.date,importance:Number(x.importance||1),category:x.category}))};}).sort((a,b)=>b.densityScore-a.densityScore);
  return {generatedAt:iso(),windowHours:72,currencies,totalUpcoming:upcoming.length,denseCurrencies:currencies.filter(x=>x.status==='dense').length};
}

"""
text=replace_once(text,anchor,catalyst_fn+anchor,'catalyst sequence function')

# Regime transition logic based on boundary distance plus reversal/acceleration risk.
old="""function buildRegimes(features=[],economyAnalysis={}){
  const familyGroups={};
  for(const f of features){const k=`${f.economy}:${f.family}`;(familyGroups[k]??=[]).push(f);}
  const regimes=[];
  for(const [key,group] of Object.entries(familyGroups)){
    const [economy,family]=key.split(':');
    const z=mean(group.map(x=>clamp(x.zScore,-3,3))),momentum=mean(group.map(x=>Math.sign(x.momentum)));
    const score=clamp(35*z+15*momentum,-100,100);
    const state=score>25?'expanding':score<-25?'contracting':'balanced';
    const transitionProbability=clamp(sigmoid((Math.abs(score)-25)/18),.05,.95);
    regimes.push({economy,family,score:Number(score.toFixed(1)),state,transitionProbability:Number(transitionProbability.toFixed(3)),sampleSize:group.length});
  }
  const existing=(economyAnalysis?.economies||[]).map(e=>({economy:e.id,family:'composite',score:Number(e.score??e.currencyScore??0),state:e.regime||'balanced',transitionProbability:Number((.5+Math.min(.45,Math.abs(Number(e.score??0))/200)).toFixed(3)),sampleSize:e.observationCount||0}));
  return [...existing,...regimes].slice(0,120);
}
"""
new="""function buildRegimes(features=[],economyAnalysis={}){
  const familyGroups={};
  for(const f of features){const k=`${f.economy}:${f.family}`;(familyGroups[k]??=[]).push(f);}
  const regimes=[];
  for(const [key,group] of Object.entries(familyGroups)){
    const [economy,family]=key.split(':');
    const z=mean(group.map(x=>clamp(x.zScore,-3,3))),momentum=mean(group.map(x=>Math.sign(x.momentum))),acceleration=mean(group.map(x=>Number(x.normalizedAcceleration||0))),reversalShare=group.length?group.filter(x=>x.slopeReversal).length/group.length:0;
    const score=clamp(35*z+15*momentum,-100,100),state=score>25?'expanding':score<-25?'contracting':'balanced',boundaryDistance=Math.min(Math.abs(score-25),Math.abs(score+25),Math.abs(score)),boundaryRisk=Math.exp(-boundaryDistance/18),reversalRisk=clamp(reversalShare+.20*Math.min(1,Math.abs(acceleration)/2),0,1),transitionProbability=clamp(.10+.48*boundaryRisk+.42*reversalRisk,.05,.95),transitionDirection=acceleration>.25?'toward-stronger':acceleration<-.25?'toward-weaker':'unclear';
    regimes.push({economy,family,score:Number(score.toFixed(1)),state,transitionProbability:Number(transitionProbability.toFixed(3)),transitionDirection,acceleration:Number(acceleration.toFixed(3)),reversalShare:Number(reversalShare.toFixed(3)),sampleSize:group.length});
  }
  const existing=(economyAnalysis?.economies||[]).map(e=>{const score=Number(e.score??e.currencyScore??0),familyRows=regimes.filter(r=>r.economy===e.id),transitionProbability=familyRows.length?mean(familyRows.map(r=>r.transitionProbability)):.5;return {economy:e.id,family:'composite',score,state:e.regime||'balanced',transitionProbability:Number(transitionProbability.toFixed(3)),transitionDirection:familyRows.length?([...familyRows].sort((a,b)=>b.transitionProbability-a.transitionProbability)[0]?.transitionDirection||'unclear'):'unclear',sampleSize:e.observationCount||0};});
  return [...existing,...regimes].sort((a,b)=>b.transitionProbability-a.transitionProbability).slice(0,120);
}
"""
text=replace_once(text,old,new,'regime transition logic')

# Wire new research layers.
text=replace_once(text,
"  const features=buildFeatures(observations);\n  const forecasts=buildForecasts(observations);\n",
"  const features=buildFeatures(observations);\n  const turningPoints=buildTurningPoints(features);\n  const forecasts=buildForecasts(observations);\n",
'turning point build')
text=replace_once(text,
"  const releaseAnalytics=buildReleaseAnalytics(events);\n  const marketAnalytics=buildMarketAnalytics(market);\n",
"  const releaseAnalytics=buildReleaseAnalytics(events);\n  const catalystSequence=buildCatalystSequence(events);\n  const marketAnalytics=buildMarketAnalytics(market);\n",
'catalyst build')
text=replace_once(text,
"    dataQuality,sourceReliability,modelHealth,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,\n",
"    dataQuality,sourceReliability,modelHealth,turningPoints,catalystSequence,features:features.slice(0,220),forecasts,releaseAnalytics,marketAnalytics,regimes,risk,scenarios,\n",
'new research output')
text=text.replace("'release-surprise-normalization','regime-classification'","'release-surprise-normalization','surprise-persistence','catalyst-sequencing','turning-point-detection','regime-transition-risk','regime-classification'",1)
path.write_text(text,encoding='utf-8')

# Decision governance consumes turning-point and catalyst-sequence risk.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function historicalCalibrationControls(decisionMemory,symbol){\n"
fn="""function transitionRiskControls(research,symbol){
  const [base,quote]=currenciesForSymbol(symbol),baseEconomy=ECONOMY_BY_CURRENCY[base],quoteEconomy=ECONOMY_BY_CURRENCY[quote],find=economy=>research?.turningPoints?.economies?.find(x=>x.economy===economy)||null,baseRisk=base==='XAU'?null:find(baseEconomy),quoteRisk=find(quoteEconomy),risks=[baseRisk?.risk,quoteRisk?.risk].filter(Number.isFinite),maxRisk=risks.length?Math.max(...risks):0,divergentDirections=baseRisk&&quoteRisk&&baseRisk.direction!==quoteRisk.direction&&baseRisk.direction!=='mixed'&&quoteRisk.direction!=='mixed',factor=clamp(1-maxRisk/500-(divergentDirections?0:.02),.78,1),status=maxRisk>=75?'high':maxRisk>=50?'watch':'stable';
  const catalystCurrencies=research?.catalystSequence?.currencies||[],baseCatalyst=catalystCurrencies.find(x=>x.currency===base),quoteCatalyst=catalystCurrencies.find(x=>x.currency===quote),density=Math.max(Number(baseCatalyst?.densityScore||0),Number(quoteCatalyst?.densityScore||0)),catalystFactor=clamp(1-density/600,.84,1);
  return {status,maxRisk,factor:Number((factor*catalystFactor).toFixed(3)),turningPointFactor:Number(factor.toFixed(3)),catalystFactor:Number(catalystFactor.toFixed(3)),divergentDirections,base:baseRisk,quote:quoteRisk,catalystDensity:density,baseCatalyst:baseCatalyst||null,quoteCatalyst:quoteCatalyst||null};
}
"""
text=replace_once(text,anchor,fn+anchor,'transition risk controls')
text=replace_once(text,
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*counterfactualFactor*temporalFactor*uncertaintyPenalty);\n",
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),transitionFactor=Number(controls?.transitionRisk?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*counterfactualFactor*temporalFactor*transitionFactor*uncertaintyPenalty);\n",
'transition confidence factor')
text=replace_once(text,
"  if(controls?.temporal?.status==='contested'&&Number(controls.temporal.factor||1)<=.80){direction='WAIT';reason.push('Recent release, revision and policy-communication timing evidence materially contests the thesis.');}\n",
"  if(controls?.temporal?.status==='contested'&&Number(controls.temporal.factor||1)<=.80){direction='WAIT';reason.push('Recent release, revision and policy-communication timing evidence materially contests the thesis.');}\n  if(controls?.transitionRisk?.status==='high'&&Number(controls.transitionRisk.maxRisk||0)>=82){direction='WAIT';reason.push('Macro turning-point risk is too high for a stable directional thesis.');}\n",
'turning point veto')
old="""    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal),counterfactual=counterfactualSensitivity(refined),temporal=temporalIntelligenceForPair(opportunity,events,news,economies,nowMs),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,counterfactual,temporal,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,causalTransmission,counterfactual,temporalIntelligence:temporal,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,uncertainty,premortem,thesis,final};\n"""
new="""    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal),counterfactual=counterfactualSensitivity(refined),temporal=temporalIntelligenceForPair(opportunity,events,news,economies,nowMs),transitionRisk=transitionRiskControls(research,opportunity.symbol),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,counterfactual,temporal,transitionRisk,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,causalTransmission,counterfactual,temporalIntelligence:temporal,transitionRisk,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,uncertainty,premortem,thesis,final};\n"""
text=replace_once(text,old,new,'pair transition risk output')
text=text.replace("'release sequences, revisions, communications and catalyst age are governed as temporal evidence without double-counting them in the posterior'","'release sequences, revisions, communications and catalyst age are governed as temporal evidence without double-counting them in the posterior','turning-point risk and catalyst density reduce confidence when a stable regime assumption is unsafe'",1)
path.write_text(text,encoding='utf-8')
print('Turning-point, surprise persistence and catalyst sequencing upgrade applied.')
