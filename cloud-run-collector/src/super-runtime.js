import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Firestore } from '@google-cloud/firestore';
import { buildSuperEconomist, registrySummary, searchRegistry } from './super-economist.js';
import { TARGET_ECONOMIES } from './super-economist-core.js';
import { fetchOfficialNews } from './official-news.js';
import { FRED_BASE_IDS } from './global-fred.js';
import { evaluateDecisionMemory, readDecisionMemorySummary, recordDecisionMemory } from './decision-memory.js';

const db=new Firestore({ignoreUndefinedProperties:true});
const state=db.collection('fxga_collector_state');
const stateChunks=db.collection('fxga_collector_state_chunks');
const audit=db.collection('fxga_super_economist_audit');
const FIRESTORE_INLINE_MAX_BYTES=700_000;
const FIRESTORE_CHUNK_RAW_BYTES=540*1024;
const NEWS_TTL_MS=15*60_000;
const webhookUrl=process.env.CLOUDFLARE_WEBHOOK_URL||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev/api/collector-webhook';
const webhookSecret=process.env.COLLECTOR_WEBHOOK_SECRET||'';
const fredApiKey=process.env.FRED_API_KEY||'';
const SERVICE_VERSION=(()=>{try{const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));return String(pkg?.version||'0.0.0');}catch{return '0.0.0';}})();

