import crypto from 'node:crypto';
import express from 'express';
import { load as loadHtml } from 'cheerio';
import { chromium } from 'playwright';
import { Firestore } from '@google-cloud/firestore';
import { CloudTasksClient } from '@google-cloud/tasks';
import { FRED_BASE_IDS, FAST_FRED_IDS, discoverGlobalFredUniverse, summarizeUniverse } from './global-fred.js';

const app = express();
app.use(express.json({ limit: '3mb' }));

const cfg = {
  port: Number(process.env.PORT || 8080),
  projectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
  region: process.env.GCP_REGION || 'us-central1',
  serviceUrl: (process.env.CLOUD_RUN_SERVICE_URL || '').replace(/\/$/, ''),
  taskQueue: process.env.CLOUD_TASKS_QUEUE || 'fxga-release-checks',
  taskInvokerSa: process.env.CLOUD_TASKS_INVOKER_SA || '',
  webhookUrl: process.env.CLOUDFLARE_WEBHOOK_URL || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev/api/collector-webhook',
  webhookSecret: process.env.COLLECTOR_WEBHOOK_SECRET || '',
  fredApiKey: process.env.FRED_API_KEY || '',
  calendarDays: Math.min(Math.max(Number(process.env.CALENDAR_DAYS || 14), 2), 30),
  maxBrowserSeconds: Math.min(Math.max(Number(process.env.MAX_BROWSER_SECONDS || 25), 5), 45),
  globalFredTarget: Math.min(Math.max(Number(process.env.GLOBAL_FRED_TARGET || 180), 110), 220),
};

const db = new Firestore();
const tasks = new CloudTasksClient();
const state = db.collection('fxga_collector_state');
const UNIVERSE_TTL_MS = 7 * 86_400_000;
const MAX_FRED_CONCURRENCY = 8;

const TARGET_ECONOMIES = ['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN'];
const COUNTRY_CURRENCY = {
  US:'USD', USA:'USD', UK:'GBP', GB:'GBP', EMU:'EUR', EU:'EUR', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR',
  JP:'JPY', ZA:'ZAR', CA:'CAD', AU:'AUD', NZ:'NZD', CH:'CHF', CN:'CNY',
};
const FXSTREET_COUNTRIES = ['US','UK','EMU','DE','FR','IT','ES','JP','ZA'];
const FXSTREET_CATEGORIES = [
  '8896AA26-A50C-4F8B-AA11-8B3FCCDA1DFD','FA6570F6-E494-4563-A363-00D0F2ABEC37',
  'C94405B5-5F85-4397-AB11-002A481C4B92','E229C890-80FC-40F3-B6F4-B658F3A02635',
  '24127F3B-EDCE-4DC4-AFDF-0B3BD8A964BE','E9E957EC-2927-4A77-AE0C-F5E4B5807C16',
  '91DA97BD-D94A-4CE8-A02B-B96EE2944E4C',
];

const OFFICIAL_SOURCE_REGISTRY = [
  { economy:'USA', authorities:['Federal Reserve','BLS','BEA','U.S. Treasury','EIA'], coverage:['policy','inflation','labour','GDP','income','liquidity','energy'] },
  { economy:'EUROPE', authorities:['ECB','Eurostat','European Commission','Destatis'], coverage:['policy','inflation','GDP','labour','money','credit','sentiment','industry'] },
  { economy:'UK', authorities:['Bank of England','ONS'], coverage:['policy','inflation','GDP','labour','wages','retail','trade','money','credit'] },
  { economy:'SOUTH_AFRICA', authorities:['South African Reserve Bank','Statistics South Africa','National Treasury'], coverage:['repo rate','inflation','GDP','labour','retail','mining','manufacturing','money','trade','fiscal'] },
  { economy:'JAPAN', authorities:['Bank of Japan','Statistics Bureau of Japan','Cabinet Office','Ministry of Finance','METI'], coverage:['policy','inflation','GDP','labour','wages','consumption','industry','trade','money','Tankan'] },
];

