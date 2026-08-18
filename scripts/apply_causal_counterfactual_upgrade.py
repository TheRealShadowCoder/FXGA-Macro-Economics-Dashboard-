from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
anchor="function evidenceGraph(pairDecisions,quality){\n"
fn="""function economyStateForCurrency(economies,currency){return (economies||[]).find(e=>String(e?.currency||'').toUpperCase()===String(currency||'').toUpperCase())||null;}
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
"""
text=replace_once(text,anchor,fn+anchor,'causal and counterfactual functions')
text=replace_once(text,
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*uncertaintyPenalty);\n",
"  const scenarioFactor=Number(controls?.scenario?.factor||.88),riskPenalty=Number(controls?.risk?.riskPenalty||.82),researchQuality=Number(controls?.risk?.qualityFactor||.82),modelFactor=Number(controls?.modelHealth?.factor||.82),historyFactor=Number(controls?.historicalCalibration?.factor||1),counterfactualFactor=Number(controls?.counterfactual?.factor||1),uncertaintyPenalty=clamp(1-Number(controls?.uncertainty?.total||.5)*.35,.62,1);\n  const confidence=Math.round(100*Math.min(maxDirectional,Number(opportunity.confidence||0)/100||maxDirectional)*contradictions.penalty*Math.max(.45,quality.score/100)*scenarioFactor*riskPenalty*researchQuality*modelFactor*historyFactor*counterfactualFactor*uncertaintyPenalty);\n",
'counterfactual confidence factor')
text=replace_once(text,
"  if(controls?.historicalCalibration?.status==='degraded'&&Number(controls.historicalCalibration.samples||0)>=20){direction='WAIT';reason.push('Historical decision calibration for this pair is degraded and requires revalidation.');}\n",
"  if(controls?.historicalCalibration?.status==='degraded'&&Number(controls.historicalCalibration.samples||0)>=20){direction='WAIT';reason.push('Historical decision calibration for this pair is degraded and requires revalidation.');}\n  if(controls?.counterfactual?.fragility==='high'&&Number(controls.counterfactual.minimumAdverseShift||99)<=10){direction='WAIT';reason.push('The thesis is too sensitive to a small adverse change in a key assumption.');}\n",
'counterfactual veto')
old="""    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,uncertainty});
    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,uncertainty,premortem,thesis,final};
"""
new="""    const marketSignal=marketAssetSignal(opportunity.symbol,marketData),expectationGap=expectationGapForPair(opportunity,events,marketData,nowMs),bayesian=bayesianPosterior(opportunity,marketSignal,expectationGap,quality),contradictions=contradictionAudit(opportunity,bayesian.posterior,marketSignal,expectationGap),refined=refinedPairScore(opportunity,expectationGap,marketSignal,contradictions),causalTransmission=causalTransmissionForPair(opportunity,economies,marketSignal),counterfactual=counterfactualSensitivity(refined),catalysts=nearestCatalysts(events,opportunity.symbol,nowMs),preferred=bayesian.posterior.buy>=bayesian.posterior.sell?'BUY':'SELL',scenario=scenarioRobustness(research,opportunity.symbol,preferred),risk=researchRiskControls(research),modelHealth=modelHealthControls(research),historicalCalibration=historicalCalibrationControls(decisionMemory,opportunity.symbol),uncertainty=uncertaintyDecomposition(bayesian.posterior,contradictions,quality,expectationGap,scenario,risk),premortem=buildPremortem(opportunity,contradictions,expectationGap,scenario,risk,quality),thesis=thesisForPair(opportunity,bayesian.posterior,refined,contradictions,catalysts,quality,expectationGap),final=finalDecision(opportunity,bayesian.posterior,refined,contradictions,quality,{scenario,risk,modelHealth,historicalCalibration,counterfactual,uncertainty});
    return {symbol:opportunity.symbol,originalDirection:opportunity.direction,originalScore:Number(opportunity.score||0),quality,bayesian,expectationGap,marketSignal,contradictions,refined,causalTransmission,counterfactual,scenarioRobustness:scenario,riskControls:risk,modelHealth,historicalCalibration,uncertainty,premortem,thesis,final};
"""
text=replace_once(text,old,new,'pair causal counterfactual output')
text=text.replace("'historical decision calibration can shrink or veto future confidence once sample size is sufficient'","'historical decision calibration can shrink or veto future confidence once sample size is sufficient','causal transmission is separated from correlation-only confirmation','small counterfactual shocks can veto fragile theses'",1)
text=text.replace("equations:{uncertainty:","equations:{counterfactual:'S_cf = S_refined + shock(component) × normalizedWeight × contradictionPenalty; fragility is the smallest adverse shock that destroys the edge',causalTransmission:'Growth/inflation/labour differentials -> policy reaction -> financial conditions -> verified market pricing -> pair decision',uncertainty:",1)
path.write_text(text,encoding='utf-8')
print('Causal transmission and counterfactual sensitivity upgrade applied.')