function hash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function numeric(value){if(typeof value==='number'&&Number.isFinite(value))return value;if(value==null)return null;const n=Number(String(value).replace(/,/g,'').replace(/%/g,'').trim());return Number.isFinite(n)?n:null;}
function ageMinutes(value){const t=Date.parse(value||'');return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/60000)):null;}
function classifyMacroFailure(message=''){
  const text=String(message||'').toLowerCase();
  if(/http 429|rate limit|too many requests/.test(text))return {type:'rate-limited',retryable:true};
  if(/http 5\d\d|econnreset|socket|temporar|upstream/.test(text))return {type:'transient-upstream',retryable:true};
  if(/timeout|timed out|abort/.test(text))return {type:'timeout',retryable:true};
  if(/http 404|not found|does not exist/.test(text))return {type:'series-unavailable',retryable:false};
  if(/no current numeric observation|no observation|non.?numeric/.test(text))return {type:'no-current-observation',retryable:false};
  if(/invalid|parse|json/.test(text))return {type:'invalid-response',retryable:true};
  if(/api key|unauthor|forbidden|http 401|http 403/.test(text))return {type:'authorization',retryable:false};
  return {type:'other',retryable:true};
}
function macroFailureDiagnostics(failures=[],requested=0,liveFetched=0,staleRetained=0,observations=0){
  const byType={},byEconomy={},byCategory={};let retryable=0,nonRetryable=0;
  for(const failure of failures){
    const type=failure.type||classifyMacroFailure(failure.error).type;
    byType[type]=(byType[type]||0)+1;
    const economy=failure.economy||'UNKNOWN',category=failure.category||'other';
    byEconomy[economy]=(byEconomy[economy]||0)+1;byCategory[category]=(byCategory[category]||0)+1;
    if(failure.retryable??classifyMacroFailure(failure.error).retryable)retryable++;else nonRetryable++;
  }
  const unresolved=Math.max(0,Number(requested||0)-Number(observations||0));
  const liveRatio=requested?liveFetched/requested:0,effectiveRatio=requested?observations/requested:0;
  return {total:failures.length,retryable,nonRetryable,unresolved,byType,byEconomy,byCategory,liveRatio,effectiveRatio,requested,liveFetched,staleRetained,observations};
}
function chunkDocId(name,generation,index){return `${name}__${generation}__${String(index).padStart(4,'0')}`;}
async function removeChunkGeneration(name,generation,count){
  if(!generation||!Number.isFinite(Number(count))||Number(count)<=0)return;
  const jobs=[];for(let i=0;i<Number(count);i++)jobs.push(stateChunks.doc(chunkDocId(name,generation,i)).delete().catch(()=>null));await Promise.all(jobs);
}
async function get(name){
  const x=await state.doc(name).get();if(!x.exists)return null;const data=x.data();if(!data?.chunked)return data;
  const generation=String(data.generation||''),count=Number(data.chunkCount||0);if(!generation||!Number.isInteger(count)||count<1)throw new Error(`Chunk manifest for ${name} is invalid`);
  const chunks=[];for(let i=0;i<count;i+=8){const indexes=Array.from({length:Math.min(8,count-i)},(_,offset)=>i+offset),snaps=await Promise.all(indexes.map(index=>stateChunks.doc(chunkDocId(name,generation,index)).get()));for(let j=0;j<snaps.length;j++){const snap=snaps[j],index=indexes[j];if(!snap.exists)throw new Error(`Chunk ${index+1}/${count} missing for ${name}`);const encoded=snap.data()?.data;if(typeof encoded!=='string')throw new Error(`Chunk ${index+1}/${count} is invalid for ${name}`);chunks[index]=Buffer.from(encoded,'base64');}}
  const json=Buffer.concat(chunks).toString('utf8');if(Number(data.byteLength||0)&&Buffer.byteLength(json,'utf8')!==Number(data.byteLength))throw new Error(`Chunk byte length mismatch for ${name}`);if(data.hash&&hash(json)!==data.hash)throw new Error(`Chunk hash mismatch for ${name}`);return {...data,payload:JSON.parse(json)};
}
async function putChanged(name,payload){
  const ref=state.doc(name),old=await ref.get(),oldData=old.exists?old.data():null,serialized=JSON.stringify(payload),h=hash(serialized);if(oldData?.hash===h)return false;const updatedAt=new Date().toISOString(),bytes=Buffer.from(serialized,'utf8');
  if(bytes.length<=FIRESTORE_INLINE_MAX_BYTES){await ref.set({hash:h,updatedAt,payload},{merge:false});if(oldData?.chunked)removeChunkGeneration(name,oldData.generation,oldData.chunkCount).catch(()=>{});return true;}
  const generation=h.slice(0,24),chunks=[];for(let offset=0;offset<bytes.length;offset+=FIRESTORE_CHUNK_RAW_BYTES)chunks.push(bytes.subarray(offset,Math.min(bytes.length,offset+FIRESTORE_CHUNK_RAW_BYTES)));
  for(let i=0;i<chunks.length;i+=6){const indexes=Array.from({length:Math.min(6,chunks.length-i)},(_,offset)=>i+offset);await Promise.all(indexes.map(index=>stateChunks.doc(chunkDocId(name,generation,index)).set({name,generation,index,count:chunks.length,encoding:'base64',data:chunks[index].toString('base64')},{merge:false})));}
  await ref.set({hash:h,updatedAt,chunked:true,encoding:'base64-json',generation,chunkCount:chunks.length,byteLength:bytes.length},{merge:false});
  if(oldData?.chunked&&oldData.generation!==generation)removeChunkGeneration(name,oldData.generation,oldData.chunkCount).catch(()=>{});
  console.log('Chunked collector state',JSON.stringify({name,byteLength:bytes.length,chunkCount:chunks.length,generation}));return true;
}
async function safeWebhook(type,payload){if(!webhookSecret||!webhookUrl)return {sent:false,reason:'not-configured'};const body=JSON.stringify({version:1,type,generatedAt:new Date().toISOString(),payload}),timestamp=String(Date.now()),requestId=crypto.randomUUID(),signature=crypto.createHmac('sha256',webhookSecret).update(`${timestamp}.${requestId}.${body}`).digest('hex');let last=null;for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json','X-FXGA-Timestamp':timestamp,'X-FXGA-Request-Id':requestId,'X-FXGA-Signature':`sha256=${signature}`},body});if(r.ok)return {sent:true,status:r.status};last=new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,180)}`);}catch(e){last=e;}await new Promise(r=>setTimeout(r,300*(2**attempt)));}console.warn(`${type} webhook deferred:`,String(last?.message||last).slice(0,220));return {sent:false,error:String(last?.message||last).slice(0,220)};}

async function fetchFredDescriptor(descriptor){
  if(!fredApiKey)throw new Error('FRED_API_KEY not configured');const seriesId=String(descriptor.seriesId||'').trim();if(!seriesId)throw new Error('FRED descriptor missing seriesId');
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');url.searchParams.set('series_id',seriesId);url.searchParams.set('api_key',fredApiKey);url.searchParams.set('file_type','json');url.searchParams.set('sort_order','desc');url.searchParams.set('limit','24');
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'FXGA-Google-Super-Economist/4.0'}});if(!response.ok)throw new Error(`FRED ${seriesId} HTTP ${response.status}`);const payload=await response.json();
  const history=(payload.observations||[]).map(row=>({date:row.date,value:row.value==='.'?null:Number(row.value)})).filter(row=>Number.isFinite(row.value)).reverse(),latest=history.at(-1),previous=history.at(-2);
  return {seriesId,title:descriptor.title||seriesId,value:latest?.value??null,date:latest?.date??null,previous:previous?.value??null,change:latest&&previous?latest.value-previous.value:null,units:descriptor.units||'',frequency:descriptor.frequency||'',categories:[descriptor.category||'fxga-core'],economy:descriptor.economy||'USA',economies:[descriptor.economy||'USA'],importance:descriptor.curated?'critical':'high',source:descriptor.source||'FRED',lastUpdated:descriptor.lastUpdated||undefined,history,staleFallback:false,collectedAt:new Date().toISOString()};
}

