import { FxgaRequestError, friendlyErrorFromResponse, type FriendlyFxgaError } from './fxga-errors';

export type GeminiMode = 'smc-signal' | 'market-brief' | 'macro-brief' | 'economic-context' | 'event-research' | 'action-report';
export type FxgaPromptTask = string;

export type GeminiHealth = { ok:boolean; configured:boolean; provider:string; api:string; model:string; fallbackModel:string; modes:GeminiMode[]; keyExposedToBrowser:false; quotaPolicy?:string; applicationHourlyCap?:number|null; applicationDailyCap?:number|null; timestamp:string };
export type IntelligenceHealth = { ok:boolean; configured:boolean; model:string; fallbackModel:string; reserveModel?:string; promptCount:number; promptRouting:string; liveReport:boolean; chatbot:boolean; applicationHourlyCap:null; applicationDailyCap:null; providerQuotaManaged:boolean; endpoints:string[]; timestamp:string };
export type GeminiAnalysis = { schema:'fxga.gemini.analysis.v1'; mode:GeminiMode; label:string; model:string; output:string; contextHash:string; signalId?:string|null; createdAt:string; cached:boolean; coalesced?:boolean; policy:string };
export type GeminiChat = { schema:'fxga.gemini.chat.v1'; task:FxgaPromptTask; label:string; question:string; answer:string; model:string; evidenceDomains:string[]; contextHash:string; createdAt:string; cached:boolean; stale?:boolean; coalesced?:boolean; policy:string };
export type GeminiLiveReport = { schema:'fxga.gemini.live-report.v1'; report:string; model:string; contextHash:string; evidenceDomains:string[]; createdAt:string; refreshAfterSeconds:number; cached:boolean; coalesced?:boolean; policy:string };
export type PromptRegistry = { schema:'fxga.prompt-registry.v1'; prompts:Array<{id:FxgaPromptTask;label:string;category?:string;evidenceDomains:string[];realtime?:boolean;sharedContract?:string|null}>; automaticRouting:boolean; timestamp:string };
export type ErrorCatalogResponse = { schema:'fxga.error-catalog.v1'; errors:Record<string,FriendlyFxgaError>; timestamp:string };
export type GeminiStreamEvent =
  | { type:'status'; phase:string; message:string; model?:string; task?:string; retryAfterSeconds?:number }
  | { type:'delta'; text:string; model?:string; cached?:boolean }
  | { type:'done'; result:GeminiChat }
  | { type:'error'; friendlyError:FriendlyFxgaError; modelsTried?:string[]; model?:string|null };

async function readJson<T>(response:Response):Promise<T>{
  const text=await response.text();let body:any={};
  try{body=text?JSON.parse(text):{}}catch{body={error:text||`HTTP ${response.status}`}}
  if(!response.ok)throw new FxgaRequestError(friendlyErrorFromResponse(response.status,body),response.status);
  return body as T;
}

export async function getGeminiHealth(signal?:AbortSignal){return readJson<GeminiHealth>(await fetch('/api/gemini/health',{method:'GET',cache:'no-store',signal,headers:{Accept:'application/json','Cache-Control':'no-cache'}}))}
export async function getIntelligenceHealth(signal?:AbortSignal){return readJson<IntelligenceHealth>(await fetch('/api/gemini/intelligence-health',{method:'GET',cache:'no-store',signal,headers:{Accept:'application/json','Cache-Control':'no-cache'}}))}
export async function getGeminiAnalysis(mode:GeminiMode,options:{signalId?:string;signal?:AbortSignal}={}){return readJson<GeminiAnalysis>(await fetch('/api/gemini/analyze',{method:'POST',cache:'no-store',signal:options.signal,headers:{Accept:'application/json','Content-Type':'application/json','Cache-Control':'no-cache'},body:JSON.stringify({mode,...(options.signalId?{signalId:options.signalId}:{})})}))}
export async function askFxga(question:string,options:{task?:FxgaPromptTask;signalId?:string;signal?:AbortSignal}={}){return readJson<GeminiChat>(await fetch('/api/gemini/chat',{method:'POST',cache:'no-store',signal:options.signal,headers:{Accept:'application/json','Content-Type':'application/json','Cache-Control':'no-cache'},body:JSON.stringify({question,...(options.task?{task:options.task}:{}),...(options.signalId?{signalId:options.signalId}:{})})}))}

