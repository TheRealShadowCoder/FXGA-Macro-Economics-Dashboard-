import crypto from 'node:crypto';
import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { refreshSuperEconomist, syncFullMacroFromUniverse, superHealth, fullState, intelligenceState, registrySearch } from './super-runtime.js';
import { backfillEventStudies } from './event-study-backfill.js';
import { collectFreeTierMarketData } from './free-market-data-v2.js';
import { freeTierBudgetStatus } from './market-data-budget.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const db=new Firestore({ignoreUndefinedProperties:true});
const collectorState=db.collection('fxga_collector_state');

// FRED keeps its existing conservative single queue. Other providers are governed by
// market-data-budget.js with persistent Firestore counters across Cloud Run instances.
const nativeFetch=globalThis.fetch.bind(globalThis);
const FRED_MIN_INTERVAL_MS=1050;
let fredNextAt=0;
let fredQueue=Promise.resolve();

async function runFredRequest(input,init){
  for(let attempt=0;attempt<6;attempt++){
    const wait=Math.max(0,fredNextAt-Date.now());
    if(wait)await sleep(wait);
    fredNextAt=Date.now()+FRED_MIN_INTERVAL_MS;
    const response=await nativeFetch(input,init);
    if(![429,500,502,503,504].includes(response.status)||attempt===5)return response;
    const retryHeader=Number(response.headers.get('retry-after'));
    await response.arrayBuffer().catch(()=>{});
    const retryMs=Number.isFinite(retryHeader)&&retryHeader>0?retryHeader*1000:[5000,10000,20000,30000,45000,60000][attempt];
    console.warn(`FRED HTTP ${response.status}; retrying attempt ${attempt+2}/6 after ${retryMs}ms`);
    await sleep(retryMs);
  }
  return nativeFetch(input,init);
}

globalThis.fetch=(input,init)=>{
  try{
    const raw=typeof input==='string'||input instanceof URL?String(input):input?.url;
    const url=new URL(raw);
    if(url.hostname==='api.stlouisfed.org'){
      const task=fredQueue.then(()=>runFredRequest(input,init),()=>runFredRequest(input,init));
      fredQueue=task.then(()=>undefined,()=>undefined);
      return task;
    }
  }catch{}
  return nativeFetch(input,init);
};

const publicPort=Number(process.env.PORT||8080);
const internalPort=publicPort===8081?8082:8081;
process.env.PORT=String(internalPort);
await import('./server-v2.js');

async function waitInternal(){
  for(let i=0;i<30;i++){
    try{const r=await fetch(`http://127.0.0.1:${internalPort}/health`);if(r.ok)return;}catch{}
    await sleep(100);
  }
  throw new Error('Internal collector did not start');
}
await waitInternal();