function stableHash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function clean(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') return clean(value.displayValue ?? value.value ?? value.Value ?? value.name ?? value.Name);
  const text = String(value).trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
}
function numeric(value) {
  const text = clean(value)?.replace(/,/g,'').replace(/%/g,'');
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}
function normalizeTitle(value='') {
  return value.toLowerCase().replace(/&/g,' and ').replace(/\bconsumer price index\b/g,'cpi')
    .replace(/\bproducer price index\b/g,'ppi').replace(/\bgross domestic product\b/g,'gdp')
    .replace(/\bnon[- ]?farm payrolls?\b/g,'nfp').replace(/\b(final|preliminary|prelim|flash|seasonally adjusted)\b/g,'')
    .replace(/[^a-z0-9%]+/g,' ').replace(/\s+/g,' ').trim();
}
function eventFingerprint(event) {
  return stableHash([event.date,event.currency,event.event,event.actual,event.forecast,event.previous,event.revised,event.deviation,event.lastUpdate]);
}
function isoSeconds(date) { return date.toISOString().replace(/\.\d{3}Z$/,'Z'); }
function importance(value) {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'HIGH' || raw === '3') return 3;
  if (raw === 'MEDIUM' || raw === '2') return 2;
  return 1;
}
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function dateValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const object = record(value);
  for (const candidate of [object.date,object.Date,object.dateUtc,object.DateUtc,object.value,object.Value]) {
    const parsed = dateValue(candidate); if (parsed) return parsed;
  }
  return null;
}
function walk(value,out,depth=0) {
  if (depth > 12 || out.length > 20000 || value == null) return;
  if (Array.isArray(value)) return value.forEach((child)=>walk(child,out,depth+1));
  if (typeof value !== 'object') return;
  out.push(value); Object.values(value).forEach((child)=>walk(child,out,depth+1));
}
async function fetchJson(url,timeoutMs=5000,headers={}) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response = await fetch(url,{ headers:{ Accept:'application/json','User-Agent':'FXGA-Macro-Collector/2.0',...headers }, signal:controller.signal, redirect:'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function putIfChanged(docName,payload) {
  const ref = state.doc(docName); const old = await ref.get();
  const previousHash = old.exists ? old.data()?.hash : null;
  const hash = stableHash(payload);
  if (hash === previousHash) return { changed:false,hash,previous:old.data() };
  await ref.set({ hash,updatedAt:new Date().toISOString(),payload },{ merge:false });
  return { changed:true,hash,previous:old.data() };
}
async function getState(docName) {
  const snap = await state.doc(docName).get(); return snap.exists ? snap.data() : null;
}

function fxstreetUrl(from,to) {
  const url = new URL(`https://calendar-api.fxsstatic.com/en/api/v2/eventDates/${isoSeconds(from)}/${isoSeconds(to)}`);
  ['NONE','LOW','MEDIUM','HIGH'].forEach((v)=>url.searchParams.append('volatilities',v));
  FXSTREET_COUNTRIES.forEach((c)=>url.searchParams.append('countries',c));
  FXSTREET_CATEGORIES.forEach((c)=>url.searchParams.append('categories',c));
  return url;
}
function parseFxstreet(payload) {
  const objects=[]; walk(payload,objects); const events=[]; const seen=new Set();
  for (const object of objects) {
    const event=record(object.event??object.Event??object.ecoCalendarEvent??object.EcoCalendarEvent);
    const country=record(object.country??object.Country??event.country??event.Country);
    const name=clean(object.name??object.Name??object.title??object.Title??event.name??event.Name??event.title??event.Title);
    if (!name) continue;
    let date=null;
    for (const candidate of [object.dateUtc,object.DateUtc,object.date,object.Date,object.dateTime,object.DateTime,object.eventDate,object.EventDate,object.releaseDate,object.ReleaseDate]) {
      date=dateValue(candidate); if (date) break;
    }
    if (!date) continue;
    const countryCode=clean(object.countryCode??object.CountryCode??event.countryCode??event.CountryCode??country.code??country.Code??country.id??country.Id)?.toUpperCase();
    let currency=clean(object.currencyCode??object.CurrencyCode??object.currency??object.Currency??event.currencyCode??event.CurrencyCode)?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) currency=COUNTRY_CURRENCY[countryCode];
    if (!currency) continue;
    const identity=`${date}|${currency}|${normalizeTitle(name)}`;
    if (seen.has(identity)) continue; seen.add(identity);
    const eventDateId=clean(object.id??object.Id??object.idEcoCalendarDate??object.IdEcoCalendarDate);
    const eventId=clean(event.id??event.Id??object.eventId??object.EventId??object.idEcoCalendar??object.IdEcoCalendar);
    events.push({
      id:`fxga-${stableHash(identity).slice(0,24)}`,eventDateId,eventId,date,
      country:clean(country.name??country.Name??object.countryName??object.CountryName)??countryCode??currency,
      countryCode,currency,event:name,category:clean(event.categoryName??event.CategoryName??object.categoryName??object.CategoryName)??'Economic Calendar',
      importance:importance(object.volatility??object.Volatility??event.volatility??event.Volatility),
      actual:clean(object.actual??object.Actual??object.displayActual??object.DisplayActual),
      forecast:clean(object.consensus??object.Consensus??object.displayConsensus??object.DisplayConsensus),
      previous:clean(object.previous??object.Previous??object.displayPrevious??object.DisplayPrevious),
      revised:clean(object.revised??object.Revised??object.displayRevised??object.DisplayRevised),
      deviation:numeric(object.deviation??object.Deviation??object.dev??object.Dev??object.displayDeviation??object.DisplayDeviation),
      unit:clean(object.unit??object.Unit??event.unit??event.Unit),
      lastUpdate:clean(object.lastUpdated??object.LastUpdated??object.lastUpdate??object.LastUpdate)??new Date().toISOString(),
      providers:['fxstreet'],sourceCount:1,source:'FXStreet public calendar feed',
    });
  }
  return events.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
}
async function fetchFxstreet(from,to) {
  return parseFxstreet(await fetchJson(fxstreetUrl(from,to),4500,{ Referer:'https://www.fxstreet.com/economic-calendar' }));
}

