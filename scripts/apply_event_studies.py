from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def replace_once(text,old,new,label):
    if old not in text: raise SystemExit(f'Patch anchor missing: {label}')
    return text.replace(old,new,1)
def regex_once(text,pattern,replacement,label):
    updated,count=re.subn(pattern,replacement,text,count=1,flags=re.S)
    if count!=1: raise SystemExit(f'Regex patch failed ({count}): {label}')
    return updated

server_path='cloud-run-collector/src/server-v2.js'
server=read(server_path)
server=replace_once(server,
    "import { TECHNICAL_ASSET_IDS, buildTechnicalSnapshot, updateTechnicalBars } from './technical-engine.js';",
    "import { TECHNICAL_ASSET_IDS, buildTechnicalSnapshot, updateTechnicalBars } from './technical-engine.js';\nimport { EVENT_STUDY_HORIZONS, buildEventStudyMeasurement, summarizeEventStudies, supportedEventStudyCurrency } from './event-study.js';",
    'event study import')
server=replace_once(server,
    "const marketBars = db.collection('fxga_market_bars');",
    "const marketBars = db.collection('fxga_market_bars');\nconst eventStudies = db.collection('fxga_event_studies');",
    'event study collection')
server=replace_once(server,
    "if (maxImportance===2) return [0,300,900,3600];",
    "if (maxImportance===2) return [0,300,900,3600,14400];",
    'medium impact 4h followup')

helper=r'''
async function nearestMarketSnapshotBefore(releaseAt) {
  if (!releaseAt) return null;
  const query=await marketSnapshots.where('capturedAt','<=',releaseAt).orderBy('capturedAt','desc').limit(1).get();
  return query.empty?null:query.docs[0].data();
}
async function publishEventStudyState() {
  const cutoff=new Date(Date.now()-7*86_400_000).toISOString();
  const snapshots=await eventStudies.where('releaseAt','>=',cutoff).limit(250).get();
  const studies=snapshots.docs.map((doc)=>doc.data()).sort((a,b)=>Date.parse(b.releaseAt||0)-Date.parse(a.releaseAt||0));
  const payload={generatedAt:new Date().toISOString(),days:7,summary:summarizeEventStudies(studies),studies};
  const saved=await putIfChanged('event-studies',payload);
  if(saved.changed)await signedWebhook('event-study-snapshot',payload);
  return {changed:saved.changed,studies:studies.length,summary:payload.summary};
}
async function captureEventStudies(events,releaseAt,offsetSeconds) {
  const horizon=EVENT_STUDY_HORIZONS[Number(offsetSeconds)];
  if(!horizon)return {captured:0,reason:'unsupported-horizon'};
  const eligible=events.filter((event)=>supportedEventStudyCurrency(event.currency)&&clean(event.actual)!==undefined);
  if(!eligible.length)return {captured:0,horizon,reason:'no-eligible-completed-events'};
  await syncCnbcMarket();
  const currentState=await getState('market');
  const current=currentState?.payload??null;
  const baseline=await nearestMarketSnapshotBefore(releaseAt||eligible[0]?.date);
  let captured=0,measured=0;
  for(const event of eligible){
    const measurement=buildEventStudyMeasurement(event,baseline,current,Number(offsetSeconds));
    if(!measurement)continue;
    const ref=eventStudies.doc(event.id);
    const existing=await ref.get();
    const previous=existing.exists?existing.data():{};
    const horizons={...(previous?.horizons||{}),[horizon]:measurement};
    await ref.set({
      eventId:event.id,event:event.event,currency:event.currency,country:event.country,category:event.category,importance:event.importance,
      releaseAt:event.date,actual:event.actual??null,forecast:event.forecast??null,previous:event.previous??null,revised:event.revised??null,
      currencyBias:event.currencyBias??'neutral',currencyBiasScore:event.currencyBiasScore??0,biasConfidence:event.biasConfidence??null,
      interpretationFamily:event.interpretationFamily??null,horizons,updatedAt:new Date().toISOString(),
    },{merge:true});
    captured+=1;if(measurement.quality==='measured')measured+=1;
  }
  const stateResult=await publishEventStudyState();
  return {captured,measured,horizon,baselineAt:baseline?.capturedAt??null,currentAt:current?.generatedAt??null,state:stateResult};
}
'''
server=replace_once(server,"async function releaseCheck({eventIds=[],releaseAt,offsetSeconds=0}) {",helper+"\nasync function releaseCheck({eventIds=[],releaseAt,offsetSeconds=0}) {",'event study helpers')

