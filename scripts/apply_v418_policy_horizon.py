from pathlib import Path


def replace_once(path, old, new):
    p=Path(path)
    text=p.read_text()
    if new in text:
        return False
    if old not in text:
        raise SystemExit(f'Anchor missing in {path}: {old[:180]!r}')
    p.write_text(text.replace(old,new,1))
    return True

module = r'''const DAY_MS=86_400_000;
const POLICY_CURRENCIES=new Set(['USD','EUR','GBP','ZAR','JPY']);
const POLICY_DECISION_RE=/\b(?:interest rate decision|rate decision|bank rate decision|repo rate decision|policy rate decision|cash rate decision|refinancing rate decision|deposit facility rate decision|fed funds rate decision|monetary policy decision)\b/i;
const normalize=value=>String(value||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

export function isPolicyDecisionEvent(event){
  const currency=String(event?.currency||'').toUpperCase();
  if(!POLICY_CURRENCIES.has(currency))return false;
  return POLICY_DECISION_RE.test(`${event?.event||''} ${event?.category||''}`);
}
export function policyCatalystSegments(from,to,maxDays=30){
  const start=from instanceof Date?from.getTime():Date.parse(from),end=to instanceof Date?to.getTime():Date.parse(to),span=Math.max(1,Math.min(30,Number(maxDays)||30))*DAY_MS;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return [];
  const segments=[];let cursor=start;
  while(cursor<end){const segmentEnd=Math.min(end,cursor+span);segments.push({from:new Date(cursor),to:new Date(segmentEnd)});cursor=segmentEnd+1000;}
  return segments;
}
function sameEvent(a,b){
  if(String(a?.currency||'')!==String(b?.currency||''))return false;
  const ta=Date.parse(a?.date||''),tb=Date.parse(b?.date||'');if(!Number.isFinite(ta)||!Number.isFinite(tb)||Math.abs(ta-tb)>5*60_000)return false;
  const na=normalize(a?.event),nb=normalize(b?.event);return na===nb||na.includes(nb)||nb.includes(na);
}
export function mergePolicyCatalystEvents(primary=[],policyEvents=[]){
  const merged=(primary||[]).map(event=>({...event}));
  for(const candidate of policyEvents||[]){
    const match=merged.find(event=>sameEvent(event,candidate));
    if(!match){merged.push({...candidate});continue;}
    match.providers=[...new Set([...(match.providers||[]),...(candidate.providers||[])])];
    match.sourceCount=match.providers.length;
    match.policyCatalyst=Boolean(match.policyCatalyst||candidate.policyCatalyst);
    match.policyCatalystHorizonOnly=Boolean(match.policyCatalystHorizonOnly)&&Boolean(candidate.policyCatalystHorizonOnly);
    match.policyProvenance=match.policyProvenance||candidate.policyProvenance;
    match.actual??=candidate.actual;match.forecast??=candidate.forecast;match.previous??=candidate.previous;
  }
  return merged.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
}
'''
module_path=Path('cloud-run-collector/src/policy-catalyst-horizon.js')
if not module_path.exists() or module_path.read_text()!=module:
    module_path.write_text(module)

