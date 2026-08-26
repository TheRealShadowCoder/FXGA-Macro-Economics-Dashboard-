import crypto from 'node:crypto';

const DEFAULT_TIMEFRAMES=['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'];
const TIMEFRAME_SET=new Set(DEFAULT_TIMEFRAMES);
const REPORTS='fxga_elliott_reports';
const BLOBS='fxga_elliott_report_blobs';
const EVIDENCE='fxga_elliott_ai_evidence';
const ANALYSES='fxga_elliott_ai_analyses';
const MAX_EVIDENCE_BYTES=300*1024;
const MAX_PDF_BYTES=48*1024*1024;
const AI_TIMEOUT_MS=90000;
const REQUEST_WINDOW_MS=60000;
const REQUESTS_PER_WINDOW=4;
const API_URL='https://generativelanguage.googleapis.com/v1/interactions';

function safeId(value,max=100){return String(value??'').trim().replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,max);}
function requestIp(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();}
function secretEqual(received,expected){
  const a=Buffer.from(String(received??'')),b=Buffer.from(String(expected??''));
  return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);
}
function toIso(value){
  if(!value)return null;
  if(typeof value==='string')return value;
  if(value instanceof Date)return value.toISOString();
  if(typeof value?.toDate==='function')return value.toDate().toISOString();
  if(typeof value?._seconds==='number')return new Date(value._seconds*1000).toISOString();
  return null;
}
async function readBody(req,maxBytes){
  const chunks=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    if(total>maxBytes)throw Object.assign(new Error('Request body too large'),{statusCode:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function asFiniteNumber(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function normalizeString(value,max=1200){return String(value??'').replace(/\u0000/g,'').slice(0,max);}
function hash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function modelOrder(){
  return [...new Set([
    String(process.env.GEMINI_MODEL||'gemini-3.5-flash-lite').trim(),
    String(process.env.GEMINI_FALLBACK_MODEL||'gemini-3.1-flash-lite').trim(),
    String(process.env.GEMINI_RESERVE_MODEL||'gemini-3.7-flash').trim()
  ].filter(Boolean))];
}
function extractInteractionText(payload){
  const steps=Array.isArray(payload?.steps)?payload.steps:[];
  for(let i=steps.length-1;i>=0;i--){
    if(steps[i]?.type!=='model_output')continue;
    const parts=Array.isArray(steps[i]?.content)?steps[i].content:[];
    const text=parts.filter(x=>x?.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n').trim();
    if(text)return text;
  }
  return '';
}
function parseJsonText(text){
  const raw=String(text||'').trim();
  try{return JSON.parse(raw);}catch{}
  const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced){try{return JSON.parse(fenced[1].trim());}catch{}}
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start>=0&&end>start){try{return JSON.parse(raw.slice(start,end+1));}catch{}}
  throw Object.assign(new Error('Gemini returned an unreadable Elliott decision payload'),{statusCode:502});
}

const DECISION_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['TRADE_SETUP','WAIT','NO_TRADE']},
    direction:{type:'string',enum:['BUY','SELL','NEUTRAL']},
    entry:{type:'object',properties:{type:{type:'string',enum:['market','limit','stop','zone','none']},price:{type:['number','null']},zoneLow:{type:['number','null']},zoneHigh:{type:['number','null']},trigger:{type:'string'}},required:['type','price','zoneLow','zoneHigh','trigger']},
    stopLoss:{type:'object',properties:{price:{type:['number','null']},basis:{type:'string'}},required:['price','basis']},
    takeProfits:{type:'array',maxItems:3,items:{type:'object',properties:{label:{type:'string'},price:{type:['number','null']},basis:{type:'string'}},required:['label','price','basis']}},
    elliott:{type:'object',properties:{primaryCount:{type:'string'},currentWave:{type:'string'},higherTimeframeBias:{type:'string'},microStructure:{type:'string'},invalidation:{type:['number','null']},alternateCount:{type:'string'}},required:['primaryCount','currentWave','higherTimeframeBias','microStructure','invalidation','alternateCount']},
    confidence:{type:'number',minimum:0,maximum:100},
    riskReward:{type:'object',properties:{tp1:{type:['number','null']},tp2:{type:['number','null']},tp3:{type:['number','null']}},required:['tp1','tp2','tp3']},
    indicatorPlanConsistency:{type:'boolean'},
    deviationsFromIndicator:{type:'array',items:{type:'string'},maxItems:12},
    evidenceSummary:{type:'array',items:{type:'string'},maxItems:16},
    conflicts:{type:'array',items:{type:'string'},maxItems:12},
    invalidationConditions:{type:'array',items:{type:'string'},maxItems:12},
    missingEvidence:{type:'array',items:{type:'string'},maxItems:12},
    summary:{type:'string'}
  },
  required:['status','direction','entry','stopLoss','takeProfits','elliott','confidence','riskReward','indicatorPlanConsistency','deviationsFromIndicator','evidenceSummary','conflicts','invalidationConditions','missingEvidence','summary']
};