export async function syncFullMacroFromUniverse(){
  const [universeState,previousState]=await Promise.all([get('fred-universe'),get('macro')]),universe=universeState?.payload,descriptors=Array.isArray(universe?.series)?universe.series:[];
  if(descriptors.length<FRED_BASE_IDS.length)throw new Error(`Persisted FRED universe is incomplete: ${descriptors.length}`);
  const started=Date.now(),fresh=[],failures=[];
  for(let i=0;i<descriptors.length;i+=8){const batch=descriptors.slice(i,i+8),settled=await Promise.allSettled(batch.map(fetchFredDescriptor));settled.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value.value!==null)fresh.push(result.value);else {const descriptor=batch[index]||{},error=result.status==='rejected'?String(result.reason?.message||result.reason).slice(0,180):'No current numeric observation',classification=classifyMacroFailure(error);failures.push({seriesId:descriptor.seriesId||'unknown',title:descriptor.title||descriptor.seriesId||'unknown',economy:descriptor.economy||'UNKNOWN',category:descriptor.category||'other',error,type:classification.type,retryable:classification.retryable});}});}
  const byId=new Map((previousState?.payload?.observations||[]).map(x=>[x.seriesId,x]));for(const item of fresh)byId.set(item.seriesId,item);
  const failedIds=new Set(failures.map(x=>x.seriesId)),observations=[];for(const descriptor of descriptors){const item=byId.get(descriptor.seriesId);if(!item)continue;observations.push(failedIds.has(descriptor.seriesId)?{...item,staleFallback:true,collectionWarning:'Latest refresh failed; retained last-known-good observation.'}:item);}
  const staleRetained=observations.filter(x=>x.staleFallback).length,failureDiagnostics=macroFailureDiagnostics(failures,descriptors.length,fresh.length,staleRetained,observations.length),coverageQuality={requested:descriptors.length,liveFetched:fresh.length,retainedLastKnownGood:staleRetained,usableObservations:observations.length,unresolved:failureDiagnostics.unresolved,liveCoveragePercent:Number((failureDiagnostics.liveRatio*100).toFixed(1)),effectiveCoveragePercent:Number((failureDiagnostics.effectiveRatio*100).toFixed(1)),status:failureDiagnostics.effectiveRatio>=.9?'strong':failureDiagnostics.effectiveRatio>=.75?'acceptable':'degraded'},snapshot={generatedAt:new Date().toISOString(),mode:'full',importantOnly:true,dynamicInternational:true,targetEconomies:TARGET_ECONOMIES,requested:descriptors.length,observations,liveFetched:fresh.length,staleRetained,coverageQuality,failureDiagnostics,universeSummary:universe.summary,failures:failures.slice(0,60),officialSources:universe.officialSources||[],collectionArchitecture:'primary-macro-observation-sync-with-last-known-good'};
  const changed=await putChanged('macro',snapshot),webhook=changed?await safeWebhook('macro-snapshot',snapshot):{sent:false,reason:'unchanged'};return {changed,webhook,mode:'full',observations:observations.length,fetchedNow:fresh.length,staleRetained,requested:descriptors.length,failures:failures.length,universe:universe.summary,durationMs:Date.now()-started};
}

