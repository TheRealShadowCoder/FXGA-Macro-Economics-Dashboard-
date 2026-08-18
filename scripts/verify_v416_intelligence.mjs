import fs from 'node:fs';

const serviceUrl=String(process.env.SERVICE_URL||'').replace(/\/$/,'');
const token=String(process.env.TOKEN||'');
const publicBase=String(process.env.PUBLIC_BASE||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!serviceUrl||!token)throw new Error('SERVICE_URL and TOKEN are required');

async function privateCall(path,method='GET',body){
  const response=await fetch(serviceUrl+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  if(!response.ok)throw new Error(`${path} HTTP ${response.status}: ${text.slice(0,900)}`);
  return JSON.parse(text);
}
async function publicCall(path){
  const response=await fetch(publicBase+path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}}),text=await response.text();
  if(!response.ok)throw new Error(`${path} HTTP ${response.status}: ${text.slice(0,900)}`);
  return JSON.parse(text);
}
function versionAtLeast(actual,required){const a=String(actual||'0').split('.').map(Number),b=String(required).split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}return true;}
function validatePolicy(policy){
  const missing=[];
  if(!policy)missing.push('policyPathResearch');
  else {
    if(policy.type!=='model-implied-policy-path')missing.push('policy.type');
    if(policy.marketPricingAvailable!==false)missing.push('policy.marketPricingAvailable');
    if(!Array.isArray(policy.economies)||policy.economies.length!==5)missing.push(`policy.economies:${policy.economies?.length??0}`);
    for(const row of policy.economies||[]){
      const tree=row?.sequenceTree;
      if(tree?.depth!==3)missing.push(`${row?.currency||'policy'}:tree-depth`);
      if(!Array.isArray(tree?.decisionWindows)||tree.decisionWindows.length!==3)missing.push(`${row?.currency||'policy'}:tree-windows`);
      for(const window of tree?.decisionWindows||[]){const p=window?.probabilities||{},sum=Number(p.hike||0)+Number(p.hold||0)+Number(p.cut||0);if(Math.abs(sum-1)>.01)missing.push(`${row?.currency||'policy'}:${window?.window||'?'}:probability-sum`);}
      if(!Array.isArray(tree?.topPaths)||tree.topPaths.length<3)missing.push(`${row?.currency||'policy'}:top-paths`);
      if(!Number.isFinite(Number(tree?.expectedNetSteps)))missing.push(`${row?.currency||'policy'}:expected-net-steps`);
    }
  }
  return missing;
}
function validateAttribution(attribution){
  const missing=[];
  if(!attribution)missing.push('decisionQualityAttribution');
  else {
    if(!Number.isFinite(Number(attribution.sampledRealizedStates)))missing.push('attribution.sampledRealizedStates');
    if(!Array.isArray(attribution?.global?.features))missing.push('attribution.features');
    const methodology=String(attribution.methodology||'').toLowerCase();
    if(!methodology.includes('association'))missing.push('attribution.association-methodology');
    if(!methodology.includes('not causal'))missing.push('attribution.non-causal-disclosure');
  }
  return missing;
}
function validateCore(core){
  const missing=[],pairs=core?.pairDecisions||[];
  if(core?.version!=='1.5.0')missing.push(`decisionCore.version:${core?.version??'missing'}`);
  if(!Array.isArray(pairs)||pairs.length<8)missing.push(`pair-count:${pairs.length}`);
  let active=0,minFactor=Infinity,maxFactor=-Infinity,maxExposure=0;
  for(const pair of pairs){
    const c=pair?.eventReactionCalibration;
    if(!c){missing.push(`${pair?.symbol||'pair'}:eventReactionCalibration`);continue;}
    const factor=Number(c.factor),exposure=Number(c.releaseExposure||0);
    if(!Number.isFinite(factor)||factor<.86-1e-9||factor>1.04+1e-9)missing.push(`${pair.symbol}:factor:${factor}`);
    if(!Number.isFinite(exposure)||exposure<0||exposure>.55+1e-9)missing.push(`${pair.symbol}:releaseExposure:${exposure}`);
    if(!String(c.methodology||'').includes('never contributes a new directional vote'))missing.push(`${pair.symbol}:confidence-only-methodology`);
    if(c.available)active++;
    if(Number.isFinite(factor)){minFactor=Math.min(minFactor,factor);maxFactor=Math.max(maxFactor,factor);}
    if(Number.isFinite(exposure))maxExposure=Math.max(maxExposure,exposure);
  }
  return {missing,pairs,active,minFactor:minFactor===Infinity?null:minFactor,maxFactor:maxFactor===-Infinity?null:maxFactor,maxExposure};
}
function validateResearch(research){return [...validatePolicy(research?.policyPathResearch),...validateAttribution(research?.decisionQualityAttribution)];}
async function waitForCollectorVersion(){let last;for(let attempt=1;attempt<=45;attempt++){try{const health=await privateCall('/health');console.log(`collector attempt ${attempt}: version=${health.version}`);if(health?.ok&&versionAtLeast(health.version,'4.16.0'))return health;last=new Error(`Collector still ${health.version}`);}catch(error){last=error;console.log(`collector attempt ${attempt}: ${error.message}`);}await sleep(5000);}throw last||new Error('Collector v4.16.0 did not become ready');}
async function verifyPrivate(){
  const health=await waitForCollectorVersion();let last;
  for(let attempt=1;attempt<=5;attempt++){
    try{
      const refreshed=await privateCall('/refresh-intelligence','POST',{forceNews:false});
      const state=await privateCall('/state'),intel=state?.intelligence?.payload,research=intel?.research,core=intel?.decisionGovernance,coreCheck=validateCore(core),researchMissing=validateResearch(research),missing=[...coreCheck.missing,...researchMissing];
      console.log(`private contract attempt ${attempt}: pairs=${coreCheck.pairs.length} activeCalibrations=${coreCheck.active} attribution=${research?.decisionQualityAttribution?.sampledRealizedStates??'missing'} missing=${missing.length} webhook=${refreshed?.webhook?.sent}`);
      if(!missing.length&&refreshed?.webhook?.sent===true)return {verifiedAt:new Date().toISOString(),reportedHealthVersion:String(health.version),decisionCoreVersion:core.version,pairs:coreCheck.pairs.length,activeCalibrations:coreCheck.active,minFactor:coreCheck.minFactor,maxFactor:coreCheck.maxFactor,maxReleaseExposure:coreCheck.maxExposure,attributionSamples:Number(research.decisionQualityAttribution.sampledRealizedStates||0),policyBanks:research.policyPathResearch.economies.length,policyCurrencies:research.policyPathResearch.economies.map(x=>x.currency),policyTreeDepth:3,marketPricingAvailable:research.policyPathResearch.marketPricingAvailable,webhookStatus:refreshed.webhook.status??null};
      last=new Error(`Private v4.16 contract missing: ${missing.join(', ')}; webhook sent=${refreshed?.webhook?.sent}`);
    }catch(error){last=error;console.log(`private contract attempt ${attempt}: ${error.message}`);}await sleep(5000);
  }
  throw last||new Error('Private v4.16 contract did not become ready');
}
async function verifyPublic(report){
  let last;
  for(let attempt=1;attempt<=48;attempt++){
    try{
      const [research,health]=await Promise.all([publicCall('/api/research'),publicCall('/api/health')]);
      const coreCheck=validateCore(research?.decisionCore),researchMissing=validateResearch(research),missing=[...coreCheck.missing,...researchMissing];
      if(health?.collectorMode!=='google-cloud-run-webhook')missing.push('public-health.collectorMode');
      const safety=health?.safety||{};
      for(const key of ['normalStateUpstreamCalendarRequests','normalStateUpstreamFredRequests','normalStateUpstreamNewsRequests','normalStateUpstreamMarketRequests'])if(Number(safety[key]??-1)!==0)missing.push(`public-health.${key}`);
      console.log(`public attempt ${attempt}: pairs=${coreCheck.pairs.length} activeCalibrations=${coreCheck.active} attribution=${research?.decisionQualityAttribution?.sampledRealizedStates??'missing'} missing=${missing.length}`);
      if(!missing.length)return {...report,publicContract:{passed:true,pairs:coreCheck.pairs.length,activeCalibrations:coreCheck.active,attributionSamples:Number(research.decisionQualityAttribution.sampledRealizedStates||0),policyBanks:research.policyPathResearch.economies.length,passiveEdge:true}};
      last=new Error(`Public v4.16 contract missing: ${missing.join(', ')}`);
    }catch(error){last=error;console.log(`public attempt ${attempt}: ${error.message}`);}await sleep(5000);
  }
  throw last||new Error('Public v4.16 contract did not become ready');
}

const report=await verifyPublic(await verifyPrivate());
const lines=[
  `verified_at=${report.verifiedAt}`,
  'contract=v4.16-intelligence-live',
  `reported_health_version=${report.reportedHealthVersion}`,
  `decision_core_version=${report.decisionCoreVersion}`,
  `governed_pairs=${report.publicContract.pairs}`,
  `active_event_reaction_calibrations=${report.publicContract.activeCalibrations}`,
  `event_reaction_factor_min=${report.minFactor}`,
  `event_reaction_factor_max=${report.maxFactor}`,
  `max_release_exposure=${report.maxReleaseExposure}`,
  `decision_attribution_samples=${report.publicContract.attributionSamples}`,
  `policy_banks=${report.publicContract.policyBanks}`,
  `policy_currencies=${report.policyCurrencies.join(',')}`,
  `policy_tree_depth=${report.policyTreeDepth}`,
  `market_pricing_available=${report.marketPricingAvailable}`,
  `webhook_status=${report.webhookStatus}`,
  `passive_edge=${report.publicContract.passiveEdge}`,
  'public_contract=passed'
];
fs.writeFileSync('.github/intelligence-v416-live.status',lines.join('\n')+'\n');
fs.writeFileSync('/tmp/v416-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
