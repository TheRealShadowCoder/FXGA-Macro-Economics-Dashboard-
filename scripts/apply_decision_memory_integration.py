from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

# Optimize decision memory to use one bounded market-history query per evaluation pass.
path=Path('cloud-run-collector/src/decision-memory.js')
text=path.read_text(encoding='utf-8')
old="""async function closestSnapshot(targetMs,toleranceMs,symbol){
  const from=new Date(targetMs-toleranceMs).toISOString(),to=new Date(targetMs+toleranceMs).toISOString();
  const snap=await marketSnapshots.where('capturedAt','>=',from).where('capturedAt','<=',to).orderBy('capturedAt','asc').limit(20).get();
  let best=null;
  for(const doc of snap.docs){const data=doc.data(),time=Date.parse(data?.capturedAt||'');if(!Number.isFinite(time))continue;const price=derivedPrice(symbol,data?.assets||[]);if(!price||price.stale)continue;const distance=Math.abs(time-targetMs);if(!best||distance<best.distance)best={capturedAt:data.capturedAt,price:price.price,derived:price.derived,sources:price.sources,distance};}
  return best;
}
"""
new="""async function loadMarketHistory(limit=260){
  const snap=await marketSnapshots.orderBy('capturedAt','desc').limit(Math.min(400,Math.max(50,limit))).get();
  return snap.docs.map(doc=>doc.data()).filter(data=>Number.isFinite(Date.parse(data?.capturedAt||'')));
}
function closestSnapshot(history,targetMs,toleranceMs,symbol){
  let best=null;
  for(const data of history){const time=Date.parse(data?.capturedAt||'');if(!Number.isFinite(time)||Math.abs(time-targetMs)>toleranceMs)continue;const price=derivedPrice(symbol,data?.assets||[]);if(!price||price.stale)continue;const distance=Math.abs(time-targetMs);if(!best||distance<best.distance)best={capturedAt:data.capturedAt,price:price.price,derived:price.derived,sources:price.sources,distance};}
  return best;
}
"""
text=replace_once(text,old,new,'market history cache')
text=replace_once(text,
"  const pending=await memory.where('complete','==',false).limit(Math.min(150,Math.max(1,limit))).get(),now=Date.now();let evaluatedHorizons=0,completed=0,expired=0;\n",
"  const [pending,history]=await Promise.all([memory.where('complete','==',false).limit(Math.min(120,Math.max(1,limit))).get(),loadMarketHistory()]),now=Date.now();let evaluatedHorizons=0,completed=0,expired=0;\n",
'evaluation cache load')
text=replace_once(text,
"const point=await closestSnapshot(targetMs,horizon.toleranceMs,data.symbol);",
"const point=closestSnapshot(history,targetMs,horizon.toleranceMs,data.symbol);",
'cached closest snapshot')
path.write_text(text,encoding='utf-8')