function stableHash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function finite(value){if(typeof value==='number'&&Number.isFinite(value))return value;if(value==null||value==='')return null;const n=Number(String(value).replace(/,/g,'').replace(/%/g,'').trim());return Number.isFinite(n)?n:null;}
function sendJson(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  res.end(body);
}
async function bodyOf(req){const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
function headersOf(req){const h={};for(const [k,v] of Object.entries(req.headers))if(v!=null&&!['host','content-length','connection'].includes(k))h[k]=Array.isArray(v)?v.join(', '):v;return h;}

async function proxyCapture(req,url){
  const body=['GET','HEAD'].includes(req.method||'GET')?undefined:await bodyOf(req);
  const upstream=await fetch(`http://127.0.0.1:${internalPort}${url.pathname}${url.search}`,{method:req.method,headers:headersOf(req),body:body?.length?body:undefined,redirect:'manual'});
  const bytes=Buffer.from(await upstream.arrayBuffer()),headers={};
  upstream.headers.forEach((v,k)=>{if(!['transfer-encoding','content-encoding','connection','content-length'].includes(k))headers[k]=v;});
  return {status:upstream.status,bytes,headers};
}
function relay(res,captured){const headers={...captured.headers,'content-length':String(captured.bytes.length)};res.writeHead(captured.status,headers);res.end(captured.bytes);}
async function proxy(req,res,url){const captured=await proxyCapture(req,url);relay(res,captured);return captured.status;}

function mergeCanonical(base,preferred){
  const next={...base};
  for(const field of ['price','change','changePercent','open','high','low','previousClose','volume','bid','ask','bidSize','askSize']){
    if(finite(preferred?.[field])!=null)next[field]=preferred[field];
  }
  next.source=preferred.source;
  next.sourceUrl=preferred.sourceUrl;
  next.fetchedAt=preferred.fetchedAt;
  next.providerTimestamp=preferred.providerTimestamp;
  next.mode='delegated-primary-with-cnbc-fallback';
  next.stale=false;
  next.sourceStack=[...new Set([preferred.source,base?.source].filter(Boolean))];
  next.fallbackSource=base?.source||null;
  return next;
}

async function signedMarketWebhook(payload){
  const webhookUrl=process.env.CLOUDFLARE_WEBHOOK_URL||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev/api/collector-webhook';
  const secret=process.env.COLLECTOR_WEBHOOK_SECRET||'';
  if(!secret||!webhookUrl)return {sent:false,reason:'not-configured'};
  const body=JSON.stringify({version:1,type:'market-snapshot',generatedAt:new Date().toISOString(),payload});
  const timestamp=String(Date.now()),requestId=crypto.randomUUID();
  const signature=crypto.createHmac('sha256',secret).update(`${timestamp}.${requestId}.${body}`).digest('hex');
  try{
    const response=await fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json','X-FXGA-Timestamp':timestamp,'X-FXGA-Request-Id':requestId,'X-FXGA-Signature':`sha256=${signature}`},body});
    return {sent:response.ok,status:response.status};
  }catch(error){return {sent:false,error:String(error?.message||error).slice(0,220)};}
}

async function augmentMarketState(){
  const delegated=await collectFreeTierMarketData();
  const ref=collectorState.doc('market');
  const snap=await ref.get();
  const stored=snap.exists?snap.data():null;
  const base=stored?.payload||{generatedAt:null,source:'CNBC',assets:[]};
  const canonical=new Map((delegated.canonicalFx||[]).filter(asset=>finite(asset.price)!=null).map(asset=>[asset.id,asset]));
  const merged=[];
  const seen=new Set();
  for(const asset of Array.isArray(base.assets)?base.assets:[]){
    const preferred=canonical.get(asset.id);
    const next=preferred?mergeCanonical(asset,preferred):asset;
    merged.push(next);seen.add(next.id);
  }
  for(const asset of canonical.values())if(!seen.has(asset.id)){merged.push(asset);seen.add(asset.id);}
  for(const asset of [...(delegated.contextAssets||[]),...(delegated.microstructureAssets||[])]){
    if(!asset?.id||seen.has(asset.id)||finite(asset.price)==null)continue;
    merged.push(asset);seen.add(asset.id);
  }
  const payload={
    ...base,
    generatedAt:new Date().toISOString(),
    source:'FXGA delegated free-tier market ensemble',
    assets:merged,
    requested:merged.length,
    live:merged.filter(asset=>finite(asset.price)!=null&&!asset.stale).length,
    failed:merged.filter(asset=>finite(asset.price)==null).length,
    delegatedMarketData:{
      architecture:delegated.architecture,
      policy:delegated.policy,
      counts:delegated.counts,
      sources:delegated.sources,
      slowFxCrossChecks:delegated.slowFxCrossChecks,
      nasdaqDataLink:delegated.nasdaqDataLink,
      budget:delegated.budget,
      publicMicrostructurePolicies:delegated.publicMicrostructurePolicies,
      durationMs:delegated.durationMs,
    },
    collectionArchitecture:'CNBC last-known-good + metered free-tier delegation + public derivatives and spot microstructure',
  };
  const nextHash=stableHash(payload),changed=stored?.hash!==nextHash,updatedAt=new Date().toISOString();
  if(changed)await ref.set({hash:nextHash,updatedAt,payload},{merge:false});
  const webhook=changed?await signedMarketWebhook(payload):{sent:false,reason:'unchanged'};
  return {changed,webhook,assets:merged.length,canonicalFx:delegated.canonicalFx.length,contextAssets:delegated.contextAssets.length,microstructureAssets:delegated.microstructureAssets.length,providersHealthy:delegated.counts.providersHealthy,budget:delegated.budget};
}

async function mergedState(){
  const research=await fullState();
  try{
    const response=await fetch(`http://127.0.0.1:${internalPort}/state`,{headers:{Accept:'application/json'}});
    if(!response.ok)return research;
    const collector=await response.json();
    return {...research,...collector,news:research.news,intelligence:research.intelligence,familySkill:research.familySkill};
  }catch(error){
    console.warn('Collector state merge unavailable',String(error?.message||error).slice(0,220));
    return research;
  }
}

async function handleMarketAffectingProxy(req,res,url){
  const captured=await proxyCapture(req,url);
  let delegation=null;
  if(captured.status>=200&&captured.status<300){
    try{delegation=await augmentMarketState();}
    catch(error){console.error('Free-tier market augmentation failed',String(error?.message||error).slice(0,400));delegation={changed:false,error:String(error?.message||error).slice(0,300)};}
  }
  const contentType=String(captured.headers['content-type']||'');
  if(delegation&&contentType.includes('application/json')){
    try{
      const original=JSON.parse(captured.bytes.toString('utf8'));
      return sendJson(res,captured.status,{...original,freeTierDelegation:{changed:delegation.changed,assets:delegation.assets,canonicalFx:delegation.canonicalFx,contextAssets:delegation.contextAssets,microstructureAssets:delegation.microstructureAssets,providersHealthy:delegation.providersHealthy}});
    }catch{}
  }
  relay(res,captured);
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/health'){
      const health=await superHealth();
      const budget=await freeTierBudgetStatus().catch(error=>({error:String(error?.message||error).slice(0,220)}));
      return sendJson(res,200,{...health,freeTierMarketData:budget});
    }
    if(req.method==='GET'&&url.pathname==='/market-data-budgets')return sendJson(res,200,await freeTierBudgetStatus());
    if(req.method==='GET'&&url.pathname==='/state')return sendJson(res,200,await mergedState());
    if(req.method==='GET'&&url.pathname==='/super-economist'){
      const x=await intelligenceState();return x?sendJson(res,200,x):sendJson(res,503,{error:'Intelligence state not initialized'});
    }
    if(req.method==='GET'&&url.pathname==='/method-registry')return sendJson(res,200,registrySearch({family:url.searchParams.get('family'),q:url.searchParams.get('q'),offset:url.searchParams.get('offset'),limit:url.searchParams.get('limit')}));
    if(req.method==='POST'&&url.pathname==='/refresh-intelligence'){
      const raw=await bodyOf(req);let input={};try{input=raw.length?JSON.parse(raw.toString('utf8')):{}}catch{}
      return sendJson(res,200,await refreshSuperEconomist({forceNews:Boolean(input.forceNews)}));
    }
    if(req.method==='POST'&&url.pathname==='/event-study-backfill'){
      const raw=await bodyOf(req);let input={};try{input=raw.length?JSON.parse(raw.toString('utf8')):{}}catch{}
      return sendJson(res,200,await backfillEventStudies({days:input.days,maxEvents:input.maxEvents}));
    }
    if(req.method==='POST'&&url.pathname==='/macro-sync'&&String(url.searchParams.get('mode')||'').toLowerCase()==='full'){
      await bodyOf(req);
      const macro=await syncFullMacroFromUniverse();
      const marketResponse=await fetch(`http://127.0.0.1:${internalPort}/market-sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!marketResponse.ok)console.warn('Full macro companion market sync returned',marketResponse.status);
      const delegation=await augmentMarketState();
      const intelligence=await refreshSuperEconomist({forceNews:true});
      return sendJson(res,200,{...macro,freeTierDelegation:{changed:delegation.changed,assets:delegation.assets,providersHealthy:delegation.providersHealthy},intelligence:{observations:intelligence.observations,coverage:intelligence.coverage,audit:intelligence.audit}});
    }
    if(req.method==='POST'&&['/market-sync','/release-check'].includes(url.pathname)){
      await handleMarketAffectingProxy(req,res,url);
      if(url.pathname==='/market-sync')refreshSuperEconomist({forceNews:false}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));
      return;
    }
    if(req.method==='POST'&&url.pathname==='/macro-sync'){
      await handleMarketAffectingProxy(req,res,url);
      refreshSuperEconomist({forceNews:false}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));
      return;
    }
    const status=await proxy(req,res,url);
    if(status>=200&&status<300&&req.method==='POST'&&url.pathname==='/bootstrap'){
      refreshSuperEconomist({forceNews:true}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));
    }
  }catch(error){
    console.error(error);
    if(!res.headersSent)sendJson(res,500,{error:String(error?.message||error).slice(0,1000)});
    else res.end();
  }
});
server.listen(publicPort,()=>console.log(`Macro research gateway v2 on :${publicPort}; collector internal :${internalPort}; free-tier market delegation enabled`));
