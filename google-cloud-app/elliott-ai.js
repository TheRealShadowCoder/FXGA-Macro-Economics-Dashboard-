import crypto from 'node:crypto';

const JOBS='fxga_elliott_report_jobs';
const REPORTS='fxga_elliott_reports';
const BLOBS='fxga_elliott_report_blobs';
const EVIDENCE='fxga_elliott_ai_evidence';
const ANALYSES='fxga_elliott_ai_analyses';
const DOSSIER_PREFIX='FXGA_60D_AI_DOSSIER_3';
const EVIDENCE_SCHEMA='FXGA_EW_AI_EVIDENCE_1';
const MIN_HISTORY_DAYS=60;
const TIMEFRAMES=['M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'];
const TIMEFRAME_SET=new Set(TIMEFRAMES);
const EXPECTED_TIMEFRAMES=TIMEFRAMES.length;
const MAX_EVIDENCE_BYTES=512*1024;
const MAX_PDF_BYTES=48*1024*1024;
const AI_TIMEOUT_MS=90000;
const REQUEST_WINDOW_MS=60000;
const REQUESTS_PER_WINDOW=4;
const API_URL='https://generativelanguage.googleapis.com/v1beta/interactions';
const PROMPT_VERSION='EW-DOSSIER-AI-4-DUAL-ENGINE';

