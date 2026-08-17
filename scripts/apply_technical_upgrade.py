from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Patch anchor not found: {label}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Regex patch failed ({count} matches): {label}')
    return updated

# -------------------------------------------------------------------------------------------------
# Collector integration
# -------------------------------------------------------------------------------------------------
server_path = 'cloud-run-collector/src/server-v2.js'
server = read(server_path)

server = replace_once(
    server,
    "import { collectCnbcMarket } from './cnbc-market.js';",
    "import { collectCnbcMarket } from './cnbc-market.js';\nimport { TECHNICAL_ASSET_IDS, buildTechnicalSnapshot, updateTechnicalBars } from './technical-engine.js';",
    'collector technical import',
)

server = replace_once(
    server,
    "const marketSnapshots = db.collection('fxga_market_snapshots');",
    "const marketSnapshots = db.collection('fxga_market_snapshots');\nconst marketBars = db.collection('fxga_market_bars');",
    'market bars collection',
)

market_task_code = r'''
async function createMarketPulseTask(scheduleAt) {
  if (!cfg.projectId||!cfg.serviceUrl||!cfg.taskInvokerSa) return {created:false,reason:'tasks-not-configured'};
  const when = new Date(scheduleAt);
  if (!Number.isFinite(when.getTime()) || when.getTime() < Date.now()-5000) return {created:false,reason:'past'};
  const parent=tasks.queuePath(cfg.projectId,cfg.region,cfg.taskQueue);
  const key=when.toISOString().slice(0,16).replace(/[-:T]/g,'');
  const taskName=tasks.taskPath(cfg.projectId,cfg.region,cfg.taskQueue,`market-${key}`);
  try {
    await tasks.createTask({parent,task:{name:taskName,scheduleTime:{seconds:Math.floor(when.getTime()/1000)},httpRequest:{httpMethod:'POST',url:`${cfg.serviceUrl}/market-sync`,headers:{'Content-Type':'application/json'},body:Buffer.from('{}'),oidcToken:{serviceAccountEmail:cfg.taskInvokerSa,audience:cfg.serviceUrl}}}});
    return {created:true};
  } catch(error) { if (Number(error?.code)===6) return {created:false,reason:'exists'}; throw error; }
}
async function scheduleMarketPulseTasks({hours=26,intervalMinutes=15}={}) {
  const intervalMs=Math.max(5,intervalMinutes)*60_000;
  const start=Math.ceil((Date.now()+60_000)/intervalMs)*intervalMs;
  const end=Date.now()+Math.max(1,hours)*3_600_000;
  let created=0,existing=0,skippedClosed=0;
  for (let timestamp=start;timestamp<=end;timestamp+=intervalMs) {
    const when=new Date(timestamp),day=when.getUTCDay();
    // High-frequency technical sampling is limited to the normal Monday-Friday market week.
    if (day===0||day===6) { skippedClosed+=1; continue; }
    const result=await createMarketPulseTask(when);
    if (result.created) created+=1;
    else if (result.reason==='exists') existing+=1;
  }
  return {intervalMinutes:Math.max(5,intervalMinutes),hours,created,existing,skippedClosed};
}
'''
server = replace_once(server, "async function signedWebhook(type,payload) {", market_task_code + "\nasync function signedWebhook(type,payload) {", 'market pulse scheduler')

technical_update_code = r'''
async function updateTechnicalMarket(snapshot) {
  const refs=TECHNICAL_ASSET_IDS.map((id)=>marketBars.doc(id));
  const documents=await db.getAll(...refs);
  let states=Object.fromEntries(documents.filter((doc)=>doc.exists).map((doc)=>[doc.id,doc.data()]));
  const hasHistory=Object.values(states).some((value)=>Object.values(value?.bars||{}).some((bars)=>Array.isArray(bars)&&bars.length>=8));
  if (!hasHistory) {
    try {
      const historical=await marketSnapshots.orderBy('capturedAt','asc').limitToLast(1000).get();
      for (const document of historical.docs) {
        const payload=document.data();
        if (!payload?.capturedAt||!Array.isArray(payload?.assets)) continue;
        states=updateTechnicalBars(states,{generatedAt:payload.capturedAt,assets:payload.assets});
      }
    } catch(error) {
      console.warn('Technical history bootstrap skipped:',String(error?.message||error).slice(0,240));
    }
  }
  states=updateTechnicalBars(states,snapshot);
  const batch=db.batch();
  for (const id of TECHNICAL_ASSET_IDS) batch.set(marketBars.doc(id),states[id],{merge:false});
  await batch.commit();
  const technical=buildTechnicalSnapshot(states,snapshot.generatedAt);
  const saved=await putIfChanged('technical',technical);
  if (saved.changed) await signedWebhook('technical-snapshot',technical);
  return {changed:saved.changed,counts:technical.counts,generatedAt:technical.generatedAt};
}
'''
server = replace_once(server, "async function syncCnbcMarket() {", technical_update_code + "\nasync function syncCnbcMarket() {", 'technical state updater')

