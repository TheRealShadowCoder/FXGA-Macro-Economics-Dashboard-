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
function finiteOrNull(value){return value===null||value===undefined||Number.isFinite(Number(value));}
function validateSummary(summary,label='global'){
  const missing=[];
  if(!summary)return [`${label}:missing`];
  for(const key of ['frozen','scored','pending']){const value=Number(summary[key]);if(!Number.isInteger(value)||value<0)missing.push(`${label}.${key}`);}
  const frozen=Number(summary.frozen||0),scored=Number(summary.scored||0),pending=Number(summary.pending||0);
  if(frozen!==scored+pending)missing.push(`${label}:frozen-scored-pending-balance`);
  if(!finiteOrNull(summary.topActionAccuracy))missing.push(`${label}.topActionAccuracy`);
  if(!finiteOrNull(summary.averageBrier))missing.push(`${label}.averageBrier`);
  if(!finiteOrNull(summary.averageLogLoss))missing.push(`${label}.averageLogLoss`);
  if(!finiteOrNull(summary.brierSkillVsUniform))missing.push(`${label}.brierSkillVsUniform`);
  const sampleConfidence=Number(summary.sampleConfidence);
  if(!Number.isFinite(sampleConfidence)||sampleConfidence<0||sampleConfidence>1)missing.push(`${label}.sampleConfidence`);
  if(scored===0){
    for(const key of ['topActionAccuracy','averageBrier','averageLogLoss','brierSkillVsUniform'])if(summary[key]!==null)missing.push(`${label}.${key}:must-remain-null-with-zero-realized-samples`);
    if(summary.status!=='building')missing.push(`${label}.status:${summary.status}`);
  }else{
    const brier=Number(summary.averageBrier),loss=Number(summary.averageLogLoss),accuracy=Number(summary.topActionAccuracy),skill=Number(summary.brierSkillVsUniform);
    if(!Number.isFinite(brier)||brier<0||brier>1)missing.push(`${label}.averageBrier-range`);
    if(!Number.isFinite(loss)||loss<0)missing.push(`${label}.averageLogLoss-range`);
    if(!Number.isFinite(accuracy)||accuracy<0||accuracy>1)missing.push(`${label}.topActionAccuracy-range`);
    if(!Number.isFinite(skill))missing.push(`${label}.brierSkillVsUniform-finite`);
  }
  return missing;
}
function validateCalibration(calibration){
  const missing=[];
  if(!calibration)return {missing:['policyCalibration'],global:null};
  missing.push(...validateSummary(calibration.global,'global'));
  for(const [currency,summary] of Object.entries(calibration.byCurrency||{}))missing.push(...validateSummary(summary,`currency.${currency}`));
  const methodology=String(calibration.methodology||'').toLowerCase();
  if(!methodology.includes('frozen before scheduled central-bank decisions'))missing.push('methodology.freeze-before-decision');
  if(!methodology.includes('brier'))missing.push('methodology.brier');
  if(!methodology.includes('log loss'))missing.push('methodology.log-loss');
  if(!methodology.includes('uniform 1/3-1/3-1/3 benchmark'))missing.push('methodology.uniform-benchmark');
  return {missing,global:calibration.global};
}
function validateAudit(audit){
  const row=audit?.policyCalibration,missing=[];
  if(!row)return ['audit.policyCalibration'];
  for(const key of ['scored','frozen','skipped']){const value=Number(row[key]);if(!Number.isInteger(value)||value<0)missing.push(`audit.policyCalibration.${key}`);}
  return missing;
}
async function waitForCollector(){let last;for(let attempt=1;attempt<=45;attempt++){try{const health=await privateCall('/health');console.log(`collector attempt ${attempt}: version=${health.version}`);if(health?.ok&&versionAtLeast(health.version,'4.17.0'))return health;last=new Error(`Collector still ${health.version}`);}catch(error){last=error;console.log(`collector attempt ${attempt}: ${error.message}`);}await sleep(5000);}throw last||new Error('Collector v4.17.0 did not become ready');}
async function verifyPrivate(){
  const health=await waitForCollector();let last;
  for(let attempt=1;attempt<=6;attempt++){
    try{
      const refresh=await privateCall('/refresh-intelligence','POST',{forceNews:false});
      const state=await privateCall('/state'),payload=state?.intelligence?.payload,research=payload?.research,check=validateCalibration(research?.policyCalibration),missing=[...check.missing,...validateAudit(payload?.audit)];
      const policyBanks=research?.policyPathResearch?.economies?.length||0;if(policyBanks!==5)missing.push(`policyPathResearch.economies:${policyBanks}`);
      const transportOk=refresh?.changed===false||refresh?.webhook?.sent===true;if(!transportOk)missing.push('refresh.webhook-transport');
      console.log(`private attempt ${attempt}: frozen=${check.global?.frozen??'missing'} scored=${check.global?.scored??'missing'} pending=${check.global?.pending??'missing'} banks=${policyBanks} missing=${missing.length}`);
      if(!missing.length)return {verifiedAt:new Date().toISOString(),reportedHealthVersion:String(health.version),refreshChanged:Boolean(refresh.changed),webhookStatus:refresh?.webhook?.status??null,global:check.global,byCurrency:research.policyCalibration.byCurrency||{},policyBanks,audit:payload.audit.policyCalibration};
      last=new Error(`Private v4.17 contract missing: ${missing.join(', ')}`);
    }catch(error){last=error;console.log(`private attempt ${attempt}: ${error.message}`);}await sleep(5000);
  }
  throw last||new Error('Private v4.17 policy calibration contract did not become ready');
}
async function verifyPublic(report){
  let last;
  for(let attempt=1;attempt<=48;attempt++){
    try{
      const [research,health]=await Promise.all([publicCall('/api/research'),publicCall('/api/health')]),check=validateCalibration(research?.policyCalibration),missing=[...check.missing];
      if((research?.policyPathResearch?.economies?.length||0)!==5)missing.push('public.policyPathResearch.economies');
      const safety=health?.safety||{};
      for(const key of ['normalStateUpstreamCalendarRequests','normalStateUpstreamFredRequests','normalStateUpstreamNewsRequests','normalStateUpstreamMarketRequests'])if(Number(safety[key]??-1)!==0)missing.push(`public-health.${key}`);
      console.log(`public attempt ${attempt}: frozen=${check.global?.frozen??'missing'} scored=${check.global?.scored??'missing'} pending=${check.global?.pending??'missing'} missing=${missing.length}`);
      if(!missing.length){
        if(Number(check.global.frozen)!==Number(report.global.frozen)||Number(check.global.scored)!==Number(report.global.scored))throw new Error(`Public calibration has not caught up yet: private ${report.global.frozen}/${report.global.scored}, public ${check.global.frozen}/${check.global.scored}`);
        return {...report,publicContract:{passed:true,passiveEdge:true,global:check.global,byCurrency:research.policyCalibration.byCurrency||{}}};
      }
      last=new Error(`Public v4.17 contract missing: ${missing.join(', ')}`);
    }catch(error){last=error;console.log(`public attempt ${attempt}: ${error.message}`);}await sleep(5000);
  }
  throw last||new Error('Public v4.17 policy calibration contract did not become ready');
}

