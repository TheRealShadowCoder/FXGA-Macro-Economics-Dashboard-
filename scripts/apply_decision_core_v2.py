from pathlib import Path


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function finalDecision(opportunity,posterior,refined,contradictions,quality){\n"
insert="""function scenarioRobustness(research,symbol,preferredDirection){
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
"""
text=replace_once(text,anchor,insert+anchor,'insert governance functions')
text=replace_once(text,
"function finalDecision(opportunity,posterior,refined,contradictions,quality){\n  const maxDirectional=Math.max(posterior.buy,posterior.sell),posteriorDirection=posterior.buy>=posterior.sell?'BUY':'SELL',original=String(opportunity.direction||'WAIT').toUpperCase();\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100));\n  const dynamicThreshold=Math.round(18+12*(1-confidence/100)+3*Math.min(4,contradictions.weightedSeverity));\n",
"function finalDecision(opportunity,posterior,refined,contradictions,quality,controls){\n  const maxDirectional=Math.max(posterior.buy,posterior.sell),posteriorDirection=posterior.buy>=posterior.sell?'BUY':'SELL',original=String(opportunity.direction||'WAIT').toUpperCase();\n  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*uncertaintyPenalty);\n  const dynamicThreshold=Math.round(18+12*(1-confidence/100)+3*Math.min(4,contradictions.weightedSeverity)+6*Number(controls?.uncertainty?.total||0));\n",
'final decision confidence')
text=replace_once(text,
"  if(contradictions.status==='severe'){direction='WAIT';reason.push('Contradiction severity is too high for directional execution.');}\n  if(String(opportunity.risk||'')==='event-lockout'){direction='WAIT';reason.push('High-impact event lockout is active.');}\n",
"  if(contradictions.status==='severe'){direction='WAIT';reason.push('Contradiction severity is too high for directional execution.');}\n  if(controls?.scenario?.available&&controls.scenario.status==='fragile'){direction='WAIT';reason.push('Directional thesis is fragile across plausible macro scenarios.');}\n  if(Number(controls?.risk?.aggregate||0)>=78){direction='WAIT';reason.push('Research risk state is too elevated for directional execution.');}\n  if(Number(controls?.uncertainty?.total||0)>=.68){direction='WAIT';reason.push('Combined model and evidence uncertainty is too high.');}\n  if(String(opportunity.risk||'')==='event-lockout'){direction='WAIT';reason.push('High-impact event lockout is active.');}\n",
'final decision vetoes')
text=replace_once(text,
"  const nowMs=now.getTime(),quality=evidenceQuality(observations),opportunities=Array.isArray(decision?.rankedOpportunities)?decision.rankedOpportunities:[];\n",
"  const nowMs=now.getTime(),baseQuality=evidenceQuality(observations),researchQuality=Number(research?.dataQuality?.overall||0),quality=researchQuality>0?{...baseQuality,score:Math.round(.72*baseQuality.score+.28*researchQuality),status:(.72*baseQuality.score+.28*researchQuality)>=80?'strong':(.72*baseQuality.score+.28*researchQuality)>=60?'usable':'weak',researchQuality}:baseQuality,opportunities=Array.isArray(decision?.rankedOpportunities)?decision.rankedOpportunities:[];\n",
'effective quality')
text=replace_once(text,
"    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality);\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,thesis,final};\n",
"    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,uncertainty});\n    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,scenarioRobustness:scenario,riskControls:risk,uncertainty,premortem,thesis,final};\n",
'pair governance context')
text=replace_once(text,
"principles:['WAIT is a valid decision','correlated evidence is temperature-shrunk','missing market evidence cannot create confirmation','contradictions raise thresholds','a governance disagreement vetoes execution rather than flipping the trade','every directional thesis carries explicit invalidation conditions']",
"principles:['WAIT is a valid decision','correlated evidence is temperature-shrunk','missing market evidence cannot create confirmation','contradictions raise thresholds','scenario fragility reduces confidence','research risk applies an explicit haircut','uncertainty is decomposed before execution','a governance disagreement vetoes execution rather than flipping the trade','every directional thesis carries explicit invalidation conditions','every decision carries a pre-mortem failure map']",
'principles expansion')
text=text.replace("equations:{bayes:","equations:{uncertainty:'U = 0.28×posteriorEntropy + 0.20×dataUncertainty + 0.18×contradictions + 0.12×marketGap + 0.12×scenarioFragility + 0.10×risk',scenarioRobustness:'SR = share of plausible scenarios retaining direction, with WAIT receiving partial credit',bayes:",1)
path.write_text(text,encoding='utf-8')

# Reorder super-economist so the governance layer can consume institutional risk/scenario research.
path=Path('cloud-run-collector/src/super-economist.js')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"  const eventForecasts=events.filter(e=>Date.parse(e.date)>=Date.now()-6*3600000).slice(0,180).map(e=>eventForecast(e,economies.find(x=>x.id===eventEconomy(e))));\n  const decisionCore=buildDecisionIntelligenceCore({economies,decision:primaryDecision,observations,events,news,marketData,now:new Date()});\n  const decision=governDecisionMatrix(primaryDecision,decisionCore);\n  const special=specialEventModels(economies,decision),impact=releaseImpact(macroAnalysis,events),registry=registrySummary(context),activeFamilyCodes=new Set(economies.flatMap(e=>e.familyScores.filter(f=>f.independentWeight>0).map(f=>f.code))),topFamilies=economies.map(e=>({economy:e.id,families:e.familyScores.filter(f=>f.independentWeight>0).slice(0,30).map(compactFamily)}));\n  const researchBase=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:decision?.currencyStates||[],opportunities:decision?.rankedOpportunities||[]});\n  const research={...researchBase,decisionCore};\n",
"  const eventForecasts=events.filter(e=>Date.parse(e.date)>=Date.now()-6*3600000).slice(0,180).map(e=>eventForecast(e,economies.find(x=>x.id===eventEconomy(e))));\n  const researchPre=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:primaryDecision?.currencyStates||[],opportunities:primaryDecision?.rankedOpportunities||[]});\n  const decisionCore=buildDecisionIntelligenceCore({economies,decision:primaryDecision,observations,events,news,marketData,research:researchPre,now:new Date()});\n  const decision=governDecisionMatrix(primaryDecision,decisionCore);\n  const special=specialEventModels(economies,decision),impact=releaseImpact(macroAnalysis,events),registry=registrySummary(context),activeFamilyCodes=new Set(economies.flatMap(e=>e.familyScores.filter(f=>f.independentWeight>0).map(f=>f.code))),topFamilies=economies.map(e=>({economy:e.id,families:e.familyScores.filter(f=>f.independentWeight>0).slice(0,30).map(compactFamily)}));\n  const researchBase=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:decision?.currencyStates||[],opportunities:decision?.rankedOpportunities||[]});\n  const research={...researchBase,decisionCore};\n",
'research pre-governance order')
text=text.replace("'pair-differential-refinement','thesis-invalidation'","'pair-differential-refinement','scenario-robustness','risk-haircut','uncertainty-decomposition','pre-mortem','thesis-invalidation'",1)
path.write_text(text,encoding='utf-8')
print('Decision core v2 governance patch applied.')
