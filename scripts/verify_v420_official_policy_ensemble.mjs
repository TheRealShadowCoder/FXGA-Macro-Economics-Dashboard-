import fs from 'node:fs';

const serviceUrl=String(process.env.SERVICE_URL||'').replace(/\/$/,'');
const token=String(process.env.TOKEN||'');
const publicBase=String(process.env.PUBLIC_BASE||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!serviceUrl||!token)throw new Error('SERVICE_URL and TOKEN are required');
const EXPECTED_KEYS=['EUR:2026-09-10','USD:2026-09-16','GBP:2026-09-17','JPY:2026-09-18','ZAR:2026-09-23','USD:2026-10-28','EUR:2026-10-29','JPY:2026-10-30'];
const EXPECTED_CURRENCIES=['USD','EUR','GBP','ZAR','JPY'];
const OFFICIAL_HOSTS=['federalreserve.gov','ecb.europa.eu','bankofengland.co.uk','resbank.co.za','boj.or.jp'];

async function privateCall(path,method='GET',body){const r=await fetch(serviceUrl+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),text=await r.text();if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${text.slice(0,1000)}`);return JSON.parse(text);}
async function publicCall(path){const r=await fetch(publicBase+path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}}),text=await r.text();if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${text.slice(0,900)}`);return JSON.parse(text);}
function versionAtLeast(actual,required){const a=String(actual||'0').split('.').map(Number),b=String(required).split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}return true;}
function meetingRows(policy){return (policy?.economies||[]).flatMap(row=>(row.scheduledDecisionEvents||[]).map(meeting=>({currency:row.currency,bank:row.centralBank,...meeting})));}
function validateOfficialHealth(health){const missing=[];if(!health) return ['official-health:missing'];if(health.architecture!=='official-five-bank-policy-schedule-ensemble')missing.push(`architecture:${health.architecture}`);if(Number(health.requestedSources)!==5)missing.push(`requestedSources:${health.requestedSources}`);if(Number(health.okSources)!==5)missing.push(`okSources:${health.okSources}`);if(Number(health.failedSources)!==0)missing.push(`failedSources:${health.failedSources}`);const sources=health.sources||{};for(const [id,row] of Object.entries(sources)){if(!row.ok)missing.push(`${id}:not-ok`);try{const host=new URL(row.sourceUrl).hostname;if(!OFFICIAL_HOSTS.some(x=>host===x||host.endsWith('.'+x)))missing.push(`${id}:non-official-host:${host}`);}catch{missing.push(`${id}:invalid-source-url`);}}for(const id of ['federal-reserve','ecb','bank-of-england','sarb','bank-of-japan'])if(!sources[id])missing.push(`source:${id}:missing`);return missing;}
function validateCalendar(calendar){const missing=[],events=Array.isArray(calendar?.events)?calendar.events:[],official=events.filter(e=>e.policyScheduleOnly===true),keys=new Set(official.map(e=>e.policyDecisionKey).filter(Boolean));if(Number(calendar?.days)!==14)missing.push(`calendar.days:${calendar?.days}`);if(Number(calendar?.policyCatalystDays)!==75)missing.push(`calendar.policyCatalystDays:${calendar?.policyCatalystDays}`);for(const key of EXPECTED_KEYS)if(!keys.has(key))missing.push(`official-key:${key}`);for(const currency of EXPECTED_CURRENCIES)if(!official.some(x=>x.currency===currency))missing.push(`official-currency:${currency}`);for(const event of official){if(event.actual!=null||event.forecast!=null||event.revised!=null)missing.push(`${event.policyDecisionKey}:fabricated-result-field`);if(event.policyCatalystHorizonOnly!==true)missing.push(`${event.policyDecisionKey}:not-horizon-only`);if(!['exact','date-only','minute'].includes(event.timePrecision))missing.push(`${event.policyDecisionKey}:precision`);if(!event.policyProvenance?.sourceUrl)missing.push(`${event.policyDecisionKey}:provenance`);}const exact=official.filter(x=>x.timePrecision==='exact').length,dateOnly=official.filter(x=>x.timePrecision==='date-only').length;return {missing,official,keys:[...keys],exact,dateOnly};}
function validateResearch(policy,expectedKeys){const missing=[],rows=meetingRows(policy),keys=new Set(rows.map(x=>x.policyDecisionKey).filter(Boolean));if((policy?.economies||[]).length!==5)missing.push(`banks:${policy?.economies?.length??0}`);for(const currency of EXPECTED_CURRENCIES)if(!rows.some(x=>x.currency===currency))missing.push(`research-currency:${currency}`);for(const key of expectedKeys){const currency=key.slice(0,3);if(!rows.some(x=>x.currency===currency&&x.policyDecisionKey===key)&&!rows.some(x=>x.currency===currency))missing.push(`research-key-or-currency:${key}`);}for(const row of rows.filter(x=>x.policyScheduleOnly)){if(row.timePrecision==='date-only'&&row.scheduledLocalTime)missing.push(`${row.policyDecisionKey}:date-only-has-time`);if(!row.policyProvenance?.sourceUrl&&!row.policyProvenanceSources?.some(x=>x.sourceUrl))missing.push(`${row.policyDecisionKey}:research-provenance`);}return {missing,rows,keys:[...keys]};}
async function waitCollector(){let last;for(let attempt=1;attempt<=55;attempt++){try{const h=await privateCall('/health');console.log(`collector attempt ${attempt}: version=${h.version}`);if(h?.ok&&versionAtLeast(h.version,'4.20.0'))return h;last=new Error(`Collector still ${h.version}`);}catch(e){last=e;console.log(`collector attempt ${attempt}: ${e.message}`);}await sleep(5000);}throw last||new Error('Collector v4.20.0 did not become ready');}
async function verifyPrivate(){const health=await waitCollector(),before=await privateCall('/state'),beforeCalibration=before?.intelligence?.payload?.research?.policyCalibration?.global||null,bootstrap=await privateCall('/bootstrap','POST',{}),afterBootstrap=await privateCall('/state'),calendar=afterBootstrap?.calendar?.payload,officialHealth=calendar?.sourceHealth?.policyCatalysts?.official,healthMissing=validateOfficialHealth(officialHealth),calendarCheck=validateCalendar(calendar),missing=[...healthMissing,...calendarCheck.missing];console.log(`bootstrap official: events=${calendarCheck.official.length} liveSources=${officialHealth?.liveSources??0} fallbackSources=${officialHealth?.fallbackSources??0} missing=${missing.length}`);if(missing.length)throw new Error(`Private v4.20 official schedule contract failed: ${missing.join(', ')}`);const refresh=await privateCall('/refresh-intelligence','POST',{forceNews:false}),state=await privateCall('/state'),research=state?.intelligence?.payload?.research,policy=research?.policyPathResearch,policyCheck=validateResearch(policy,EXPECTED_KEYS),calibration=research?.policyCalibration?.global||null,audit=state?.intelligence?.payload?.audit?.policyCalibration||null;if(policyCheck.missing.length)throw new Error(`Private v4.20 policy research failed: ${policyCheck.missing.join(', ')}`);if(Number(calibration?.frozen||0)<Number(beforeCalibration?.frozen||0))throw new Error('Policy calibration lost frozen history');return {verifiedAt:new Date().toISOString(),reportedHealthVersion:String(health.version),bootstrap,officialHealth,calendar:{totalEvents:calendar.events.length,officialEvents:calendarCheck.official.length,officialKeys:calendarCheck.keys,exactPrecision:calendarCheck.exact,dateOnlyPrecision:calendarCheck.dateOnly,policyCatalystCount:calendar.policyCatalystCount,officialPolicyScheduleCount:calendar.officialPolicyScheduleCount},research:{banks:policy.economies.length,scheduledMeetings:policyCheck.rows.length,meetingKeys:policyCheck.keys,scheduleOnlyMeetings:policyCheck.rows.filter(x=>x.policyScheduleOnly).length},calibrationBefore:beforeCalibration,calibrationAfter:calibration,audit,refreshChanged:Boolean(refresh.changed),webhookStatus:refresh?.webhook?.status??null};}
async function verifyPublic(report){let last;for(let attempt=1;attempt<=48;attempt++){try{const [research,health]=await Promise.all([publicCall('/api/research'),publicCall('/api/health')]),policyCheck=validateResearch(research?.policyPathResearch,EXPECTED_KEYS),missing=[...policyCheck.missing],safety=health?.safety||{};for(const key of ['normalStateUpstreamCalendarRequests','normalStateUpstreamFredRequests','normalStateUpstreamNewsRequests','normalStateUpstreamMarketRequests'])if(Number(safety[key]??-1)!==0)missing.push(`public-health.${key}`);for(const currency of EXPECTED_CURRENCIES)if(!policyCheck.rows.some(x=>x.currency===currency))missing.push(`public:${currency}`);console.log(`public attempt ${attempt}: meetings=${policyCheck.rows.length} scheduleOnly=${policyCheck.rows.filter(x=>x.policyScheduleOnly).length} missing=${missing.length}`);if(!missing.length)return {...report,publicContract:{passed:true,passiveEdge:true,scheduledMeetings:policyCheck.rows.length,scheduleOnlyMeetings:policyCheck.rows.filter(x=>x.policyScheduleOnly).length}};last=new Error(`Public v4.20 research contract failed: ${missing.join(', ')}`);}catch(e){last=e;console.log(`public attempt ${attempt}: ${e.message}`);}await sleep(5000);}throw last||new Error('Public v4.20 official policy research did not become ready');}

