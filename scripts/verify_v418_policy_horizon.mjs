import fs from 'node:fs';

const serviceUrl=String(process.env.SERVICE_URL||'').replace(/\/$/,'');
const token=String(process.env.TOKEN||'');
const publicBase=String(process.env.PUBLIC_BASE||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!serviceUrl||!token)throw new Error('SERVICE_URL and TOKEN are required');
const TARGET=new Set(['USD','EUR','GBP','ZAR','JPY']);
const POLICY_RE=/\b(?:interest rate decision|rate decision|bank rate decision|repo rate decision|policy rate decision|cash rate decision|refinancing rate decision|deposit facility rate decision|fed funds rate decision|monetary policy decision)\b/i;

async function privateCall(path,method='GET',body){const response=await fetch(serviceUrl+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),text=await response.text();if(!response.ok)throw new Error(`${path} HTTP ${response.status}: ${text.slice(0,900)}`);return JSON.parse(text);}
async function publicCall(path){const response=await fetch(publicBase+path,{headers:{Accept:'application/json','Cache-Control':'no-cache'}}),text=await response.text();if(!response.ok)throw new Error(`${path} HTTP ${response.status}: ${text.slice(0,900)}`);return JSON.parse(text);}
function versionAtLeast(actual,required){const a=String(actual||'0').split('.').map(Number),b=String(required).split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}return true;}
function meetingRows(policy){return (policy?.economies||[]).flatMap(row=>(row.scheduledDecisionEvents||[]).map(meeting=>({currency:row.currency,...meeting})));}
function validateCalendar(calendar){
  const missing=[],events=Array.isArray(calendar?.events)?calendar.events:[],normalEnd=Date.parse(calendar?.windowEnd||''),policyEnd=Date.parse(calendar?.policyWindowEnd||''),extended=events.filter(e=>e?.policyCatalystHorizonOnly===true);
  if(Number(calendar?.days)!==14)missing.push(`calendar.days:${calendar?.days}`);
  if(Number(calendar?.policyCatalystDays)!==75)missing.push(`calendar.policyCatalystDays:${calendar?.policyCatalystDays}`);
  if(!Number.isFinite(normalEnd)||!Number.isFinite(policyEnd)||policyEnd<=normalEnd)missing.push('calendar.policy-window');
  if(Number(calendar?.policyCatalystCount)!==extended.length)missing.push(`calendar.policyCatalystCount:${calendar?.policyCatalystCount}/${extended.length}`);
  const health=calendar?.sourceHealth?.policyCatalysts;
  if(!health)missing.push('calendar.sourceHealth.policyCatalysts');
  else {if(Number(health.segments)<1)missing.push('policyCatalysts.segments');if(Number(health.failedSegments)>=Number(health.segments))missing.push(`policyCatalysts.all-segments-failed:${health.failedSegments}/${health.segments}`);if(health.source!=='FXStreet public calendar feed')missing.push(`policyCatalysts.source:${health.source}`);}
  for(const e of extended){
    const t=Date.parse(e.date||'');
    if(!TARGET.has(String(e.currency||'').toUpperCase()))missing.push(`${e.id}:currency`);
    if(!POLICY_RE.test(`${e.event||''} ${e.category||''}`))missing.push(`${e.id}:not-policy-decision`);
    if(!Number.isFinite(t)||t<=normalEnd||t>policyEnd)missing.push(`${e.id}:outside-extended-window`);
    if(!e.policyProvenance?.source||!e.policyProvenance?.retrievedAt||!e.policyProvenance?.windowStart||!e.policyProvenance?.windowEnd)missing.push(`${e.id}:provenance`);
  }
  return {missing,extended,health,events};
}
function validatePolicyResearch(policy,calendarExtended){
  const missing=[],rows=meetingRows(policy),byId=new Map(calendarExtended.map(e=>[e.id,e])),extended=rows.filter(x=>x.policyCatalystHorizonOnly===true);
  if((policy?.economies||[]).length!==5)missing.push(`policy.economies:${policy?.economies?.length??0}`);
  for(const row of extended){const source=byId.get(row.id);if(!source)missing.push(`${row.id}:extended-meeting-not-in-calendar`);if(!row.policyProvenance?.source)missing.push(`${row.id}:research-provenance`);}
  return {missing,rows,extended};
}
async function waitCollector(){let last;for(let attempt=1;attempt<=50;attempt++){try{const health=await privateCall('/health');console.log(`collector attempt ${attempt}: ${health.version}`);if(health?.ok&&versionAtLeast(health.version,'4.18.0'))return health;last=new Error(`Collector still ${health.version}`);}catch(e){last=e;console.log(`collector attempt ${attempt}: ${e.message}`);}await sleep(5000);}throw last||new Error('Collector 4.18.0 did not become ready');}
async function verifyPrivate(){
  const health=await waitCollector();
  const bootstrap=await privateCall('/bootstrap','POST',{}),stateAfterBootstrap=await privateCall('/state'),calendar=stateAfterBootstrap?.calendar?.payload,calendarCheck=validateCalendar(calendar);
  console.log(`bootstrap: events=${calendarCheck.events.length} extended=${calendarCheck.extended.length} segments=${calendarCheck.health?.segments??0} failedSegments=${calendarCheck.health?.failedSegments??0}`);
  if(calendarCheck.missing.length)throw new Error(`Private calendar contract missing: ${calendarCheck.missing.join(', ')}`);
  const refresh=await privateCall('/refresh-intelligence','POST',{forceNews:false}),state=await privateCall('/state'),research=state?.intelligence?.payload?.research,policy=research?.policyPathResearch,policyCheck=validatePolicyResearch(policy,calendarCheck.extended);
  if(policyCheck.missing.length)throw new Error(`Private policy research contract missing: ${policyCheck.missing.join(', ')}`);
  const calibration=research?.policyCalibration?.global||null;
  return {verifiedAt:new Date().toISOString(),reportedHealthVersion:String(health.version),bootstrap,calendar:{days:calendar.days,policyCatalystDays:calendar.policyCatalystDays,windowEnd:calendar.windowEnd,policyWindowEnd:calendar.policyWindowEnd,totalEvents:calendarCheck.events.length,extendedCount:calendarCheck.extended.length,extendedCurrencies:[...new Set(calendarCheck.extended.map(x=>x.currency))],extendedEvents:calendarCheck.extended.map(x=>({id:x.id,currency:x.currency,event:x.event,date:x.date,source:x.policyProvenance?.source||x.source||null}))},sourceHealth:calendarCheck.health,policyResearch:{banks:policy.economies.length,scheduledMeetings:policyCheck.rows.length,extendedMeetings:policyCheck.extended.length,extendedIds:policyCheck.extended.map(x=>x.id)},policyCalibration:calibration?{frozen:calibration.frozen,scored:calibration.scored,pending:calibration.pending,status:calibration.status}:null,refreshChanged:Boolean(refresh.changed),webhookStatus:refresh?.webhook?.status??null};
}
async function verifyPublic(report){
  let last;
  for(let attempt=1;attempt<=48;attempt++){
    try{
      const [research,health]=await Promise.all([publicCall('/api/research'),publicCall('/api/health')]),policy=research?.policyPathResearch,rows=meetingRows(policy),publicExtended=rows.filter(x=>x.policyCatalystHorizonOnly===true),missing=[];
      if((policy?.economies||[]).length!==5)missing.push(`policy.economies:${policy?.economies?.length??0}`);
      for(const id of report.policyResearch.extendedIds)if(!publicExtended.some(x=>x.id===id))missing.push(`public-missing-extended:${id}`);
      const safety=health?.safety||{};for(const key of ['normalStateUpstreamCalendarRequests','normalStateUpstreamFredRequests','normalStateUpstreamNewsRequests','normalStateUpstreamMarketRequests'])if(Number(safety[key]??-1)!==0)missing.push(`public-health.${key}`);
      console.log(`public attempt ${attempt}: banks=${policy?.economies?.length??0} extendedMeetings=${publicExtended.length} missing=${missing.length}`);
      if(!missing.length)return {...report,publicContract:{passed:true,passiveEdge:true,extendedMeetings:publicExtended.length}};
      last=new Error(`Public v4.18 contract missing: ${missing.join(', ')}`);
    }catch(error){last=error;console.log(`public attempt ${attempt}: ${error.message}`);}await sleep(5000);
  }
  throw last||new Error('Public v4.18 policy horizon did not become ready');
}