const report=await verifyPublic(await verifyPrivate());
const currencies=Object.keys(report.publicContract.byCurrency);
const lines=[
  `verified_at=${report.verifiedAt}`,
  'contract=v4.17-policy-calibration-live',
  `reported_health_version=${report.reportedHealthVersion}`,
  `policy_banks=${report.policyBanks}`,
  `policy_frozen=${report.publicContract.global.frozen}`,
  `policy_scored=${report.publicContract.global.scored}`,
  `policy_pending=${report.publicContract.global.pending}`,
  `policy_status=${report.publicContract.global.status}`,
  `policy_average_brier=${report.publicContract.global.averageBrier}`,
  `policy_average_log_loss=${report.publicContract.global.averageLogLoss}`,
  `policy_brier_skill_vs_uniform=${report.publicContract.global.brierSkillVsUniform}`,
  `policy_top_action_accuracy=${report.publicContract.global.topActionAccuracy}`,
  `policy_sample_confidence=${report.publicContract.global.sampleConfidence}`,
  `policy_currency_scorecards=${currencies.join(',')}`,
  `refresh_changed=${report.refreshChanged}`,
  `webhook_status=${report.webhookStatus}`,
  `passive_edge=${report.publicContract.passiveEdge}`,
  'zero_scored_samples_allowed=true',
  'fabricated_historical_scores=false',
  'public_contract=passed'
];
fs.writeFileSync('.github/intelligence-v417-policy-calibration-live.status',lines.join('\n')+'\n');
fs.writeFileSync('/tmp/v417-policy-calibration.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