# Decision governance: use historical decision calibration as a confidence control.
path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function modelHealthControls(research){\n"
fn="""function historicalCalibrationControls(decisionMemory,symbol){
  const pair=decisionMemory?.bySymbol?.[String(symbol||'').toUpperCase()]||null,global=decisionMemory?.horizons||{},sources=[];
  for(const horizon of ['h1','h4','h24']){const stats=pair?.horizons?.[horizon]||global?.[horizon];if(stats&&Number(stats.count||0)>0)sources.push({horizon,...stats});}
  const samples=sources.reduce((s,x)=>s+Number(x.count||0),0);
  if(!samples)return {status:'building',samples:0,factor:1,score:null,hitRate:null,brier:null,horizons:[]};
  const hitRate=sources.reduce((s,x)=>s+Number(x.hitRate||0)*Number(x.count||0),0)/samples,brier=sources.reduce((s,x)=>s+Number(x.brier||0)*Number(x.count||0),0)/samples;
  const hitSkill=clamp((hitRate-35)/35,0,1),brierSkill=clamp((.36-brier)/.26,0,1),score=Math.round(100*(.55*hitSkill+.45*brierSkill)),factor=clamp(.75+.25*score/100,.75,1),status=samples>=20&&(hitRate<42||brier>.32)?'degraded':samples>=8?'calibrated':'building';
  return {status,samples,factor:Number(factor.toFixed(3)),score,hitRate:Number(hitRate.toFixed(1)),brier:Number(brier.toFixed(4)),horizons:sources.map(x=>({horizon:x.horizon,count:x.count,hitRate:x.hitRate,brier:x.brier,averageSignedBps:x.averageSignedBps}))};
}
"""
text=replace_once(text,anchor,fn+anchor,'historical calibration control')
text=replace_once(text,
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*uncertaintyPenalty);\n",
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*uncertaintyPenalty);\n",
'historical confidence factor')
text=replace_once(text,
"  if(controls?.modelHealth?.status==='degraded'&&Number(controls.modelHealth.calibratedForecasts||0)>=5){direction='WAIT';reason.push('Forecast model health is degraded across validated series.');}\n",
"  if(controls?.modelHealth?.status==='degraded'&&Number(controls.modelHealth.calibratedForecasts||0)>=5){direction='WAIT';reason.push('Forecast model health is degraded across validated series.');}\n  if(controls?.historicalCalibration?.status==='degraded'&&Number(controls.historicalCalibration.samples||0)>=20){direction='WAIT';reason.push('Historical decision calibration for this pair is degraded and requires revalidation.');}\n",
'historical calibration veto')
text=replace_once(text,
"export function buildDecisionIntelligenceCore({economies=[],decision={},observations=[],events=[],news=[],marketData=null,research=null,now=new Date()}={}){\n",
"export function buildDecisionIntelligenceCore({economies=[],decision={},observations=[],events=[],news=[],marketData=null,research=null,decisionMemory=null,now=new Date()}={}){\n",
'core signature memory')
text=replace_once(text,
"    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,scenarioRobustness:scenario,riskControls:risk,modelHealth,uncertainty,premortem,thesis,final};\n",
"    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,uncertainty,premortem,thesis,final};\n",
'pair historical calibration')
text=text.replace("'forecast models lose confidence when walk-forward errors deteriorate'","'forecast models lose confidence when walk-forward errors deteriorate','historical decision calibration can shrink or veto future confidence once sample size is sufficient'",1)
path.write_text(text,encoding='utf-8')

# Feed compact memory summary through the research engine.
path=Path('cloud-run-collector/src/super-economist.js')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"export function buildSuperEconomist({observations=[],events=[],news=[],familyReliability={},marketData=null}={}){\n",
"export function buildSuperEconomist({observations=[],events=[],news=[],familyReliability={},marketData=null,decisionMemory=null}={}){\n",
'super economist memory signature')
text=replace_once(text,
"  const decisionCore=buildDecisionIntelligenceCore({economies,decision:primaryDecision,observations,events,news,marketData,research:researchPre,now:new Date()});\n",
"  const decisionCore=buildDecisionIntelligenceCore({economies,decision:primaryDecision,observations,events,news,marketData,research:researchPre,decisionMemory,now:new Date()});\n",
'pass decision memory')
text=replace_once(text,
"  const research={...researchBase,decisionCore};\n",
"  const research={...researchBase,decisionCore,decisionMemory};\n",
'research memory output')
text=replace_once(text,
"decisionIntelligence:decision,decisionGovernance:decisionCore,research,intelligenceMatrix:decision.intelligenceMatrix",
"decisionIntelligence:decision,decisionGovernance:decisionCore,decisionMemory,research,intelligenceMatrix:decision.intelligenceMatrix",
'engine memory output')
text=text.replace("'pre-mortem','thesis-invalidation'","'pre-mortem','historical-decision-calibration','thesis-invalidation'",1)
path.write_text(text,encoding='utf-8')

