import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Patch anchor not found: ${label}`);
  return text.replace(from, to);
}

const serverPath = 'cloud-run-collector/src/server-v2.js';
let server = fs.readFileSync(serverPath, 'utf8');

server = replaceOnce(
  server,
  "import { FRED_BASE_IDS, FAST_FRED_IDS, discoverGlobalFredUniverse, summarizeUniverse } from './global-fred.js';",
  "import { FRED_BASE_IDS, FAST_FRED_IDS, discoverGlobalFredUniverse, summarizeUniverse } from './global-fred.js';\nimport { collectCnbcMarket } from './cnbc-market.js';",
  'CNBC market import',
);

server = replaceOnce(
  server,
  "const state = db.collection('fxga_collector_state');\nconst UNIVERSE_TTL_MS = 7 * 86_400_000;",
  "const state = db.collection('fxga_collector_state');\nconst calendarHistory = db.collection('fxga_calendar_history');\nconst marketSnapshots = db.collection('fxga_market_snapshots');\nconst UNIVERSE_TTL_MS = 7 * 86_400_000;\nconst CALENDAR_HISTORY_DAYS = 7;",
  'Firestore collections',
);

const biasHelpers = String.raw`
function economicNumber(value) {
  let text = clean(value)?.replace(/,/g,'').replace(/\s/g,'');
  if (!text) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1,-1); }
  const match = text.match(/^([+-]?\d*\.?\d+)([KMBT])?%?$/i);
  if (!match) return undefined;
  const suffix = (match[2] || '').toUpperCase();
  const multiplier = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1;
  const parsed = Number(match[1]) * multiplier;
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -parsed : parsed;
}
function eventBiasRule(name='') {
  const title = normalizeTitle(name);
  if (/unemployment rate|jobless claims|initial claims|continuing claims|claimant count|unemployment claims|layoffs|redundanc/.test(title)) return { direction:'lower', family:'labour-slack', explanation:'Lower labour-market slack/claims is normally supportive for the base currency.' };
  if (/cpi|consumer price|ppi|producer price|pce price|inflation rate|inflation expectation|average hourly earnings|wage|earnings growth/.test(title)) return { direction:'higher', family:'policy-inflation', explanation:'A hotter-than-expected inflation/wage release normally supports the base currency through a more hawkish rates path.' };
  if (/interest rate|cash rate|repo rate|bank rate|refinancing rate|deposit facility|fed funds|policy rate/.test(title)) return { direction:'higher', family:'policy-rate', explanation:'A higher-than-expected policy rate is normally supportive for the base currency.' };
  if (/trade balance|current account|exports/.test(title)) return { direction:'higher', family:'external-balance', explanation:'A stronger external balance is normally supportive for the base currency.' };
  if (/gdp|retail sales|industrial production|manufacturing production|pmi|employment change|nonfarm payroll|nfp|consumer confidence|business confidence|building permits|housing starts|durable goods|factory orders|services|manufacturing|economic sentiment|business activity|capacity utilization|productivity/.test(title)) return { direction:'higher', family:'growth-activity', explanation:'A stronger-than-expected growth/activity release is normally supportive for the base currency.' };
  return { direction:'context', family:'context-sensitive', explanation:'This release is context-sensitive; FXGA will not force a directional currency label without a supported rule.' };
}
function classifyCurrencyBias(event) {
  const actual = economicNumber(event.actual);
  const forecast = economicNumber(event.forecast);
  const previous = economicNumber(event.revised ?? event.previous);
  const rule = eventBiasRule(event.event);
  if (actual === undefined) return { currencyBias:'pending', currencyBiasScore:0, biasConfidence:0, currencyBiasReason:'Actual result is not available yet.', comparisonBasis:'none' };
  const reference = forecast !== undefined ? forecast : previous;
  const comparisonBasis = forecast !== undefined ? 'forecast' : previous !== undefined ? 'previous' : 'none';
  if (reference === undefined) return { currencyBias:'neutral', currencyBiasScore:0, biasConfidence:25, currencyBiasReason:`${rule.explanation} No numeric consensus/previous value is available for comparison.`, comparisonBasis };
  if (rule.direction === 'context') return { currencyBias:'neutral', currencyBiasScore:0, biasConfidence:35, currencyBiasReason:rule.explanation, comparisonBasis };
  const difference = actual - reference;
  const tolerance = Math.max(1e-9, Math.abs(reference) * 0.0001);
  if (Math.abs(difference) <= tolerance) return { currencyBias:'neutral', currencyBiasScore:0, biasConfidence:70, currencyBiasReason:`Result is effectively in line with ${comparisonBasis}. ${rule.explanation}`, comparisonBasis };
  const positiveSurprise = difference > 0;
  const bullish = rule.direction === 'higher' ? positiveSurprise : !positiveSurprise;
  const magnitude = Math.abs(difference) / Math.max(Math.abs(reference), 1e-9);
  const importanceBoost = Number(event.importance || 1) >= 3 ? 12 : Number(event.importance || 1) === 2 ? 6 : 0;
  const biasConfidence = Math.max(45, Math.min(96, Math.round(62 + importanceBoost + Math.min(22, magnitude * 180))));
  return {
    currencyBias: bullish ? 'bullish' : 'bearish',
    currencyBiasScore: bullish ? 1 : -1,
    biasConfidence,
    currencyBiasReason:`Actual ${actual} vs ${comparisonBasis} ${reference}. ${rule.explanation}`,
    comparisonBasis,
    surpriseValue:difference,
    surprisePercent: reference === 0 ? undefined : (difference / Math.abs(reference)) * 100,
    interpretationFamily:rule.family,
  };
}
function enrichCalendarEvent(event) {
  const bias = classifyCurrencyBias(event);
  const actual = economicNumber(event.actual), forecast = economicNumber(event.forecast);
  const outcome = actual === undefined ? 'pending' : forecast === undefined ? 'no-consensus' : actual > forecast ? 'beat' : actual < forecast ? 'miss' : 'in-line';
  return { ...event, ...bias, outcome, betterThanExpected:bias.currencyBias === 'bullish', worseThanExpected:bias.currencyBias === 'bearish' };
}
async function persistCalendarHistory(events) {
  const now = Date.now(), cutoff = now - CALENDAR_HISTORY_DAYS * 86_400_000;
  const completed = events.filter((event) => {
    const time = Date.parse(event.date);
    return Number.isFinite(time) && time <= now && time >= cutoff && clean(event.actual) !== undefined;
  });
  for (let index = 0; index < completed.length; index += 400) {
    const batch = db.batch();
    for (const event of completed.slice(index, index + 400)) {
      batch.set(calendarHistory.doc(event.id), { ...event, archivedAt:new Date().toISOString(), retentionWindowDays:CALENDAR_HISTORY_DAYS }, { merge:true });
    }
    await batch.commit();
  }
  return { persisted:completed.length, historyDays:CALENDAR_HISTORY_DAYS };
}
`;

server = replaceOnce(
  server,
  "function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }",
  `${biasHelpers}\nfunction record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }`,
  'calendar bias engine',
);

const marketSync = String.raw`
async function syncCnbcMarket() {
  const fresh = await collectCnbcMarket({ maxBrowserSeconds:cfg.maxBrowserSeconds });
  const previousState = await getState('market');
  const previousById = new Map((previousState?.payload?.assets || []).map((asset) => [asset.id, asset]));
  let staleRetained = 0;
  const assets = fresh.assets.map((asset) => {
    if (asset.price != null) return asset;
    const previous = previousById.get(asset.id);
    if (previous?.price == null) return asset;
    staleRetained += 1;
    return { ...previous, stale:true, staleSince:previous.staleSince || previous.fetchedAt || previousState?.updatedAt || null, lastAttemptAt:asset.fetchedAt, lastAttemptMode:asset.mode, error:asset.error || 'CNBC refresh returned no usable price; retained last good value.' };
  });
  const snapshot = { ...fresh, generatedAt:new Date().toISOString(), assets, live:assets.filter((asset)=>asset.price!=null&&!asset.stale).length, staleRetained, failed:assets.filter((asset)=>asset.price==null).length };
  const saved = await putIfChanged('market', snapshot);
  const historyId = snapshot.generatedAt.slice(0,16).replace(/[-:T]/g,'');
  await marketSnapshots.doc(historyId).set({ capturedAt:snapshot.generatedAt, source:'CNBC', assets:assets.map(({error,...asset})=>asset) }, { merge:true });
  if (saved.changed) await signedWebhook('market-snapshot', snapshot);
  return { changed:saved.changed, requested:snapshot.requested, live:snapshot.live, staleRetained:snapshot.staleRetained, failed:snapshot.failed, durationMs:snapshot.durationMs };
}
`;

server = replaceOnce(
  server,
  "async function bootstrapCalendar() {",
  `${marketSync}\nasync function bootstrapCalendar() {`,
  'market synchronization function',
);

server = replaceOnce(
  server,
  "  const now=new Date(); const to=new Date(now.getTime()+cfg.calendarDays*86_400_000);\n  const [fxstreetResult,myfxbook,cnbc]=await Promise.allSettled([fetchFxstreet(now,to),scrapeMyfxbook(),scrapeCnbc()]);",
  "  const now=new Date(); const from=new Date(now.getTime()-CALENDAR_HISTORY_DAYS*86_400_000); const to=new Date(now.getTime()+cfg.calendarDays*86_400_000);\n  const [fxstreetResult,myfxbook,cnbc]=await Promise.allSettled([fetchFxstreet(from,to),scrapeMyfxbook(),scrapeCnbc()]);",
  'seven day calendar fetch window',
);

server = replaceOnce(
  server,
  "  const events=mergeEvents(fxstreet,myfx.events||[]).filter((event)=>Date.parse(event.date)<=to.getTime());",
  "  const events=mergeEvents(fxstreet,myfx.events||[]).map(enrichCalendarEvent).filter((event)=>Date.parse(event.date)>=from.getTime()&&Date.parse(event.date)<=to.getTime());",
  'calendar event enrichment',
);

server = replaceOnce(
  server,
  "  const snapshot={generatedAt:new Date().toISOString(),days:cfg.calendarDays,targetEconomies:TARGET_ECONOMIES,events,sourceHealth,cnbcContext:cnbcResult.items||[]};\n  const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events);",
  "  const snapshot={generatedAt:new Date().toISOString(),days:cfg.calendarDays,historyDays:CALENDAR_HISTORY_DAYS,windowStart:from.toISOString(),windowEnd:to.toISOString(),targetEconomies:TARGET_ECONOMIES,events,sourceHealth,cnbcContext:cnbcResult.items||[]};\n  const history=await persistCalendarHistory(events);\n  const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events);",
  'calendar history persistence',
);

server = replaceOnce(
  server,
  "  return {events:events.length,changed:saved.changed,scheduled,sourceHealth};",
  "  const market=await syncCnbcMarket().catch((error)=>({error:String(error?.message||error).slice(0,300)}));\n  return {events:events.length,changed:saved.changed,scheduled,history,sourceHealth,market};",
  'bootstrap market result',
);

server = replaceOnce(
  server,
  "    const merged={...event,actual:candidate.actual??event.actual,forecast:candidate.forecast??event.forecast,previous:candidate.previous??event.previous,revised:candidate.revised??event.revised,deviation:candidate.deviation??event.deviation,lastUpdate:candidate.lastUpdate??new Date().toISOString(),providers:[...new Set([...(event.providers||[]),'fxstreet'])]};",
  "    const merged=enrichCalendarEvent({...event,actual:candidate.actual??event.actual,forecast:candidate.forecast??event.forecast,previous:candidate.previous??event.previous,revised:candidate.revised??event.revised,deviation:candidate.deviation??event.deviation,lastUpdate:candidate.lastUpdate??new Date().toISOString(),providers:[...new Set([...(event.providers||[]),'fxstreet'])]});",
  'release bias refresh',
);

server = replaceOnce(
  server,
  "  await state.collection('release_snapshots').doc(`${Date.now()}-${stableHash(eventIds.join(',')).slice(0,12)}`).set({releaseAt,offsetSeconds,changed,capturedAt:new Date().toISOString()});",
  "  await db.collection('fxga_release_snapshots').doc(`${Date.now()}-${stableHash(eventIds.join(',')).slice(0,12)}`).set({releaseAt,offsetSeconds,changed,capturedAt:new Date().toISOString()});\n  await persistCalendarHistory(changed);",
  'release snapshot collection fix',
);

server = replaceOnce(
  server,
  "app.get('/health',async(_req,res)=>{\n  const [calendar,macro,universe]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe')]);\n  res.json({ok:true,service:'fxga-cloud-run-collector',version:2,projectConfigured:Boolean(cfg.projectId),tasksConfigured:Boolean(cfg.serviceUrl&&cfg.taskInvokerSa),webhookConfigured:Boolean(cfg.webhookSecret&&cfg.webhookUrl),fredConfigured:Boolean(cfg.fredApiKey),calendarUpdatedAt:calendar?.updatedAt??null,macroUpdatedAt:macro?.updatedAt??null,fredUniverse:universe?.payload?.summary??{curatedBase:FRED_BASE_IDS.length},targetEconomies:TARGET_ECONOMIES,mode:'event-driven-cloud-run'});\n});",
  "app.get('/health',async(_req,res)=>{\n  const [calendar,macro,universe,market]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe'),getState('market')]);\n  res.json({ok:true,service:'fxga-cloud-run-collector',version:2,projectConfigured:Boolean(cfg.projectId),tasksConfigured:Boolean(cfg.serviceUrl&&cfg.taskInvokerSa),webhookConfigured:Boolean(cfg.webhookSecret&&cfg.webhookUrl),fredConfigured:Boolean(cfg.fredApiKey),calendarUpdatedAt:calendar?.updatedAt??null,macroUpdatedAt:macro?.updatedAt??null,marketUpdatedAt:market?.updatedAt??null,marketAssets:market?.payload?.assets?.length??0,fredUniverse:universe?.payload?.summary??{curatedBase:FRED_BASE_IDS.length},targetEconomies:TARGET_ECONOMIES,mode:'event-driven-cloud-run'});\n});",
  'health market status',
);

server = replaceOnce(
  server,
  "app.post('/macro-sync',async(req,res,next)=>{try{res.json(await syncFred(req.query.mode||req.body?.mode||'fast'));}catch(error){next(error);}});",
  "app.post('/macro-sync',async(req,res,next)=>{try{const [macro,market]=await Promise.all([syncFred(req.query.mode||req.body?.mode||'fast'),syncCnbcMarket()]);res.json({...macro,market});}catch(error){next(error);}});\napp.post('/market-sync',async(_req,res,next)=>{try{res.json(await syncCnbcMarket());}catch(error){next(error);}});\napp.get('/market',async(_req,res)=>{const market=await getState('market');res.json(market?.payload??{generatedAt:null,source:'CNBC',assets:[]});});\napp.get('/calendar-history',async(req,res)=>{const days=Math.min(7,Math.max(1,Number(req.query.days||7)));const calendar=await getState('calendar');const now=Date.now(),cutoff=now-days*86_400_000;const events=(calendar?.payload?.events||[]).filter((event)=>{const time=Date.parse(event.date);return Number.isFinite(time)&&time<=now&&time>=cutoff;});res.json({generatedAt:calendar?.payload?.generatedAt??null,days,events});});",
  'market and calendar history routes',
);

server = replaceOnce(
  server,
  "app.get('/state',async(_req,res)=>{\n  const [calendar,macro,sourceHealth,universe]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe')]);\n  res.json({calendar,macro,sourceHealth,fredUniverse:universe});\n});",
  "app.get('/state',async(_req,res)=>{\n  const [calendar,macro,sourceHealth,universe,market]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe'),getState('market')]);\n  res.json({calendar,macro,sourceHealth,fredUniverse:universe,market});\n});",
  'collector state market data',
);

fs.writeFileSync(serverPath, server);

const workerPath = 'worker/index-v3.ts';
let worker = fs.readFileSync(workerPath, 'utf8');

worker = replaceOnce(
  worker,
  "const INTELLIGENCE_KEY='google:intelligence';\nconst META_KEY='google:meta';",
  "const INTELLIGENCE_KEY='google:intelligence';\nconst MARKET_KEY='google:market';\nconst META_KEY='google:meta';",
  'worker market storage key',
);

worker = replaceOnce(
  worker,
  "    else if(type==='macro-snapshot'){const observations:MacroObservation[]=(Array.isArray(payload?.observations)?payload.observations:[]).filter((x:any)=>x?.seriesId).map(normalizeObservation);if(!observations.length)throw new Error('macro-snapshot missing observations');await this.ctx.storage.put(MACRO_KEY,{...payload,observations});}\n    else if(type==='intelligence-snapshot')",
  "    else if(type==='macro-snapshot'){const observations:MacroObservation[]=(Array.isArray(payload?.observations)?payload.observations:[]).filter((x:any)=>x?.seriesId).map(normalizeObservation);if(!observations.length)throw new Error('macro-snapshot missing observations');await this.ctx.storage.put(MACRO_KEY,{...payload,observations});}\n    else if(type==='market-snapshot'){if(!Array.isArray(payload?.assets))throw new Error('market-snapshot missing assets');await this.ctx.storage.put(MARKET_KEY,payload);}\n    else if(type==='intelligence-snapshot')",
  'market webhook handler',
);

worker = replaceOnce(
  worker,
  "  private async state(){const [calendar,macro,intelligence,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);const events=Array.isArray(calendar?.events)?calendar!.events as CalendarEvent[]:[];",
  "  private async state(){const [calendar,macro,intelligence,market,meta]=await Promise.all([this.ctx.storage.get<Record<string,any>>(CALENDAR_KEY),this.ctx.storage.get<Record<string,any>>(MACRO_KEY),this.ctx.storage.get<Record<string,any>>(INTELLIGENCE_KEY),this.ctx.storage.get<Record<string,any>>(MARKET_KEY),this.ctx.storage.get<Record<string,any>>(META_KEY)]);const events=Array.isArray(calendar?.events)?calendar!.events as CalendarEvent[]:[];",
  'worker state market read',
);

worker = replaceOnce(
  worker,
  "return {calendar,macro,intelligence,meta,events,upcoming,active,recent,initialized:Boolean(events.length&&(macro?.observations?.length||intelligence?.globalMacro?.totalObservations))};}",
  "return {calendar,macro,intelligence,market,meta,events,upcoming,active,recent,initialized:Boolean(events.length&&(macro?.observations?.length||intelligence?.globalMacro?.totalObservations))};}",
  'worker state market return',
);

worker = replaceOnce(
  worker,
  "if(url.pathname==='/api/dashboard'){const now=Date.now(),calendar=events.filter(e=>Date.parse(e.date)>=now-6*3600000).slice(0,150);return json({generatedAt:intel?.generatedAt??s.meta?.lastWebhookAt??new Date().toISOString(),macro:observations.slice(0,80),calendar,news:intel?.news??[],sources:SOURCE_VIEW,errors:[]});}",
  "if(url.pathname==='/api/dashboard'){const now=Date.now(),calendar=events.filter(e=>Date.parse(e.date)>=now-7*86400000).slice(0,600);return json({generatedAt:intel?.generatedAt??s.meta?.lastWebhookAt??new Date().toISOString(),macro:observations.slice(0,80),calendar,market:Array.isArray(s.market?.assets)?s.market.assets:[],news:intel?.news??[],sources:SOURCE_VIEW,errors:[]});}",
  'dashboard history and market payload',
);

worker = replaceOnce(
  worker,
  "      if(url.pathname==='/api/global-macro')return json(intel?.globalMacro??groupMacro(observations,s.macro?.generatedAt??null));",
  "      if(url.pathname==='/api/global-macro')return json(intel?.globalMacro??groupMacro(observations,s.macro?.generatedAt??null));\n      if(url.pathname==='/api/market-prices')return json(s.market??{generatedAt:null,source:'CNBC',assets:[]});\n      if(url.pathname==='/api/calendar-history'){const days=Math.min(7,Math.max(1,Number(url.searchParams.get('days')||7))),now=Date.now(),cutoff=now-days*86400000;return json({generatedAt:s.calendar?.generatedAt??null,days,events:events.filter(e=>{const time=Date.parse(e.date);return Number.isFinite(time)&&time<=now&&time>=cutoff;})});}",
  'public market and history endpoints',
);

fs.writeFileSync(workerPath, worker);
console.log('FXGA data upgrade patch applied successfully.');