function emptyDecision(reason='AI analysis is not available'){
  return{status:'WAIT',direction:'NEUTRAL',entry:{type:'none',price:null,zoneLow:null,zoneHigh:null,trigger:''},stopLoss:{price:null,basis:''},takeProfits:[],elliott:{primaryCount:'',currentWave:'',higherTimeframeBias:'',microStructure:'',invalidation:null,alternateCount:''},confidence:0,riskReward:{tp1:null,tp2:null,tp3:null},indicatorPlanConsistency:false,deviationsFromIndicator:[],evidenceSummary:[],conflicts:[],invalidationConditions:[],missingEvidence:[reason],summary:reason};
}

function normalizeDecision(raw,evidenceCount){
  const value=raw&&typeof raw==='object'?raw:{},out=emptyDecision('');
  out.status=['TRADE_SETUP','WAIT','NO_TRADE'].includes(value.status)?value.status:'WAIT';
  out.direction=['BUY','SELL','NEUTRAL'].includes(value.direction)?value.direction:'NEUTRAL';
  const entry=value.entry&&typeof value.entry==='object'?value.entry:{};
  out.entry={type:['market','limit','stop','zone','none'].includes(entry.type)?entry.type:'none',price:asFiniteNumber(entry.price),zoneLow:asFiniteNumber(entry.zoneLow),zoneHigh:asFiniteNumber(entry.zoneHigh),trigger:normalizeString(entry.trigger,1000)};
  const stop=value.stopLoss&&typeof value.stopLoss==='object'?value.stopLoss:{};
  out.stopLoss={price:asFiniteNumber(stop.price),basis:normalizeString(stop.basis,1000)};
  out.takeProfits=(Array.isArray(value.takeProfits)?value.takeProfits:[]).slice(0,3).map((tp,index)=>({label:normalizeString(tp?.label||`TP${index+1}`,40),price:asFiniteNumber(tp?.price),basis:normalizeString(tp?.basis,1000)}));
  const ew=value.elliott&&typeof value.elliott==='object'?value.elliott:{};
  out.elliott={primaryCount:normalizeString(ew.primaryCount,800),currentWave:normalizeString(ew.currentWave,300),higherTimeframeBias:normalizeString(ew.higherTimeframeBias,500),microStructure:normalizeString(ew.microStructure,800),invalidation:asFiniteNumber(ew.invalidation),alternateCount:normalizeString(ew.alternateCount,800)};
  out.confidence=clamp(Number(value.confidence)||0,0,100);
  const rr=value.riskReward&&typeof value.riskReward==='object'?value.riskReward:{};
  out.riskReward={tp1:asFiniteNumber(rr.tp1),tp2:asFiniteNumber(rr.tp2),tp3:asFiniteNumber(rr.tp3)};
  out.indicatorPlanConsistency=Boolean(value.indicatorPlanConsistency);
  for(const key of ['deviationsFromIndicator','evidenceSummary','conflicts','invalidationConditions','missingEvidence'])out[key]=(Array.isArray(value[key])?value[key]:[]).slice(0,key==='evidenceSummary'?16:12).map(x=>normalizeString(x,1000));
  out.summary=normalizeString(value.summary,4000);
  if(evidenceCount<DEFAULT_TIMEFRAMES.length){out.missingEvidence.unshift(`Structured indicator evidence is incomplete: ${evidenceCount}/${DEFAULT_TIMEFRAMES.length} timeframes.`);if(out.status==='TRADE_SETUP')out.status='WAIT';}
  if(out.status==='TRADE_SETUP'&&(out.direction==='NEUTRAL'||!out.entry.price||!out.stopLoss.price||!out.takeProfits.some(tp=>tp.price))){out.status='WAIT';out.missingEvidence.unshift('Executable trade levels were incomplete, so the server downgraded the model output to WAIT.');}
  return out;
}

