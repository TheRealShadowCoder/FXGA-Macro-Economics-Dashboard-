import fs from 'node:fs';

const serviceUrl=String(process.env.SERVICE_URL||'').replace(/\/$/,'');
const token=String(process.env.TOKEN||'');
const publicBase=String(process.env.PUBLIC_BASE||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const requiredPrivate=['bayesian','refined','reactionFunctionGap','crossAsset','causalTransmission','counterfactual','temporalIntelligence','transitionRisk','structuralBreak','evidenceIndependence','evidenceCompleteness','scenarioRobustness','riskControls','modelHealth','historicalCalibration','horizonCalibration','decisionChange','historicalAnalogues','uncertainty','premortem','thesis','final'];
const requiredPublic=['reactionFunctionGap','crossAsset','evidenceCompleteness','horizonCalibration','decisionChange','historicalAnalogues','structuralBreak','causalTransmission','counterfactual','temporalIntelligence','transitionRisk','evidenceIndependence'];

if(!serviceUrl||!token)throw new Error('SERVICE_URL and TOKEN are required');

async function privateCall(path,method='GET',body){
  const response=await fetch(serviceUrl+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  if(!response.ok)throw new Error(`${path} HTTP ${response.status}: ${text.slice(0,800)}`);
  return JSON.parse(text);
}
function inspectPrivate(state,health){
  const intel=state?.intelligence?.payload,research=intel?.research,core=intel?.decisionGovernance,pairs=core?.pairDecisions||[],missing=[];
  if(!intel)missing.push('intelligence');if(!research)missing.push('research');if(!core)missing.push('decisionGovernance');if(pairs.length<8)missing.push(`pair-count:${pairs.length}`);
  for(const pair of pairs)for(const field of requiredPrivate)if(pair?.[field]===undefined)missing.push(`${pair?.symbol||'pair'}:${field}`);
  if(!core?.crossPairConsistency?.checks?.length)missing.push('crossPairConsistency');if(!core?.portfolioInteraction?.pairControls)missing.push('portfolioInteraction');
  if(!research?.structuralBreaks?.series)missing.push('structuralBreaks');if(!research?.turningPoints?.rows)missing.push('turningPoints');if(!research?.evidenceIndependence)missing.push('evidenceIndependence');if(!research?.catalystSequence?.currencies)missing.push('catalystSequence');if(!Array.isArray(research?.releaseAnalytics?.persistence))missing.push('surprisePersistence');
  const calibrated=(research?.forecasts||[]).filter(x=>x?.modelWeights&&Number(x?.validationPoints||0)>0),distributed=calibrated.filter(x=>x?.distribution&&Number(x.distribution.residualCount||0)>0);
  if(!calibrated.length)missing.push('calibratedForecasts');if(!distributed.length)missing.push('distributedForecasts');
  if(!intel?.decisionMemory?.decisionChanges)missing.push('decisionChanges');if(!intel?.decisionMemory?.analogueLibrary)missing.push('analogueLibrary');
  return {ok:missing.length===0,missing,intel,research,core,pairs,calibrated,distributed,health};
}
async function verifyPrivate(){
  let last;
  for(let attempt=1;attempt<=36;attempt++){
    try{
      const health=await privateCall('/health');if(!health?.ok)throw new Error('Cloud Run health is not ok');
      await privateCall('/market-sync','POST',{}).catch(()=>null);
      const refresh=await privateCall('/refresh-intelligence','POST',{forceNews:false});
      if(refresh?.webhook?.sent===false)console.log(`refresh webhook deferred: ${refresh.webhook.error||refresh.webhook.reason||'unknown'}`);
      const state=await privateCall('/state'),check=inspectPrivate(state,health);
      console.log(`private attempt ${attempt}: version=${health.version} pairs=${check.pairs.length} missing=${check.missing.length}`);
      if(check.ok){const {research,core,pairs,calibrated,distributed,intel}=check;return {verifiedAt:new Date().toISOString(),serviceUrl,reportedHealthVersion:String(health.version??'unknown'),contract:'v4.14-fields',pairs:pairs.length,evidenceQuality:core.evidenceQuality?.score??null,actionable:intel.sessionSignals?.decisionSummary?.actionableCount??null,wait:intel.sessionSignals?.decisionSummary?.waitCount??null,modelHealth:research.modelHealth?.status??null,modelHealthScore:research.modelHealth?.score??null,sourceReliability:research.sourceReliability?.length||0,calibratedForecasts:calibrated.length,distributedForecasts:distributed.length,structuralBreakSeries:research.structuralBreaks.series.length,breakSeries:research.structuralBreaks.breakSeries||0,turningFamilies:research.turningPoints.rows.length,evidenceIndependence:research.evidenceIndependence.independenceRatio,catalystCurrencies:research.catalystSequence.currencies.length,triangleChecks:core.crossPairConsistency.checks.length,triangleConflicts:core.crossPairConsistency.conflicts||0,portfolioVetoes:Number(core.portfolioInteraction.concentrationVetoes||0)+Number(core.portfolioInteraction.triangleVetoes||0),decisionMemorySamples:intel.decisionMemory.sampledDecisions||0,analogueSymbols:Object.keys(intel.decisionMemory.analogueLibrary||{}).length,webhookSent:refresh?.webhook?.sent!==false};}
      last=new Error(`Private contract missing: ${check.missing.slice(0,24).join(', ')}`);
    }catch(error){last=error;console.log(`private attempt ${attempt}: ${error.message}`);}
    await sleep(5000);
  }
  throw last||new Error('Private v4.14 contract did not become ready');
}
async function verifyPublic(report){
  let last;
  for(let attempt=1;attempt<=48;attempt++){
    try{
      const response=await fetch(publicBase+'/api/research',{headers:{Accept:'application/json','Cache-Control':'no-cache'}}),text=await response.text();if(!response.ok)throw new Error(`/api/research HTTP ${response.status}: ${text.slice(0,600)}`);
      const research=JSON.parse(text),core=research?.decisionCore,pairs=core?.pairDecisions||[],missing=[];
      if(pairs.length<8)missing.push(`pair-count:${pairs.length}`);for(const pair of pairs)for(const field of requiredPublic)if(pair?.[field]===undefined)missing.push(`${pair?.symbol||'pair'}:${field}`);
      if(!research?.structuralBreaks)missing.push('structuralBreaks');if(!research?.evidenceIndependence)missing.push('evidenceIndependence');if(!research?.turningPoints)missing.push('turningPoints');if(!research?.catalystSequence)missing.push('catalystSequence');if(!research?.decisionMemory?.decisionChanges)missing.push('decisionChanges');if(!research?.decisionMemory?.analogueLibrary)missing.push('analogueLibrary');if(!core?.crossPairConsistency)missing.push('crossPairConsistency');if(!core?.portfolioInteraction)missing.push('portfolioInteraction');
      console.log(`public attempt ${attempt}: pairs=${pairs.length} missing=${missing.length}`);
      if(!missing.length)return {...report,publicContract:{passed:true,pairs:pairs.length,decisionMemorySamples:research.decisionMemory.sampledDecisions||0,analogueSymbols:Object.keys(research.decisionMemory.analogueLibrary||{}).length}};
      last=new Error(`Public contract missing: ${missing.slice(0,24).join(', ')}`);
    }catch(error){last=error;console.log(`public attempt ${attempt}: ${error.message}`);}
    await sleep(5000);
  }
  throw last||new Error('Public v4.14 contract did not become ready');
}
function writeMarker(report){
  const lines=[`verified_at=${report.verifiedAt}`,'contract=v4.14-live',`reported_health_version=${report.reportedHealthVersion}`,`contract_proof=${report.contract}`,`pairs=${report.pairs}`,`actionable=${report.actionable}`,`wait=${report.wait}`,`evidence_quality=${report.evidenceQuality}`,`model_health=${report.modelHealth}`,`model_health_score=${report.modelHealthScore}`,`source_reliability=${report.sourceReliability}`,`calibrated_forecasts=${report.calibratedForecasts}`,`distributed_forecasts=${report.distributedForecasts}`,`structural_break_series=${report.structuralBreakSeries}`,`break_series=${report.breakSeries}`,`turning_families=${report.turningFamilies}`,`evidence_independence=${report.evidenceIndependence}`,`catalyst_currencies=${report.catalystCurrencies}`,`triangle_checks=${report.triangleChecks}`,`triangle_conflicts=${report.triangleConflicts}`,`portfolio_vetoes=${report.portfolioVetoes}`,`decision_memory_samples=${report.publicContract?.decisionMemorySamples??report.decisionMemorySamples}`,`analogue_symbols=${report.publicContract?.analogueSymbols??report.analogueSymbols}`,`webhook_sent=${report.webhookSent}`,'public_contract=passed'];
  fs.writeFileSync('.github/intelligence-v414-live.status',lines.join('\n')+'\n');
  fs.writeFileSync('/tmp/v414-direct.json',JSON.stringify(report,null,2));
}

const privateReport=await verifyPrivate();
const fullReport=await verifyPublic(privateReport);
writeMarker(fullReport);
console.log(JSON.stringify(fullReport,null,2));