path='cloud-run-collector/src/server-v2.js'
replace_once(path,"import { EVENT_STUDY_HORIZONS, buildEventStudyMeasurement, summarizeEventStudies, supportedEventStudyCurrency } from './event-study.js';\n", "import { EVENT_STUDY_HORIZONS, buildEventStudyMeasurement, summarizeEventStudies, supportedEventStudyCurrency } from './event-study.js';\nimport { isPolicyDecisionEvent, mergePolicyCatalystEvents, policyCatalystSegments } from './policy-catalyst-horizon.js';\n")
replace_once(path,"  calendarDays: Math.min(Math.max(Number(process.env.CALENDAR_DAYS || 14), 2), 30),\n", "  calendarDays: Math.min(Math.max(Number(process.env.CALENDAR_DAYS || 14), 2), 30),\n  policyCatalystDays: Math.min(Math.max(Number(process.env.POLICY_CATALYST_DAYS || 75), 31), 120),\n")
replace_once(path,"async function fetchFxstreet(from,to) {\n  return parseFxstreet(await fetchJson(fxstreetUrl(from,to),4500,{ Referer:'https://www.fxstreet.com/economic-calendar' }));\n}\n", "async function fetchFxstreet(from,to) {\n  return parseFxstreet(await fetchJson(fxstreetUrl(from,to),4500,{ Referer:'https://www.fxstreet.com/economic-calendar' }));\n}\nasync function fetchPolicyCatalystHorizon(from,to) {\n  const segments=policyCatalystSegments(from,to,30),settled=await Promise.allSettled(segments.map(segment=>fetchFxstreet(segment.from,segment.to))),events=[],failures=[],retrievedAt=new Date().toISOString();\n  settled.forEach((result,index)=>{\n    const segment=segments[index];\n    if(result.status==='rejected'){failures.push({windowStart:segment.from.toISOString(),windowEnd:segment.to.toISOString(),error:String(result.reason?.message||result.reason).slice(0,220)});return;}\n    for(const event of result.value||[]){if(!isPolicyDecisionEvent(event))continue;events.push({...event,policyCatalyst:true,policyCatalystHorizonOnly:true,policyProvenance:{provider:'fxstreet',source:'FXStreet public calendar feed',retrievedAt,windowStart:segment.from.toISOString(),windowEnd:segment.to.toISOString()}});}\n  });\n  const merged=mergePolicyCatalystEvents([],events);\n  return {events:merged,health:{ok:segments.length>0&&failures.length<segments.length,source:'FXStreet public calendar feed',segments:segments.length,failedSegments:failures.length,events:merged.length,windowStart:from.toISOString(),windowEnd:to.toISOString(),failures:failures.slice(0,5)}};\n}\n")
replace_once(path,"  const now=new Date(); const from=new Date(now.getTime()-CALENDAR_HISTORY_DAYS*86_400_000); const to=new Date(now.getTime()+cfg.calendarDays*86_400_000);\n", "  const now=new Date(); const from=new Date(now.getTime()-CALENDAR_HISTORY_DAYS*86_400_000); const to=new Date(now.getTime()+cfg.calendarDays*86_400_000); const policyTo=new Date(now.getTime()+cfg.policyCatalystDays*86_400_000);\n")
replace_once(path,"  const [fxstreetResult,myfxbook,cnbc]=await Promise.allSettled([fetchFxstreet(from,to),scrapeMyfxbook(),scrapeCnbc()]);\n", "  const [fxstreetResult,myfxbook,cnbc,policyHorizonResult]=await Promise.allSettled([fetchFxstreet(from,to),scrapeMyfxbook(),scrapeCnbc(),fetchPolicyCatalystHorizon(new Date(to.getTime()+1000),policyTo)]);\n")
replace_once(path,"  const cnbcResult=cnbc.status==='fulfilled'?cnbc.value:{items:[],ok:false,error:String(cnbc.reason)};\n", "  const cnbcResult=cnbc.status==='fulfilled'?cnbc.value:{items:[],ok:false,error:String(cnbc.reason)};\n  const policyHorizon=policyHorizonResult.status==='fulfilled'?policyHorizonResult.value:{events:[],health:{ok:false,source:'FXStreet public calendar feed',segments:0,failedSegments:1,events:0,error:String(policyHorizonResult.reason?.message||policyHorizonResult.reason).slice(0,220)}};\n")
replace_once(path,"  const events=mergeEvents(fxstreet,myfx.events||[]).map(enrichCalendarEvent).filter((event)=>Date.parse(event.date)>=from.getTime()&&Date.parse(event.date)<=to.getTime());\n", "  const normalEvents=mergeEvents(fxstreet,myfx.events||[]).map(enrichCalendarEvent).filter((event)=>Date.parse(event.date)>=from.getTime()&&Date.parse(event.date)<=to.getTime());\n  const policyEvents=(policyHorizon.events||[]).map(enrichCalendarEvent).filter((event)=>Date.parse(event.date)>to.getTime()&&Date.parse(event.date)<=policyTo.getTime());\n  const events=mergePolicyCatalystEvents(normalEvents,policyEvents);\n")
replace_once(path,"  const sourceHealth={fxstreet:{ok:fxstreet.length>0,events:fxstreet.length},myfxbook:{ok:Boolean(myfx.ok),events:(myfx.events||[]).length,mode:myfx.mode,error:myfx.error},cnbc:{ok:Boolean(cnbcResult.ok),items:(cnbcResult.items||[]).length,error:cnbcResult.error}};\n", "  const sourceHealth={fxstreet:{ok:fxstreet.length>0,events:fxstreet.length},myfxbook:{ok:Boolean(myfx.ok),events:(myfx.events||[]).length,mode:myfx.mode,error:myfx.error},cnbc:{ok:Boolean(cnbcResult.ok),items:(cnbcResult.items||[]).length,error:cnbcResult.error},policyCatalysts:policyHorizon.health};\n")
replace_once(path,"  const snapshot={generatedAt:new Date().toISOString(),days:cfg.calendarDays,historyDays:CALENDAR_HISTORY_DAYS,windowStart:from.toISOString(),windowEnd:to.toISOString(),targetEconomies:TARGET_ECONOMIES,events,sourceHealth,cnbcContext:cnbcResult.items||[]};\n", "  const snapshot={generatedAt:new Date().toISOString(),days:cfg.calendarDays,historyDays:CALENDAR_HISTORY_DAYS,windowStart:from.toISOString(),windowEnd:to.toISOString(),policyCatalystDays:cfg.policyCatalystDays,policyWindowEnd:policyTo.toISOString(),policyCatalystCount:policyEvents.length,targetEconomies:TARGET_ECONOMIES,events,sourceHealth,cnbcContext:cnbcResult.items||[]};\n")
replace_once(path,"  const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events); const marketPulse=await scheduleMarketPulseTasks();\n", "  const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events.filter((event)=>!event.policyCatalystHorizonOnly)); const marketPulse=await scheduleMarketPulseTasks();\n")