function parseMyfxbookTable(html) {
  const $=loadHtml(html); const events=[];
  $('table tr').each((_,row)=>{
    const cells=$(row).find('td').map((__,cell)=>$(cell).text().trim().replace(/\s+/g,' ')).get();
    if (cells.length<5) return;
    const joined=cells.join('|'); const currency=cells.find((value)=>/^[A-Z]{3}$/.test(value));
    if (!currency || !['USD','EUR','GBP','ZAR','JPY'].includes(currency)) return;
    const dateText=cells.find((value)=>/\b\d{1,2}:\d{2}\b/.test(value)&&/\d/.test(value));
    const name=cells.find((value)=>value.length>5&&value!==currency&&!/^[-+\d.,% ]+$/.test(value));
    if (!dateText||!name) return;
    const parsed=Date.parse(dateText); if (!Number.isFinite(parsed)) return;
    const numbers=cells.filter((value)=>/^[-+]?\d[\d,.]*%?$/.test(value));
    const identity=`${new Date(parsed).toISOString()}|${currency}|${normalizeTitle(name)}`;
    events.push({ id:`myfxbook-${stableHash(identity).slice(0,24)}`,date:new Date(parsed).toISOString(),currency,country:currency,
      event:name,category:'Economic Calendar',importance:/high/i.test(joined)?3:/medium/i.test(joined)?2:1,
      actual:numbers.at(-1),forecast:numbers.at(-2),previous:numbers.at(-3),providers:['myfxbook'],sourceCount:1,source:'Myfxbook public calendar' });
  });
  return events;
}
async function scrapeMyfxbook() {
  const url='https://www.myfxbook.com/forex-economic-calendar';
  try {
    const response=await fetch(url,{ headers:{ 'User-Agent':'Mozilla/5.0 FXGA-Macro-Collector/2.0',Accept:'text/html' },redirect:'follow' });
    if (response.ok) { const parsed=parseMyfxbookTable(await response.text()); if (parsed.length) return { events:parsed,mode:'html',ok:true }; }
  } catch {}
  const browser=await chromium.launch({headless:true}); const page=await browser.newPage(); const started=Date.now();
  try {
    await page.route('**/*',async(route)=>{
      const type=route.request().resourceType();
      if (['image','font','media'].includes(type)||/doubleclick|google-analytics|googletagmanager|taboola|adservice/i.test(route.request().url())) return route.abort();
      return route.continue();
    });
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:cfg.maxBrowserSeconds*1000});
    await page.waitForTimeout(1800);
    const events=parseMyfxbookTable(await page.content());
    return { events,mode:'playwright',ok:events.length>0,durationMs:Date.now()-started };
  } catch (error) {
    return { events:[],mode:'playwright',ok:false,error:String(error?.message||error).slice(0,300),durationMs:Date.now()-started };
  } finally { await browser.close().catch(()=>{}); }
}
async function scrapeCnbc() {
  const url='https://www.cnbc.com/economy/';
  try {
    const response=await fetch(url,{headers:{'User-Agent':'FXGA-Macro-Collector/2.0',Accept:'text/html'},redirect:'follow'});
    if (!response.ok) return {ok:false,items:[],error:`HTTP ${response.status}`};
    const $=loadHtml(await response.text()); const items=[];
    $('a').each((_,anchor)=>{
      if (items.length>=50) return;
      const text=$(anchor).text().trim().replace(/\s+/g,' '); const href=$(anchor).attr('href');
      if (text.length<18||!href||!/(econom|inflation|fed|ecb|boe|boj|sarb|jobs|gdp|rates|consumer|market)/i.test(text)) return;
      try { items.push({title:text.slice(0,240),url:new URL(href,url).toString()}); } catch {}
    });
    return {ok:true,items};
  } catch(error) { return {ok:false,items:[],error:String(error?.message||error).slice(0,300)}; }
}
function mergeEvents(primary,secondary) {
  const merged=primary.map((event)=>({...event}));
  for (const candidate of secondary) {
    const match=merged.find((event)=>event.currency===candidate.currency&&Math.abs(Date.parse(event.date)-Date.parse(candidate.date))<=5*60_000&&(
      normalizeTitle(event.event)===normalizeTitle(candidate.event)||normalizeTitle(event.event).includes(normalizeTitle(candidate.event))||normalizeTitle(candidate.event).includes(normalizeTitle(event.event))));
    if (!match) continue;
    match.providers=[...new Set([...(match.providers||[]),...(candidate.providers||[])])]; match.sourceCount=match.providers.length;
    match.actual??=candidate.actual; match.forecast??=candidate.forecast; match.previous??=candidate.previous;
  }
  return merged;
}

