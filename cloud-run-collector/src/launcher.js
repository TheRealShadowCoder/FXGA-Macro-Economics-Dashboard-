import http from 'node:http';
import { refreshSuperEconomist, syncFullMacroFromUniverse, superHealth, fullState, intelligenceState, registrySearch } from './super-runtime.js';
import { backfillEventStudies } from './event-study-backfill.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// All upstream collection runs inside the primary data service. FRED requests share one
// conservative queue with temporary-error retry. The application edge never participates.
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
    const retryMs=Number.isFinite(retryHeader)&&retryHeader>0
      ? retryHeader*1000
      : [5000,10000,20000,30000,45000,60000][attempt];
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

function sendJson(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  res.end(body);
}
async function bodyOf(req){
  const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);
}
function headersOf(req){
  const h={};for(const [k,v] of Object.entries(req.headers))if(v!=null&&!['host','content-length','connection'].includes(k))h[k]=Array.isArray(v)?v.join(', '):v;
  return h;
}
async function proxy(req,res,url){
  const body=['GET','HEAD'].includes(req.method||'GET')?undefined:await bodyOf(req);
  const upstream=await fetch(`http://127.0.0.1:${internalPort}${url.pathname}${url.search}`,{method:req.method,headers:headersOf(req),body:body?.length?body:undefined,redirect:'manual'});
  const bytes=Buffer.from(await upstream.arrayBuffer()),headers={};
  upstream.headers.forEach((v,k)=>{if(!['transfer-encoding','content-encoding','connection'].includes(k))headers[k]=v;});
  headers['content-length']=String(bytes.length);
  res.writeHead(upstream.status,headers);res.end(bytes);
  return upstream.status;
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
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/health')return sendJson(res,200,await superHealth());
    if(req.method==='GET'&&url.pathname==='/state')return sendJson(res,200,await mergedState());
    if(req.method==='GET'&&url.pathname==='/super-economist'){
      const x=await intelligenceState();return x?sendJson(res,200,x):sendJson(res,503,{error:'Intelligence state not initialized'});
    }
    if(req.method==='GET'&&url.pathname==='/method-registry'){
      return sendJson(res,200,registrySearch({family:url.searchParams.get('family'),q:url.searchParams.get('q'),offset:url.searchParams.get('offset'),limit:url.searchParams.get('limit')}));
    }
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
      const intelligence=await refreshSuperEconomist({forceNews:true});
      return sendJson(res,200,{...macro,intelligence:{observations:intelligence.observations,coverage:intelligence.coverage,audit:intelligence.audit}});
    }
    const status=await proxy(req,res,url);
    if(status>=200&&status<300&&req.method==='POST'&&['/bootstrap','/release-check','/macro-sync'].includes(url.pathname)){
      const forceNews=url.pathname==='/bootstrap';
      if(url.pathname==='/release-check')fetch(`http://127.0.0.1:${internalPort}/market-sync`,{method:'POST'}).catch(e=>console.warn('Release-aligned market snapshot deferred',String(e?.message||e)));
      refreshSuperEconomist({forceNews}).then(x=>console.log('Intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('Intelligence refresh failed',e));
    }
  }catch(error){
    console.error(error);
    if(!res.headersSent)sendJson(res,500,{error:String(error?.message||error).slice(0,1000)});
    else res.end();
  }
});
server.listen(publicPort,()=>console.log(`Macro research gateway on :${publicPort}; collector internal :${internalPort}`));