function buildPrompt({jobId,report,evidence,evidenceCount}){
  return[
    'You are the FXGA Elliott Wave Evidence Intelligence Engine.',
    'Analyze the attached 21-page MT5 chart PDF together with the structured indicator evidence and return one audited trade decision.',
    '',
    'SOURCE-OF-TRUTH ORDER:',
    '1. CONFIRMED strict-non-repainting indicator evidence from closed candles.',
    '2. Hard Elliott Wave cardinal rules and explicit count invalidation levels.',
    '3. Frozen indicator signal/risk plan: entry, stop, targets, readiness and execution-valid state.',
    '4. Multi-timeframe chart screenshots in the attached PDF for visual confirmation, nesting, labels and context.',
    '5. LIVE/FORECAST/provisional evidence may explain what is developing but MUST NOT override confirmed evidence.',
    '',
    'MANDATORY RULES:',
    '- Never invent a price. If the indicator does not support a defensible exact entry, stop or target, output WAIT with null prices.',
    '- Never convert a live-bar preview into a confirmed signal.',
    '- If hard Elliott invalidation is active, do not recommend the invalidated direction.',
    '- If execution_valid=false, signal_ready=false, closed_bar_ready=false, or the count is materially conflicted, prefer WAIT/NO_TRADE.',
    '- If the indicator supplies frozen confirmed entry/stop/TP values, use those exact levels unless the screenshots prove they are stale or invalid. List every deviation.',
    '- Stop loss must respect the Elliott structural/count invalidation.',
    '- Explain active wave, higher-timeframe bias, lower-timeframe confirmation, alternate count, invalidation, and strongest conflicting evidence.',
    '- Confidence means evidence quality, not promised profitability.',
    '- Do not claim profitability or statistical edge unless supplied evidence explicitly supports it.',
    '- Decision support only. Never imply that an order was placed.',
    '',`JOB: ${jobId}`,`SYMBOL: ${report.symbol||''}`,`SCREENSHOT PAGES: ${report.pageCount||21}`,`STRUCTURED EVIDENCE COMPLETENESS: ${evidenceCount}/${DEFAULT_TIMEFRAMES.length}`,'','STRUCTURED INDICATOR EVIDENCE JSON:',JSON.stringify(evidence)
  ].join('\n');
}

async function invokeGemini({prompt,pdfBytes}){
  const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
  if(!apiKey)throw Object.assign(new Error('Gemini API key is not configured'),{statusCode:503});
  const input=[{type:'text',text:prompt},{type:'document',data:pdfBytes.toString('base64'),mime_type:'application/pdf'}];
  let lastError=null;
  for(const model of modelOrder()){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),AI_TIMEOUT_MS);
    try{
      let response=await fetch(API_URL,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({model,input,store:false,generation_config:{temperature:0.1,max_output_tokens:3000},response_format:{type:'text',mime_type:'application/json',schema:DECISION_SCHEMA}})});
      let text=await response.text();
      if(!response.ok&&response.status===400){
        response=await fetch(API_URL,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({model,input:[...input,{type:'text',text:'Return ONLY valid JSON matching the requested Elliott decision fields.'}],store:false,generation_config:{temperature:0.1,max_output_tokens:3000}})});
        text=await response.text();
      }
      if(!response.ok){let provider={};try{provider=JSON.parse(text);}catch{}const message=provider?.error?.message||provider?.message||`Gemini ${model} HTTP ${response.status}`;lastError=Object.assign(new Error(message),{statusCode:response.status===429?429:502});if([429,500,502,503,504].includes(response.status))continue;throw lastError;}
      const payload=JSON.parse(text),output=extractInteractionText(payload);
      if(!output){lastError=Object.assign(new Error(`Gemini ${model} returned no model output`),{statusCode:502});continue;}
      return{model,payload:parseJsonText(output),interactionId:payload.id||null};
    }catch(error){lastError=error;if(error?.name==='AbortError')lastError=Object.assign(new Error(`Gemini ${model} timed out`),{statusCode:504});}
    finally{clearTimeout(timer);}
  }
  throw lastError||Object.assign(new Error('All Gemini models failed'),{statusCode:502});
}