server = regex_once(
    server,
    r"async function syncCnbcMarket\(\) \{.*?\n\}\nasync function bootstrapCalendar",
    r'''async function syncCnbcMarket() {
  const fresh = await collectCnbcMarket({ maxBrowserSeconds:cfg.maxBrowserSeconds });
  const previousState = await getState('market');
  const previousById = new Map((previousState?.payload?.assets || []).map((asset) => [asset.id, asset]));
  let staleRetained = 0;
  const assets = fresh.assets.map((asset) => {
    if (asset.price != null) return asset;
    const previous = previousById.get(asset.id);
    if (previous?.price == null) return asset;
    staleRetained += 1;
    return { ...previous, stale:true, staleSince:previous.staleSince || previous.fetchedAt || previousState?.updatedAt || null, lastAttemptAt:asset.fetchedAt, lastAttemptMode:asset.mode, error:asset.error || 'Market refresh returned no usable price; retained last verified value.' };
  });
  const snapshot = { ...fresh, generatedAt:new Date().toISOString(), assets, live:assets.filter((asset)=>asset.price!=null&&!asset.stale).length, staleRetained, failed:assets.filter((asset)=>asset.price==null).length };
  const saved = await putIfChanged('market', snapshot);
  const historyId = snapshot.generatedAt.slice(0,16).replace(/[-:T]/g,'');
  await marketSnapshots.doc(historyId).set({ capturedAt:snapshot.generatedAt, source:'CNBC', assets:assets.map(({error,...asset})=>asset) }, { merge:true });
  if (saved.changed) await signedWebhook('market-snapshot', snapshot);
  const technical=await updateTechnicalMarket(snapshot).catch((error)=>({error:String(error?.message||error).slice(0,300)}));
  return { changed:saved.changed, requested:snapshot.requested, live:snapshot.live, staleRetained:snapshot.staleRetained, failed:snapshot.failed, durationMs:snapshot.durationMs, technical };
}
async function bootstrapCalendar''',
    'replace market sync',
)

server = replace_once(
    server,
    "const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events);",
    "const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events); const marketPulse=await scheduleMarketPulseTasks();",
    'bootstrap market pulse',
)
server = replace_once(
    server,
    "return {events:events.length,changed:saved.changed,scheduled,history,sourceHealth,market};",
    "return {events:events.length,changed:saved.changed,scheduled,marketPulse,history,sourceHealth,market};",
    'bootstrap return market pulse',
)

server = replace_once(
    server,
    "const [calendar,macro,universe,market]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe'),getState('market')]);",
    "const [calendar,macro,universe,market,technical]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe'),getState('market'),getState('technical')]);",
    'health technical state',
)
server = replace_once(
    server,
    "marketUpdatedAt:market?.updatedAt??null,marketAssets:market?.payload?.assets?.length??0,fredUniverse:",
    "marketUpdatedAt:market?.updatedAt??null,marketAssets:market?.payload?.assets?.length??0,technicalUpdatedAt:technical?.updatedAt??null,technicalAssets:Object.keys(technical?.payload?.assets||{}).length,fredUniverse:",
    'health technical fields',
)

server = replace_once(
    server,
    "app.get('/market',async(_req,res)=>{const market=await getState('market');res.json(market?.payload??{generatedAt:null,source:'CNBC',assets:[]});});",
    "app.get('/market',async(_req,res)=>{const market=await getState('market');res.json(market?.payload??{generatedAt:null,source:'CNBC',assets:[]});});\napp.get('/technical',async(_req,res)=>{const technical=await getState('technical');res.json(technical?.payload??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}});});",
    'technical endpoint',
)

server = replace_once(
    server,
    "const [calendar,macro,sourceHealth,universe,market]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe'),getState('market')]);\n  res.json({calendar,macro,sourceHealth,fredUniverse:universe,market});",
    "const [calendar,macro,sourceHealth,universe,market,technical]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe'),getState('market'),getState('technical')]);\n  res.json({calendar,macro,sourceHealth,fredUniverse:universe,market,technical});",
    'collector state technical',
)
write(server_path, server)

