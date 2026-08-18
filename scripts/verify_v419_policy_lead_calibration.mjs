import fs from 'node:fs';

const serviceUrl=String(process.env.SERVICE_URL||'').replace(/\/$/,'');
const token=String(process.env.TOKEN||'');
const publicBase=String(process.env.PUBLIC_BASE||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!serviceUrl||!token)throw new Error('SERVICE_URL and TOKEN are required');
const EXPECTED_BUCKETS=['early-45d','14d','7d','24h','final'];
const V418_BASELINE_FROZEN=2;
const V418_BASELINE_UNIQUE=2;

async function privateCall(path,method='GET',body){const r=await fetch(serviceUrl+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),text=await r.text();if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${text.slice(0,900)}`);return JSON.parse(text);}
async function publicCall(path){const r=await fetch(publicBase+path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}}),text=await r.text();if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${text.slice(0,900)}`);return JSON.parse(text);}
function versionAtLeast(actual,required){const a=String(actual||'0').split('.').map(Number),b=String(required).split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}return true;}
function validateMetric(metric,label){const missing=[];if(!metric)return [`${label}:missing`];for(const key of ['frozen','uniqueDecisions','scored','pending']){const n=Number(metric[key]);if(!Number.isInteger(n)||n<0)missing.push(`${label}.${key}`);}if(Number(metric.frozen)!==Number(metric.scored)+Number(metric.pending))missing.push(`${label}:balance`);if(Number(metric.uniqueDecisions)>Number(metric.frozen))missing.push(`${label}:unique>frozen`);if(!Number.isFinite(Number(metric.sampleConfidence))||Number(metric.sampleConfidence)<0||Number(metric.sampleConfidence)>1)missing.push(`${label}.sampleConfidence`);if(Number(metric.scored)===0){for(const key of ['topActionAccuracy','averageBrier','averageLogLoss','brierSkillVsUniform'])if(metric[key]!==null)missing.push(`${label}.${key}:must-null-with-zero-score`);}return missing;}
function validateCalibration(data,{strictBaseline=false}={}){
  const missing=[];if(!data)return {missing:['policyCalibration'],bucketCounts:{}};
  if(Number(data.auditVersion)!==2)missing.push(`auditVersion:${data.auditVersion}`);
  const ids=(data.leadBuckets||[]).map(x=>x.id);if(JSON.stringify(ids)!==JSON.stringify(EXPECTED_BUCKETS))missing.push(`leadBuckets:${ids.join(',')}`);
  missing.push(...validateMetric(data.global,'global'));
  const bucketCounts={};let bucketFrozen=0,bucketScored=0;
  for(const id of EXPECTED_BUCKETS){const metric=data.byLeadBucket?.[id];missing.push(...validateMetric(metric,`lead.${id}`));bucketCounts[id]={frozen:Number(metric?.frozen||0),scored:Number(metric?.scored||0),pending:Number(metric?.pending||0)};bucketFrozen+=Number(metric?.frozen||0);bucketScored+=Number(metric?.scored||0);}
  if(bucketFrozen!==Number(data.global?.frozen||0))missing.push(`lead-frozen-sum:${bucketFrozen}/${data.global?.frozen}`);
  if(bucketScored!==Number(data.global?.scored||0))missing.push(`lead-scored-sum:${bucketScored}/${data.global?.scored}`);
  const comparisons=data.leadComparisons||[];if(comparisons.length!==4)missing.push(`leadComparisons:${comparisons.length}`);for(const row of comparisons){if(!EXPECTED_BUCKETS.includes(row.fromBucket)||!EXPECTED_BUCKETS.includes(row.toBucket))missing.push('leadComparison.bucket');if(Number(row.pairs)===0&&(row.averageBrierImprovement!==null||row.averageLogLossImprovement!==null))missing.push(`${row.fromBucket}->${row.toBucket}:unmatched-metrics-nonnull`);}
  const methodology=String(data.methodology||'');if(!methodology.includes('Existing legacy frozen rows are never rewritten'))missing.push('methodology.legacy-immutability');if(!methodology.includes('Missing earlier lead windows are never backfilled'))missing.push('methodology.no-backfill');if(!methodology.includes('same realized decision'))missing.push('methodology.paired-decisions');
  if(strictBaseline){if(Number(data.global?.frozen)!==V418_BASELINE_FROZEN)missing.push(`migration-frozen:${data.global?.frozen}/${V418_BASELINE_FROZEN}`);if(Number(data.global?.uniqueDecisions)!==V418_BASELINE_UNIQUE)missing.push(`migration-unique:${data.global?.uniqueDecisions}/${V418_BASELINE_UNIQUE}`);if(Number(data.global?.scored)!==0)missing.push(`migration-scored:${data.global?.scored}`);}
  return {missing,bucketCounts};
}
async function waitCollector(){let last;for(let attempt=1;attempt<=50;attempt++){try{const h=await privateCall('/health');console.log(`collector attempt ${attempt}: ${h.version}`);if(h?.ok&&versionAtLeast(h.version,'4.19.0'))return h;last=new Error(`Collector still ${h.version}`);}catch(e){last=e;console.log(`collector attempt ${attempt}: ${e.message}`);}await sleep(5000);}throw last||new Error('Collector v4.19.0 did not become ready');}
async function verifyPrivate(){
  const health=await waitCollector(),refresh=await privateCall('/refresh-intelligence','POST',{forceNews:false}),state=await privateCall('/state'),research=state?.intelligence?.payload?.research,data=research?.policyCalibration,check=validateCalibration(data,{strictBaseline:true});
  console.log(`private: frozen=${data?.global?.frozen} unique=${data?.global?.uniqueDecisions} scored=${data?.global?.scored} missing=${check.missing.length}`);
  if(check.missing.length)throw new Error(`Private v4.19 migration contract failed: ${check.missing.join(', ')}`);
  return {verifiedAt:new Date().toISOString(),reportedHealthVersion:String(health.version),global:data.global,bucketCounts:check.bucketCounts,leadBuckets:data.leadBuckets,leadComparisons:data.leadComparisons,byCurrency:data.byCurrency||{},refreshChanged:Boolean(refresh.changed),webhookStatus:refresh?.webhook?.status??null,audit:state?.intelligence?.payload?.audit?.policyCalibration||null};
}
async function verifyPublic(report){let last;for(let attempt=1;attempt<=48;attempt++){try{const [research,health]=await Promise.all([publicCall('/api/research'),publicCall('/api/health')]),data=research?.policyCalibration,check=validateCalibration(data,{strictBaseline:true}),missing=[...check.missing];const safety=health?.safety||{};for(const key of ['normalStateUpstreamCalendarRequests','normalStateUpstreamFredRequests','normalStateUpstreamNewsRequests','normalStateUpstreamMarketRequests'])if(Number(safety[key]??-1)!==0)missing.push(`public-health.${key}`);if(JSON.stringify(check.bucketCounts)!==JSON.stringify(report.bucketCounts))missing.push('public-private-lead-bucket-mismatch');console.log(`public attempt ${attempt}: frozen=${data?.global?.frozen} unique=${data?.global?.uniqueDecisions} missing=${missing.length}`);if(!missing.length)return {...report,publicContract:{passed:true,passiveEdge:true,bucketCounts:check.bucketCounts}};last=new Error(`Public v4.19 migration contract failed: ${missing.join(', ')}`);}catch(e){last=e;console.log(`public attempt ${attempt}: ${e.message}`);}await sleep(5000);}throw last||new Error('Public v4.19 policy calibration did not become ready');}

