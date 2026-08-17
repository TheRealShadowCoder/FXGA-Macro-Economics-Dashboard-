import http from 'node:http';
import { refreshSuperEconomist, superHealth, fullState, intelligenceState, registrySearch } from './super-runtime.js';

const publicPort=Number(process.env.PORT||8080);
const internalPort=publicPort===8081?8082:8081;
process.env.PORT=String(internalPort);
await import('./server-v2.js');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
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
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/health')return sendJson(res,200,await superHealth());
    if(req.method==='GET'&&url.pathname==='/state')return sendJson(res,200,await fullState());
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
    const status=await proxy(req,res,url);
    if(status>=200&&status<300&&req.method==='POST'&&['/bootstrap','/release-check','/macro-sync'].includes(url.pathname)){
      const forceNews=url.pathname==='/bootstrap'||(url.pathname==='/macro-sync'&&url.searchParams.get('mode')==='full');
      refreshSuperEconomist({forceNews}).then(x=>console.log('FXGA 9705 intelligence refresh',JSON.stringify({trigger:url.pathname,...x}))).catch(e=>console.error('FXGA 9705 intelligence refresh failed',e));
    }
  }catch(error){
    console.error(error);
    if(!res.headersSent)sendJson(res,500,{error:String(error?.message||error).slice(0,1000)});
    else res.end();
  }
});
server.listen(publicPort,()=>console.log(`FXGA Google Cloud gateway v3 on :${publicPort}; collector v2 internal :${internalPort}`));
