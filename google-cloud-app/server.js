import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
const TARGET_ECONOMIES = ['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const db = new Firestore({ projectId:PROJECT_ID, ignoreUndefinedProperties:true });
const state = db.collection('fxga_collector_state');
const chunks = db.collection('fxga_collector_state_chunks');
const releaseSnapshots = db.collection('fxga_release_snapshots');
const cache = new Map();
const CACHE_MS = 2500;
const INTELLIGENCE_CACHE_MS = 5000;

const SOURCE_VIEW = [
  {id:'macro-primary',name:'FRED Economic Data',category:'Macro Data API',region:'Global',status:'live',note:'Primary macroeconomic series persisted by the Google Cloud collector.'},
  {id:'market-ensemble',name:'FXGA Market Data Ensemble',category:'Market Data',region:'Global',status:'live',note:'Quota-governed market sources collected and normalized in Google Cloud.'},
  {id:'calendar-primary',name:'Global Economic Calendar',category:'Economic Calendar',region:'Global',status:'live',note:'Persisted release calendar and release-history state.'},
  {id:'official-publications',name:'Official Central Bank & Statistics Feeds',category:'Official Publications',region:'Global',status:'live',note:'Primary-source policy and statistical publications.'},
  {id:'decision-research',name:'Decision Research Engine',category:'Research & Risk',region:'Global',status:'live',note:'Institutional research, calibration, risk and decision intelligence computed in Google Cloud.'},
];

const SECURITY_HEADERS = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy':'same-origin',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, OPTIONS',
  'Access-Control-Allow-Headers':'Accept, Cache-Control, Content-Type',
  'Access-Control-Max-Age':'86400',
};

function chunkDocId(name,generation,index){return `${name}__${generation}__${String(index).padStart(4,'0')}`;}
function jsonBody(payload){return Buffer.from(JSON.stringify(payload));}
function send(res,status,body,headers={}){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(String(body));
  res.writeHead(status,{...SECURITY_HEADERS,'Content-Length':String(bytes.length),...headers});
  res.end(bytes);
}
function sendJson(res,status,payload,cacheControl='no-store'){
  return send(res,status,jsonBody(payload),{'Content-Type':'application/json; charset=utf-8','Cache-Control':cacheControl});
}
function apiError(res,status,message){return sendJson(res,status,{error:message});}
function compactQualityAudit(audit){if(!audit||typeof audit!=='object')return audit;const {methods,...rest}=audit;return rest;}
function compactResearch(intel){
  if(!intel?.research)return null;
  const research={...intel.research};
  if(research.qualityCalibrationEvidence)research.qualityCalibrationEvidence=compactQualityAudit(research.qualityCalibrationEvidence);
  return {...research,decisionCore:intel.decisionGovernance??null,decisionMemory:intel.decisionMemory??null,intelligenceGeneratedAt:intel.generatedAt??null};
}
function compactPublicIntelligence(intel){
  if(!intel||typeof intel!=='object')return intel;
  const {executionLocation,collectorMode,...rest}=intel;
  const output={...rest};
  if(output.qualityCalibrationEvidence)output.qualityCalibrationEvidence=compactQualityAudit(output.qualityCalibrationEvidence);
  if(output.research)output.research=compactResearch(intel);
  if(output.sessionSignals?.researchSummary?.qualityCalibrationEvidence){
    output.sessionSignals={...output.sessionSignals,researchSummary:{...output.sessionSignals.researchSummary,qualityCalibrationEvidence:compactQualityAudit(output.sessionSignals.researchSummary.qualityCalibrationEvidence)}};
  }
  return output;
}
function normalizeObservation(item={}){
  return {
    seriesId:String(item.seriesId??''),title:String(item.title??item.seriesId??''),
    value:typeof item.value==='number'?item.value:null,date:typeof item.date==='string'?item.date:null,
    previous:typeof item.previous==='number'?item.previous:null,change:typeof item.change==='number'?item.change:null,
    units:String(item.units??''),frequency:String(item.frequency??''),categories:Array.isArray(item.categories)?item.categories.map(String):[],
    economy:typeof item.economy==='string'?item.economy:undefined,economies:Array.isArray(item.economies)?item.economies.map(String):undefined,
    importance:item.importance==='critical'?'critical':'high',source:typeof item.source==='string'?item.source:'Primary data network',
    lastUpdated:typeof item.lastUpdated==='string'?item.lastUpdated:undefined,
    history:Array.isArray(item.history)?item.history.filter(x=>x&&typeof x.date==='string'&&typeof x.value==='number'):[],
  };
}
function groupMacro(observations,generatedAt=null){
  const economies=Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,[]])),global=[];
  for(const observation of observations){
    const tags=Array.isArray(observation.economies)&&observation.economies.length?observation.economies:[observation.economy||'GLOBAL'];
    let assigned=false;
    for(const economy of TARGET_ECONOMIES)if(tags.includes(economy)){economies[economy].push(observation);assigned=true;}
    if(!assigned||tags.includes('GLOBAL'))global.push(observation);
  }
  return {generatedAt,mode:'google-cloud-direct',targetEconomies:TARGET_ECONOMIES,totalObservations:observations.length,counts:Object.fromEntries(TARGET_ECONOMIES.map(e=>[e,economies[e].length])),economies,global};
}
function filterMacro(observations,url){
  let selected=observations;
  const raw=url.searchParams.get('series');
  if(raw){const ids=new Set(raw.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean));selected=selected.filter(x=>ids.has(x.seriesId.toUpperCase()));}
  const category=url.searchParams.get('category');if(category)selected=selected.filter(x=>x.categories?.includes(category));
  const q=url.searchParams.get('q')?.toLowerCase();if(q)selected=selected.filter(x=>`${x.seriesId} ${x.title} ${(x.categories||[]).join(' ')}`.toLowerCase().includes(q));
  const limit=Math.min(220,Math.max(1,Number(url.searchParams.get('limit')||16)));return selected.slice(0,limit);
}