export async function streamFxga(
  question:string,
  options:{task?:FxgaPromptTask;signalId?:string;signal?:AbortSignal;onEvent?:(event:GeminiStreamEvent)=>void}={}
):Promise<GeminiChat>{
  const response=await fetch('/api/gemini/chat-stream',{
    method:'POST',cache:'no-store',signal:options.signal,
    headers:{Accept:'text/event-stream','Content-Type':'application/json','Cache-Control':'no-cache'},
    body:JSON.stringify({question,...(options.task?{task:options.task}:{}),...(options.signalId?{signalId:options.signalId}:{})}),
  });
  if(!response.ok){
    const text=await response.text();let body:any={};
    try{body=text?JSON.parse(text):{}}catch{body={error:text||`HTTP ${response.status}`}}
    throw new FxgaRequestError(friendlyErrorFromResponse(response.status,body),response.status);
  }
  if(!response.body)throw new Error('Gemini streaming response body is unavailable');

  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let finalResult:GeminiChat|null=null;
  let streamedError:FriendlyFxgaError|null=null;

  const consumeFrame=(frame:string)=>{
    let eventName='message';
    const dataLines:string[]=[];
    for(const line of frame.split(/\r?\n/)){
      if(line.startsWith('event:'))eventName=line.slice(6).trim();
      else if(line.startsWith('data:'))dataLines.push(line.slice(5).trim());
    }
    if(!dataLines.length)return;
    let data:any;
    try{data=JSON.parse(dataLines.join('\n'))}catch{return;}
    if(eventName==='status')options.onEvent?.({type:'status',...data});
    else if(eventName==='delta')options.onEvent?.({type:'delta',...data});
    else if(eventName==='done'){
      finalResult=data.result as GeminiChat;
      options.onEvent?.({type:'done',result:finalResult});
    }else if(eventName==='error'){
      streamedError=data.friendlyError as FriendlyFxgaError;
      options.onEvent?.({type:'error',friendlyError:streamedError,modelsTried:data.modelsTried,model:data.model});
    }
  };

  for(;;){
    const {value,done}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    let split:number;
    while((split=buffer.search(/\r?\n\r?\n/))>=0){
      const frame=buffer.slice(0,split);
      const separator=buffer.slice(split).match(/^\r?\n\r?\n/)?.[0]||'\n\n';
      buffer=buffer.slice(split+separator.length);
      consumeFrame(frame);
    }
  }
  buffer+=decoder.decode();
  if(buffer.trim())consumeFrame(buffer);
  if(streamedError)throw new FxgaRequestError(streamedError,streamedError.technical?.httpStatus||500);
  if(!finalResult)throw new Error('Gemini streaming request ended without a completed result');
  return finalResult;
}

export async function getGeminiLiveReport(signal?:AbortSignal){return readJson<GeminiLiveReport>(await fetch('/api/gemini/live-report',{method:'GET',cache:'no-store',signal,headers:{Accept:'application/json','Cache-Control':'no-cache'}}))}
export async function getPromptRegistry(signal?:AbortSignal){return readJson<PromptRegistry>(await fetch('/api/gemini/prompts',{method:'GET',cache:'no-store',signal,headers:{Accept:'application/json'}}))}
export async function getFxgaErrorCatalog(signal?:AbortSignal){return readJson<ErrorCatalogResponse>(await fetch('/api/errors/catalog',{method:'GET',cache:'no-store',signal,headers:{Accept:'application/json'}}))}