# Persist/evaluate memory around each intelligence refresh.
path=Path('cloud-run-collector/src/super-runtime.js')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"import { FRED_BASE_IDS } from './global-fred.js';\n",
"import { FRED_BASE_IDS } from './global-fred.js';\nimport { evaluateDecisionMemory, readDecisionMemorySummary, recordDecisionMemory } from './decision-memory.js';\n",
'runtime memory import')
old="""export async function refreshSuperEconomist({forceNews=false}={}){
  const [calendar,macro,universe,market]=await Promise.all([get('calendar'),get('macro'),get('fred-universe'),get('market')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],marketData=market?.payload?.assets||[],news=await ensureNews(forceNews),skills=await reliability();
  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData});const frozen=await freeze(engine,events);
  let payload={...engine,news:news.items||[],newsSourceHealth:news.sourceHealth||{},fredCatalog:buildFredCatalog(universe?.payload),globalMacro:group(observations,macro?.payload?.generatedAt),audit:{frozenThisRun:frozen,scoredThisRun:scored}};payload={...payload,operationalHealth:operationalHealth({calendar,macro,news,intelligence:payload})};
  const changed=await putChanged('intelligence',payload),webhook=changed?await safeWebhook('intelligence-snapshot',payload):{sent:false,reason:'unchanged'};return {changed,webhook,registry:payload.registry,coverage:payload.coverage,audit:payload.audit,operationalHealth:payload.operationalHealth,economies:payload.economyAnalysis.economies.length,observations:observations.length};
}
"""
new="""export async function refreshSuperEconomist({forceNews=false}={}){
  const [calendar,macro,universe,market]=await Promise.all([get('calendar'),get('macro'),get('fred-universe'),get('market')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],marketData=market?.payload?.assets||[],news=await ensureNews(forceNews),skills=await reliability();
  let memorySummary=null,memoryEvaluation={evaluatedHorizons:0,completed:0,expired:0};
  try{const evaluated=await evaluateDecisionMemory({limit:60});memorySummary=evaluated.summary;memoryEvaluation={evaluatedHorizons:evaluated.evaluatedHorizons,completed:evaluated.completed,expired:evaluated.expired};}catch(error){console.warn('Decision memory evaluation deferred:',String(error?.message||error).slice(0,220));memorySummary=await readDecisionMemorySummary().catch(()=>null);}
  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary});const frozen=await freeze(engine,events);
  let memoryRecord={recorded:0,skipped:0,total:0};try{memoryRecord=await recordDecisionMemory(engine,marketData);}catch(error){console.warn('Decision memory recording deferred:',String(error?.message||error).slice(0,220));}
  let payload={...engine,news:news.items||[],newsSourceHealth:news.sourceHealth||{},fredCatalog:buildFredCatalog(universe?.payload),globalMacro:group(observations,macro?.payload?.generatedAt),audit:{frozenThisRun:frozen,scoredThisRun:scored,decisionMemory:{...memoryEvaluation,...memoryRecord}}};payload={...payload,operationalHealth:operationalHealth({calendar,macro,news,intelligence:payload})};
  const changed=await putChanged('intelligence',payload),webhook=changed?await safeWebhook('intelligence-snapshot',payload):{sent:false,reason:'unchanged'};return {changed,webhook,registry:payload.registry,coverage:payload.coverage,audit:payload.audit,operationalHealth:payload.operationalHealth,economies:payload.economyAnalysis.economies.length,observations:observations.length};
}
"""
text=replace_once(text,old,new,'runtime refresh memory loop')
path.write_text(text,encoding='utf-8')

# Include module in syntax gate.
path=Path('cloud-run-collector/package.json')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"node --check src/decision-intelligence-core.js && node --check src/super-economist.js",
"node --check src/decision-intelligence-core.js && node --check src/decision-memory.js && node --check src/super-economist.js",
'package memory check')
path.write_text(text,encoding='utf-8')
print('Decision memory integration applied.')