async function ensureNews(force=false){
  const saved=await get('news');if(!force&&saved?.payload?.items&&Date.parse(saved.updatedAt||0)>Date.now()-NEWS_TTL_MS)return saved.payload;
  const current=await fetchOfficialNews(),oldItems=Array.isArray(saved?.payload?.items)?saved.payload.items:[],failedSources=new Set(Object.entries(current.sourceHealth||{}).filter(([,h])=>!h.ok).map(([id])=>id)),merged=new Map(current.items.map(x=>[x.id,x]));
  for(const item of oldItems){if(!failedSources.has(item.sourceId)||Date.parse(item.publishedAt||0)<Date.now()-7*86400000||merged.has(item.id))continue;merged.set(item.id,{...item,staleFallback:true});}
  const payload={...current,items:[...merged.values()].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)).slice(0,180),staleRetained:[...merged.values()].filter(x=>x.staleFallback).length};
  await state.doc('news').set({hash:hash(payload),updatedAt:new Date().toISOString(),payload},{merge:false});return payload;
}
async function reliability(){const saved=await get('family-skill');return saved?.payload?.reliability||{};}
async function saveReliability(map,stats){await state.doc('family-skill').set({hash:hash(map),updatedAt:new Date().toISOString(),payload:{reliability:map,stats}},{merge:false});}
function side(x,eps){return x>eps?1:x<-eps?-1:0;}
async function scoreFrozen(events,map){const byId=new Map(events.map(e=>[e.id,e])),pending=await audit.where('scored','==',false).limit(100).get();let scored=0;const stats={};for(const doc of pending.docs){const f=doc.data(),event=byId.get(f.eventId);if(!event)continue;const actual=numeric(event.actual),consensus=numeric(event.forecast),predicted=Number(f.predictedActual);if(actual==null||consensus==null||!Number.isFinite(predicted))continue;const eps=Math.max(Math.abs(consensus)*.0025,1e-6),a=side(actual-consensus,eps),p=side(predicted-consensus,eps),skill=a===0?.5:a===p?1:0;for(const fam of f.topFamilies||[]){const old=Number(map[fam.code]??.60);map[fam.code]=Math.max(.15,Math.min(.95,old*.95+skill*.05));stats[fam.code]=(stats[fam.code]||0)+1;}await doc.ref.set({scored:true,scoredAt:new Date().toISOString(),actual,consensus,actualSide:a,predictedSide:p,forecastSkill:skill},{merge:true});scored++;}if(scored)await saveReliability(map,stats);return scored;}
async function freeze(engine,events){const forecasts=new Map((engine.eventForecasts||[]).map(x=>[x.eventId,x])),now=Date.now();let count=0;for(const event of events){const t=Date.parse(event.date);if(t<now||t>now+36*3600000)continue;const forecast=forecasts.get(event.id);if(!forecast)continue;const ref=audit.doc(event.id),snap=await ref.get();if(snap.exists)continue;const economy=event.currency==='USD'?'USA':event.currency==='EUR'?'EUROPE':event.currency==='GBP'?'UK':event.currency==='ZAR'?'SOUTH_AFRICA':event.currency==='JPY'?'JAPAN':null,topFamilies=engine.topFamilies?.find(x=>x.economy===economy)?.families?.slice(0,20).map(x=>({code:x.code,weight:x.weight}))||[];await ref.set({eventId:event.id,event:event.event,currency:event.currency,releaseAt:event.date,frozenAt:new Date().toISOString(),consensus:forecast.consensus,predictedActual:forecast.predictedActual,probabilities:forecast.probabilities,confidence:forecast.confidence,eventEdge:forecast.eventEdge,topFamilies,scored:false});count++;}return count;}
function buildFredCatalog(universe){const series=(universe?.series||[]).map(x=>({id:x.seriesId,title:x.title||x.seriesId,units:x.units||'',frequency:x.frequency||'',categories:[x.category||'fxga-core'],importance:x.curated?'critical':'high',economy:x.economy||'USA'})),counts=new Map();for(const s of series)for(const c of s.categories)counts.set(c,(counts.get(c)||0)+1);return {total:series.length,curatedBase:FRED_BASE_IDS.length,maxSeriesPerRequest:220,categories:[...counts].map(([id,count])=>({id,label:id.replace(/[-_]/g,' '),description:'Important macro family',count})),series,policy:{importantOnly:true,scope:'Primary macro collector',globalCoverage:TARGET_ECONOMIES,dynamicTarget:180}};}
function group(observations,generatedAt){const economies=Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,[]])),global=[];for(const o of observations){const tags=Array.isArray(o.economies)&&o.economies.length?o.economies:[o.economy||'GLOBAL'];let assigned=false;for(const e of TARGET_ECONOMIES)if(tags.includes(e)){economies[e].push(o);assigned=true;}if(!assigned||tags.includes('GLOBAL'))global.push(o);}return {generatedAt:generatedAt||null,mode:'google-cloud-run-webhook',targetEconomies:TARGET_ECONOMIES,totalObservations:observations.length,counts:Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,economies[e].length])),economies,global};}
function operationalHealth({calendar,macro,news,intelligence}){
  const calendarHealth=calendar?.payload?.sourceHealth||{},newsHealth=news?.sourceHealth||{},observations=macro?.payload?.observations||[],economyCounts=Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,observations.filter(o=>(o.economies||[o.economy]).includes(e)).length])),fredFailures=macro?.payload?.failures||[],staleMacro=observations.filter(o=>o.staleFallback).length,sourceChecks=[...Object.entries(calendarHealth).map(([id,x])=>({id,layer:'calendar',ok:Boolean(x?.ok),details:x})),...Object.entries(newsHealth).map(([id,x])=>({id,layer:'official-news',ok:Boolean(x?.ok),details:x}))];
  const criticalIssues=[];if(observations.length<100)criticalIssues.push(`Macro observation count below 100 (${observations.length})`);for(const [e,count] of Object.entries(economyCounts))if(count<5)criticalIssues.push(`${e} coverage low (${count})`);if(!calendar?.payload?.events?.length)criticalIssues.push('Calendar empty');if(!intelligence?.registry?.totalMethods)criticalIssues.push('Intelligence not initialized');
  const macroQuality=macro?.payload?.coverageQuality||{requested:macro?.payload?.requested||0,liveFetched:macro?.payload?.liveFetched??macro?.payload?.fetchedNow??0,retainedLastKnownGood:staleMacro,usableObservations:observations.length,unresolved:Math.max(0,Number(macro?.payload?.requested||0)-observations.length),liveCoveragePercent:null,effectiveCoveragePercent:null,status:'unknown'},failureDiagnostics=macro?.payload?.failureDiagnostics||macroFailureDiagnostics(fredFailures,macroQuality.requested,macroQuality.liveFetched,staleMacro,observations.length);if(Number(macroQuality.effectiveCoveragePercent??100)<75)criticalIssues.push(`Macro effective coverage below 75% (${macroQuality.effectiveCoveragePercent}%)`);
  return {generatedAt:new Date().toISOString(),status:criticalIssues.length?'degraded':'healthy',criticalIssues,calendarEvents:calendar?.payload?.events?.length||0,macroObservations:observations.length,fredRequested:macro?.payload?.requested||0,fredLiveFetched:macro?.payload?.liveFetched??macro?.payload?.fetchedNow??null,fredFailures:fredFailures.length,staleMacroRetained:staleMacro,macroQuality,failureDiagnostics,officialNewsItems:news?.items?.length||0,staleNewsRetained:news?.staleRetained||0,economyCounts,sourceChecks,agesMinutes:{calendar:ageMinutes(calendar?.payload?.generatedAt||calendar?.updatedAt),macro:ageMinutes(macro?.payload?.generatedAt||macro?.updatedAt),news:ageMinutes(news?.generatedAt),intelligence:ageMinutes(intelligence?.generatedAt)}};
}
export async function refreshSuperEconomist({forceNews=false}={}){
  const [calendar,macro,universe,market]=await Promise.all([get('calendar'),get('macro'),get('fred-universe'),get('market')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],marketData=market?.payload?.assets||[],news=await ensureNews(forceNews),skills=await reliability();
  let memorySummary=null,memoryEvaluation={evaluatedHorizons:0,completed:0,expired:0};
  try{const evaluated=await evaluateDecisionMemory({limit:60});memorySummary=evaluated.summary;memoryEvaluation={evaluatedHorizons:evaluated.evaluatedHorizons,completed:evaluated.completed,expired:evaluated.expired};}catch(error){console.warn('Decision memory evaluation deferred:',String(error?.message||error).slice(0,220));memorySummary=await readDecisionMemorySummary().catch(()=>null);}
  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary});const frozen=await freeze(engine,events);
  let memoryRecord={recorded:0,skipped:0,total:0};try{memoryRecord=await recordDecisionMemory(engine,marketData);}catch(error){console.warn('Decision memory recording deferred:',String(error?.message||error).slice(0,220));}
  let payload={...engine,news:news.items||[],newsSourceHealth:news.sourceHealth||{},fredCatalog:buildFredCatalog(universe?.payload),globalMacro:group(observations,macro?.payload?.generatedAt),audit:{frozenThisRun:frozen,scoredThisRun:scored,decisionMemory:{...memoryEvaluation,...memoryRecord}}};payload={...payload,operationalHealth:operationalHealth({calendar,macro,news,intelligence:payload})};
  const changed=await putChanged('intelligence',payload),webhook=changed?await safeWebhook('intelligence-snapshot',payload):{sent:false,reason:'unchanged'};return {changed,webhook,registry:payload.registry,coverage:payload.coverage,audit:payload.audit,operationalHealth:payload.operationalHealth,economies:payload.economyAnalysis.economies.length,observations:observations.length};
}
export async function superHealth(){const [calendar,macro,intelligence,universe,news]=await Promise.all([get('calendar'),get('macro'),get('intelligence'),get('fred-universe'),get('news')]),context={hasMacro:Boolean(macro?.payload?.observations?.length),hasCalendar:Boolean(calendar?.payload?.events?.length),hasNews:Boolean(intelligence?.payload?.news?.length),hasMarketData:false,hasAltData:false};return {ok:true,service:'fxga-cloud-run-collector',version:SERVICE_VERSION,architecture:'google-cloud-only-acquisition-and-intelligence',methodRegistry:registrySummary(context),calendarUpdatedAt:calendar?.updatedAt??null,macroUpdatedAt:macro?.updatedAt??null,intelligenceUpdatedAt:intelligence?.updatedAt??null,fredUniverse:universe?.payload?.summary??{curatedBase:FRED_BASE_IDS.length},targetEconomies:TARGET_ECONOMIES,operationalHealth:intelligence?.payload?.operationalHealth??operationalHealth({calendar,macro,news:news?.payload||{},intelligence:intelligence?.payload||{}}),cloudflareRole:'signed-webhook-receiver-and-serving-only'};}
export async function fullState(){const [calendar,macro,sourceHealth,fredUniverse,news,intelligence,familySkill]=await Promise.all([get('calendar'),get('macro'),get('source-health'),get('fred-universe'),get('news'),get('intelligence'),get('family-skill')]);return {calendar,macro,sourceHealth,fredUniverse,news,intelligence,familySkill};}
export async function intelligenceState(){return (await get('intelligence'))?.payload||null;}
export function registrySearch(args){return searchRegistry(args);}