# Add technical engine to the collector syntax gate.
package_path='cloud-run-collector/package.json'
package=read(package_path)
package=replace_once(package,"node --check src/cnbc-market.js &&","node --check src/cnbc-market.js && node --check src/technical-engine.js &&",'technical syntax gate')
write(package_path,package)

# -------------------------------------------------------------------------------------------------
# Passive edge state and APIs
# -------------------------------------------------------------------------------------------------
worker_path='worker/index-v3.ts'
worker=read(worker_path)
worker=replace_once(worker,"const MARKET_KEY='google:market';","const MARKET_KEY='google:market';\nconst TECHNICAL_KEY='market:technical';",'worker technical key')
worker=replace_once(worker,"else if(type==='market-snapshot'){if(!Array.isArray(payload?.assets))throw new Error('market-snapshot missing assets');await this.ctx.storage.put(MARKET_KEY,payload);}","else if(type==='market-snapshot'){if(!Array.isArray(payload?.assets))throw new Error('market-snapshot missing assets');await this.ctx.storage.put(MARKET_KEY,payload);}\n    else if(type==='technical-snapshot'){if(!payload?.assets||typeof payload.assets!=='object')throw new Error('technical-snapshot missing assets');await this.ctx.storage.put(TECHNICAL_KEY,payload);}",'worker technical webhook')
worker=replace_once(worker,"private async state(){const [calendar,macro,intelligence,market,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);","private async state(){const [calendar,macro,intelligence,market,technical,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(TECHNICAL_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);",'worker state Promise')
worker=replace_once(worker,"return {calendar,macro,intelligence,market,meta,events,upcoming,active,recent,initialized:","return {calendar,macro,intelligence,market,technical,meta,events,upcoming,active,recent,initialized:",'worker state return')

worker=replace_once(worker,"if(url.pathname==='/api/market-prices')return json(s.market??{generatedAt:null,source:'CNBC',assets:[]});","if(url.pathname==='/api/market-prices')return json(s.market??{generatedAt:null,source:'CNBC',assets:[]});\n      if(url.pathname==='/api/technical')return json(s.technical??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}});\n      if(url.pathname==='/api/technical-history'){const asset=(url.searchParams.get('asset')||'EURUSD').toUpperCase(),timeframe=(url.searchParams.get('timeframe')||'H1').toUpperCase();const item=s.technical?.assets?.[asset],frame=item?.timeframes?.[timeframe];return frame?json({generatedAt:s.technical?.generatedAt??null,asset,timeframe,bias:frame.bias,quality:frame.quality,history:frame.history??[]}):error('Technical history is not available for the requested asset/timeframe',404);}",'worker technical routes')

old_signal="if(url.pathname==='/api/session-signals')return intel?.sessionSignals?json({...intel.sessionSignals,collectorMode:'google-cloud-run-webhook',economyObservationCount:observations.length}):error('Currency outlook is not initialized',503);"
new_signal="""if(url.pathname==='/api/session-signals'){if(!intel?.sessionSignals)return error('Currency outlook is not initialized',503);const technicalAssets=s.technical?.assets??{};const sessions=(intel.sessionSignals.sessions??[]).map((session:any)=>({...session,signals:(session.signals??[]).map((signal:any)=>{const technical=technicalAssets[String(signal.symbol||'').toUpperCase()]??null;const gate=technical?.decisionGate??null;const macroDirection=String(signal.direction||'WAIT').toUpperCase();const technicalAligned=gate?.status==='confirmed'&&((macroDirection==='BUY'&&gate.direction==='bullish')||(macroDirection==='SELL'&&gate.direction==='bearish'));return {...signal,technicalGate:gate?.status??'warming',technicalBias:gate?.direction??'neutral',technicalConfidence:Number(gate?.confidence??0),technicalModel:gate?.model??null,technicalReason:gate?.reason??'Awaiting verified price history.',executionGate:macroDirection==='WAIT'?'NO_DIRECTIONAL_EXECUTION':technicalAligned?'TECHNICAL_CONFIRMATION_PASSED':'AWAIT_TECHNICAL_CONFIRMATION'};})}));return json({...intel.sessionSignals,sessions,economyObservationCount:observations.length,technicalGeneratedAt:s.technical?.generatedAt??null});}"""
worker=replace_once(worker,old_signal,new_signal,'session technical overlay')
write(worker_path,worker)

print('Technical engine integration patch applied successfully.')
