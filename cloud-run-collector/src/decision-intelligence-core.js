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
  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);
  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*counterfactualFactor*uncertaintyPenalty);
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
  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}
  if(Number(controls?.uncertainty?.total||0)>=.68){direction='WAIT';reason.push('Combined model and evidence uncertainty is too high.');}
  if(String(opportunity.risk||'')==='event-lockout'){direction='WAIT';reason.push('High-impact event lockout is active.');}
  return {direction,confidence,dynamicThreshold,reason:reason.length?reason:['Primary and governance layers agree; decision remains eligible for technical confirmation.'],executionGate:direction==='WAIT'?'NO_DIRECTIONAL_EXECUTION':'AWAIT_TECHNICAL_CONFIRMATION'};
}
function economyStateForCurrency(economies,currency){return (economies||[]).find(e=>String(e?.currency||'').toUpperCase()===String(currency||'').toUpperCase())||null;}
function dimensionScore(state,id){const d=(state?.dimensions||[]).find(x=>x.id===id);return Number(d?.score||0);}
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
function evidenceGraph(pairDecisions,quality){
  const nodes=[{id:'quality',type:'quality',label:'Evidence Quality',score:quality.score,status:quality.status}],edges=[];
  for(const pair of pairDecisions){
    const pairId=`pair:${pair.symbol}`;nodes.push({id:pairId,type:'decision',label:pair.symbol,score:pair.refined.score,status:pair.final.direction});edges.push({from:'quality',to:pairId,relation:'conditions',weight:quality.score/100});
    for(const [key,value] of Object.entries(pair.refined.components)){const id=`${pair.symbol}:${key}`;nodes.push({id,type:'evidence',label:key,score:value.value});edges.push({from:id,to:pairId,relation:Math.sign(value.value)===Math.sign(pair.refined.score)?'supports':'opposes',weight:value.weight});}
  }
  return {nodes:nodes.slice(0,80),edges:edges.slice(0,120),nodeCount:nodes.length,edgeCount:edges.length};
}
function decisionAudit(pairDecisions){
  const directional=pairDecisions.filter(x=>x.final.direction!=='WAIT'),wait=pairDecisions.length-directional.length,disagreements=pairDecisions.filter(x=>String(x.originalDirection)!=='WAIT'&&x.final.direction==='WAIT').length,severeContradictions=pairDecisions.filter(x=>x.contradictions.status==='severe').length;
  return {pairCount:pairDecisions.length,directionalCount:directional.length,waitCount:wait,governanceVetoes:disagreements,severeContradictions,averageGovernedConfidence:Math.round(mean(pairDecisions.map(x=>x.final.confidence))),averageEvidenceQuality:Math.round(mean(pairDecisions.map(x=>x.quality.score)))};
}