function taskOffsets(maxImportance) {
  if (maxImportance>=3) return [0,5,15,30,60,120,300];
  if (maxImportance===2) return [0,15,60,180];
  return [0,60,180];
}
async function createReleaseTask(releaseAt,offsetSeconds,eventIds) {
  if (!cfg.projectId||!cfg.serviceUrl||!cfg.taskInvokerSa) return {created:false,reason:'tasks-not-configured'};
  const parent=tasks.queuePath(cfg.projectId,cfg.region,cfg.taskQueue);
  const taskId=`fxga-${stableHash(`${releaseAt}|${offsetSeconds}|${eventIds.join(',')}`).slice(0,40)}`;
  const taskName=tasks.taskPath(cfg.projectId,cfg.region,cfg.taskQueue,taskId);
  const scheduleMs=Date.parse(releaseAt)+offsetSeconds*1000;
  if (scheduleMs<Date.now()-5000) return {created:false,reason:'past'};
  try {
    await tasks.createTask({parent,task:{name:taskName,scheduleTime:{seconds:Math.floor(scheduleMs/1000)},httpRequest:{httpMethod:'POST',url:`${cfg.serviceUrl}/release-check`,headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify({releaseAt,offsetSeconds,eventIds})),oidcToken:{serviceAccountEmail:cfg.taskInvokerSa,audience:cfg.serviceUrl}}}});
    return {created:true};
  } catch(error) { if (Number(error?.code)===6) return {created:false,reason:'exists'}; throw error; }
}
async function scheduleReleaseTasks(events) {
  const clusters=new Map();
  for (const event of events) {
    if (Date.parse(event.date)<Date.now()-5000) continue;
    const cluster=clusters.get(event.date)||[]; cluster.push(event); clusters.set(event.date,cluster);
  }
  let created=0;
  for (const [releaseAt,cluster] of clusters) {
    const maxImportance=Math.max(...cluster.map((event)=>event.importance||1));
    for (const offset of taskOffsets(maxImportance)) {
      const result=await createReleaseTask(releaseAt,offset,cluster.map((event)=>event.id)); if (result.created) created+=1;
    }
  }
  return {clusters:clusters.size,tasksCreated:created};
}
async function signedWebhook(type,payload) {
  if (!cfg.webhookSecret||!cfg.webhookUrl) return {sent:false,reason:'webhook-not-configured'};
  const body=JSON.stringify({version:1,type,generatedAt:new Date().toISOString(),payload});
  const timestamp=String(Date.now()); const requestId=crypto.randomUUID();
  const signature=crypto.createHmac('sha256',cfg.webhookSecret).update(`${timestamp}.${requestId}.${body}`).digest('hex');
  let lastError=null;
  for (let attempt=0;attempt<3;attempt+=1) {
    try {
      const response=await fetch(cfg.webhookUrl,{method:'POST',headers:{'Content-Type':'application/json','X-FXGA-Timestamp':timestamp,'X-FXGA-Request-Id':requestId,'X-FXGA-Signature':`sha256=${signature}`},body});
      if (response.ok) return {sent:true,status:response.status};
      lastError=new Error(`Webhook HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);
    } catch(error) { lastError=error; }
    await new Promise((resolve)=>setTimeout(resolve,400*(2**attempt)));
  }
  throw lastError||new Error('Webhook failed');
}

async function bootstrapCalendar() {
  const now=new Date(); const to=new Date(now.getTime()+cfg.calendarDays*86_400_000);
  const [fxstreetResult,myfxbook,cnbc]=await Promise.allSettled([fetchFxstreet(now,to),scrapeMyfxbook(),scrapeCnbc()]);
  const fxstreet=fxstreetResult.status==='fulfilled'?fxstreetResult.value:[];
  const myfx=myfxbook.status==='fulfilled'?myfxbook.value:{events:[],ok:false,error:String(myfxbook.reason)};
  const cnbcResult=cnbc.status==='fulfilled'?cnbc.value:{items:[],ok:false,error:String(cnbc.reason)};
  const events=mergeEvents(fxstreet,myfx.events||[]).filter((event)=>Date.parse(event.date)<=to.getTime());
  if (!events.length) throw new Error('Calendar bootstrap produced no events');
  const sourceHealth={fxstreet:{ok:fxstreet.length>0,events:fxstreet.length},myfxbook:{ok:Boolean(myfx.ok),events:(myfx.events||[]).length,mode:myfx.mode,error:myfx.error},cnbc:{ok:Boolean(cnbcResult.ok),items:(cnbcResult.items||[]).length,error:cnbcResult.error}};
  const snapshot={generatedAt:new Date().toISOString(),days:cfg.calendarDays,targetEconomies:TARGET_ECONOMIES,events,sourceHealth,cnbcContext:cnbcResult.items||[]};
  const saved=await putIfChanged('calendar',snapshot); const scheduled=await scheduleReleaseTasks(events);
  if (saved.changed) await signedWebhook('calendar-snapshot',snapshot);
  await state.doc('source-health').set({updatedAt:new Date().toISOString(),payload:sourceHealth});
  return {events:events.length,changed:saved.changed,scheduled,sourceHealth};
}
async function releaseCheck({eventIds=[],releaseAt,offsetSeconds=0}) {
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
    const merged={...event,actual:candidate.actual??event.actual,forecast:candidate.forecast??event.forecast,previous:candidate.previous??event.previous,revised:candidate.revised??event.revised,deviation:candidate.deviation??event.deviation,lastUpdate:candidate.lastUpdate??new Date().toISOString(),providers:[...new Set([...(event.providers||[]),'fxstreet'])]};
    if (eventFingerprint(merged)!==eventFingerprint(event)) changed.push(merged); return merged;
  });
  if (!changed.length) return {changed:0,releaseAt,offsetSeconds};
  const snapshot={...calendarState.payload,generatedAt:new Date().toISOString(),events:next};
  await state.doc('calendar').set({hash:stableHash(snapshot),updatedAt:new Date().toISOString(),payload:snapshot});
  await state.collection('release_snapshots').doc(`${Date.now()}-${stableHash(eventIds.join(',')).slice(0,12)}`).set({releaseAt,offsetSeconds,changed,capturedAt:new Date().toISOString()});
  await signedWebhook('release-delta',{releaseAt,offsetSeconds,events:changed});
  return {changed:changed.length,releaseAt,offsetSeconds};
}

async function getFredUniverse(force=false) {
  if (!cfg.fredApiKey) throw new Error('FRED_API_KEY not configured');
  const cached=await getState('fred-universe');
  if (!force&&cached?.payload?.series?.length>=FRED_BASE_IDS.length&&Date.parse(cached.updatedAt||0)>=Date.now()-UNIVERSE_TTL_MS) return cached.payload;
  const series=await discoverGlobalFredUniverse(cfg.fredApiKey,fetchJson,{maxSeries:cfg.globalFredTarget,maxPerQuery:2});
  const payload={generatedAt:new Date().toISOString(),targetEconomies:TARGET_ECONOMIES,series,summary:summarizeUniverse(series),officialSources:OFFICIAL_SOURCE_REGISTRY};
  await state.doc('fred-universe').set({hash:stableHash(payload),updatedAt:new Date().toISOString(),payload});
  return payload;
}
async function fetchFredSeries(descriptor) {
  const seriesId=descriptor.seriesId;
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id',seriesId); url.searchParams.set('api_key',cfg.fredApiKey); url.searchParams.set('file_type','json');
  url.searchParams.set('sort_order','desc'); url.searchParams.set('limit','24');
  const payload=await fetchJson(url,5500);
  const history=(payload.observations||[]).map((row)=>({date:row.date,value:row.value==='.'?null:Number(row.value)})).filter((row)=>Number.isFinite(row.value)).reverse();
  const latest=history.at(-1),previous=history.at(-2);
  return {
    seriesId,title:descriptor.title||seriesId,value:latest?.value??null,date:latest?.date??null,previous:previous?.value??null,
    change:latest&&previous?latest.value-previous.value:null,units:descriptor.units||'',frequency:descriptor.frequency||'',
    categories:[descriptor.category||'fxga-core'],economy:descriptor.economy||'USA',economies:[descriptor.economy||'USA'],
    importance:descriptor.curated?'critical':'high',source:descriptor.source||'FRED',lastUpdated:descriptor.lastUpdated||undefined,history,
  };
}
async function mapFredInBatches(descriptors) {
  const observations=[]; const failures=[];
  for (let index=0;index<descriptors.length;index+=MAX_FRED_CONCURRENCY) {
    const batch=descriptors.slice(index,index+MAX_FRED_CONCURRENCY);
    const settled=await Promise.allSettled(batch.map(fetchFredSeries));
    settled.forEach((result,i)=>{
      if (result.status==='fulfilled'&&result.value.value!==null) observations.push(result.value);
      else if (result.status==='rejected') failures.push({seriesId:batch[i].seriesId,error:String(result.reason?.message||result.reason).slice(0,160)});
    });
  }
  return {observations,failures};
}
async function syncFred(mode='fast') {
  if (!cfg.fredApiKey) return {skipped:true,reason:'FRED_API_KEY not configured'};
  const full=String(mode).toLowerCase()==='full';
  const universe=await getFredUniverse(full);
  let descriptors=universe.series||[];
  if (!full) {
    descriptors=descriptors.filter((item)=>FAST_FRED_IDS.has(item.seriesId)||/daily|weekly/i.test(item.frequency||''));
    if (descriptors.length<30) descriptors=(universe.series||[]).filter((item)=>FAST_FRED_IDS.has(item.seriesId));
  }
  const {observations,failures}=await mapFredInBatches(descriptors);
  const previous=(await getState('macro'))?.payload;
  let merged=observations;
  if (!full&&Array.isArray(previous?.observations)) {
    const byId=new Map(previous.observations.map((item)=>[item.seriesId,item]));
    observations.forEach((item)=>byId.set(item.seriesId,item)); merged=[...byId.values()];
  }
  const snapshot={
    generatedAt:new Date().toISOString(),mode:full?'full':'fast',importantOnly:true,dynamicInternational:true,
    targetEconomies:TARGET_ECONOMIES,requested:descriptors.length,observations:merged,
    universeSummary:universe.summary,failures:failures.slice(0,30),officialSources:OFFICIAL_SOURCE_REGISTRY,
  };
  const saved=await putIfChanged('macro',snapshot);
  if (saved.changed) await signedWebhook('macro-snapshot',snapshot);
  return {changed:saved.changed,mode:snapshot.mode,observations:merged.length,fetchedNow:observations.length,requested:descriptors.length,failures:failures.length,universe:universe.summary};
}

app.get('/health',async(_req,res)=>{
  const [calendar,macro,universe]=await Promise.all([getState('calendar'),getState('macro'),getState('fred-universe')]);
  res.json({ok:true,service:'fxga-cloud-run-collector',version:2,projectConfigured:Boolean(cfg.projectId),tasksConfigured:Boolean(cfg.serviceUrl&&cfg.taskInvokerSa),webhookConfigured:Boolean(cfg.webhookSecret&&cfg.webhookUrl),fredConfigured:Boolean(cfg.fredApiKey),calendarUpdatedAt:calendar?.updatedAt??null,macroUpdatedAt:macro?.updatedAt??null,fredUniverse:universe?.payload?.summary??{curatedBase:FRED_BASE_IDS.length},targetEconomies:TARGET_ECONOMIES,mode:'event-driven-cloud-run'});
});
app.post('/bootstrap',async(_req,res,next)=>{try{res.json(await bootstrapCalendar());}catch(error){next(error);}});
app.post('/release-check',async(req,res,next)=>{try{res.json(await releaseCheck(req.body||{}));}catch(error){next(error);}});
app.post('/macro-sync',async(req,res,next)=>{try{res.json(await syncFred(req.query.mode||req.body?.mode||'fast'));}catch(error){next(error);}});
app.post('/fred-discover',async(req,res,next)=>{try{res.json(await getFredUniverse(Boolean(req.body?.force)));}catch(error){next(error);}});
app.get('/fred-universe',async(_req,res,next)=>{try{res.json(await getFredUniverse(false));}catch(error){next(error);}});
app.get('/state',async(_req,res)=>{
  const [calendar,macro,sourceHealth,universe]=await Promise.all([getState('calendar'),getState('macro'),getState('source-health'),getState('fred-universe')]);
  res.json({calendar,macro,sourceHealth,fredUniverse:universe});
});
app.use((error,_req,res,_next)=>{console.error(error);res.status(500).json({error:String(error?.message||error).slice(0,1000)});});
app.listen(cfg.port,()=>console.log(`FXGA Cloud Run global collector v2 listening on :${cfg.port}`));
