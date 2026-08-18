const clamp=(v,min=-1,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):0));
const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const sigmoid=(x)=>1/(1+Math.exp(-Math.max(-20,Math.min(20,x))));
const nowIso=()=>new Date().toISOString();
const ECONOMY_BY_CURRENCY={USD:'USA',EUR:'EUROPE',GBP:'UK',ZAR:'SOUTH_AFRICA',JPY:'JAPAN'};
const DEFAULT_PRIOR={buy:1/3,sell:1/3,wait:1/3};
const COMPONENT_KEYS=[['structuralDivergence','structure',1.00],['policyDivergence','policy',.90],['releaseDivergence','release',.78],['narrativeDivergence','narrative',.58]];

function safeProbabilities(value){
  const p=value&&typeof value==='object'?value:{};
  const buy=Math.max(.001,Number(p.buy??DEFAULT_PRIOR.buy)),sell=Math.max(.001,Number(p.sell??DEFAULT_PRIOR.sell)),wait=Math.max(.001,Number(p.wait??DEFAULT_PRIOR.wait));
  const total=buy+sell+wait;
  return {buy:buy/total,sell:sell/total,wait:wait/total};
}
function softmaxLogs(logs){
  const m=Math.max(...Object.values(logs));
  const exps=Object.fromEntries(Object.entries(logs).map(([k,v])=>[k,Math.exp(v-m)]));
  const total=Object.values(exps).reduce((a,b)=>a+b,0)||1;
  return Object.fromEntries(Object.entries(exps).map(([k,v])=>[k,v/total]));
}
function eventOrientation(event){
  const text=`${event?.event||''} ${event?.category||''}`.toLowerCase();
  return /unemployment|jobless|claims|deficit|delinquen|default|layoff/.test(text)?-1:1;
}
function numeric(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(value==null)return null;
  const n=Number(String(value).replace(/,/g,'').replace(/%/g,'').trim());
  return Number.isFinite(n)?n:null;
}
function eventExpectationImpulse(events,currency,nowMs){
  const evidence=[];
  for(const event of events||[]){
    if(String(event?.currency||'').toUpperCase()!==currency)continue;
    const t=Date.parse(event?.date||'');
    if(!Number.isFinite(t)||t<nowMs-3*3600000||t>nowMs+36*3600000)continue;
    const forecast=numeric(event.forecast),previous=numeric(event.revised??event.previous);
    if(forecast==null||previous==null)continue;
    const scale=Math.max(Math.abs(previous)*.008,Math.abs(forecast-previous)*.5,1e-6);
    const directional=clamp((forecast-previous)/scale,-3,3)*eventOrientation(event)/3;
    const distanceHours=Math.abs(t-nowMs)/3600000;
    const proximity=Math.exp(-Math.log(2)*distanceHours/12);
    const importance=Math.max(1,Math.min(3,Number(event.importance||1)))/3;
    evidence.push({event:event.event,date:event.date,importance:Number(event.importance||1),value:directional,weight:proximity*(.55+.45*importance)});
  }
  const den=evidence.reduce((s,x)=>s+x.weight,0);
  const score=den?100*evidence.reduce((s,x)=>s+x.value*x.weight,0)/den:0;
  return {score:Math.round(clamp(score/100,-1,1)*100),evidence:evidence.sort((a,b)=>b.weight-a.weight).slice(0,6)};
}
function crossAssetFactor(marketData,id,scale=.45){
  const assets=Array.isArray(marketData)?marketData:Array.isArray(marketData?.assets)?marketData.assets:[],target=String(id||'').toUpperCase();
  const asset=assets.find(a=>String(a?.id||'').toUpperCase()===target)||assets.find(a=>String(a?.symbol||'').replace(/[^A-Z0-9]/gi,'').toUpperCase()===target);
  if(!asset)return {available:false,id:target,score:0,changePercent:null,stale:false};
  const change=numeric(asset.changePercent??asset.changePct??asset.percentChange);if(change==null)return {available:false,id:target,score:0,changePercent:null,stale:Boolean(asset.stale)};
  return {available:true,id:target,score:100*Math.tanh(change/scale),changePercent:change,stale:Boolean(asset.stale)};
}
function crossAssetConfirmation(symbol,marketData){
  const factors={dxy:crossAssetFactor(marketData,'DXY',.35),us2y:crossAssetFactor(marketData,'US2Y',.45),us10y:crossAssetFactor(marketData,'US10Y',.45),spx:crossAssetFactor(marketData,'SPX',.55),nasdaq:crossAssetFactor(marketData,'NASDAQ',.65),vix:crossAssetFactor(marketData,'VIX',2.2),gold:crossAssetFactor(marketData,'GOLD',.55)},s=String(symbol||'').toUpperCase();
  const templates={EURUSD:{dxy:-.55,us2y:-.25,spx:.10,vix:-.10},GBPUSD:{dxy:-.55,us2y:-.25,spx:.10,vix:-.10},USDJPY:{dxy:.40,us2y:.35,spx:.15,vix:-.10},USDZAR:{dxy:.35,us2y:.15,spx:-.20,vix:.30},EURZAR:{spx:-.30,vix:.45,dxy:.10,us2y:.15},GBPZAR:{spx:-.30,vix:.45,dxy:.10,us2y:.15},EURGBP:{},XAUUSD:{dxy:-.35,us10y:-.30,vix:.25,spx:-.10}};
  const weights=templates[s]||{},used=[];let numerator=0,denominator=0;
  for(const [id,weight] of Object.entries(weights)){if(!weight)continue;const factor=factors[id];if(!factor?.available)continue;const reliability=factor.stale?.55:1;numerator+=factor.score*weight*reliability;denominator+=Math.abs(weight)*reliability;used.push({id,weight,score:Number(factor.score.toFixed(2)),changePercent:factor.changePercent,stale:factor.stale});}
  const score=denominator?numerator/denominator:0;return {symbol:s,available:used.length>=2,score:Number(score.toFixed(2)),used,availableFactors:used.length,status:used.length<2?'insufficient':score>=25?'bullish-confirmation':score<=-25?'bearish-confirmation':'mixed'};
}
function marketAssetSignal(symbol,marketData){
  const assets=Array.isArray(marketData)?marketData:Array.isArray(marketData?.assets)?marketData.assets:[];
  const upper=String(symbol||'').toUpperCase();
  const exact=assets.find(a=>String(a?.symbol||a?.id||'').replace(/[^A-Z0-9]/gi,'').toUpperCase()===upper);
  if(!exact)return {available:false,score:0,asset:null,reason:'No exact verified market series for this instrument.'};
  const change=numeric(exact.changePercent??exact.changePct??exact.percentChange);
  if(change==null)return {available:false,score:0,asset:exact,reason:'Verified instrument exists but percentage change is unavailable.'};
  const scale=upper==='XAUUSD'?1.25:.65;
  const score=Math.round(clamp(change/scale,-1,1)*100);
  return {available:true,score,asset:{id:exact.id,symbol:exact.symbol,label:exact.label,price:exact.price,changePercent:change,stale:Boolean(exact.stale)},reason:'Exact instrument change used as market confirmation.'};
}
function currenciesForSymbol(symbol){
  const s=String(symbol||'').toUpperCase();
  if(s==='XAUUSD')return ['XAU','USD'];
  if(s.length>=6)return [s.slice(0,3),s.slice(3,6)];
  return [];
}
function nearestCatalysts(events,symbol,nowMs){
  const currencies=currenciesForSymbol(symbol).filter(c=>c!=='XAU');
  return (events||[]).filter(e=>currencies.includes(String(e.currency||'').toUpperCase())).map(e=>({...e,deltaMs:Date.parse(e.date)-nowMs})).filter(e=>Number.isFinite(e.deltaMs)&&e.deltaMs>=-30*60000&&e.deltaMs<=24*3600000).sort((a,b)=>Math.abs(a.deltaMs)-Math.abs(b.deltaMs)).slice(0,5).map(e=>({event:e.event,currency:e.currency,date:e.date,importance:Number(e.importance||1),minutes:Math.round(e.deltaMs/60000)}));
}
function evidenceQuality(observations=[]){
  if(!observations.length)return {score:0,coverage:0,freshness:0,historyDepth:0,sourceBreadth:0,status:'insufficient'};
  const valid=observations.filter(o=>numeric(o?.value)!=null);
  const freshness=mean(valid.map(o=>{const t=Date.parse(o?.lastUpdated||o?.date||'');if(!Number.isFinite(t))return .25;const days=Math.max(0,(Date.now()-t)/86400000);const frequency=String(o?.frequency||'').toLowerCase();const halfLife=frequency.includes('daily')?7:frequency.includes('weekly')?28:frequency.includes('quarter')?240:frequency.includes('annual')?500:75;return Math.max(.05,Math.exp(-Math.log(2)*days/halfLife));}));
  const historyDepth=mean(valid.map(o=>Math.min(1,(Array.isArray(o?.history)?o.history.length:0)/12)));
  const sources=new Set(valid.map(o=>String(o?.source||'')).filter(Boolean));
  const sourceBreadth=Math.min(1,sources.size/4);
  const coverage=valid.length/observations.length;
  const score=Math.round(100*(coverage*.34+freshness*.28+historyDepth*.23+sourceBreadth*.15));
  return {score,coverage:Number(coverage.toFixed(4)),freshness:Number(freshness.toFixed(4)),historyDepth:Number(historyDepth.toFixed(4)),sourceBreadth:Number(sourceBreadth.toFixed(4)),status:score>=80?'strong':score>=60?'usable':'weak'};
}
function bayesianPosterior(opportunity,marketSignal,expectationGap,quality){
  const prior=safeProbabilities(opportunity?.probabilities);
  const evidence=[];
  for(const [field,label,baseWeight] of COMPONENT_KEYS){
    const raw=Number(opportunity?.components?.[field]||0);
    if(Math.abs(raw)<1)continue;
    evidence.push({id:label,score:clamp(raw/100,-1,1),reliability:baseWeight*Math.max(.25,Number(opportunity?.confidence||0)/100)});
  }
  if(marketSignal.available)evidence.push({id:'market',score:clamp(marketSignal.score/100,-1,1),reliability:.72*(marketSignal.asset?.stale?.55:1)});
  if(Number.isFinite(expectationGap?.directionalConsensus))evidence.push({id:'expectations',score:clamp(expectationGap.directionalConsensus/100,-1,1),reliability:.55});
  const logs={buy:Math.log(prior.buy),sell:Math.log(prior.sell),wait:Math.log(prior.wait)};
  const temperature=.62*Math.max(.35,quality.score/100);
  for(const item of evidence){
    const signed=clamp(item.score,-1,1),strength=clamp(item.reliability,0,1)*temperature;
    const buyLike=clamp(.5+.36*signed*strength,.08,.92),sellLike=clamp(.5-.36*signed*strength,.08,.92),waitLike=clamp(.58-.28*Math.abs(signed)*strength,.12,.82);
    logs.buy+=Math.log(buyLike);logs.sell+=Math.log(sellLike);logs.wait+=Math.log(waitLike);
  }
  const posterior=softmaxLogs(logs);
  return {prior,posterior,evidence,temperature:Number(temperature.toFixed(3)),method:'tempered Bayesian likelihood update with correlated-evidence shrinkage'};
}
function expectationGapForPair(opportunity,events,marketData,nowMs){
  const [base,quote]=currenciesForSymbol(opportunity.symbol),baseExpectation=base&&base!=='XAU'?eventExpectationImpulse(events,base,nowMs):{score:0,evidence:[]},quoteExpectation=quote?eventExpectationImpulse(events,quote,nowMs):{score:0,evidence:[]};
  const directionalConsensus=base==='XAU'?-quoteExpectation.score:baseExpectation.score-quoteExpectation.score;
  const policy=Number(opportunity?.components?.policyDivergence||0),macro=Number(opportunity?.components?.structuralDivergence||0),market=marketAssetSignal(opportunity.symbol,marketData);
  const fundamentalExpectation=Math.round(.55*policy+.30*macro+.15*directionalConsensus);
  const gap=market.available?fundamentalExpectation-market.score:null;
  const state=gap==null?'unpriced':Math.abs(gap)<12?'aligned':gap>0?'fundamentals-stronger-than-price':'price-stronger-than-fundamentals';
  return {symbol:opportunity.symbol,fundamentalExpectation,directionalConsensus,marketPricing:market.available?market.score:null,gap,state,marketAvailable:market.available,baseExpectation,quoteExpectation};
}
function contradictionAudit(opportunity,posterior,marketSignal,expectationGap){
  const preferred=posterior.buy>posterior.sell?'BUY':'SELL',sign=preferred==='BUY'?1:-1,items=[];
  for(const [field,label] of COMPONENT_KEYS){const value=Number(opportunity?.components?.[field]||0);if(Math.abs(value)>=15&&Math.sign(value)!==sign)items.push({layer:label,value:Math.round(value),severity:Math.abs(value)>=40?'high':'medium',reason:`${label} evidence opposes ${preferred}.`});}
  if(marketSignal.available&&Math.abs(marketSignal.score)>=15&&Math.sign(marketSignal.score)!==sign)items.push({layer:'market',value:marketSignal.score,severity:Math.abs(marketSignal.score)>=45?'high':'medium',reason:'Verified market movement opposes the fundamental posterior.'});
  if(expectationGap.marketAvailable&&Math.abs(expectationGap.gap)>=30)items.push({layer:'expectation-gap',value:expectationGap.gap,severity:Math.abs(expectationGap.gap)>=55?'high':'medium',reason:'Fundamental expectations and current price response are materially separated.'});
  const weighted=items.reduce((s,x)=>s+(x.severity==='high'?2:1),0),penalty=Math.max(.45,1-.10*weighted);
  return {preferred,items,count:items.length,weightedSeverity:weighted,penalty,status:weighted>=5?'severe':weighted>=2?'material':'contained'};
}
function refinedPairScore(opportunity,expectationGap,marketSignal,contradictions){
  const components=[
    {id:'legacy-edge',value:Number(opportunity.score||0),weight:.48},
    {id:'policy',value:Number(opportunity?.components?.policyDivergence||0),weight:.17},
    {id:'release',value:Number(opportunity?.components?.releaseDivergence||0),weight:.10},
    {id:'consensus-expectation',value:Number(expectationGap.directionalConsensus||0),weight:.10},
  ];
  if(marketSignal.available)components.push({id:'market-confirmation',value:marketSignal.score,weight:.15});
  else components[0].weight+=.10,components[1].weight+=.05;
  const total=components.reduce((s,x)=>s+x.weight,0)||1;
  const raw=components.reduce((s,x)=>s+x.value*x.weight,0)/total;
  const score=Math.round(raw*contradictions.penalty);
  return {score,components:Object.fromEntries(components.map(x=>[x.id,{value:Math.round(x.value),weight:Number((x.weight/total).toFixed(3))}])),contradictionPenalty:Number(contradictions.penalty.toFixed(3))};
}
function thesisForPair(opportunity,posterior,refined,contradictions,catalysts,quality,expectationGap){
  const direction=posterior.buy>posterior.sell?'BUY':'SELL',componentEntries=COMPONENT_KEYS.map(([field,label])=>({label,value:Number(opportunity?.components?.[field]||0)})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  const drivers=componentEntries.filter(x=>Math.sign(x.value)===(direction==='BUY'?1:-1)&&Math.abs(x.value)>=8).slice(0,3);
  const opponents=componentEntries.filter(x=>Math.sign(x.value)!==(direction==='BUY'?1:-1)&&Math.abs(x.value)>=8).slice(0,3);
  const invalidations=[
    `Refined evidence score crosses ${direction==='BUY'?'below':'above'} zero and remains there after the next material update.`,
    `Posterior ${direction.toLowerCase()} probability falls below 45%.`,
    `Evidence quality falls below 60/100 or the decision becomes source-limited.`,
    `Contradiction severity rises to severe without a compensating catalyst.`,
  ];
  if(catalysts[0])invalidations.unshift(`${catalysts[0].currency} ${catalysts[0].event} materially contradicts the current thesis.`);
  if(expectationGap.marketAvailable)invalidations.push('Verified price response persists against the fundamental thesis through the active event window.');
  return {direction,statement:`${opportunity.symbol}: ${direction} thesis after Bayesian evidence reconciliation; refined score ${refined.score}.`,drivers,opposingEvidence:opponents,catalysts,invalidations,quality:quality.status,counterThesis:opponents.length?`The strongest counter-thesis is ${opponents[0].label} at ${Math.round(opponents[0].value)}.`:'No major modeled component currently forms a strong counter-thesis; event and market-confirmation risk remain.'};
}
function scenarioRobustness(research,symbol,preferredDirection){
  const scenarios=Array.isArray(research?.scenarios)?research.scenarios:[];
  const observations=[];
  for(const scenario of scenarios){
    const pair=(scenario?.pairs||[]).find(item=>String(item?.symbol||'').toUpperCase()===String(symbol||'').toUpperCase());
    if(!pair)continue;
    const direction=String(pair.direction||'WAIT').toUpperCase();
    observations.push({scenario:scenario.label||scenario.id,direction,score:Number(pair.score||0),matches:direction===preferredDirection,wait:direction==='WAIT'});
  }
  if(!observations.length)return {available:false,score:50,factor:.88,matches:0,flips:0,waits:0,total:0,observations:[],status:'not-measured'};
  const matches=observations.filter(x=>x.matches).length,waits=observations.filter(x=>x.wait).length,flips=observations.length-matches-waits;
  const score=Math.round(100*(matches+.45*waits)/observations.length),factor=clamp(.55+.45*score/100,.55,1);
  return {available:true,score,factor:Number(factor.toFixed(3)),matches,flips,waits,total:observations.length,observations,status:score>=70?'robust':score>=45?'conditional':'fragile'};
}
function evidenceCompletenessControls({quality,causalTransmission,counterfactual,scenario,modelHealth,evidenceIndependence,temporal,marketSignal,crossAsset,historicalCalibration,transitionRisk,structuralBreak,reactionFunctionGap}){
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
    {id:'structural-stability',weight:5,mandatory:false,score:structuralBreak?clamp(1-Number(structuralBreak.risk||0)/100,0,1):.5,available:Boolean(structuralBreak)},
    {id:'reaction-function',weight:5,mandatory:false,score:(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)?1:.5,available:Boolean(reactionFunctionGap?.base?.available||reactionFunctionGap?.quote?.available)},
  ];
  const totalWeight=checks.reduce((s,x)=>s+x.weight,0),earned=checks.reduce((s,x)=>s+x.weight*x.score,0),score=Math.round(100*earned/Math.max(1,totalWeight)),mandatoryMissing=checks.filter(x=>x.mandatory&&!x.available).map(x=>x.id),missing=checks.filter(x=>!x.available).map(x=>x.id),available=checks.filter(x=>x.available).map(x=>x.id),factor=clamp(.80+.20*score/100,.80,1),status=mandatoryMissing.length?'insufficient':score>=82?'complete':score>=68?'adequate':score>=55?'partial':'thin';
  return {score,status,factor:Number(factor.toFixed(3)),mandatoryMissing,missing,available,checks:checks.map(x=>({id:x.id,weight:x.weight,mandatory:x.mandatory,available:x.available,score:Number(x.score.toFixed(3))}))};
}
function evidenceIndependenceControls(research,symbol){
  const [base,quote]=currenciesForSymbol(symbol),lookup=currency=>research?.evidenceIndependence?.economies?.find(x=>x.economy===ECONOMY_BY_CURRENCY[currency])||null,baseRow=base==='XAU'?null:lookup(base),quoteRow=lookup(quote),ratios=[baseRow?.independenceRatio,quoteRow?.independenceRatio].filter(Number.isFinite),ratio=ratios.length?mean(ratios):Number(research?.evidenceIndependence?.independenceRatio||1),factor=clamp(.72+.28*ratio,.72,1),status=ratio<.5?'high-redundancy':ratio<.72?'overlapping':'independent';return {status,independenceRatio:Number(ratio.toFixed(3)),factor:Number(factor.toFixed(3)),base:baseRow,quote:quoteRow,globalRatio:Number(research?.evidenceIndependence?.independenceRatio||1)};
}
function structuralBreakControls(research,symbol){
  const [base,quote]=currenciesForSymbol(symbol),lookup=currency=>research?.structuralBreaks?.economies?.find(x=>x.economy===ECONOMY_BY_CURRENCY[currency])||null,baseRow=base==='XAU'?null:lookup(base),quoteRow=lookup(quote),risks=[baseRow?.risk,quoteRow?.risk].filter(Number.isFinite),risk=risks.length?Math.max(...risks):0,status=risk>=78?'break':risk>=52?'watch':'stable',factor=status==='break'?clamp(1-risk/500,.80,.86):status==='watch'?clamp(1-risk/700,.90,.95):1;
  return {status,risk,factor:Number(factor.toFixed(3)),base:baseRow,quote:quoteRow,breakSeries:Number(research?.structuralBreaks?.breakSeries||0),watchSeries:Number(research?.structuralBreaks?.watchSeries||0)};
}
function transitionRiskControls(research,symbol){
  const [base,quote]=currenciesForSymbol(symbol),baseEconomy=ECONOMY_BY_CURRENCY[base],quoteEconomy=ECONOMY_BY_CURRENCY[quote],find=economy=>research?.turningPoints?.economies?.find(x=>x.economy===economy)||null,baseRisk=base==='XAU'?null:find(baseEconomy),quoteRisk=find(quoteEconomy),risks=[baseRisk?.risk,quoteRisk?.risk].filter(Number.isFinite),maxRisk=risks.length?Math.max(...risks):0,divergentDirections=baseRisk&&quoteRisk&&baseRisk.direction!==quoteRisk.direction&&baseRisk.direction!=='mixed'&&quoteRisk.direction!=='mixed',factor=clamp(1-maxRisk/500-(divergentDirections?0:.02),.78,1),status=maxRisk>=75?'high':maxRisk>=50?'watch':'stable';
  const catalystCurrencies=research?.catalystSequence?.currencies||[],baseCatalyst=catalystCurrencies.find(x=>x.currency===base),quoteCatalyst=catalystCurrencies.find(x=>x.currency===quote),density=Math.max(Number(baseCatalyst?.densityScore||0),Number(quoteCatalyst?.densityScore||0)),catalystFactor=clamp(1-density/600,.84,1);
  return {status,maxRisk,factor:Number((factor*catalystFactor).toFixed(3)),turningPointFactor:Number(factor.toFixed(3)),catalystFactor:Number(catalystFactor.toFixed(3)),divergentDirections,base:baseRisk,quote:quoteRisk,catalystDensity:density,baseCatalyst:baseCatalyst||null,quoteCatalyst:quoteCatalyst||null};
}
function confidenceBucketForCalibration(value){const c=Number(value||0);return c>=80?'80-100':c>=65?'65-79':c>=50?'50-64':'0-49';}
function analogueVector({refined,bayesian,quality,uncertainty,scenario,contradictions,reactionFunctionGap,crossAsset,evidenceCompleteness,temporal,transitionRisk,structuralBreak,evidenceIndependence,modelHealth,counterfactual,causalTransmission}){
  const p=bayesian?.posterior||{};return {refinedScore:Number(refined?.score||0),directionalProbability:Math.max(Number(p.buy||0),Number(p.sell||0)),evidenceQuality:Number(quality?.score||0),uncertainty:Number(uncertainty?.score||0),scenarioRobustness:Number(scenario?.score||0),contradictions:Number(contradictions?.count||0),reactionGap:Number(reactionFunctionGap?.differential||0),crossAssetScore:Number(crossAsset?.score||0),evidenceCompleteness:Number(evidenceCompleteness?.score||0),releaseDifferential:Number(temporal?.releaseDifferential||0),revisionDifferential:Number(temporal?.revisionDifferential||0),communicationGap:Number(temporal?.communicationGap||0),transitionRisk:Number(transitionRisk?.maxRisk||0),structuralBreakRisk:Number(structuralBreak?.risk||0),independenceRatio:Number(evidenceIndependence?.independenceRatio??1),modelHealth:Number(modelHealth?.score||0),counterfactualShift:Number(counterfactual?.minimumAdverseShift||100),causalNet:Number(causalTransmission?.netTransmission||0)};
}
const ANALOGUE_SCALES={refinedScore:100,directionalProbability:1,evidenceQuality:100,uncertainty:100,scenarioRobustness:100,contradictions:5,reactionGap:100,crossAssetScore:100,evidenceCompleteness:100,releaseDifferential:100,revisionDifferential:100,communicationGap:100,transitionRisk:100,structuralBreakRisk:100,independenceRatio:1,modelHealth:100,counterfactualShift:100,causalNet:100};
function analogueDistance(a,b){let sum=0,count=0;for(const [key,scale] of Object.entries(ANALOGUE_SCALES)){const av=Number(a?.[key]),bv=Number(b?.[key]);if(!Number.isFinite(av)||!Number.isFinite(bv))continue;const d=(av-bv)/scale;sum+=d*d;count++;}return count?Math.sqrt(sum/count):1;}
function historicalAnalogueControls(decisionMemory,symbol,direction,vector){
  const candidates=(decisionMemory?.analogueLibrary?.[String(symbol||'').toUpperCase()]||[]).filter(x=>x.direction===direction).map(row=>{const distance=analogueDistance(vector,row.featureVector),similarity=Math.exp(-2.8*distance),outcome=row.outcomes?.h4||row.outcomes?.h1||row.outcomes?.h24||row.outcomes?.m15||null;return {...row,distance:Number(distance.toFixed(4)),similarity:Number(similarity.toFixed(4)),selectedOutcome:outcome};}).filter(x=>x.selectedOutcome&&x.similarity>=.30).sort((a,b)=>b.similarity-a.similarity).slice(0,8);
  const weight=candidates.reduce((s,x)=>s+x.similarity,0),hit=weight?candidates.reduce((s,x)=>s+x.similarity*(x.selectedOutcome.outcome==='correct'?1:x.selectedOutcome.outcome==='flat'?.5:0),0)/weight:null,avgBps=weight?candidates.reduce((s,x)=>s+x.similarity*Number(x.selectedOutcome.signedBps||0),0)/weight:null,avgSimilarity=candidates.length?mean(candidates.map(x=>x.similarity)):0,samples=candidates.length,score=hit==null?null:Math.round(100*clamp(.65*hit+.35*clamp((Number(avgBps||0)+5)/12,0,1),0,1)),factor=samples>=5?clamp(.84+.20*Number(score||50)/100,.84,1.04):1,status=samples>=6&&(Number(hit||0)<.38||Number(avgBps||0)<-2)?'adverse':samples>=4?'usable':'building';
  return {status,samples,factor:Number(factor.toFixed(3)),weightedHitRate:hit==null?null:Number((100*hit).toFixed(1)),averageSignedBps:avgBps==null?null:Number(avgBps.toFixed(2)),averageSimilarity:Number(avgSimilarity.toFixed(3)),score,analogues:candidates.map(x=>({decisionAt:x.decisionAt,similarity:x.similarity,distance:x.distance,outcome:x.selectedOutcome.outcome,signedBps:Number(x.selectedOutcome.signedBps||0)}))};
}
function horizonCalibrationControls(decisionMemory,symbol,confidence,directionalProbability){
  const horizons=['m15','h1','h4','h24'],pair=decisionMemory?.bySymbol?.[String(symbol||'').toUpperCase()]?.horizons||{},bucket=decisionMemory?.byConfidence?.[confidenceBucketForCalibration(confidence)]?.horizons||{},global=decisionMemory?.horizons||{},rows={};
  for(const horizon of horizons){const candidates=[{level:'pair',stats:pair[horizon],min:8},{level:'confidence',stats:bucket[horizon],min:12},{level:'global',stats:global[horizon],min:18}],selected=candidates.find(x=>Number(x.stats?.count||0)>=x.min)||candidates.find(x=>Number(x.stats?.count||0)>0),stats=selected?.stats||null,samples=Number(stats?.count||0),empiricalHit=Number(stats?.hitRate)/100,validHit=Number.isFinite(empiricalHit),reliability=selected?.level==='pair'?Math.min(.45,samples/40*.45):selected?.level==='confidence'?Math.min(.32,samples/55*.32):Math.min(.22,samples/80*.22),calibrated=validHit?(1-reliability)*Number(directionalProbability||0)+reliability*empiricalHit:Number(directionalProbability||0);rows[horizon]={horizon,source:selected?.level||'none',samples,modelProbability:Number(directionalProbability||0),empiricalHitRate:validHit?empiricalHit:null,calibratedProbability:Number(clamp(calibrated,.01,.99).toFixed(4)),brier:Number.isFinite(Number(stats?.brier))?Number(stats.brier):null,averageSignedBps:Number.isFinite(Number(stats?.averageSignedBps))?Number(stats.averageSignedBps):null,reliability:Number(reliability.toFixed(3)),status:samples>=18?'calibrated':samples>=6?'building':'insufficient'};}
  const useful=Object.values(rows).filter(x=>x.samples>=6),weighted=useful.reduce((s,x)=>s+x.calibratedProbability*Math.max(1,x.samples),0),weight=useful.reduce((s,x)=>s+Math.max(1,x.samples),0),overall=weight?weighted/weight:Number(directionalProbability||0),negativeEdge=Object.values(rows).filter(x=>x.samples>=18&&Number.isFinite(x.averageSignedBps)&&x.averageSignedBps<-1.5),positive=Object.values(rows).filter(x=>x.samples>=10&&Number.isFinite(x.averageSignedBps)&&x.averageSignedBps>1.5).sort((a,b)=>b.averageSignedBps-a.averageSignedBps),preferredHorizon=positive[0]?.horizon||null;
  return {confidenceBucket:confidenceBucketForCalibration(confidence),rows,overallCalibratedProbability:Number(clamp(overall,.01,.99).toFixed(4)),negativeEdgeHorizons:negativeEdge.map(x=>x.horizon),preferredHorizon,status:useful.length>=3?'calibrated':useful.length?'building':'insufficient'};
}
function decisionChangeControls(decisionMemory,symbol,currentDirection,currentScore,currentConfidence,nowMs){
  const history=decisionMemory?.decisionChanges?.[String(symbol||'').toUpperCase()]||{},previous=history.latest||null;if(!previous)return {status:'new',factor:1,previous:null,ageMinutes:null,directionChanged:false,scoreDelta:null,confidenceDelta:null,reasons:[]};const ageMinutes=Math.max(0,(nowMs-Date.parse(previous.decisionAt||0))/60000),directionChanged=previous.direction&&currentDirection&&previous.direction!==currentDirection&&previous.direction!=='WAIT'&&currentDirection!=='WAIT',scoreDelta=Number(currentScore||0)-Number(previous.refinedScore||0),confidenceDelta=Number(currentConfidence||0)-Number(previous.confidence||0),reasons=[];let factor=1,status='stable';if(directionChanged&&ageMinutes<=30){factor=.78;status='fresh-flip';reasons.push('Directional state flipped within 30 minutes.');}else if(directionChanged&&ageMinutes<=120){factor=.90;status='recent-flip';reasons.push('Directional state changed within the last two hours.');}if(Math.abs(scoreDelta)>=35){factor*=.95;reasons.push('Refined score changed materially from the prior frozen decision.');}if(confidenceDelta<=-20){factor*=.96;reasons.push('Governed confidence deteriorated sharply from the prior decision.');}return {status,factor:Number(clamp(factor,.70,1).toFixed(3)),previous,ageMinutes:Math.round(ageMinutes),directionChanged,scoreDelta:Math.round(scoreDelta),confidenceDelta:Math.round(confidenceDelta),reasons};
}
function historicalCalibrationControls(decisionMemory,symbol){
  const pair=decisionMemory?.bySymbol?.[String(symbol||'').toUpperCase()]||null,global=decisionMemory?.horizons||{},sources=[];
  for(const horizon of ['h1','h4','h24']){const stats=pair?.horizons?.[horizon]||global?.[horizon];if(stats&&Number(stats.count||0)>0)sources.push({horizon,...stats});}
  const samples=sources.reduce((s,x)=>s+Number(x.count||0),0);
  if(!samples)return {status:'building',samples:0,factor:1,score:null,hitRate:null,brier:null,horizons:[]};
  const hitRate=sources.reduce((s,x)=>s+Number(x.hitRate||0)*Number(x.count||0),0)/samples,brier=sources.reduce((s,x)=>s+Number(x.brier||0)*Number(x.count||0),0)/samples;
  const hitSkill=clamp((hitRate-35)/35,0,1),brierSkill=clamp((.36-brier)/.26,0,1),score=Math.round(100*(.55*hitSkill+.45*brierSkill)),factor=clamp(.75+.25*score/100,.75,1),status=samples>=20&&(hitRate<42||brier>.32)?'degraded':samples>=8?'calibrated':'building';
  return {status,samples,factor:Number(factor.toFixed(3)),score,hitRate:Number(hitRate.toFixed(1)),brier:Number(brier.toFixed(4)),horizons:sources.map(x=>({horizon:x.horizon,count:x.count,hitRate:x.hitRate,brier:x.brier,averageSignedBps:x.averageSignedBps}))};
}
function modelHealthControls(research){
  const health=research?.modelHealth||{},score=Number(health.score||0),status=String(health.status||'insufficient');
  const factor=score>0?clamp(.55+.45*score/100,.55,1):.82;
  return {score,status,factor:Number(factor.toFixed(3)),drifting:Number(health.drifting||0),watch:Number(health.watch||0),calibratedForecasts:Number(health.calibratedForecasts||0),averageDriftScore:Number(health.averageDriftScore||0)};
}
function researchRiskControls(research){
  const aggregate=Number(research?.risk?.aggregate||0),quality=Number(research?.dataQuality?.overall||0),severity=String(research?.risk?.severity||'normal');
  const riskPenalty=clamp(1-aggregate/180,.48,1),qualityFactor=quality>0?clamp(quality/85,.60,1):.82;
  return {aggregate,quality,severity,riskPenalty:Number(riskPenalty.toFixed(3)),qualityFactor:Number(qualityFactor.toFixed(3)),nextHighImpact:research?.risk?.nextHighImpact||null};
}
function uncertaintyDecomposition(posterior,contradictions,quality,expectationGap,scenario,risk){
  const probs=[posterior.buy,posterior.sell,posterior.wait].map(x=>Math.max(1e-9,Number(x||0))),entropy=-probs.reduce((s,p)=>s+p*Math.log(p),0)/Math.log(3);
  const dataUncertainty=1-clamp(quality.score/100,0,1),contradictionUncertainty=clamp(contradictions.weightedSeverity/6,0,1),marketUncertainty=expectationGap.marketAvailable?clamp(Math.abs(Number(expectationGap.gap||0))/100,0,1):.55,scenarioUncertainty=scenario.available?1-scenario.score/100:.50,riskUncertainty=clamp(risk.aggregate/100,0,1);
  const total=clamp(.28*entropy+.20*dataUncertainty+.18*contradictionUncertainty+.12*marketUncertainty+.12*scenarioUncertainty+.10*riskUncertainty,0,1);
  return {total:Number(total.toFixed(4)),score:Math.round(total*100),posteriorEntropy:Number(entropy.toFixed(4)),data:Math.round(dataUncertainty*100),contradictions:Math.round(contradictionUncertainty*100),market:Math.round(marketUncertainty*100),scenario:Math.round(scenarioUncertainty*100),risk:Math.round(riskUncertainty*100),status:total>=.62?'high':total>=.38?'moderate':'contained'};
}
function buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality){
  const failures=[];
  if(quality.score<70)failures.push({risk:'evidence-quality',severity:'high',condition:'Evidence freshness, breadth or historical depth deteriorates further.',response:'Downgrade to WAIT until coverage recovers.'});
  if(contradictions.count)failures.push({risk:'contradiction-escalation',severity:contradictions.status==='severe'?'high':'medium',condition:'Opposing macro, policy, release or market evidence strengthens.',response:'Require a fresh score and posterior reconciliation before execution.'});
  if(expectationGap.marketAvailable&&Math.abs(Number(expectationGap.gap||0))>=20)failures.push({risk:'expectation-gap-persistence',severity:'medium',condition:'Price continues to reject the fundamental expectation gap.',response:'Treat price rejection as evidence against the thesis rather than assuming delayed convergence.'});
  if(scenario.available&&scenario.status!=='robust')failures.push({risk:'scenario-fragility',severity:scenario.status==='fragile'?'high':'medium',condition:'A plausible macro stress scenario flips or neutralizes the pair direction.',response:'Reduce confidence or hold WAIT until the catalyst resolves.'});
  if(risk.aggregate>=50||risk.nextHighImpact)failures.push({risk:'event-or-portfolio-risk',severity:risk.aggregate>=70?'high':'medium',condition:'Event or portfolio risk overwhelms the modeled directional edge.',response:'Apply event lockout or risk haircut before technical confirmation.'});
  if(!failures.length)failures.push({risk:'unmodeled-shock',severity:'low',condition:'A new policy, geopolitical or liquidity shock arrives outside the modeled evidence set.',response:'Invalidate cached conviction and force a full evidence refresh.'});
  return failures.slice(0,6);
}
function finalDecision(opportunity,posterior,refined,contradictions,quality,controls){
  const maxDirectional=Math.max(posterior.buy,posterior.sell),posteriorDirection=posterior.buy>=posterior.sell?'BUY':'SELL',original=String(opportunity.direction||'WAIT').toUpperCase();
  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),horizonProbability=Number(controls?.horizonCalibration?.overallCalibratedProbability||maxDirectional),horizonFactor=clamp(.78+.22*(horizonProbability/.5),.72,1.08),changeFactor=Number(controls?.decisionChange?.factor||1),analogueFactor=Number(controls?.historicalAnalogues?.factor||1),crossAssetFactorValue=Number(controls?.crossAsset?.factor||1),reactionFactor=Number(controls?.reactionFunctionGap?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),temporalFactor=Number(controls?.temporal?.factor||1),transitionFactor=Number(controls?.transitionRisk?.factor||1),breakFactor=Number(controls?.structuralBreak?.factor||1),independenceFactor=Number(controls?.evidenceIndependence?.factor||1),completenessFactor=Number(controls?.evidenceCompleteness?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);
  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*horizonFactor*changeFactor*analogueFactor*crossAssetFactorValue*reactionFactor*counterfactualFactor*temporalFactor*transitionFactor*breakFactor*independenceFactor*completenessFactor*uncertaintyPenalty);
  const dynamicThreshold=Math.round(18+12*(1-confidence/100)+3*Math.min(4,contradictions.weightedSeverity)+6*Number(controls?.uncertainty?.total||0));
  const reason=[];
  let direction=posteriorDirection;
  if(original==='WAIT'){direction='WAIT';reason.push('Primary macro engine has no directional edge.');}
  if(original!=='WAIT'&&posteriorDirection!==original){direction='WAIT';reason.push('Bayesian governance disagrees with the primary directional engine.');}
  if(Math.abs(refined.score)<dynamicThreshold){direction='WAIT';reason.push('Refined score does not clear the dynamic evidence threshold.');}
  if(maxDirectional<.46){direction='WAIT';reason.push('Posterior directional probability is not decisive.');}
  if(confidence<38){direction='WAIT';reason.push('Governed confidence is below the minimum decision threshold.');}
  if(contradictions.status==='severe'){direction='WAIT';reason.push('Contradiction severity is too high for directional execution.');}
  if(controls?.scenario?.available&&controls.scenario.status==='fragile'){direction='WAIT';reason.push('Directional thesis is fragile across plausible macro scenarios.');}
  if(Number(controls?.risk?.aggregate||0)>=78){direction='WAIT';reason.push('Research risk state is too elevated for directional execution.');}
  if(controls?.modelHealth?.status==='degraded'&&Number(controls.modelHealth.calibratedForecasts||0)>=5){direction='WAIT';reason.push('Forecast model health is degraded across validated series.');}
  if(controls?.historicalCalibration?.status==='degraded'&&Number(controls.historicalCalibration.samples||0)>=20){direction='WAIT';reason.push('Historical decision calibration for this pair is degraded and requires revalidation.');}
  if((controls?.horizonCalibration?.negativeEdgeHorizons||[]).length>=2){direction='WAIT';reason.push('Multiple sufficiently sampled decision horizons show negative realized directional edge.');}
  if(controls?.decisionChange?.status==='fresh-flip'&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Fresh directional flip requires stronger evidence before execution.');}
  if(controls?.historicalAnalogues?.status==='adverse'&&Number(controls.historicalAnalogues.samples||0)>=6){direction='WAIT';reason.push('Nearest historical analogues show adverse realized outcomes for this directional state.');}
  if(controls?.crossAsset?.alignment==='opposed'&&Math.abs(Number(controls.crossAsset.score||0))>=50&&Math.abs(Number(refined?.score||0))<45){direction='WAIT';reason.push('Broad cross-asset transmission materially opposes the pair thesis.');}
  if(controls?.reactionFunctionGap?.status==='strong-repricing-conflict'&&Math.abs(Number(refined?.score||0))<50){direction='WAIT';reason.push('Central-bank reaction-function repricing risk materially opposes the directional thesis.');}
  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}
  if(controls?.temporal?.status==='contested'&&Number(controls.temporal.factor||1)<=.80){direction='WAIT';reason.push('Recent release, revision and policy-communication timing evidence materially contests the thesis.');}
  if(controls?.transitionRisk?.status==='high'&&Number(controls.transitionRisk.maxRisk||0)>=82){direction='WAIT';reason.push('Macro turning-point risk is too high for a stable directional thesis.');}
  if(controls?.structuralBreak?.status==='break'&&Number(controls.structuralBreak.risk||0)>=88&&Math.abs(Number(refined?.score||0))<55){direction='WAIT';reason.push('A major macro structural-break warning makes the historical relationship unstable.');}
  if((controls?.evidenceCompleteness?.mandatoryMissing||[]).length||Number(controls?.evidenceCompleteness?.score||100)<50){direction='WAIT';reason.push('Mandatory research evidence is incomplete for directional execution.');}
  if(Number(controls?.uncertainty?.total||0)>=.68){direction='WAIT';reason.push('Combined model and evidence uncertainty is too high.');}
  if(String(opportunity.risk||'')==='event-lockout'){direction='WAIT';reason.push('High-impact event lockout is active.');}
  return {direction,confidence,dynamicThreshold,reason:reason.length?reason:['Primary and governance layers agree; decision remains eligible for technical confirmation.'],executionGate:direction==='WAIT'?'NO_DIRECTIONAL_EXECUTION':'AWAIT_TECHNICAL_CONFIRMATION'};
}
function economyStateForCurrency(economies,currency){return (economies||[]).find(e=>String(e?.currency||'').toUpperCase()===String(currency||'').toUpperCase())||null;}
function dimensionScore(state,id){const d=(state?.dimensions||[]).find(x=>x.id===id);return Number(d?.score||0);}
function reactionFunctionForEconomy(state){
  if(!state)return {available:false,dataPressure:0,policyEvidence:0,gap:0,status:'unavailable',components:{}};
  const inflation=dimensionScore(state,'inflation'),labour=dimensionScore(state,'labour'),growth=dimensionScore(state,'growth'),policy=dimensionScore(state,'policy'),financial=dimensionScore(state,'financial');
  const dataPressure=.48*inflation+.25*labour+.17*growth+.10*financial,gap=dataPressure-policy,status=gap>=18?'hawkish-repricing-risk':gap<=-18?'dovish-repricing-risk':'policy-near-data';
  return {available:true,economy:state.id,currency:state.currency,centralBank:state.centralBank,dataPressure:Math.round(dataPressure),policyEvidence:Math.round(policy),gap:Math.round(gap),status,components:{inflation:Math.round(inflation),labour:Math.round(labour),growth:Math.round(growth),financial:Math.round(financial),policy:Math.round(policy)}};
}
function reactionFunctionGapForPair(opportunity,economies){
  const [base,quote]=currenciesForSymbol(opportunity.symbol),baseState=base==='XAU'?null:economyStateForCurrency(economies,base),quoteState=economyStateForCurrency(economies,quote),baseGap=base==='XAU'?{available:false,currency:'XAU',gap:0,status:'not-applicable'}:reactionFunctionForEconomy(baseState),quoteGap=reactionFunctionForEconomy(quoteState),differential=base==='XAU'?-Number(quoteGap.gap||0):Number(baseGap.gap||0)-Number(quoteGap.gap||0),direction=Math.sign(Number(opportunity?.score||0))||1,alignment=Math.abs(differential)<12?'neutral':Math.sign(differential)===direction?'aligned':'opposed',factor=alignment==='aligned'?clamp(1+Math.min(.06,Math.abs(differential)/1200),1,1.06):alignment==='opposed'?clamp(1-Math.min(.13,Math.abs(differential)/700),.87,1):1;
  return {symbol:opportunity.symbol,base:baseGap,quote:quoteGap,differential:Math.round(differential),alignment,factor:Number(factor.toFixed(3)),status:Math.abs(differential)>=35?(alignment==='aligned'?'strong-repricing-support':'strong-repricing-conflict'):Math.abs(differential)>=15?(alignment==='aligned'?'repricing-support':'repricing-conflict'):'balanced'};
}
function causalTransmissionForPair(opportunity,economies,marketSignal){
  const [base,quote]=currenciesForSymbol(opportunity.symbol),baseState=economyStateForCurrency(economies,base),quoteState=economyStateForCurrency(economies,quote),nodes=[],edges=[];
  const add=(id,label,value,available=true)=>nodes.push({id,label,value:available?Math.round(value):null,available});
  const differential=(id)=>base==='XAU'?-dimensionScore(quoteState,id):dimensionScore(baseState,id)-dimensionScore(quoteState,id);
  const hasEconomies=base==='XAU'?Boolean(quoteState):Boolean(baseState&&quoteState);
  add('growth','Growth differential',differential('growth'),hasEconomies);add('inflation','Inflation differential',differential('inflation'),hasEconomies);add('labour','Labour differential',differential('labour'),hasEconomies);add('policy','Policy differential',differential('policy'),hasEconomies);add('financial','Financial conditions differential',differential('financial'),hasEconomies);add('market','Verified price confirmation',marketSignal.score,marketSignal.available);
  for(const [from,to,relation] of [['growth','policy','growth influences reaction function'],['inflation','policy','inflation influences reaction function'],['labour','policy','labour slack influences reaction function'],['policy','financial','policy transmits through financial conditions'],['financial','market','financial conditions transmit to market pricing'],['policy','market','rate expectations transmit to FX pricing']])edges.push({from,to,relation});
  const available=nodes.filter(n=>n.available),signed=available.map(n=>Number(n.value||0)),direction=Math.sign(Number(opportunity?.score||0)),aligned=direction?available.filter(n=>Math.sign(Number(n.value||0))===direction&&Math.abs(Number(n.value||0))>=8).length:0,opposed=direction?available.filter(n=>Math.sign(Number(n.value||0))===-direction&&Math.abs(Number(n.value||0))>=8).length:0,agreement=available.length?aligned/available.length:0;
  return {symbol:opportunity.symbol,nodes,edges,availableNodes:available.length,missingNodes:nodes.filter(n=>!n.available).map(n=>n.id),aligned,opposed,agreement:Number(agreement.toFixed(4)),status:available.length<4?'incomplete':opposed>=2?'contested':agreement>=.5?'supportive':'mixed',netTransmission:available.length?Math.round(mean(signed)):0};
}
function counterfactualSensitivity(refined){
  const direction=Math.sign(Number(refined?.score||0))||1,penalty=Number(refined?.contradictionPenalty||1),components=Object.entries(refined?.components||{}),shocks=[5,10,15,20,30,40,50,65,80,100],tests=[];
  for(const [id,component] of components){
    const weight=Number(component?.weight||0),value=Number(component?.value||0);if(weight<=0)continue;
    let minimumAdverseShift=null,scoreAfter=null;
    for(const magnitude of shocks){const shock=-direction*magnitude,next=Number(refined.score||0)+shock*weight*penalty;if(Math.sign(next)!==direction||Math.abs(next)<12){minimumAdverseShift=magnitude;scoreAfter=Math.round(next);break;}}
    const neutralized=Math.round(Number(refined.score||0)+(-value)*weight*penalty),inverted=Math.round(Number(refined.score||0)+(-2*value)*weight*penalty);
    tests.push({component:id,currentValue:Math.round(value),weight:Number(weight.toFixed(3)),minimumAdverseShift,scoreAfter,scoreIfNeutralized:neutralized,scoreIfInverted:inverted});
  }
  const finite=tests.map(x=>x.minimumAdverseShift).filter(Number.isFinite),minimum=finite.length?Math.min(...finite):null,fragility=minimum==null?'robust':minimum<=10?'high':minimum<=25?'medium':'low',factor=fragility==='high'?.80:fragility==='medium'?.92:1;
  const weakest=tests.filter(x=>x.minimumAdverseShift===minimum).map(x=>x.component);
  return {baselineScore:Number(refined?.score||0),minimumAdverseShift:minimum,fragility,factor,weakestComponents:weakest,tests,whatWouldChangeTheMind:tests.filter(x=>Number.isFinite(x.minimumAdverseShift)).sort((a,b)=>a.minimumAdverseShift-b.minimumAdverseShift).slice(0,4).map(x=>`${x.component} deteriorates by roughly ${x.minimumAdverseShift} score points.`)};
}
function recentReleaseSequence(events,currency,nowMs){
  const rows=(events||[]).filter(e=>String(e?.currency||'').toUpperCase()===currency).map(e=>({...e,t:Date.parse(e?.date||'')})).filter(e=>Number.isFinite(e.t)&&e.t<=nowMs&&e.t>=nowMs-7*86400000&&e.actual!==undefined&&e.actual!=='').sort((a,b)=>b.t-a.t).slice(0,12);
  let num=0,den=0;for(const e of rows){const bias=Number(e.currencyBiasScore??(e.currencyBias==='bullish'?1:e.currencyBias==='bearish'?-1:0)),impact=Math.max(1,Math.min(3,Number(e.importance||1)))/3,ageHours=(nowMs-e.t)/3600000,decay=Math.exp(-Math.log(2)*ageHours/48),w=impact*decay;num+=bias*w;den+=w;}
  const score=den?Math.round(100*num/den):0,nonNeutral=rows.map(e=>Number(e.currencyBiasScore??(e.currencyBias==='bullish'?1:e.currencyBias==='bearish'?-1:0))).filter(Boolean);let streak=0,streakSign=nonNeutral[0]||0;for(const value of nonNeutral){if(value===streakSign)streak++;else break;}
  const latest=rows.slice(0,3),prior=rows.slice(3,6),avg=(xs)=>xs.length?mean(xs.map(e=>Number(e.currencyBiasScore??(e.currencyBias==='bullish'?1:e.currencyBias==='bearish'?-1:0)))):0,acceleration=Math.round(100*(avg(latest)-avg(prior)));
  return {currency,score,count:rows.length,streak:streakSign===0?0:streak*streakSign,acceleration,consistency:Number((Math.abs(num)/Math.max(den,1e-9)).toFixed(4)),latest:rows.slice(0,5).map(e=>({event:e.event,date:e.date,importance:Number(e.importance||1),bias:e.currencyBias||'neutral',biasScore:Number(e.currencyBiasScore||0)})),status:rows.length<2?'insufficient':score>=25?'bullish-sequence':score<=-25?'bearish-sequence':'mixed'};
}
function revisionSequence(events,currency,nowMs){
  const items=[];for(const e of events||[]){if(String(e?.currency||'').toUpperCase()!==currency)continue;const t=Date.parse(e?.date||'');if(!Number.isFinite(t)||t>nowMs||t<nowMs-14*86400000)continue;const revised=numeric(e?.revised),previous=numeric(e?.previous);if(revised==null||previous==null||Math.abs(revised-previous)<1e-12)continue;const orientation=eventOrientation(e),raw=(revised-previous),scale=Math.max(Math.abs(previous)*.005,Math.abs(raw),1e-9),score=clamp(raw/scale,-1,1)*orientation;items.push({event:e.event,date:e.date,previous,revised,score});}
  items.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));const recent=items.slice(0,8),score=recent.length?Math.round(100*mean(recent.map((x,i)=>x.score*Math.exp(-Math.log(2)*i/3)))):0;
  return {currency,score,count:recent.length,status:recent.length<2?'insufficient':score>=20?'supportive-revisions':score<=-20?'adverse-revisions':'mixed',items:recent.slice(0,5)};
}
const NEWS_CURRENCY={"United States":'USD','Euro Area':'EUR','United Kingdom':'GBP','South Africa':'ZAR','Japan':'JPY'};
function policyCommunication(news,currency,nowMs){
  const items=(news||[]).filter(item=>NEWS_CURRENCY[item?.region]===currency&&item?.policyTone&&Date.parse(item?.publishedAt||'')<=nowMs&&Date.parse(item?.publishedAt||'')>=nowMs-7*86400000).map(item=>{const ageHours=(nowMs-Date.parse(item.publishedAt))/3600000,w=Math.max(.2,Number(item.policyTone?.confidence||20)/100)*Math.exp(-Math.log(2)*ageHours/72);return {title:item.title,publishedAt:item.publishedAt,score:Number(item.policyTone?.score||0),stance:item.policyTone?.stance||'balanced',confidence:Number(item.policyTone?.confidence||0),weight:w};}).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  const den=items.reduce((s,x)=>s+x.weight,0),score=den?Math.round(items.reduce((s,x)=>s+x.score*x.weight,0)/den):0;return {currency,score,count:items.length,status:items.length<1?'insufficient':score>=18?'hawkish':score<=-18?'dovish':'balanced',items:items.slice(0,5)};
}
function temporalIntelligenceForPair(opportunity,events,news,economies,nowMs){
  const [base,quote]=currenciesForSymbol(opportunity.symbol),baseSeq=base==='XAU'?{score:0,count:0,status:'not-applicable'}:recentReleaseSequence(events,base,nowMs),quoteSeq=recentReleaseSequence(events,quote,nowMs),baseRev=base==='XAU'?{score:0,count:0,status:'not-applicable'}:revisionSequence(events,base,nowMs),quoteRev=revisionSequence(events,quote,nowMs),baseComm=base==='XAU'?{score:0,count:0,status:'not-applicable'}:policyCommunication(news,base,nowMs),quoteComm=policyCommunication(news,quote,nowMs),releaseDifferential=(base==='XAU'?-quoteSeq.score:baseSeq.score-quoteSeq.score),revisionDifferential=(base==='XAU'?-quoteRev.score:baseRev.score-quoteRev.score),direction=Math.sign(Number(opportunity?.score||0))||1;
  const baseState=economyStateForCurrency(economies,base),quoteState=economyStateForCurrency(economies,quote),stanceScore=s=>s?.policyStance==='hawkish'?65:s?.policyStance==='dovish'?-65:0,baseGap=base==='XAU'?0:baseComm.score-stanceScore(baseState),quoteGap=quoteComm.score-stanceScore(quoteState),communicationGap=Math.max(Math.abs(baseGap),Math.abs(quoteGap));
  const related=(events||[]).filter(e=>[base,quote].includes(String(e?.currency||'').toUpperCase())).map(e=>({...e,t:Date.parse(e?.date||'')})).filter(e=>Number.isFinite(e.t));const completed=related.filter(e=>e.t<=nowMs).sort((a,b)=>b.t-a.t),upcoming=related.filter(e=>e.t>nowMs).sort((a,b)=>a.t-b.t),lastHigh=completed.find(e=>Number(e.importance||1)>=3),nextHigh=upcoming.find(e=>Number(e.importance||1)>=3),catalystAgeHours=lastHigh?Math.round((nowMs-lastHigh.t)/3600000):null;
  const releaseConflict=Math.abs(releaseDifferential)>=30&&Math.sign(releaseDifferential)!==direction,revisionConflict=Math.abs(revisionDifferential)>=30&&Math.sign(revisionDifferential)!==direction,communicationConflict=communicationGap>=45,staleCatalyst=catalystAgeHours!=null&&catalystAgeHours>96&&!nextHigh;
  const factor=clamp(1-(releaseConflict?.09:0)-(revisionConflict?.06:0)-(communicationConflict?.07:0)-(staleCatalyst?.05:0),.73,1),conflicts=[releaseConflict?'release-sequence':null,revisionConflict?'revision-sequence':null,communicationConflict?'policy-communication-gap':null,staleCatalyst?'stale-catalyst':null].filter(Boolean);
  return {symbol:opportunity.symbol,factor:Number(factor.toFixed(3)),status:conflicts.length>=3?'contested':conflicts.length?'mixed':'aligned',conflicts,releaseDifferential,revisionDifferential,communicationGap,base:{release:baseSeq,revisions:baseRev,communication:baseComm,policyCommunicationGap:baseGap},quote:{release:quoteSeq,revisions:quoteRev,communication:quoteComm,policyCommunicationGap:quoteGap},catalysts:{lastHighImpact:lastHigh?{event:lastHigh.event,currency:lastHigh.currency,date:lastHigh.date}:null,nextHighImpact:nextHigh?{event:nextHigh.event,currency:nextHigh.currency,date:nextHigh.date,minutes:Math.round((nextHigh.t-nowMs)/60000)}:null,catalystAgeHours}};
}
function evidenceGraph(pairDecisions,quality){
  const nodes=[{id:'quality',type:'quality',label:'Evidence Quality',score:quality.score,status:quality.status}],edges=[];
  for(const pair of pairDecisions){
    const pairId=`pair:${pair.symbol}`;nodes.push({id:pairId,type:'decision',label:pair.symbol,score:pair.refined.score,status:pair.final.direction});edges.push({from:'quality',to:pairId,relation:'conditions',weight:quality.score/100});
    for(const [key,value] of Object.entries(pair.refined.components)){const id=`${pair.symbol}:${key}`;nodes.push({id,type:'evidence',label:key,score:value.value});edges.push({from:id,to:pairId,relation:Math.sign(value.value)===Math.sign(pair.refined.score)?'supports':'opposes',weight:value.weight});}
  }
  return {nodes:nodes.slice(0,80),edges:edges.slice(0,120),nodeCount:nodes.length,edgeCount:edges.length};
}
function triangleConsistency(pairDecisions=[]){
  const bySymbol=new Map(pairDecisions.map(x=>[String(x.symbol||'').toUpperCase(),x])),definitions=[
    {target:'EURGBP',legs:[['EURUSD',1],['GBPUSD',-1]],equation:'EURGBP ≈ EURUSD − GBPUSD'},
    {target:'EURZAR',legs:[['EURUSD',1],['USDZAR',1]],equation:'EURZAR ≈ EURUSD + USDZAR'},
    {target:'GBPZAR',legs:[['GBPUSD',1],['USDZAR',1]],equation:'GBPZAR ≈ GBPUSD + USDZAR'},
  ],checks=[];
  for(const def of definitions){const target=bySymbol.get(def.target),legs=def.legs.map(([symbol,coef])=>({symbol,coef,pair:bySymbol.get(symbol)}));if(!target||legs.some(x=>!x.pair))continue;const direct=Number(target.refined?.score||0),implied=legs.reduce((s,x)=>s+x.coef*Number(x.pair.refined?.score||0),0),gap=direct-implied,directSign=Math.sign(direct),impliedSign=Math.sign(implied),signConflict=Math.abs(direct)>=12&&Math.abs(implied)>=12&&directSign!==impliedSign,materialGap=Math.abs(gap)>=35;const participants=[target,...legs.map(x=>x.pair)],weakest=[...participants].sort((a,b)=>{const qa=Math.abs(Number(a.refined?.score||0))*Number(a.final?.confidence||0),qb=Math.abs(Number(b.refined?.score||0))*Number(b.final?.confidence||0);return qa-qb;})[0];checks.push({target:def.target,equation:def.equation,direct:Math.round(direct),implied:Math.round(implied),gap:Math.round(gap),signConflict,materialGap,status:signConflict?'conflict':materialGap?'divergent':'consistent',participants:participants.map(x=>x.symbol),weakestSymbol:weakest?.symbol||null});}
  const conflicts=checks.filter(x=>x.status==='conflict'),divergent=checks.filter(x=>x.status==='divergent');
  return {checks,conflicts:conflicts.length,divergent:divergent.length,consistent:checks.filter(x=>x.status==='consistent').length,vetoSymbols:[...new Set(conflicts.map(x=>x.weakestSymbol).filter(Boolean))]};
}
function exposureFor(symbol,direction){const [base,quote]=currenciesForSymbol(symbol),sign=direction==='BUY'?1:direction==='SELL'?-1:0;if(!sign)return {};return {[base]:sign,[quote]:-sign};}
function portfolioInteraction(pairDecisions=[],triangle){
  const ranked=[...pairDecisions].sort((a,b)=>{const qa=Number(a.final?.confidence||0)*Math.abs(Number(a.refined?.score||0)),qb=Number(b.final?.confidence||0)*Math.abs(Number(b.refined?.score||0));return qb-qa;}),exposure={},pairControls={},accepted=[];
  for(const pair of ranked){const originalDirection=String(pair.final?.direction||'WAIT'),symbol=String(pair.symbol||'').toUpperCase(),control={symbol,originalDirection,portfolioDirection:originalDirection,concentrationScore:0,triangleConflict:triangle.vetoSymbols.includes(symbol),reasons:[],exposureBefore:{...exposure},exposureAfter:null};if(originalDirection==='WAIT'){control.reasons.push('Pair is already WAIT after evidence governance.');control.exposureAfter={...exposure};pairControls[symbol]=control;continue;}if(control.triangleConflict){control.portfolioDirection='WAIT';control.reasons.push('Weaker leg of a material triangular FX inconsistency.');control.exposureAfter={...exposure};pairControls[symbol]=control;continue;}const proposed=exposureFor(symbol,originalDirection),sameSide=Object.entries(proposed).map(([ccy,unit])=>({ccy,existing:Number(exposure[ccy]||0),unit})).filter(x=>x.existing*x.unit>0),maxSame=sameSide.length?Math.max(...sameSide.map(x=>Math.abs(x.existing))):0,concentration=Math.min(100,Math.round(35*maxSame+15*sameSide.length));control.concentrationScore=concentration;if(maxSame>=2){control.portfolioDirection='WAIT';control.reasons.push('Common-currency exposure would exceed the portfolio concentration limit.');}else if(maxSame>=1){control.reasons.push('Trade overlaps an existing common-currency directional exposure.');}if(control.portfolioDirection!=='WAIT'){for(const [ccy,unit] of Object.entries(proposed))exposure[ccy]=Number(exposure[ccy]||0)+unit;accepted.push(symbol);}control.exposureAfter={...exposure};pairControls[symbol]=control;}
  const gross=Object.values(exposure).reduce((s,x)=>s+Math.abs(Number(x||0)),0),largest=Object.entries(exposure).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0]||null;
  return {pairControls,accepted,exposure,grossExposureUnits:gross,largestExposure:largest?{currency:largest[0],units:largest[1]}:null,concentrationVetoes:Object.values(pairControls).filter(x=>x.originalDirection!=='WAIT'&&x.portfolioDirection==='WAIT'&&!x.triangleConflict).length,triangleVetoes:Object.values(pairControls).filter(x=>x.triangleConflict&&x.originalDirection!=='WAIT').length};
}
function decisionAudit(pairDecisions){
  const directional=pairDecisions.filter(x=>x.final.direction!=='WAIT'),wait=pairDecisions.length-directional.length,disagreements=pairDecisions.filter(x=>String(x.originalDirection)!=='WAIT'&&x.final.direction==='WAIT').length,severeContradictions=pairDecisions.filter(x=>x.contradictions.status==='severe').length;
  return {pairCount:pairDecisions.length,directionalCount:directional.length,waitCount:wait,governanceVetoes:disagreements,severeContradictions,averageGovernedConfidence:Math.round(mean(pairDecisions.map(x=>x.final.confidence))),averageEvidenceQuality:Math.round(mean(pairDecisions.map(x=>x.quality.score)))};
}