async function readState(name,ttl=name==='intelligence'?INTELLIGENCE_CACHE_MS:CACHE_MS){
  const cached=cache.get(name);if(cached&&Date.now()-cached.at<ttl)return cached.value;
  const snap=await state.doc(name).get();if(!snap.exists){cache.set(name,{at:Date.now(),value:null});return null;}
  const data=snap.data();
  if(!data?.chunked){cache.set(name,{at:Date.now(),value:data});return data;}
  const generation=String(data.generation||''),count=Number(data.chunkCount||0);
  if(!generation||!Number.isInteger(count)||count<1)throw new Error(`Chunk manifest for ${name} is invalid`);
  const parts=[];
  for(let i=0;i<count;i+=8){
    const indexes=Array.from({length:Math.min(8,count-i)},(_,offset)=>i+offset);
    const snaps=await Promise.all(indexes.map(index=>chunks.doc(chunkDocId(name,generation,index)).get()));
    for(let j=0;j<snaps.length;j++){
      if(!snaps[j].exists)throw new Error(`Chunk ${indexes[j]+1}/${count} missing for ${name}`);
      const encoded=snaps[j].data()?.data;if(typeof encoded!=='string')throw new Error(`Chunk ${indexes[j]+1}/${count} invalid for ${name}`);
      parts[indexes[j]]=Buffer.from(encoded,'base64');
    }
  }
  const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
  const value={...data,payload};cache.set(name,{at:Date.now(),value});return value;
}
async function readStateMeta(name){
  const snap=await state.doc(name).get();if(!snap.exists)return null;const data=snap.data();
  return {updatedAt:data?.updatedAt??null,hash:data?.hash??null,chunked:Boolean(data?.chunked),byteLength:data?.byteLength??null};
}
async function liteState(){
  const [calendar,macro,market,technical,eventStudies]=await Promise.all(['calendar','macro','market','technical','event-studies'].map(x=>readState(x)));
  return {calendar,macro,market,technical,eventStudies};
}
function macroCoverage(macro,observations){
  const existing=macro?.payload?.coverageQuality||{};
  const requested=Math.max(1,Number(existing.requested??macro?.payload?.requested??macro?.payload?.universeSummary?.total??observations.length));
  const usable=Number(existing.usableObservations??observations.length);
  const effective=Number(existing.effectiveCoveragePercent??((usable/requested)*100));
  const live=Number(existing.liveCoveragePercent??effective);
  return {...existing,requested,usableObservations:usable,effectiveCoveragePercent:Number(effective.toFixed(1)),liveCoveragePercent:Number(live.toFixed(1)),status:existing.status??(effective>=90?'strong':effective>=75?'acceptable':'degraded')};
}

