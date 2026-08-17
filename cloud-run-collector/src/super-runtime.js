import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { buildSuperEconomist, registrySummary, searchRegistry } from './super-economist.js';
import { TARGET_ECONOMIES } from './super-economist-core.js';
import { fetchOfficialNews } from './official-news.js';
import { FRED_BASE_IDS } from './global-fred.js';

const db=new Firestore({ignoreUndefinedProperties:true});
const state=db.collection('fxga_collector_state');
const audit=db.collection('fxga_super_economist_audit');
const NEWS_TTL_MS=15*60_000;
const webhookUrl=process.env.CLOUDFLARE_WEBHOOK_URL||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev/api/collector-webhook';
const webhookSecret=process.env.COLLECTOR_WEBHOOK_SECRET||'';
const fredApiKey=process.env.FRED_API_KEY||'';

function hash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function numeric(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(value==null)return null; const n=Number(String(value).replace(/,/g,'').replace(/%/g,'').trim());return Number.isFinite(n)?n:null;
}
async function get(name){const x=await state.doc(name).get();return x.exists?x.data():null;}
async function putChanged(name,payload){
  const ref=state.doc(name),old=await ref.get(),h=hash(payload);
  if(old.exists&&old.data()?.hash===h)return false;
  await ref.set({hash:h,updatedAt:new Date().toISOString(),payload},{merge:false});return true;
}
async function safeWebhook(type,payload){
  if(!webhookSecret||!webhookUrl)return {sent:false,reason:'not-configured'};
  const body=JSON.stringify({version:1,type,generatedAt:new Date().toISOString(),payload}),timestamp=String(Date.now()),requestId=crypto.randomUUID(),signature=crypto.createHmac('sha256',webhookSecret).update(`${timestamp}.${requestId}.${body}`).digest('hex');
  let last=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json','X-FXGA-Timestamp':timestamp,'X-FXGA-Request-Id':requestId,'X-FXGA-Signature':`sha256=${signature}`},body});
      if(r.ok)return {sent:true,status:r.status}; last=new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,180)}`);
    }catch(e){last=e;}
    await new Promise(r=>setTimeout(r,300*(2**attempt)));
  }
  console.warn(`${type} webhook deferred:`,String(last?.message||last).slice(0,220));return {sent:false,error:String(last?.message||last).slice(0,220)};
}

async function fetchFredDescriptor(descriptor){
  if(!fredApiKey)throw new Error('FRED_API_KEY not configured');
  const seriesId=String(descriptor.seriesId||'').trim();
  if(!seriesId)throw new Error('FRED descriptor missing seriesId');
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id',seriesId);
  url.searchParams.set('api_key',fredApiKey);
  url.searchParams.set('file_type','json');
  url.searchParams.set('sort_order','desc');
  url.searchParams.set('limit','24');
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'FXGA-Google-Super-Economist/3.0'}});
  if(!response.ok)throw new Error(`FRED ${seriesId} HTTP ${response.status}`);
  const payload=await response.json();
  const history=(payload.observations||[])
    .map(row=>({date:row.date,value:row.value==='.'?null:Number(row.value)}))
    .filter(row=>Number.isFinite(row.value)).reverse();
  const latest=history.at(-1),previous=history.at(-2);
  return {
    seriesId,title:descriptor.title||seriesId,value:latest?.value??null,date:latest?.date??null,previous:previous?.value??null,
    change:latest&&previous?latest.value-previous.value:null,units:descriptor.units||'',frequency:descriptor.frequency||'',
    categories:[descriptor.category||'fxga-core'],economy:descriptor.economy||'USA',economies:[descriptor.economy||'USA'],
    importance:descriptor.curated?'critical':'high',source:descriptor.source||'FRED',lastUpdated:descriptor.lastUpdated||undefined,history,
  };
}

export async function syncFullMacroFromUniverse(){
  const universeState=await get('fred-universe');
  const universe=universeState?.payload;
  const descriptors=Array.isArray(universe?.series)?universe.series:[];
  if(descriptors.length<FRED_BASE_IDS.length)throw new Error(`Persisted FRED universe is incomplete: ${descriptors.length}`);
  const started=Date.now(),observations=[],failures=[];
  for(let i=0;i<descriptors.length;i+=8){
    const batch=descriptors.slice(i,i+8);
    const settled=await Promise.allSettled(batch.map(fetchFredDescriptor));
    settled.forEach((result,index)=>{
      if(result.status==='fulfilled'&&result.value.value!==null)observations.push(result.value);
      else failures.push({seriesId:batch[index]?.seriesId||'unknown',error:result.status==='rejected'?String(result.reason?.message||result.reason).slice(0,180):'No current numeric observation'});
    });
  }
  const snapshot={
    generatedAt:new Date().toISOString(),mode:'full',importantOnly:true,dynamicInternational:true,
    targetEconomies:TARGET_ECONOMIES,requested:descriptors.length,observations,
    universeSummary:universe.summary,failures:failures.slice(0,40),officialSources:universe.officialSources||[],
    collectionArchitecture:'google-cloud-cached-universe-observation-sync',
  };
  const changed=await putChanged('macro',snapshot);
  const webhook=changed?await safeWebhook('macro-snapshot',snapshot):{sent:false,reason:'unchanged'};
  return {changed,webhook,mode:'full',observations:observations.length,fetchedNow:observations.length,requested:descriptors.length,failures:failures.length,universe:universe.summary,durationMs:Date.now()-started};
}

async function ensureNews(force=false){
  const saved=await get('news');
  if(!force&&saved?.payload?.items&&Date.parse(saved.updatedAt||0)>Date.now()-NEWS_TTL_MS)return saved.payload;
  const payload=await fetchOfficialNews();
  await state.doc('news').set({hash:hash(payload),updatedAt:new Date().toISOString(),payload},{merge:false});
  return payload;
}
async function reliability(){
  const saved=await get('family-skill');return saved?.payload?.reliability||{};
}
async function saveReliability(map,stats){
  await state.doc('family-skill').set({hash:hash(map),updatedAt:new Date().toISOString(),payload:{reliability:map,stats}},{merge:false});
}
function side(x,eps){return x>eps?1:x<-eps?-1:0;}
async function scoreFrozen(events,map){
  const byId=new Map(events.map(e=>[e.id,e]));
  const pending=await audit.where('scored','==',false).limit(100).get();let scored=0;const stats={};
  for(const doc of pending.docs){
    const f=doc.data(),event=byId.get(f.eventId);if(!event)continue;
    const actual=numeric(event.actual),consensus=numeric(event.forecast),predicted=Number(f.predictedActual);
    if(actual==null||consensus==null||!Number.isFinite(predicted))continue;
    const eps=Math.max(Math.abs(consensus)*0.0025,1e-6),a=side(actual-consensus,eps),p=side(predicted-consensus,eps),skill=a===0?0.5:a===p?1:0;
    for(const fam of f.topFamilies||[]){const old=Number(map[fam.code]??0.60);map[fam.code]=Math.max(0.15,Math.min(0.95,old*0.95+skill*0.05));stats[fam.code]=(stats[fam.code]||0)+1;}
    await doc.ref.set({scored:true,scoredAt:new Date().toISOString(),actual,consensus,actualSide:a,predictedSide:p,forecastSkill:skill},{merge:true});scored++;
  }
  if(scored)await saveReliability(map,stats);
  return scored;
}
async function freeze(engine,events){
  const forecasts=new Map((engine.eventForecasts||[]).map(x=>[x.eventId,x])),now=Date.now();let count=0;
  for(const event of events){
    const t=Date.parse(event.date);if(t<now||t>now+36*3600000)continue;
    const forecast=forecasts.get(event.id);if(!forecast)continue;
    const ref=audit.doc(event.id),snap=await ref.get();if(snap.exists)continue;
    const economy=event.currency==='USD'?'USA':event.currency==='EUR'?'EUROPE':event.currency==='GBP'?'UK':event.currency==='ZAR'?'SOUTH_AFRICA':event.currency==='JPY'?'JAPAN':null;
    const topFamilies=engine.topFamilies?.find(x=>x.economy===economy)?.families?.slice(0,20).map(x=>({code:x.code,weight:x.weight}))||[];
    await ref.set({eventId:event.id,event:event.event,currency:event.currency,releaseAt:event.date,frozenAt:new Date().toISOString(),consensus:forecast.consensus,predictedActual:forecast.predictedActual,probabilities:forecast.probabilities,confidence:forecast.confidence,eventEdge:forecast.eventEdge,topFamilies,scored:false});count++;
  }
  return count;
}
function buildFredCatalog(universe){
  const series=(universe?.series||[]).map(x=>({id:x.seriesId,title:x.title||x.seriesId,units:x.units||'',frequency:x.frequency||'',categories:[x.category||'fxga-core'],importance:x.curated?'critical':'high',economy:x.economy||'USA'}));
  const counts=new Map();for(const s of series)for(const c of s.categories)counts.set(c,(counts.get(c)||0)+1);
  return {total:series.length,curatedBase:FRED_BASE_IDS.length,maxSeriesPerRequest:220,categories:[...counts].map(([id,count])=>({id,label:id.replace(/[-_]/g,' '),description:'Google Cloud FXGA important macro family',count})),series,policy:{importantOnly:true,scope:'Google Cloud collector only',globalCoverage:TARGET_ECONOMIES,dynamicTarget:180}};
}
function group(observations,generatedAt){
  const economies=Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,[]])),global=[];
  for(const o of observations){const tags=Array.isArray(o.economies)&&o.economies.length?o.economies:[o.economy||'GLOBAL'];let assigned=false;for(const e of TARGET_ECONOMIES)if(tags.includes(e)){economies[e].push(o);assigned=true;}if(!assigned||tags.includes('GLOBAL'))global.push(o);}
  return {generatedAt:generatedAt||null,mode:'google-cloud-run-webhook',targetEconomies:TARGET_ECONOMIES,totalObservations:observations.length,counts:Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,economies[e].length])),economies,global};
}
export async function refreshSuperEconomist({forceNews=false}={}){
  const [calendar,macro,universe]=await Promise.all([get('calendar'),get('macro'),get('fred-universe')]);
  const events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],news=await ensureNews(forceNews),skills=await reliability();
  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills});
  const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills});
  const frozen=await freeze(engine,events);
  const payload={...engine,news:news.items||[],newsSourceHealth:news.sourceHealth||{},fredCatalog:buildFredCatalog(universe?.payload),globalMacro:group(observations,macro?.payload?.generatedAt),audit:{frozenThisRun:frozen,scoredThisRun:scored}};
  const changed=await putChanged('intelligence',payload);const webhook=changed?await safeWebhook('intelligence-snapshot',payload):{sent:false,reason:'unchanged'};
  return {changed,webhook,registry:payload.registry,coverage:payload.coverage,audit:payload.audit,economies:payload.economyAnalysis.economies.length,observations:observations.length};
}
export async function superHealth(){
  const [calendar,macro,intelligence,universe]=await Promise.all([get('calendar'),get('macro'),get('intelligence'),get('fred-universe')]);
  const context={hasMacro:Boolean(macro?.payload?.observations?.length),hasCalendar:Boolean(calendar?.payload?.events?.length),hasNews:Boolean(intelligence?.payload?.news?.length),hasMarketData:false,hasAltData:false};
  return {ok:true,service:'fxga-cloud-run-collector',version:3,architecture:'google-cloud-only-acquisition-and-intelligence',methodRegistry:registrySummary(context),calendarUpdatedAt:calendar?.updatedAt??null,macroUpdatedAt:macro?.updatedAt??null,intelligenceUpdatedAt:intelligence?.updatedAt??null,fredUniverse:universe?.payload?.summary??{curatedBase:FRED_BASE_IDS.length},targetEconomies:TARGET_ECONOMIES,cloudflareRole:'signed-webhook-receiver-and-serving-only'};
}
export async function fullState(){
  const [calendar,macro,sourceHealth,fredUniverse,news,intelligence,familySkill]=await Promise.all([get('calendar'),get('macro'),get('source-health'),get('fred-universe'),get('news'),get('intelligence'),get('family-skill')]);
  return {calendar,macro,sourceHealth,fredUniverse,news,intelligence,familySkill};
}
export async function intelligenceState(){return (await get('intelligence'))?.payload||null;}
export function registrySearch(args){return searchRegistry(args);}