export function buildDecisionIntelligenceCore({economies=[],decision={},observations=[],events=[],news=[],marketData=null,research=null,decisionMemory=null,now=new Date()}={}){
  const nowMs=now.getTime(),baseQuality=evidenceQuality(observations),researchQuality=Number(research?.dataQuality?.overall||0),quality=researchQuality>0?{...baseQuality,score:Math.round(.72*baseQuality.score+.28*researchQuality),status:(.72*baseQuality.score+.28*researchQuality)>=80?'strong':(.72*baseQuality.score+.28*researchQuality)>=60?'usable':'weak',researchQuality}:baseQuality,opportunities=Array.isArray(decision?.rankedOpportunities)?decision.rankedOpportunities:[];
  const pairDecisions=opportunities.map(opportunity=>{
    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),crossAssetRaw=crossAssetConfirmation(opportunity.symbol,marketData),crossAssetDirection=Math.sign(Number(opportunity.score||0))||1,crossAssetAlignment=!crossAssetRaw.available?'unavailable':Math.abs(crossAssetRaw.score)<18?'neutral':Math.sign(crossAssetRaw.score)===crossAssetDirection?'aligned':'opposed',crossAsset={...crossAssetRaw,alignment:crossAssetAlignment,factor:crossAssetAlignment==='aligned'?Number(clamp(1+Math.min(.07,Math.abs(crossAssetRaw.score)/1200),1,1.07).toFixed(3)):crossAssetAlignment==='opposed'?Number(clamp(1-Math.min(.15,Math.abs(crossAssetRaw.score)/650),.85,1).toFixed(3)):1},expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),reactionFunctionGap=reactionFunctionGapForPair(opportunity,economies),causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal),counterfactual=counterfactualSensitivity(refined),temporal=temporalIntelligenceForPair(opportunity,events,news,economies,nowMs),transitionRisk=transitionRiskControls(research,opportunity.symbol),structuralBreak=structuralBreakControls(research,opportunity.symbol),evidenceIndependence=evidenceIndependenceControls(research,opportunity.symbol),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),directionalProbability=Math.max(bayesian.posterior.buy,bayesian.posterior.sell),horizonCalibration=horizonCalibrationControls(decisionMemory,opportunity.symbol,Number(opportunity.confidence||0),directionalProbability),decisionChange=decisionChangeControls(decisionMemory,opportunity.symbol,preferred,refined.score,Number(opportunity.confidence||0),nowMs),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),evidenceCompleteness=evidenceCompletenessControls({quality,causalTransmission,counterfactual,scenario,modelHealth,evidenceIndependence,temporal,marketSignal,crossAsset,historicalCalibration,transitionRisk,structuralBreak,reactionFunctionGap}),analogueState=analogueVector({refined,bayesian,quality,uncertainty,scenario,contradictions,reactionFunctionGap,crossAsset,evidenceCompleteness,temporal,transitionRisk,structuralBreak,evidenceIndependence,modelHealth,counterfactual,causalTransmission}),historicalAnalogues=historicalAnalogueControls(decisionMemory,opportunity.symbol,preferred,analogueState),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,horizonCalibration,decisionChange,historicalAnalogues,crossAsset,reactionFunctionGap,counterfactual,temporal,transitionRisk,structuralBreak,evidenceIndependence,evidenceCompleteness,uncertainty});
    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,crossAsset,contradictions,refined,reactionFunctionGap,causalTransmission,counterfactual,temporalIntelligence:temporal,transitionRisk,structuralBreak,evidenceIndependence,evidenceCompleteness,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,horizonCalibration,decisionChange,historicalAnalogues,uncertainty,premortem,thesis,final};
  });
  const graph=evidenceGraph(pairDecisions,quality),audit=decisionAudit(pairDecisions),expectationGaps=pairDecisions.map(x=>x.expectationGap),contradictionSummary={contained:pairDecisions.filter(x=>x.contradictions.status==='contained').length,material:pairDecisions.filter(x=>x.contradictions.status==='material').length,severe:pairDecisions.filter(x=>x.contradictions.status==='severe').length,total:pairDecisions.reduce((s,x)=>s+x.contradictions.count,0)},crossPairConsistency=triangleConsistency(pairDecisions),portfolio=portfolioInteraction(pairDecisions,crossPairConsistency);
  return {version:'1.4.0',generatedAt:now.toISOString(),methodology:'Primary macro decision -> tempered Bayesian update -> expectation-gap analysis -> contradiction governance -> refined pair differential -> thesis/invalidation -> conservative execution gate.',principles:['WAIT is a valid decision','correlated evidence is temperature-shrunk','missing market evidence cannot create confirmation','contradictions raise thresholds','scenario fragility reduces confidence','research risk applies an explicit haircut','forecast models lose confidence when walk-forward errors deteriorate','historical decision calibration can shrink or veto future confidence once sample size is sufficient','causal transmission is separated from correlation-only confirmation','small counterfactual shocks can veto fragile theses','release sequences, revisions, communications and catalyst age are governed as temporal evidence without double-counting them in the posterior','turning-point risk and catalyst density reduce confidence when a stable regime assumption is unsafe','structural-break warnings reduce reliance on historical relationships when recent levels, variance or slope behavior changes abruptly','triangular FX relationships must reconcile before conflicting legs can be simultaneously actionable','common-currency concentration is governed separately from single-pair conviction','cross-asset confirmation uses independent dollar, rates, equity, volatility and gold transmission rather than duplicating pair momentum','evidence completeness penalizes missing mandatory research layers instead of rewarding only the evidence that happened to be available','nearest historical analogues can influence confidence only when they use prior frozen states with realized market outcomes','uncertainty is decomposed before execution','a governance disagreement vetoes execution rather than flipping the trade','every directional thesis carries explicit invalidation conditions','every decision carries a pre-mortem failure map'],evidenceQuality:quality,pairDecisions,expectationGaps,contradictionSummary,crossPairConsistency,portfolioInteraction:portfolio,evidenceGraph:graph,audit,researchContext:{dataQualityOverall:Number(research?.dataQuality?.overall||0),riskAggregate:Number(research?.risk?.aggregate||0),newsItems:Array.isArray(news)?news.length:0,economies:Array.isArray(economies)?economies.length:0},equations:{counterfactual:'S_cf = S_refined + shock(component) × normalizedWeight × contradictionPenalty; fragility is the smallest adverse shock that destroys the edge',causalTransmission:'Growth/inflation/labour differentials -> policy reaction -> financial conditions -> verified market pricing -> pair decision',uncertainty:'U = 0.28×posteriorEntropy + 0.20×dataUncertainty + 0.18×contradictions + 0.12×marketGap + 0.12×scenarioFragility + 0.10×risk',scenarioRobustness:'SR = share of plausible scenarios retaining direction, with WAIT receiving partial credit',bayes:'posterior(state) ∝ prior(state) × Π tempered likelihood(evidence | state)',refinedScore:'S* = contradictionPenalty × weighted(primaryEdge, policy, release, consensusExpectation, verifiedMarket)',governedConfidence:'C* = min(posterior directional probability, primary confidence) × contradictionPenalty × evidenceQuality',decision:'Directional only when primary direction agrees with posterior, |S*| clears dynamic threshold, confidence ≥ 38, contradictions are not severe, and no event lockout is active.'}};
}