async function api(req,res,url){
  if(req.method==='OPTIONS')return send(res,204,'',{'Cache-Control':'public, max-age=86400'});
  if(req.method!=='GET')return apiError(res,405,'Method not allowed');
  if(url.pathname==='/api/health'){
    const [calendar,macro,intelligence,market,technical]=await Promise.all(['calendar','macro','intelligence','market','technical'].map(readStateMeta));
    return sendJson(res,200,{ok:true,app:'FXGA Macro Intelligence',architecture:'google-cloud-processing-cloudflare-static-hosting',compute:'Google Cloud Run',state:'Google Cloud Firestore',websiteHost:'Cloudflare Static Assets',cloudflareRole:'static-host-only',cloudflareProcessing:false,cloudflareUpstreamRequests:0,timestamp:new Date().toISOString(),updatedAt:{calendar:calendar?.updatedAt??null,macro:macro?.updatedAt??null,intelligence:intelligence?.updatedAt??null,market:market?.updatedAt??null,technical:technical?.updatedAt??null}});
  }
  if(url.pathname==='/api/sources')return sendJson(res,200,{sources:SOURCE_VIEW},'public, max-age=30');
  if(url.pathname==='/api/research'){
    const intel=(await readState('intelligence'))?.payload;const research=compactResearch(intel);
    return research?sendJson(res,200,research,'public, max-age=5'):apiError(res,503,'Research snapshot is not initialized');
  }
  if(url.pathname==='/api/scenarios'){
    const intel=(await readState('intelligence'))?.payload;const scenarios=intel?.research?.scenarios;
    return Array.isArray(scenarios)?sendJson(res,200,{generatedAt:intel.research.generatedAt,scenarios},'public, max-age=5'):apiError(res,503,'Scenario research is not initialized');
  }
  if(url.pathname==='/api/release-analytics'){
    const intel=(await readState('intelligence'))?.payload;return intel?.research?.releaseAnalytics?sendJson(res,200,intel.research.releaseAnalytics,'public, max-age=5'):apiError(res,503,'Release analytics are not initialized');
  }
  if(url.pathname==='/api/super-economist'||url.pathname==='/api/decision-intelligence'){
    const intel=(await readState('intelligence'))?.payload;return intel?sendJson(res,200,compactPublicIntelligence(intel),'public, max-age=3'):apiError(res,503,'Decision research is not initialized');
  }

  const s=await liteState();
  const events=Array.isArray(s.calendar?.payload?.events)?s.calendar.payload.events:[];
  const observations=(Array.isArray(s.macro?.payload?.observations)?s.macro.payload.observations:[]).map(normalizeObservation);
  const market=s.market?.payload??{generatedAt:null,source:'FXGA Google Cloud market state',assets:[]};
  const technical=s.technical?.payload??{generatedAt:null,methodology:'evidence-gated-multi-timeframe-market-structure',counts:{assets:0,confirmed:0,contextAligned:0,conflict:0,warming:0},assets:{}};

  if(url.pathname==='/api/data-quality'){
    const macro=s.macro??{},coverage=macroCoverage(macro,observations),diag=macro.payload?.failureDiagnostics??{},marketAssets=Array.isArray(market.assets)?market.assets:[];
    return sendJson(res,200,{generatedAt:macro.payload?.generatedAt??macro.updatedAt??null,macro:{coverage,failures:{total:Number(diag.total??macro.payload?.failures?.length??0),retryable:Number(diag.retryable??0),nonRetryable:Number(diag.nonRetryable??0),unresolved:Number(diag.unresolved??Math.max(0,coverage.requested-observations.length)),byType:diag.byType??{},byEconomy:diag.byEconomy??{},byCategory:diag.byCategory??{},series:(Array.isArray(macro.payload?.failures)?macro.payload.failures:[]).slice(0,40)}},market:{assets:marketAssets.length,priced:marketAssets.filter(x=>typeof x.price==='number'&&Number.isFinite(x.price)).length,stale:marketAssets.filter(x=>x.stale).length},technical:{assets:Object.keys(technical.assets??{}).length,confirmed:Number(technical.counts?.confirmed??0),warming:Number(technical.counts?.warming??0)},calendar:{events:events.length,sourceHealth:s.calendar?.payload?.sourceHealth??{}},publicPolicy:'Quality metrics describe persisted Google Cloud evidence. Unavailable evidence is never synthesized.'},'public, max-age=5');
  }
  if(url.pathname==='/api/market-prices')return sendJson(res,200,market,'public, max-age=2');
  if(url.pathname==='/api/technical')return sendJson(res,200,technical,'public, max-age=3');
  if(url.pathname==='/api/calendar-history'){
    const days=Math.min(7,Math.max(1,Number(url.searchParams.get('days')||7))),now=Date.now(),cutoff=now-days*86400000;
    return sendJson(res,200,{generatedAt:s.calendar?.payload?.generatedAt??null,days,events:events.filter(e=>{const time=Date.parse(e.date);return Number.isFinite(time)&&time<=now&&time>=cutoff;})},'public, max-age=5');
  }
  if(url.pathname==='/api/calendar'){
    const days=Math.min(31,Math.max(1,Number(url.searchParams.get('days')||7))),importance=Math.min(3,Math.max(1,Number(url.searchParams.get('importance')||1))),cutoff=Date.now()+days*86400000;
    return sendJson(res,200,{events:events.filter(e=>Number(e.importance??1)>=importance&&Date.parse(e.date)<=cutoff).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)),cached:true,mode:'google-cloud-direct',calendarSyncedAt:s.calendar?.payload?.generatedAt??null},'public, max-age=5');
  }
  if(url.pathname==='/api/event-studies'){
    const days=Math.min(7,Math.max(1,Number(url.searchParams.get('days')||7))),currency=(url.searchParams.get('currency')||'').toUpperCase(),cutoff=Date.now()-days*86400000;
    let studies=Array.isArray(s.eventStudies?.payload?.studies)?s.eventStudies.payload.studies:[];studies=studies.filter(study=>Date.parse(study.releaseAt)>=cutoff&&(!currency||study.currency===currency));
    return sendJson(res,200,{generatedAt:s.eventStudies?.payload?.generatedAt??null,days,currency:currency||null,summary:s.eventStudies?.payload?.summary??{studies:studies.length,measuredHorizons:0,byHorizon:{}},studies},'public, max-age=5');
  }
  if(url.pathname==='/api/technical-history'){
    const asset=(url.searchParams.get('asset')||'EURUSD').toUpperCase(),timeframe=(url.searchParams.get('timeframe')||'H1').toUpperCase(),frame=technical.assets?.[asset]?.timeframes?.[timeframe];
    return frame?sendJson(res,200,{generatedAt:technical.generatedAt??null,asset,timeframe,bias:frame.bias,quality:frame.quality,history:frame.history??[]}):apiError(res,404,'Technical history is not available for the requested asset/timeframe');
  }
  if(url.pathname==='/api/global-macro')return sendJson(res,200,groupMacro(observations,s.macro?.payload?.generatedAt??null),'public, max-age=5');
  if(url.pathname==='/api/fred'){
    const series=filterMacro(observations,url);return sendJson(res,200,{series,selection:{cachedOnly:true,source:'verified Google Cloud Firestore macro state',count:series.length}},'public, max-age=10');
  }
  if(url.pathname==='/api/fred/catalog')return sendJson(res,200,{total:observations.length,series:observations.map(x=>({id:x.seriesId,title:x.title,units:x.units,frequency:x.frequency,categories:x.categories})),categories:[],policy:{importantOnly:true,scope:'persisted primary-source macro data'}},'public, max-age=30');
  if(url.pathname==='/api/acquisition/catalog')return sendJson(res,200,{methods:[],sources:SOURCE_VIEW,status:{inFlightSources:0,sources:SOURCE_VIEW.length},limits:{applicationServiceExternalAcquisition:0},policy:{applicationServiceAcquisitionDisabled:true,allAcquisitionRunsInPrivateGoogleCloudCollector:true}},'public, max-age=30');
  if(url.pathname==='/api/acquire')return apiError(res,409,'Direct acquisition is disabled on the public application service. The private Google Cloud collector owns acquisition.');

  const intel=(await readState('intelligence'))?.payload;
  if(url.pathname==='/api/analysis')return intel?.macroAnalysis?sendJson(res,200,intel.macroAnalysis,'public, max-age=5'):apiError(res,503,'Analysis snapshot is not initialized');
  if(url.pathname==='/api/economy-analysis')return intel?.economyAnalysis?sendJson(res,200,intel.economyAnalysis,'public, max-age=5'):apiError(res,503,'Economy analysis is not initialized');
  if(url.pathname==='/api/release-impact')return intel?.releaseImpact?sendJson(res,200,intel.releaseImpact,'public, max-age=5'):apiError(res,503,'Release impact is not initialized');
  if(url.pathname==='/api/news'){
    const news=(await readState('news'))?.payload;return sendJson(res,200,{items:Array.isArray(news?.items)?news.items:Array.isArray(intel?.news)?intel.news:[],mode:'google-cloud-direct'},'public, max-age=10');
  }
  if(url.pathname==='/api/session-signals'){
    if(!intel?.sessionSignals)return apiError(res,503,'Currency outlook is not initialized');
    const technicalAssets=technical.assets??{};
    const applyTechnical=signal=>{const gate=technicalAssets[String(signal?.symbol||'').toUpperCase()]?.decisionGate??null,macroDirection=String(signal?.direction||'WAIT').toUpperCase(),aligned=gate?.status==='confirmed'&&((macroDirection==='BUY'&&gate.direction==='bullish')||(macroDirection==='SELL'&&gate.direction==='bearish'));return {...signal,technicalGate:gate?.status??'warming',technicalBias:gate?.direction??'neutral',technicalConfidence:Number(gate?.confidence??0),technicalModel:gate?.model??null,technicalReason:gate?.reason??'Awaiting verified price history.',executionGate:macroDirection==='WAIT'?'NO_DIRECTIONAL_EXECUTION':aligned?'TECHNICAL_CONFIRMATION_PASSED':'AWAIT_TECHNICAL_CONFIRMATION'};};
    const sessions=(intel.sessionSignals.sessions??[]).map(session=>({...session,signals:(session.signals??[]).map(applyTechnical)})),rankedOpportunities=(intel.sessionSignals.rankedOpportunities??[]).map(applyTechnical),technicalExecutableCount=rankedOpportunities.filter(x=>x.executionGate==='TECHNICAL_CONFIRMATION_PASSED').length;
    return sendJson(res,200,{...intel.sessionSignals,sessions,rankedOpportunities,decisionSummary:{...(intel.sessionSignals.decisionSummary??{}),technicalExecutableCount,actionableCount:technicalExecutableCount},economyObservationCount:observations.length,technicalGeneratedAt:technical.generatedAt??null},'public, max-age=3');
  }
  if(url.pathname==='/api/dashboard'){
    const now=Date.now(),calendar=events.filter(e=>Date.parse(e.date)>=now-7*86400000).slice(0,600),news=(await readState('news'))?.payload?.items??intel?.news??[];
    return sendJson(res,200,{generatedAt:intel?.generatedAt??s.macro?.updatedAt??new Date().toISOString(),macro:observations.slice(0,80),calendar,market:Array.isArray(market.assets)?market.assets:[],news,sources:SOURCE_VIEW,errors:[]},'public, max-age=3');
  }
  if(url.pathname==='/api/release-state'){
    const now=Date.now(),upcoming=events.filter(e=>Date.parse(e.date)>=now).slice(0,250).map(event=>({event,releaseAt:event.date})),active=events.filter(e=>Math.abs(Date.parse(e.date)-now)<=10*60000).map(event=>({event,releaseAt:event.date})),recent=events.filter(e=>Date.parse(e.date)<now&&Date.parse(e.date)>=now-6*3600000).slice(-100).map(event=>({event,releaseAt:event.date}));
    return sendJson(res,200,{initialized:Boolean(events.length&&observations.length),mode:'google-cloud-direct',calendarSyncedAt:s.calendar?.payload?.generatedAt??null,nextReleaseAt:upcoming?.[0]?.event?.date??null,active,upcoming,recent,baseline:intel?.macroAnalysis?{generatedAt:intel.generatedAt,analysis:intel.macroAnalysis,observations}:null,stats:{applicationServiceUpstreamAcquisitionRequests:0}},'public, max-age=3');
  }
  if(url.pathname==='/api/release-history'){
    const id=url.searchParams.get('id')?.trim();if(!id)return apiError(res,400,'id is required');
    const snap=await releaseSnapshots.orderBy('capturedAt','desc').limit(60).get();const snapshots=[];
    for(const doc of snap.docs){const data=doc.data(),matches=(Array.isArray(data.changed)?data.changed:[]).filter(e=>e?.id===id);if(matches.length)snapshots.push({capturedAt:data.capturedAt,releaseAt:data.releaseAt,offsetSeconds:data.offsetSeconds,events:matches});}
    return sendJson(res,200,{id,snapshots},'public, max-age=5');
  }
  return apiError(res,404,'API route not found');
}