export function createElliottAiService({db,broadcast=()=>{}}={}){
  if(!db)throw new Error('createElliottAiService requires Firestore');
  const reports=db.collection(REPORTS),blobs=db.collection(BLOBS),evidenceCol=db.collection(EVIDENCE),analyses=db.collection(ANALYSES),windows=new Map();

  function requireMt5(req){const expected=String(process.env.FXGA_MT5_REPORT_SECRET||'');if(!expected)throw Object.assign(new Error('MT5 report bridge secret is not configured'),{statusCode:503});if(!secretEqual(req.headers['x-fxga-mt5-secret'],expected))throw Object.assign(new Error('Unauthorized MT5 report bridge'),{statusCode:401});}
  function allowAnalyze(req){const key=requestIp(req),now=Date.now();let entry=windows.get(key);if(!entry||now-entry.start>=REQUEST_WINDOW_MS)entry={start:now,count:0};entry.count++;windows.set(key,entry);if(entry.count>REQUESTS_PER_WINDOW)throw Object.assign(new Error('Too many Elliott AI requests; wait a minute and try again'),{statusCode:429});}
  async function readBlob(blobId){
    const ref=blobs.doc(safeId(blobId,140)),metaSnap=await ref.get();
    if(!metaSnap.exists)throw Object.assign(new Error('Elliott PDF blob is missing'),{statusCode:404});
    const meta=metaSnap.data(),count=Number(meta.chunkCount||0),parts=[];
    for(let start=0;start<count;start+=100){const refs=[];for(let i=start;i<Math.min(count,start+100);i++)refs.push(ref.collection('chunks').doc(String(i).padStart(6,'0')));const snaps=await db.getAll(...refs);for(const snap of snaps){if(!snap.exists)throw Object.assign(new Error('Elliott PDF blob is incomplete'),{statusCode:500});parts.push(Buffer.from(snap.data().bytes));}}
    const bytes=Buffer.concat(parts);if(bytes.length>MAX_PDF_BYTES)throw Object.assign(new Error(`Elliott PDF is ${Math.round(bytes.length/1024/1024)}MB; Gemini inline document guard is 48MB`),{statusCode:413});return bytes;
  }
  async function readEvidence(jobId,timeframes=DEFAULT_TIMEFRAMES){
    const refs=timeframes.filter(tf=>TIMEFRAME_SET.has(tf)).map(tf=>evidenceCol.doc(`${jobId}__${tf}`)),snaps=refs.length?await db.getAll(...refs):[],rows=[];
    for(const snap of snaps)if(snap.exists){const d=snap.data();rows.push({timeframe:d.timeframe,receivedAt:toIso(d.receivedAt),terminalId:d.terminalId||null,evidence:d.evidence||null,evidenceHash:d.evidenceHash||null});}
    rows.sort((a,b)=>DEFAULT_TIMEFRAMES.indexOf(a.timeframe)-DEFAULT_TIMEFRAMES.indexOf(b.timeframe));return rows;
  }
  function publicAnalysis(doc){if(!doc)return null;const d=doc.data?.()??doc,id=doc.id??d.id;return{id,jobId:d.jobId||id,symbol:d.symbol||'',status:d.status||'UNKNOWN',aiState:d.aiState||d.status||'UNKNOWN',model:d.model||null,promptVersion:d.promptVersion||'EW-AI-1',evidenceCount:Number(d.evidenceCount||0),evidenceExpected:Number(d.evidenceExpected||DEFAULT_TIMEFRAMES.length),generatedAt:toIso(d.generatedAt),updatedAt:toIso(d.updatedAt),error:d.error||null,decision:d.decision||null};}
  async function analyze(jobId){
    const existing=await analyses.doc(jobId).get();if(existing.exists&&existing.data()?.status==='READY')return publicAnalysis(existing);
    const reportSnap=await reports.doc(jobId).get();if(!reportSnap.exists)throw Object.assign(new Error('Elliott PDF report is not ready yet'),{statusCode:409});
    const report=reportSnap.data(),evidence=await readEvidence(jobId,report.timeframes||DEFAULT_TIMEFRAMES),now=new Date();
    await analyses.doc(jobId).set({id:jobId,jobId,symbol:report.symbol||'',status:'ANALYZING',aiState:'ANALYZING',evidenceCount:evidence.length,evidenceExpected:(report.timeframes||DEFAULT_TIMEFRAMES).length,updatedAt:now,promptVersion:'EW-AI-1'},{merge:true});
    try{
      const pdfBytes=await readBlob(report.pdfBlobId),prompt=buildPrompt({jobId,report,evidence,evidenceCount:evidence.length}),result=await invokeGemini({prompt,pdfBytes}),decision=normalizeDecision(result.payload,evidence.length),generatedAt=new Date(),evidenceHash=hash(evidence);
      const analysis={id:jobId,jobId,symbol:report.symbol||'',status:'READY',aiState:'READY',model:result.model,promptVersion:'EW-AI-1',interactionId:result.interactionId,evidenceCount:evidence.length,evidenceExpected:(report.timeframes||DEFAULT_TIMEFRAMES).length,evidenceHash,reportId:jobId,pdfHash:hash(pdfBytes),decision,generatedAt,updatedAt:generatedAt,governance:'indicator-confirmed-evidence-first; screenshot-confirmation-second; no-auto-order'};
      await analyses.doc(jobId).set(analysis,{merge:true});broadcast({type:'elliott-ai-ready',jobId,symbol:report.symbol||'',decision:decision.status,direction:decision.direction,at:generatedAt.toISOString()});return publicAnalysis({id:jobId,data:()=>analysis});
    }catch(error){await analyses.doc(jobId).set({status:'FAILED',aiState:'FAILED',error:String(error?.message||error).slice(0,1500),updatedAt:new Date()},{merge:true});throw error;}
  }

  async function handle(req,res,url,sendJson,apiError){
    if(!url.pathname.startsWith('/api/elliott-ai'))return false;
    try{
      if(req.method==='POST'&&url.pathname==='/api/elliott-ai/evidence'){
        requireMt5(req);const jobId=safeId(url.searchParams.get('jobId'),80),timeframe=String(url.searchParams.get('timeframe')||'').toUpperCase(),terminalId=safeId(url.searchParams.get('terminalId')||'',80);
        if(!jobId||!TIMEFRAME_SET.has(timeframe))return apiError(res,400,'Valid jobId and timeframe are required');
        const raw=await readBody(req,MAX_EVIDENCE_BYTES);if(!raw.length)return apiError(res,400,'Indicator evidence body is empty');let evidence;try{evidence=JSON.parse(raw.toString('utf8'));}catch{return apiError(res,400,'Indicator evidence must be valid JSON');}
        const docId=`${jobId}__${timeframe}`,now=new Date();await evidenceCol.doc(docId).set({id:docId,jobId,timeframe,terminalId,receivedAt:now,evidence,evidenceHash:hash(raw),byteLength:raw.length,source:'FXGA_RealTime_Elliott_Wave_Setups',strictNonRepaint:Boolean(evidence?.nonRepaint?.strict??evidence?.strictNonRepaint??false)},{merge:true});
        return sendJson(res,200,{ok:true,jobId,timeframe,bytes:raw.length,evidenceHash:hash(raw)});
      }
      const statusMatch=url.pathname.match(/^\/api\/elliott-ai\/jobs\/([^/]+)$/);
      if(req.method==='GET'&&statusMatch){const jobId=safeId(statusMatch[1],80),analysisSnap=await analyses.doc(jobId).get(),reportSnap=await reports.doc(jobId).get(),timeframes=reportSnap.exists?(reportSnap.data()?.timeframes||DEFAULT_TIMEFRAMES):DEFAULT_TIMEFRAMES,evidence=await readEvidence(jobId,timeframes);return sendJson(res,200,{ok:true,jobId,reportReady:reportSnap.exists,evidenceCount:evidence.length,evidenceExpected:timeframes.length,analysis:analysisSnap.exists?publicAnalysis(analysisSnap):null});}
      if(req.method==='POST'&&url.pathname==='/api/elliott-ai/analyze'){allowAnalyze(req);const jobId=safeId(url.searchParams.get('jobId'),80);if(!jobId)return apiError(res,400,'jobId is required');const result=await analyze(jobId);return sendJson(res,200,{ok:true,analysis:result});}
      return apiError(res,404,'Elliott AI route not found');
    }catch(error){return apiError(res,Number(error?.statusCode||500),String(error?.message||error));}
  }
  function health(){return{enabled:true,provider:'Google Gemini Interactions API',models:modelOrder(),structuredEvidence:true,pdfVision:true,defaultTimeframes:DEFAULT_TIMEFRAMES.length,promptVersion:'EW-AI-1',autoTrading:false};}
  return{handle,health,analyze};
}