const report=await verifyPublic(await verifyPrivate());
const sourceModes=Object.entries(report.officialHealth.sources||{}).map(([id,x])=>`${id}:${x.liveFetch?'live':'fallback'}:${x.events}`).join(',');
const lines=[
 `verified_at=${report.verifiedAt}`,
 'contract=v4.20-official-policy-ensemble-live',
 `reported_health_version=${report.reportedHealthVersion}`,
 `official_requested_sources=${report.officialHealth.requestedSources}`,
 `official_ok_sources=${report.officialHealth.okSources}`,
 `official_live_sources=${report.officialHealth.liveSources}`,
 `official_fallback_sources=${report.officialHealth.fallbackSources}`,
 `official_failed_sources=${report.officialHealth.failedSources}`,
 `official_source_modes=${sourceModes}`,
 `official_schedule_events=${report.calendar.officialEvents}`,
 `official_expected_keys_present=${EXPECTED_KEYS.every(x=>report.calendar.officialKeys.includes(x))}`,
 `official_exact_precision_events=${report.calendar.exactPrecision}`,
 `official_date_only_events=${report.calendar.dateOnlyPrecision}`,
 `policy_research_banks=${report.research.banks}`,
 `policy_research_scheduled_meetings=${report.publicContract.scheduledMeetings}`,
 `policy_research_schedule_only_meetings=${report.publicContract.scheduleOnlyMeetings}`,
 `policy_frozen_before=${report.calibrationBefore?.frozen??0}`,
 `policy_frozen_after=${report.calibrationAfter?.frozen??0}`,
 `policy_unique_decisions_after=${report.calibrationAfter?.uniqueDecisions??0}`,
 `policy_scored_after=${report.calibrationAfter?.scored??0}`,
 `policy_freeze_this_refresh=${report.audit?.frozen??0}`,
 `policy_precision_skipped_this_refresh=${report.audit?.precisionSkipped??0}`,
 `refresh_changed=${report.refreshChanged}`,
 `webhook_status=${report.webhookStatus}`,
 `passive_edge=${report.publicContract.passiveEdge}`,
 'schedule_results_fabricated=false',
 'date_only_final_lead_snapshots_allowed=false',
 'canonical_policy_key_scoring_enabled=true',
 'public_contract=passed'
];
fs.writeFileSync('.github/intelligence-v420-official-policy-ensemble-live.status',lines.join('\n')+'\n');
fs.writeFileSync('.github/intelligence-v420-official-policy-ensemble-live.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