server=regex_once(server,
    r"async function releaseCheck\(\{eventIds=\[\],releaseAt,offsetSeconds=0\}\) \{.*?\n\}\n\nasync function getFredUniverse",
    r'''async function releaseCheck({eventIds=[],releaseAt,offsetSeconds=0}) {
  const calendarState=await getState('calendar'); const allEvents=calendarState?.payload?.events||[];
  const scheduled=allEvents.filter((event)=>eventIds.includes(event.id));
  if (!scheduled.length) return {changed:0,reason:'events-not-found'};
  const times=scheduled.map((event)=>Date.parse(event.date)).filter(Number.isFinite);
  const from=new Date(Math.min(...times)-10*60_000); const to=new Date(Math.max(...times)+10*60_000);
  let fresh=[]; try { fresh=await fetchFxstreet(from,to); } catch {}
  const changed=[];
  const next=allEvents.map((event)=>{
    if (!eventIds.includes(event.id)) return event;
    const candidate=fresh.find((item)=>item.currency===event.currency&&Math.abs(Date.parse(item.date)-Date.parse(event.date))<=120_000&&normalizeTitle(item.event)===normalizeTitle(event.event));
    if (!candidate) return event;
    const merged=enrichCalendarEvent({...event,actual:candidate.actual??event.actual,forecast:candidate.forecast??event.forecast,previous:candidate.previous??event.previous,revised:candidate.revised??event.revised,deviation:candidate.deviation??event.deviation,lastUpdate:candidate.lastUpdate??new Date().toISOString(),providers:[...new Set([...(event.providers||[]),'fxstreet'])]});
    if (eventFingerprint(merged)!==eventFingerprint(event)) changed.push(merged); return merged;
  });
  if (changed.length) {
    const snapshot={...calendarState.payload,generatedAt:new Date().toISOString(),events:next};
    await state.doc('calendar').set({hash:stableHash(snapshot),updatedAt:new Date().toISOString(),payload:snapshot});
    await db.collection('fxga_release_snapshots').doc(`${Date.now()}-${stableHash(eventIds.join(',')).slice(0,12)}`).set({releaseAt,offsetSeconds,changed,capturedAt:new Date().toISOString()});
    await persistCalendarHistory(changed);
    await signedWebhook('release-delta',{releaseAt,offsetSeconds,events:changed});
  }
  const studyEvents=next.filter((event)=>eventIds.includes(event.id));
  const eventStudy=EVENT_STUDY_HORIZONS[Number(offsetSeconds)]?await captureEventStudies(studyEvents,releaseAt,Number(offsetSeconds)):null;
  return {changed:changed.length,releaseAt,offsetSeconds,eventStudy};
}

async function getFredUniverse''',
    'release check event study integration')

server=replace_once(server,
    "const [calendar,macro,universe,market,technical]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe'),getState('market'),getState('technical')]);",
    "const [calendar,macro,universe,market,technical,eventStudyState]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe'),getState('market'),getState('technical'),getState('event-studies')]);",
    'health event studies')
server=replace_once(server,
    "technicalUpdatedAt:technical?.updatedAt??null,technicalAssets:Object.keys(technical?.payload?.assets||{}).length,fredUniverse:",
    "technicalUpdatedAt:technical?.updatedAt??null,technicalAssets:Object.keys(technical?.payload?.assets||{}).length,eventStudiesUpdatedAt:eventStudyState?.updatedAt??null,eventStudies:eventStudyState?.payload?.studies?.length??0,fredUniverse:",
    'health event study fields')