export function buildDecisionIntelligenceCore({economies=[],decision={},observations=[],events=[],news=[],marketData=null,research=null,decisionMemory=null,now=new Date()}={}){
  const nowMs=now.getTime(),baseQuality=evidenceQuality(observations),researchQuality=Number(research?.dataQuality?.overall||0),quality=researchQuality>0?{...baseQuality,score:Math.round(.72*baseQuality.score+.28*researchQuality),status:(.72*baseQuality.score+.28*researchQuality)>=80?'strong':(.72*baseQuality.score+.28*researchQuality)>=60?'usable':'weak',researchQuality}:baseQuality,opportunities=Array.isArray(decision?.rankedOpportunities)?decision.rankedOpportunities:[];
  const pairDecisions=opportunities.map(opportunity=>{
    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal),counterfactual=counterfactualSensitivity(refined),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,counterfactual,uncertainty});
    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,causalTransmission,counterfactual,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,uncertainty,premortem,thesis,final};
  });
  const graph=evidenceGraph(pairDecisions,quality),audit=decisionAudit(pairDecisions),expectationGaps=pairDecisions.map(x=>x.expectationGap),contradictionSummary={contained:pairDecisions.filter(x=>x.contradictions.status==='contained').length,material:pairDecisions.filter(x=>x.contradictions.status==='material').length,severe:pairDecisions.filter(x=>x.contradictions.status==='severe').length,total:pairDecisions.reduce((s,x)=>s+x.contradictions.count,0)};
  return {version:'1.0.0',generatedAt:now.toISOString(),methodology:'Primary macro decision -> tempered Bayesian update -> expectation-gap analysis -> contradiction governance -> refined pair differential -> thesis/invalidation -> conservative execution gate.',principles:['WAIT is a valid decision','correlated evidence is temperature-shrunk','missing market evidence cannot create confirmation','contradictions raise thresholds','scenario fragility reduces confidence','research risk applies an explicit haircut','forecast models lose confidence when walk-forward errors deteriorate','historical decision calibration can shrink or veto future confidence once sample size is sufficient','causal transmission is separated from correlation-only confirmation','small counterfactual shocks can veto fragile theses','uncertainty is decomposed before execution','a governance disagreement vetoes execution rather than flipping the trade','every directional thesis carries explicit invalidation conditions','every decision carries a pre-mortem failure map'],evidenceQuality:quality,pairDecisions,expectationGaps,contradictionSummary,evidenceGraph:graph,audit,researchContext:{dataQualityOverall:Number(research?.dataQuality?.overall||0),riskAggregate:Number(research?.risk?.aggregate||0),newsItems:Array.isArray(news)?news.length:0,economies:Array.isArray(economies)?economies.length:0},equations:{counterfactual:'S_cf = S_refined + shock(component) × normalizedWeight × contradictionPenalty; fragility is the smallest adverse shock that destroys the edge',causalTransmission:'Growth/inflation/labour differentials -> policy reaction -> financial conditions -> verified market pricing -> pair decision',uncertainty:'U = 0.28×posteriorEntropy + 0.20×dataUncertainty + 0.18×contradictions + 0.12×marketGap + 0.12×scenarioFragility + 0.10×risk',scenarioRobustness:'SR = share of plausible scenarios retaining direction, with WAIT receiving partial credit',bayes:'posterior(state) ∝ prior(state) × Π tempered likelihood(evidence | state)',refinedScore:'S* = contradictionPenalty × weighted(primaryEdge, policy, release, consensusExpectation, verifiedMarket)',governedConfidence:'C* = min(posterior directional probability, primary confidence) × contradictionPenalty × evidenceQuality',decision:'Directional only when primary direction agrees with posterior, |S*| clears dynamic threshold, confidence ≥ 38, contradictions are not severe, and no event lockout is active.'}};
}

export function governDecisionMatrix(decision,core){
  if(!decision||!core)return decision;
  const bySymbol=new Map((core.pairDecisions||[]).map(x=>[String(x.symbol).toUpperCase(),x]));
  const govern=(item)=>{const g=bySymbol.get(String(item?.symbol||'').toUpperCase());if(!g)return item;return {...item,primaryDirection:item.direction,primaryConfidence:item.confidence,primaryScore:item.score,direction:g.final.direction,confidence:g.final.confidence,executionGate:g.final.executionGate,decisionCore:{posterior:g.bayesian.posterior,refinedScore:g.refined.score,expectationGap:g.expectationGap,contradictions:g.contradictions,thesis:g.thesis,governanceReasons:g.final.reason,dynamicThreshold:g.final.dynamicThreshold}};};
  const rankedOpportunities=(decision.rankedOpportunities||[]).map(govern).sort((a,b)=>Number(b.conviction||0)-Number(a.conviction||0));
  const sessions=(decision.sessions||[]).map(session=>({...session,signals:(session.signals||[]).map(govern)}));
  const actionable=rankedOpportunities.filter(x=>x.direction!=='WAIT'),top=actionable[0]||rankedOpportunities[0]||null;
  return {...decision,rankedOpportunities,sessions,decisionSummary:{...(decision.decisionSummary||{}),primaryActionableCount:Number(decision.decisionSummary?.actionableCount||0),actionableCount:actionable.length,waitCount:rankedOpportunities.length-actionable.length,governanceVetoes:core.audit?.governanceVetoes||0,topOpportunity:top?{symbol:top.symbol,direction:top.direction,score:top.score,confidence:top.confidence,conviction:top.conviction,executionGate:top.executionGate}:null},governance:{version:core.version,audit:core.audit,contradictionSummary:core.contradictionSummary,evidenceQuality:core.evidenceQuality}};
}