path='cloud-run-collector/src/policy-path-research.js'
replace_once(path,"nextMeeting:meeting?{id:meeting.id,event:meeting.event,date:meeting.date,forecast:meeting.forecast??null,previous:meeting.previous??null}:null,scheduledDecisionEvents:meetings.map(x=>({id:x.id,event:x.event,date:x.date,forecast:x.forecast??null,previous:x.previous??null}))", "nextMeeting:meeting?{id:meeting.id,event:meeting.event,date:meeting.date,forecast:meeting.forecast??null,previous:meeting.previous??null,source:meeting.source??null,providers:meeting.providers??[],policyCatalystHorizonOnly:Boolean(meeting.policyCatalystHorizonOnly),policyProvenance:meeting.policyProvenance??null}:null,scheduledDecisionEvents:meetings.map(x=>({id:x.id,event:x.event,date:x.date,forecast:x.forecast??null,previous:x.previous??null,source:x.source??null,providers:x.providers??[],policyCatalystHorizonOnly:Boolean(x.policyCatalystHorizonOnly),policyProvenance:x.policyProvenance??null}))")
replace_once(path,"Generalized central-bank reaction research for the five covered economies. Next-decision probabilities and three-decision sequence trees are model-implied", "Generalized central-bank reaction research for the five covered economies. Scheduled decision provenance is retained, including policy-only extended-horizon calendar observations when present. Next-decision probabilities and three-decision sequence trees are model-implied")

path='cloud-run-collector/package.json'
replace_once(path,"node --check src/policy-calibration.js && node --check src/decision-quality-attribution.js", "node --check src/policy-calibration.js && node --check src/policy-catalyst-horizon.js && node --check src/decision-quality-attribution.js")

path='.github/workflows/deploy-cloud-run-collector.yml'
replace_once(path,"CALENDAR_DAYS=14,MAX_BROWSER_SECONDS=25", "CALENDAR_DAYS=14,POLICY_CATALYST_DAYS=75,MAX_BROWSER_SECONDS=25")
replace_once(path,"          echo \"Calendar bootstrap: daily at 00:05 UTC\"\n", "          echo \"Calendar bootstrap: daily at 00:05 UTC\"\n          echo \"Policy-only catalyst horizon: 75 days; normal economic calendar remains 14 days\"\n")

path='src/components/PolicyEventResearchPanel.tsx'
replace_once(path,"type PolicyEconomy={economy:string;currency:string;centralBank:string;currentStance:string;dataPressure:number;currentPolicyEvidence:number;reactionGap:number;probabilities:{hike:number;hold:number;cut:number};pathPressure:{nextMeeting:number;threeMonth:number;sixMonth:number};nextMeeting:{event:string;date:string;forecast:string|null;previous:string|null}|null;scheduledDecisionEvents?:Array<{event:string;date:string;forecast:string|null;previous:string|null}>;sequenceTree?:SequenceTree;", "type PolicyMeeting={id?:string;event:string;date:string;forecast:string|null;previous:string|null;source?:string|null;providers?:string[];policyCatalystHorizonOnly?:boolean;policyProvenance?:{provider?:string;source?:string;retrievedAt?:string;windowStart?:string;windowEnd?:string}|null};\ntype PolicyEconomy={economy:string;currency:string;centralBank:string;currentStance:string;dataPressure:number;currentPolicyEvidence:number;reactionGap:number;probabilities:{hike:number;hold:number;cut:number};pathPressure:{nextMeeting:number;threeMonth:number;sixMonth:number};nextMeeting:PolicyMeeting|null;scheduledDecisionEvents?:PolicyMeeting[];sequenceTree?:SequenceTree;")
replace_once(path,"{row.nextMeeting&&<div className=\"policy-meeting\"><small>Next scheduled policy catalyst</small><span>{row.nextMeeting.event} · {new Date(row.nextMeeting.date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>}", "{row.nextMeeting&&<div className=\"policy-meeting\"><small>Next scheduled policy catalyst{row.nextMeeting.policyCatalystHorizonOnly?' · extended policy horizon':''}</small><span>{row.nextMeeting.event} · {new Date(row.nextMeeting.date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}{row.nextMeeting.source?` · ${row.nextMeeting.source}`:''}</span></div>}")

print('v4.18 policy catalyst horizon patch applied')