server=replace_once(server,
    "app.get('/technical',async(_req,res)=>{const technical=await getState('technical');res.json(technical?.payload??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}});});",
    "app.get('/technical',async(_req,res)=>{const technical=await getState('technical');res.json(technical?.payload??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}});});\napp.get('/event-studies',async(req,res)=>{const days=Math.min(7,Math.max(1,Number(req.query.days||7))),currency=String(req.query.currency||'').toUpperCase(),stored=await getState('event-studies'),cutoff=Date.now()-days*86_400_000;let studies=stored?.payload?.studies||[];studies=studies.filter((study)=>Date.parse(study.releaseAt)>=cutoff&&(!currency||study.currency===currency));res.json({generatedAt:stored?.payload?.generatedAt??null,days,currency:currency||null,summary:summarizeEventStudies(studies),studies});});",
    'private event study endpoint')
server=replace_once(server,
    "const [calendar,macro,sourceHealth,universe,market,technical]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe'),getState('market'),getState('technical')]);\n  res.json({calendar,macro,sourceHealth,fredUniverse:universe,market,technical});",
    "const [calendar,macro,sourceHealth,universe,market,technical,eventStudyState]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe'),getState('market'),getState('technical'),getState('event-studies')]);\n  res.json({calendar,macro,sourceHealth,fredUniverse:universe,market,technical,eventStudies:eventStudyState});",
    'state event studies')
write(server_path,server)

package_path='cloud-run-collector/package.json'
package=read(package_path)
package=replace_once(package,"node --check src/advanced-technical.js &&","node --check src/advanced-technical.js && node --check src/event-study.js &&",'event study syntax')
write(package_path,package)

worker_path='worker/index-v3.ts'
worker=read(worker_path)
worker=replace_once(worker,"const TECHNICAL_KEY='market:technical';","const TECHNICAL_KEY='market:technical';\nconst EVENT_STUDIES_KEY='research:event-studies';",'edge event study key')
worker=replace_once(worker,
    "else if(type==='technical-snapshot'){if(!payload?.assets||typeof payload.assets!=='object')throw new Error('technical-snapshot missing assets');await this.ctx.storage.put(TECHNICAL_KEY,payload);}",
    "else if(type==='technical-snapshot'){if(!payload?.assets||typeof payload.assets!=='object')throw new Error('technical-snapshot missing assets');await this.ctx.storage.put(TECHNICAL_KEY,payload);}\n    else if(type==='event-study-snapshot'){if(!Array.isArray(payload?.studies))throw new Error('event-study-snapshot missing studies');await this.ctx.storage.put(EVENT_STUDIES_KEY,payload);}",
    'edge event study webhook')
worker=replace_once(worker,
    "private async state(){const [calendar,macro,intelligence,market,technical,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(TECHNICAL_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);",
    "private async state(){const [calendar,macro,intelligence,market,technical,eventStudies,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(TECHNICAL_KEY),this.ctx.storage.get<Record<string,any>>(EVENT_STUDIES_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);",
    'edge state event study')
worker=replace_once(worker,"return {calendar,macro,intelligence,market,technical,meta,events,upcoming,active,recent,initialized:","return {calendar,macro,intelligence,market,technical,eventStudies,meta,events,upcoming,active,recent,initialized:",'edge state event study return')
worker=replace_once(worker,
    "if(url.pathname==='/api/technical')return json(s.technical??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}});",
    "if(url.pathname==='/api/technical')return json(s.technical??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}});\n      if(url.pathname==='/api/event-studies'){const days=Math.min(7,Math.max(1,Number(url.searchParams.get('days')||7))),currency=(url.searchParams.get('currency')||'').toUpperCase(),cutoff=Date.now()-days*86400000;let studies=Array.isArray(s.eventStudies?.studies)?s.eventStudies.studies:[];studies=studies.filter((study:any)=>Date.parse(study.releaseAt)>=cutoff&&(!currency||study.currency===currency));return json({generatedAt:s.eventStudies?.generatedAt??null,days,currency:currency||null,summary:s.eventStudies?.summary??{studies:studies.length,measuredHorizons:0,byHorizon:{}},studies});}",
    'public event study api')
write(worker_path,worker)
print('Event-study integration patch applied successfully.')