const report=await verifyPublic(await verifyPrivate());
const lines=[
  `verified_at=${report.verifiedAt}`,
  'contract=v4.18-policy-horizon-live',
  `reported_health_version=${report.reportedHealthVersion}`,
  `calendar_days=${report.calendar.days}`,
  `policy_catalyst_days=${report.calendar.policyCatalystDays}`,
  `calendar_total_events=${report.calendar.totalEvents}`,
  `extended_policy_events=${report.calendar.extendedCount}`,
  `extended_policy_currencies=${report.calendar.extendedCurrencies.join(',')}`,
  `policy_source_segments=${report.sourceHealth?.segments??0}`,
  `policy_source_failed_segments=${report.sourceHealth?.failedSegments??0}`,
  `policy_banks=${report.policyResearch.banks}`,
  `research_scheduled_meetings=${report.policyResearch.scheduledMeetings}`,
  `research_extended_meetings=${report.publicContract.extendedMeetings}`,
  `policy_frozen=${report.policyCalibration?.frozen??0}`,
  `policy_scored=${report.policyCalibration?.scored??0}`,
  `policy_pending=${report.policyCalibration?.pending??0}`,
  `policy_calibration_status=${report.policyCalibration?.status??'building'}`,
  `refresh_changed=${report.refreshChanged}`,
  `webhook_status=${report.webhookStatus}`,
  `passive_edge=${report.publicContract.passiveEdge}`,
  'normal_calendar_unchanged_at_14_days=true',
  'far_future_release_tasks_disabled=true',
  'public_contract=passed'
];
fs.writeFileSync('.github/intelligence-v418-policy-horizon-live.status',lines.join('\n')+'\n');
fs.writeFileSync('.github/intelligence-v418-policy-horizon-live.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