const report=await verifyPublic(await verifyPrivate());
const activeBuckets=Object.entries(report.bucketCounts).filter(([,x])=>x.frozen>0).map(([id,x])=>`${id}:${x.frozen}`).join(',');
const lines=[
  `verified_at=${report.verifiedAt}`,
  'contract=v4.19-policy-lead-calibration-live',
  `reported_health_version=${report.reportedHealthVersion}`,
  `audit_version=2`,
  `frozen_snapshots=${report.global.frozen}`,
  `unique_policy_decisions=${report.global.uniqueDecisions}`,
  `scored_snapshots=${report.global.scored}`,
  `pending_snapshots=${report.global.pending}`,
  `active_lead_buckets=${activeBuckets}`,
  `lead_comparison_count=${report.leadComparisons.length}`,
  `migration_baseline_preserved=${report.global.frozen===V418_BASELINE_FROZEN&&report.global.uniqueDecisions===V418_BASELINE_UNIQUE}`,
  `refresh_changed=${report.refreshChanged}`,
  `webhook_status=${report.webhookStatus}`,
  `passive_edge=${report.publicContract.passiveEdge}`,
  'legacy_rows_rewritten=false',
  'missing_lead_windows_backfilled=false',
  'public_contract=passed'
];
fs.writeFileSync('.github/intelligence-v419-policy-lead-calibration-live.status',lines.join('\n')+'\n');
fs.writeFileSync('.github/intelligence-v419-policy-lead-calibration-live.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