const mime = new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.ico','image/x-icon'],['.woff2','font/woff2'],['.bmp','image/bmp']
]);
async function serveStatic(req,res,url){
  let requestPath=decodeURIComponent(url.pathname);if(requestPath==='/'||requestPath==='')requestPath='/index.html';
  const candidate=path.normalize(path.join(DIST,requestPath));
  if(!candidate.startsWith(DIST))return apiError(res,403,'Forbidden');
  try{
    const info=await stat(candidate);if(info.isFile()){const bytes=await readFile(candidate),ext=path.extname(candidate).toLowerCase(),immutable=requestPath.startsWith('/assets/');return send(res,200,bytes,{'Content-Type':mime.get(ext)||'application/octet-stream','Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache'});}
  }catch{}
  const index=await readFile(path.join(DIST,'index.html'));return send(res,200,index,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
}

const wss=new WebSocketServer({noServer:true});
let watchTimer=null,lastIntelVersion='';
async function pollUpdates(){
  if(!wss.clients.size)return;
  try{const meta=await readStateMeta('intelligence'),version=`${meta?.updatedAt||''}:${meta?.hash||''}`;if(lastIntelVersion&&version&&version!==lastIntelVersion){const message=JSON.stringify({type:'google-cloud-update',updateType:'intelligence-snapshot',timestamp:meta?.updatedAt??new Date().toISOString()});for(const client of wss.clients)if(client.readyState===WebSocket.OPEN)client.send(message);}if(version)lastIntelVersion=version;}catch{}
}
function ensureWatcher(){if(watchTimer||!wss.clients.size)return;watchTimer=setInterval(pollUpdates,10000);pollUpdates();}
function stopWatcher(){if(wss.clients.size||!watchTimer)return;clearInterval(watchTimer);watchTimer=null;}
wss.on('connection',socket=>{socket.send(JSON.stringify({type:'connected',channel:'google-cloud-live',timestamp:new Date().toISOString()}));ensureWatcher();socket.on('close',stopWatcher);});

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  try{if(url.pathname.startsWith('/api/'))return await api(req,res,url);return await serveStatic(req,res,url);}catch(error){console.error(error);return apiError(res,500,String(error?.message||error).slice(0,1000));}
});
server.on('upgrade',(req,socket,head)=>{const url=new URL(req.url||'/','http://localhost');if(url.pathname!=='/api/live'){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
server.listen(PORT,()=>console.log(`FXGA Google Cloud application listening on :${PORT}; Cloudflare hosts static files only and all application processing remains in Google Cloud`));