export function governDecisionMatrix(decision,core){
  if(!decision||!core)return decision;
  const bySymbol=new Map((core.pairDecisions||[]).map(x=>[String(x.symbol).toUpperCase(),x])),portfolio=core.portfolioInteraction||{pairControls:{}};
  const govern=(item)=>{const symbol=String(item?.symbol||'').toUpperCase(),g=bySymbol.get(symbol);if(!g)return item;const portfolioControl=portfolio.pairControls?.[symbol]||null,portfolioWait=portfolioControl&&portfolioControl.originalDirection!=='WAIT'&&portfolioControl.portfolioDirection==='WAIT',direction=portfolioWait?'WAIT':g.final.direction,executionGate=portfolioWait?(portfolioControl.triangleConflict?'CROSS_PAIR_CONSISTENCY_WAIT':'PORTFOLIO_CONCENTRATION_WAIT'):g.final.executionGate,confidence=portfolioWait?Math.min(g.final.confidence,34):g.final.confidence,reasons=[...(g.final.reason||[]),...(portfolioControl?.reasons||[])];return {...item,primaryDirection:item.direction,primaryConfidence:item.confidence,primaryScore:item.score,direction,confidence,executionGate,portfolioControl,decisionCore:{posterior:g.bayesian.posterior,refinedScore:g.refined.score,expectationGap:g.expectationGap,crossAsset:g.crossAsset,reactionFunctionGap:g.reactionFunctionGap,contradictions:g.contradictions,thesis:g.thesis,governanceReasons:reasons,dynamicThreshold:g.final.dynamicThreshold,causalTransmission:g.causalTransmission,counterfactual:g.counterfactual,temporalIntelligence:g.temporalIntelligence,transitionRisk:g.transitionRisk,structuralBreak:g.structuralBreak,evidenceIndependence:g.evidenceIndependence,evidenceCompleteness:g.evidenceCompleteness,scenarioRobustness:g.scenarioRobustness,modelHealth:g.modelHealth,historicalCalibration:g.historicalCalibration,horizonCalibration:g.horizonCalibration,decisionChange:g.decisionChange,historicalAnalogues:g.historicalAnalogues,uncertainty:g.uncertainty,premortem:g.premortem}};};
  const rankedOpportunities=(decision.rankedOpportunities||[]).map(govern).sort((a,b)=>Number(b.conviction||0)-Number(a.conviction||0));
  const sessions=(decision.sessions||[]).map(session=>({...session,signals:(session.signals||[]).map(govern)}));
  const actionable=rankedOpportunities.filter(x=>x.direction!=='WAIT'),top=actionable[0]||rankedOpportunities[0]||null;
  return {...decision,rankedOpportunities,sessions,decisionSummary:{...(decision.decisionSummary||{}),primaryActionableCount:Number(decision.decisionSummary?.actionableCount||0),actionableCount:actionable.length,waitCount:rankedOpportunities.length-actionable.length,governanceVetoes:core.audit?.governanceVetoes||0,portfolioVetoes:Number(portfolio.concentrationVetoes||0),crossPairVetoes:Number(portfolio.triangleVetoes||0),topOpportunity:top?{symbol:top.symbol,direction:top.direction,score:top.score,confidence:top.confidence,conviction:top.conviction,executionGate:top.executionGate}:null},governance:{version:core.version,audit:core.audit,contradictionSummary:core.contradictionSummary,evidenceQuality:core.evidenceQuality,crossPairConsistency:core.crossPairConsistency,portfolioInteraction:portfolio}};
}