function safeId(value,max=100){return String(value??'').trim().replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,max);}
function requestIp(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();}
function secretEqual(received,expected){const a=Buffer.from(String(received??'')),b=Buffer.from(String(expected??''));return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);}
function toIso(value){if(!value)return null;if(typeof value==='string')return value;if(value instanceof Date)return value.toISOString();if(typeof value?.toDate==='function')return value.toDate().toISOString();if(typeof value?._seconds==='number')return new Date(value._seconds*1000).toISOString();return null;}
async function readBody(req,maxBytes){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Object.assign(new Error('Request body too large'),{statusCode:413});chunks.push(chunk);}return Buffer.concat(chunks);}
function asFiniteNumber(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function normalizeString(value,max=1200){return String(value??'').replace(/\u0000/g,'').slice(0,max);}
function hash(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function modelOrder(){return [...new Set([String(process.env.GEMINI_MODEL||'gemini-3.5-flash-lite').trim(),String(process.env.GEMINI_FALLBACK_MODEL||'gemini-3.6-flash').trim(),String(process.env.GEMINI_RESERVE_MODEL||'gemini-3.7-flash').trim()].filter(Boolean))];}
function extractInteractionText(payload){const steps=Array.isArray(payload?.steps)?payload.steps:[];for(let i=steps.length-1;i>=0;i--){if(steps[i]?.type!=='model_output')continue;const parts=Array.isArray(steps[i]?.content)?steps[i].content:[];const text=parts.filter(x=>x?.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n').trim();if(text)return text;}return '';}
function parseJsonText(text){const raw=String(text||'').trim();try{return JSON.parse(raw);}catch{}const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fenced){try{return JSON.parse(fenced[1].trim());}catch{}}const start=raw.indexOf('{'),end=raw.lastIndexOf('}');if(start>=0&&end>start){try{return JSON.parse(raw.slice(start,end+1));}catch{}}throw Object.assign(new Error('Gemini returned an unreadable Elliott decision payload'),{statusCode:502});}
function strictEvidence(e){return Boolean(e?.strict_non_repaint?.enabled===true&&e?.strict_non_repaint?.closed_bar_pivots===true&&e?.strict_non_repaint?.freeze_confirmed_pivots===true&&e?.strict_non_repaint?.closed_bar_signals===true);}

const DECISION_SCHEMA={type:'object',properties:{status:{type:'string',enum:['TRADE_SETUP','WAIT','NO_TRADE']},direction:{type:'string',enum:['BUY','SELL','NEUTRAL']},entry:{type:'object',properties:{type:{type:'string',enum:['market','limit','stop','zone','none']},price:{type:['number','null']},zoneLow:{type:['number','null']},zoneHigh:{type:['number','null']},trigger:{type:'string'}},required:['type','price','zoneLow','zoneHigh','trigger']},stopLoss:{type:'object',properties:{price:{type:['number','null']},basis:{type:'string'}},required:['price','basis']},takeProfits:{type:'array',maxItems:3,items:{type:'object',properties:{label:{type:'string'},price:{type:['number','null']},basis:{type:'string'}},required:['label','price','basis']}},elliott:{type:'object',properties:{primaryCount:{type:'string'},currentWave:{type:'string'},higherTimeframeBias:{type:'string'},microStructure:{type:'string'},invalidation:{type:['number','null']},alternateCount:{type:'string'}},required:['primaryCount','currentWave','higherTimeframeBias','microStructure','invalidation','alternateCount']},confidence:{type:'number',minimum:0,maximum:100},riskReward:{type:'object',properties:{tp1:{type:['number','null']},tp2:{type:['number','null']},tp3:{type:['number','null']}},required:['tp1','tp2','tp3']},indicatorPlanConsistency:{type:'boolean'},deviationsFromIndicator:{type:'array',items:{type:'string'},maxItems:12},evidenceSummary:{type:'array',items:{type:'string'},maxItems:16},conflicts:{type:'array',items:{type:'string'},maxItems:12},invalidationConditions:{type:'array',items:{type:'string'},maxItems:12},missingEvidence:{type:'array',items:{type:'string'},maxItems:12},summary:{type:'string'}},required:['status','direction','entry','stopLoss','takeProfits','elliott','confidence','riskReward','indicatorPlanConsistency','deviationsFromIndicator','evidenceSummary','conflicts','invalidationConditions','missingEvidence','summary']};

function emptyDecision(reason='AI analysis is not available'){return{status:'WAIT',direction:'NEUTRAL',entry:{type:'none',price:null,zoneLow:null,zoneHigh:null,trigger:''},stopLoss:{price:null,basis:''},takeProfits:[],elliott:{primaryCount:'',currentWave:'',higherTimeframeBias:'',microStructure:'',invalidation:null,alternateCount:''},confidence:0,riskReward:{tp1:null,tp2:null,tp3:null},indicatorPlanConsistency:false,deviationsFromIndicator:[],evidenceSummary:[],conflicts:[],invalidationConditions:[],missingEvidence:reason?[reason]:[],summary:reason};}

function normalizeDecision(raw,report){
  const value=raw&&typeof raw==='object'?raw:{},out=emptyDecision('');
  out.status=['TRADE_SETUP','WAIT','NO_TRADE'].includes(value.status)?value.status:'WAIT';
  out.direction=['BUY','SELL','NEUTRAL'].includes(value.direction)?value.direction:'NEUTRAL';
  const entry=value.entry&&typeof value.entry==='object'?value.entry:{};
  out.entry={type:['market','limit','stop','zone','none'].includes(entry.type)?entry.type:'none',price:asFiniteNumber(entry.price),zoneLow:asFiniteNumber(entry.zoneLow),zoneHigh:asFiniteNumber(entry.zoneHigh),trigger:normalizeString(entry.trigger,1000)};
  if(out.entry.zoneLow!==null&&out.entry.zoneHigh!==null&&out.entry.zoneLow>out.entry.zoneHigh)[out.entry.zoneLow,out.entry.zoneHigh]=[out.entry.zoneHigh,out.entry.zoneLow];
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

  const coverageOk=Boolean(report?.historyCoverageComplete)&&Number(report?.historyDays||0)>=MIN_HISTORY_DAYS-1;
  const evidenceOk=Number(report?.evidenceCount||0)>=EXPECTED_TIMEFRAMES;
  const chartsOk=Array.isArray(report?.timeframes)&&report.timeframes.length>=EXPECTED_TIMEFRAMES;
  const dossierOk=String(report?.dossierVersion||'').startsWith(DOSSIER_PREFIX)&&report?.aiInputMode==='single-pdf-dossier';
  const strictOk=report?.strictNonRepaintComplete===true;
  if(!coverageOk)out.missingEvidence.unshift(`60-day H1 price-history coverage is incomplete (${Number(report?.historyDays||0).toFixed(2)} observed days).`);
  if(!evidenceOk)out.missingEvidence.unshift(`Indicator evidence is incomplete: ${Number(report?.evidenceCount||0)}/${EXPECTED_TIMEFRAMES} timeframe snapshots.`);
  if(!chartsOk||!dossierOk)out.missingEvidence.unshift('The canonical single-PDF dossier contract is incomplete or from an older report version.');
  if(!strictOk)out.missingEvidence.unshift('Strict non-repaint evidence validation did not pass for every required timeframe.');

  const exactEntry=out.entry.price;
  const validZone=out.entry.zoneLow!==null&&out.entry.zoneHigh!==null&&out.entry.zoneLow<=out.entry.zoneHigh;
  const entryReference=exactEntry!==null?exactEntry:validZone?(out.entry.zoneLow+out.entry.zoneHigh)/2:null;
  const exactTp=out.takeProfits.find(tp=>tp.price!==null)?.price??null;
  const executableEvidence=coverageOk&&evidenceOk&&chartsOk&&dossierOk&&strictOk;
  if(out.status==='TRADE_SETUP'&&!executableEvidence)out.status='WAIT';
  if(out.status==='TRADE_SETUP'&&(out.direction==='NEUTRAL'||entryReference===null||out.stopLoss.price===null||exactTp===null||out.elliott.invalidation===null)){
    out.status='WAIT';
    out.missingEvidence.unshift('Executable entry/zone, stop, Elliott structural invalidation, or target was incomplete; server downgraded to WAIT.');
  }
  if(out.status==='TRADE_SETUP'){
    const zoneLow=validZone?out.entry.zoneLow:entryReference,zoneHigh=validZone?out.entry.zoneHigh:entryReference;
    const invalidStop=out.direction==='BUY'?out.stopLoss.price>=zoneLow:out.stopLoss.price<=zoneHigh;
    const invalidStructural=out.direction==='BUY'?out.elliott.invalidation>=zoneLow:out.elliott.invalidation<=zoneHigh;
    const invalidTp=out.takeProfits.some(tp=>tp.price!==null&&(out.direction==='BUY'?tp.price<=zoneHigh:tp.price>=zoneLow));
    if(invalidStop||invalidStructural||invalidTp){out.status='WAIT';out.conflicts.unshift('AI returned geometrically inconsistent entry/stop/structural-invalidation/target levels; executable status was rejected.');}
  }
  return out;
}

async function invokeGemini({pdfBytes,reportId,symbol}){
  const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
  if(!apiKey)throw Object.assign(new Error('Gemini API key is not configured'),{statusCode:503});
  const instruction=`Read the attached FXGA 60-Day Elliott + Macro AI Dossier for ${symbol||'the requested market'} (report ${reportId}). The PDF is the ONE canonical evidence input. Follow its embedded evidence hierarchy and strict non-repaint rules. Elliott hard structure remains authoritative. RSI/Bollinger is a secondary confirmation and execution-quality filter: it may veto or downgrade timing, but it may never legalize a hard-invalid Elliott count. Do not invent missing facts. Economic releases are contextual catalysts only and can never legalize an invalid Elliott count. Return ONLY the structured trade decision.`;
  const input=[{type:'text',text:instruction},{type:'document',data:pdfBytes.toString('base64'),mime_type:'application/pdf'}];
  let lastError=null;
  for(const model of modelOrder()){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),AI_TIMEOUT_MS);
    try{
      const baseBody={model,input,store:false,generation_config:{thinking_level:'medium',max_output_tokens:3000}};
      let response=await fetch(API_URL,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({...baseBody,response_format:{type:'text',mime_type:'application/json',schema:DECISION_SCHEMA}})});
      let text=await response.text();
      if(!response.ok&&response.status===400){response=await fetch(API_URL,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({...baseBody,input:[...input,{type:'text',text:'Return ONLY valid JSON matching the requested Elliott decision fields.'}]})});text=await response.text();}
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
  const jobs=db.collection(JOBS),reports=db.collection(REPORTS),blobs=db.collection(BLOBS),evidenceCol=db.collection(EVIDENCE),analyses=db.collection(ANALYSES),windows=new Map();
  function requireMt5(req){const expected=String(process.env.FXGA_MT5_REPORT_SECRET||'');if(!expected)throw Object.assign(new Error('MT5 report bridge secret is not configured'),{statusCode:503});if(!secretEqual(req.headers['x-fxga-mt5-secret'],expected))throw Object.assign(new Error('Unauthorized MT5 report bridge'),{statusCode:401});}
  function allowAnalyze(req){const key=requestIp(req),now=Date.now();let entry=windows.get(key);if(!entry||now-entry.start>=REQUEST_WINDOW_MS)entry={start:now,count:0};entry.count++;windows.set(key,entry);if(entry.count>REQUESTS_PER_WINDOW)throw Object.assign(new Error('Too many Elliott AI requests; wait a minute and try again'),{statusCode:429});}
  async function readBlob(blobId){const ref=blobs.doc(safeId(blobId,140)),metaSnap=await ref.get();if(!metaSnap.exists)throw Object.assign(new Error('Elliott PDF blob is missing'),{statusCode:404});const meta=metaSnap.data(),count=Number(meta.chunkCount||0),parts=[];for(let start=0;start<count;start+=100){const refs=[];for(let i=start;i<Math.min(count,start+100);i++)refs.push(ref.collection('chunks').doc(String(i).padStart(6,'0')));const snaps=await db.getAll(...refs);for(const snap of snaps){if(!snap.exists)throw Object.assign(new Error('Elliott PDF blob is incomplete'),{statusCode:500});parts.push(Buffer.from(snap.data().bytes));}}const bytes=Buffer.concat(parts);if(bytes.length>MAX_PDF_BYTES)throw Object.assign(new Error(`Elliott dossier is ${Math.round(bytes.length/1024/1024)}MB; Gemini inline document safety cap is 48MB`),{statusCode:413});return bytes;}
  function publicAnalysis(doc){if(!doc)return null;const d=doc.data?.()??doc,id=doc.id??d.id;return{id,jobId:d.jobId||id,symbol:d.symbol||'',status:d.status||'UNKNOWN',aiState:d.aiState||d.status||'UNKNOWN',model:d.model||null,promptVersion:d.promptVersion||PROMPT_VERSION,evidenceCount:Number(d.evidenceCount||0),evidenceExpected:Number(d.evidenceExpected||EXPECTED_TIMEFRAMES),dossierVersion:d.dossierVersion||null,inputMode:d.inputMode||'single-pdf-dossier',generatedAt:toIso(d.generatedAt),updatedAt:toIso(d.updatedAt),error:d.error||null,decision:d.decision||null};}
  async function analyze(jobId){
    const existing=await analyses.doc(jobId).get();
    if(existing.exists&&existing.data()?.status==='READY')return publicAnalysis(existing);
    const reportSnap=await reports.doc(jobId).get();
    if(!reportSnap.exists)throw Object.assign(new Error('Elliott dossier PDF is not ready yet'),{statusCode:409});
    const report=reportSnap.data();
    if(!String(report.dossierVersion||'').startsWith(DOSSIER_PREFIX))throw Object.assign(new Error('This report predates the strict 60-day dossier v2 contract; create a new Analyze report'),{statusCode:409});
    if(report.strictNonRepaintComplete!==true)throw Object.assign(new Error('Dossier strict non-repaint validation is incomplete'),{statusCode:409});
    const now=new Date();
    await analyses.doc(jobId).set({id:jobId,jobId,symbol:report.symbol||'',status:'ANALYZING',aiState:'ANALYZING',evidenceCount:Number(report.evidenceCount||0),evidenceExpected:EXPECTED_TIMEFRAMES,dossierVersion:report.dossierVersion,inputMode:'single-pdf-dossier',updatedAt:now,promptVersion:PROMPT_VERSION},{merge:true});
    try{
      const pdfBytes=await readBlob(report.pdfBlobId),result=await invokeGemini({pdfBytes,reportId:jobId,symbol:report.symbol}),decision=normalizeDecision(result.payload,report),generatedAt=new Date(),analysis={id:jobId,jobId,symbol:report.symbol||'',status:'READY',aiState:'READY',model:result.model,promptVersion:PROMPT_VERSION,interactionId:result.interactionId,evidenceCount:Number(report.evidenceCount||0),evidenceExpected:EXPECTED_TIMEFRAMES,dossierVersion:report.dossierVersion,inputMode:'single-pdf-dossier',pdfHash:hash(pdfBytes),decision,generatedAt,updatedAt:generatedAt,governance:'one-PDF canonical evidence; strict non-repaint required on all 21 timeframes; economic events contextual only; no-auto-order'};
      await analyses.doc(jobId).set(analysis,{merge:true});
      broadcast({type:'elliott-ai-ready',jobId,symbol:report.symbol||'',decision:decision.status,direction:decision.direction,at:generatedAt.toISOString()});
      return publicAnalysis({id:jobId,data:()=>analysis});
    }catch(error){await analyses.doc(jobId).set({status:'FAILED',aiState:'FAILED',error:String(error?.message||error).slice(0,1500),updatedAt:new Date()},{merge:true});throw error;}
  }

  async function handle(req,res,url,sendJson,apiError){
    if(!url.pathname.startsWith('/api/elliott-ai'))return false;
    try{
      if(req.method==='POST'&&url.pathname==='/api/elliott-ai/evidence'){
        requireMt5(req);
        const jobId=safeId(url.searchParams.get('jobId'),80),timeframe=String(url.searchParams.get('timeframe')||'').toUpperCase(),terminalId=safeId(url.searchParams.get('terminalId')||'',80);
        if(!jobId||!TIMEFRAME_SET.has(timeframe))return apiError(res,400,'Valid jobId and timeframe are required');
        const jobSnap=await jobs.doc(jobId).get();
        if(!jobSnap.exists)return apiError(res,404,'Elliott report job not found');
        const job=jobSnap.data();
        if(job.status!=='CAPTURING')return apiError(res,409,`Job is ${job.status}, not CAPTURING`);
        if(job.terminalId&&terminalId&&job.terminalId!==terminalId)return apiError(res,409,'Job belongs to another MT5 terminal');
        if(!Array.isArray(job.timeframes)||!job.timeframes.includes(timeframe))return apiError(res,400,'Timeframe is not part of this report job');
        const raw=await readBody(req,MAX_EVIDENCE_BYTES);
        if(!raw.length)return apiError(res,400,'Indicator evidence body is empty');
        let evidence;try{evidence=JSON.parse(raw.toString('utf8'));}catch{return apiError(res,400,'Indicator evidence must be valid JSON');}
        if(String(evidence?.schema_version||'')!==EVIDENCE_SCHEMA)return apiError(res,400,`Unsupported Elliott evidence schema; expected ${EVIDENCE_SCHEMA}`);
        if(String(evidence?.symbol||'').toUpperCase()!==String(job.symbol||'').toUpperCase())return apiError(res,409,'Indicator evidence symbol does not match report job symbol');
        if(String(evidence?.chart_timeframe||'').toUpperCase()!==timeframe)return apiError(res,409,'Indicator evidence timeframe does not match upload timeframe');
        if(!strictEvidence(evidence))return apiError(res,409,'Strict non-repaint evidence flags are incomplete; capture rejected');
        const docId=`${jobId}__${timeframe}`,now=new Date(),evidenceHash=hash(raw);
        await evidenceCol.doc(docId).set({id:docId,jobId,timeframe,terminalId,receivedAt:now,evidence,evidenceHash,byteLength:raw.length,source:'FXGA_RealTime_Elliott_Wave_Setups',schemaVersion:EVIDENCE_SCHEMA,indicatorVersion:String(evidence?.indicator_version||''),strictNonRepaint:true,purpose:'PDF-dossier-builder-only'},{merge:true});
        return sendJson(res,200,{ok:true,jobId,timeframe,bytes:raw.length,evidenceHash,strictNonRepaint:true,aiTransport:'PDF-only'});
      }
      const statusMatch=url.pathname.match(/^\/api\/elliott-ai\/jobs\/([^/]+)$/);
      if(req.method==='GET'&&statusMatch){const jobId=safeId(statusMatch[1],80),analysisSnap=await analyses.doc(jobId).get(),reportSnap=await reports.doc(jobId).get(),report=reportSnap.exists?reportSnap.data():null;return sendJson(res,200,{ok:true,jobId,reportReady:reportSnap.exists,evidenceCount:Number(report?.evidenceCount||0),evidenceExpected:EXPECTED_TIMEFRAMES,dossierVersion:report?.dossierVersion||null,inputMode:'single-pdf-dossier',strictNonRepaintComplete:Boolean(report?.strictNonRepaintComplete),analysis:analysisSnap.exists?publicAnalysis(analysisSnap):null});}
      if(req.method==='POST'&&url.pathname==='/api/elliott-ai/analyze'){allowAnalyze(req);const jobId=safeId(url.searchParams.get('jobId'),80);if(!jobId)return apiError(res,400,'jobId is required');const result=await analyze(jobId);return sendJson(res,200,{ok:true,analysis:result});}
      return apiError(res,404,'Elliott AI route not found');
    }catch(error){return apiError(res,Number(error?.statusCode||500),String(error?.message||error));}
  }

  function health(){return{enabled:true,provider:'Google Gemini Interactions API',endpointVersion:'v1beta',models:modelOrder(),pdfVision:true,defaultTimeframes:EXPECTED_TIMEFRAMES,promptVersion:PROMPT_VERSION,inputMode:'single-pdf-dossier',historyDaysMinimum:MIN_HISTORY_DAYS,jsonEvidenceSentToModel:false,structuredEvidencePurpose:'embedded-into-pdf-only',strictNonRepaintRequired:true,evidenceSchema:EVIDENCE_SCHEMA,autoTrading:false};}
  return{handle,health,analyze};
}
