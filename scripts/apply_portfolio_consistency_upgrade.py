from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')

anchor="function decisionAudit(pairDecisions){\n"
fn="""function triangleConsistency(pairDecisions=[]){
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
"""
text=replace_once(text,anchor,fn+anchor,'portfolio consistency functions')

# Add consistency to core output.
text=replace_once(text,
"  const graph=evidenceGraph(pairDecisions,quality),audit=decisionAudit(pairDecisions),expectationGaps=pairDecisions.map(x=>x.expectationGap),contradictionSummary={contained:pairDecisions.filter(x=>x.contradictions.status==='contained').length,material:pairDecisions.filter(x=>x.contradictions.status==='material').length,severe:pairDecisions.filter(x=>x.contradictions.status==='severe').length,total:pairDecisions.reduce((s,x)=>s+x.contradictions.count,0)};\n",
"  const graph=evidenceGraph(pairDecisions,quality),audit=decisionAudit(pairDecisions),expectationGaps=pairDecisions.map(x=>x.expectationGap),contradictionSummary={contained:pairDecisions.filter(x=>x.contradictions.status==='contained').length,material:pairDecisions.filter(x=>x.contradictions.status==='material').length,severe:pairDecisions.filter(x=>x.contradictions.status==='severe').length,total:pairDecisions.reduce((s,x)=>s+x.contradictions.count,0)},crossPairConsistency=triangleConsistency(pairDecisions),portfolio=portfolioInteraction(pairDecisions,crossPairConsistency);\n",
'core portfolio build')
text=replace_once(text,
"evidenceQuality:quality,pairDecisions,expectationGaps,contradictionSummary,evidenceGraph:graph,audit,researchContext",
"evidenceQuality:quality,pairDecisions,expectationGaps,contradictionSummary,crossPairConsistency,portfolioInteraction:portfolio,evidenceGraph:graph,audit,researchContext",
'core portfolio output')
text=text.replace("'turning-point risk and catalyst density reduce confidence when a stable regime assumption is unsafe'","'turning-point risk and catalyst density reduce confidence when a stable regime assumption is unsafe','triangular FX relationships must reconcile before conflicting legs can be simultaneously actionable','common-currency concentration is governed separately from single-pair conviction'",1)

# Replace final matrix governance to enforce cross-pair consistency/concentration after single-pair governance.
old="""export function governDecisionMatrix(decision,core){
  if(!decision||!core)return decision;
  const bySymbol=new Map((core.pairDecisions||[]).map(x=>[String(x.symbol).toUpperCase(),x]));
  const govern=(item)=>{const g=bySymbol.get(String(item?.symbol||'').toUpperCase());if(!g)return item;return {...item,primaryDirection:item.direction,primaryConfidence:item.confidence,primaryScore:item.score,direction:g.final.direction,confidence:g.final.confidence,executionGate:g.final.executionGate,decisionCore:{posterior:g.bayesian.posterior,refinedScore:g.refined.score,expectationGap:g.expectationGap,contradictions:g.contradictions,thesis:g.thesis,governanceReasons:g.final.reason,dynamicThreshold:g.final.dynamicThreshold}};};
  const rankedOpportunities=(decision.rankedOpportunities||[]).map(govern).sort((a,b)=>Number(b.conviction||0)-Number(a.conviction||0));
  const sessions=(decision.sessions||[]).map(session=>({...session,signals:(session.signals||[]).map(govern)}));
  const actionable=rankedOpportunities.filter(x=>x.direction!=='WAIT'),top=actionable[0]||rankedOpportunities[0]||null;
  return {...decision,rankedOpportunities,sessions,decisionSummary:{...(decision.decisionSummary||{}),primaryActionableCount:Number(decision.decisionSummary?.actionableCount||0),actionableCount:actionable.length,waitCount:rankedOpportunities.length-actionable.length,governanceVetoes:core.audit?.governanceVetoes||0,topOpportunity:top?{symbol:top.symbol,direction:top.direction,score:top.score,confidence:top.confidence,conviction:top.conviction,executionGate:top.executionGate}:null},governance:{version:core.version,audit:core.audit,contradictionSummary:core.contradictionSummary,evidenceQuality:core.evidenceQuality}};
}
"""
new="""export function governDecisionMatrix(decision,core){
  if(!decision||!core)return decision;
  const bySymbol=new Map((core.pairDecisions||[]).map(x=>[String(x.symbol).toUpperCase(),x])),portfolio=core.portfolioInteraction||{pairControls:{}};
  const govern=(item)=>{const symbol=String(item?.symbol||'').toUpperCase(),g=bySymbol.get(symbol);if(!g)return item;const portfolioControl=portfolio.pairControls?.[symbol]||null,portfolioWait=portfolioControl&&portfolioControl.originalDirection!=='WAIT'&&portfolioControl.portfolioDirection==='WAIT',direction=portfolioWait?'WAIT':g.final.direction,executionGate=portfolioWait?(portfolioControl.triangleConflict?'CROSS_PAIR_CONSISTENCY_WAIT':'PORTFOLIO_CONCENTRATION_WAIT'):g.final.executionGate,confidence=portfolioWait?Math.min(g.final.confidence,34):g.final.confidence,reasons=[...(g.final.reason||[]),...(portfolioControl?.reasons||[])];return {...item,primaryDirection:item.direction,primaryConfidence:item.confidence,primaryScore:item.score,direction,confidence,executionGate,portfolioControl,decisionCore:{posterior:g.bayesian.posterior,refinedScore:g.refined.score,expectationGap:g.expectationGap,contradictions:g.contradictions,thesis:g.thesis,governanceReasons:reasons,dynamicThreshold:g.final.dynamicThreshold,causalTransmission:g.causalTransmission,counterfactual:g.counterfactual,temporalIntelligence:g.temporalIntelligence,transitionRisk:g.transitionRisk,historicalCalibration:g.historicalCalibration}};};
  const rankedOpportunities=(decision.rankedOpportunities||[]).map(govern).sort((a,b)=>Number(b.conviction||0)-Number(a.conviction||0));
  const sessions=(decision.sessions||[]).map(session=>({...session,signals:(session.signals||[]).map(govern)}));
  const actionable=rankedOpportunities.filter(x=>x.direction!=='WAIT'),top=actionable[0]||rankedOpportunities[0]||null;
  return {...decision,rankedOpportunities,sessions,decisionSummary:{...(decision.decisionSummary||{}),primaryActionableCount:Number(decision.decisionSummary?.actionableCount||0),actionableCount:actionable.length,waitCount:rankedOpportunities.length-actionable.length,governanceVetoes:core.audit?.governanceVetoes||0,portfolioVetoes:Number(portfolio.concentrationVetoes||0),crossPairVetoes:Number(portfolio.triangleVetoes||0),topOpportunity:top?{symbol:top.symbol,direction:top.direction,score:top.score,confidence:top.confidence,conviction:top.conviction,executionGate:top.executionGate}:null},governance:{version:core.version,audit:core.audit,contradictionSummary:core.contradictionSummary,evidenceQuality:core.evidenceQuality,crossPairConsistency:core.crossPairConsistency,portfolioInteraction:portfolio}};
}
"""
text=replace_once(text,old,new,'portfolio matrix governance')
path.write_text(text,encoding='utf-8')
print('Cross-pair consistency and portfolio interaction upgrade applied.')
