import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { createMT5PriceCache } from './price-cache.js';

const PORT=Number(process.env.PORT||8080);
const PROJECT_ID=process.env.GCP_PROJECT_ID||process.env.GOOGLE_CLOUD_PROJECT||undefined;
const EXPECTED_TOKEN_SHA256=String(process.env.FXGA_MT5_TOKEN_SHA256||'649e0eee73a3441f9d869991dd2295eb9544725b86936a227e6fcc1c2631630d').toLowerCase();
const SCHEMA='fxga.smc.signal.v3';
const ENGINE='FXGA_SMC2000';
const SOURCE='MetaTrader5';
const ALLOWED_EVENTS=new Set(['SIGNAL_NEW','LIMIT_FILLED','TP1_HIT','TP2_HIT','TP3_HIT','INVALIDATED','LIMIT_EXPIRED','LIMIT_MISSED']);
const MAX_BODY_BYTES=750_000;
const MAX_PER_MINUTE=180;
const db=new Firestore({projectId:PROJECT_ID,ignoreUndefinedProperties:true});
const signals=db.collection('fxga_tradingview_signals');
const events=db.collection('fxga_tradingview_signal_events');
const live=db.collection('fxga_tradingview_live');
const metricsRef=live.doc('metrics');
const metaRef=live.doc('meta');
const priceCache=createMT5PriceCache({db});
const rate=new Map();

const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const isoMs=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n).toISOString():null;};
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Accept, Cache-Control, Content-Type, X-FXGA-MT5-Token','Access-Control-Max-Age':'86400'};

function sendJson(res,status,payload,cacheControl='no-store'){
  const body=Buffer.from(JSON.stringify(payload));
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':String(body.length),'Cache-Control':cacheControl,'X-Content-Type-Options':'nosniff',...CORS});
  res.end(body);
}
function requestIp(req){const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();return forwarded||String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');}
function authorized(req){const supplied=String(req.headers['x-fxga-mt5-token']||'');if(!supplied||!EXPECTED_TOKEN_SHA256)return false;const got=Buffer.from(sha(supplied),'hex'),expected=Buffer.from(EXPECTED_TOKEN_SHA256,'hex');return got.length===expected.length&&crypto.timingSafeEqual(got,expected);}
function rateAllowed(ip){const minute=Math.floor(Date.now()/60000),key=ip||'unknown',row=rate.get(key);if(!row||row.minute!==minute){rate.set(key,{minute,count:1});return true;}row.count+=1;return row.count<=MAX_PER_MINUTE;}
async function readJson(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BODY_BYTES)throw Object.assign(new Error('Payload exceeds 750 KB'),{statusCode:413});chunks.push(chunk);}if(!chunks.length)throw Object.assign(new Error('Empty JSON body'),{statusCode:400});try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Body must be valid JSON'),{statusCode:400});}}
function validate(p){if(!p||typeof p!=='object')return 'Payload must be a JSON object';if(p.schema!==SCHEMA)return `Unsupported schema; expected ${SCHEMA}`;if(String(p.source||'')!==SOURCE)return `source must be ${SOURCE}`;if(String(p.engine||'')!==ENGINE)return `engine must be ${ENGINE}`;if(!ALLOWED_EVENTS.has(String(p.event||'')))return 'Unsupported lifecycle event';if(!String(p.event_id||'').trim())return 'event_id is required';if(!String(p.symbol||p.instrument?.symbol||'').trim())return 'symbol is required';if(!['BUY','SELL'].includes(String(p.side||'')))return 'side must be BUY or SELL';return null;}
function trueRatio(obj){if(!obj||typeof obj!=='object')return 0;const vals=Object.values(obj).filter(x=>typeof x==='boolean');return vals.length?vals.filter(Boolean).length/vals.length:0;}
function intelligence(p){
  const method=p.smc_method||{},h=p.timeframe_hierarchy||{},a=h.at_signal||{},c=h.current||{},rr=p.risk_reward||{},plan=p.trade_plan||{},life=p.lifecycle||{};
  const sourceScore=clamp(method.score??p.score??0),alignment=a.fully_aligned?100:c.fully_aligned?88:55,evidence=clamp(trueRatio(p.smc_evidence_at_signal?.detailed||{})*100),rr3=finite(rr.rr_tp3),rrScore=rr3==null?45:clamp(rr3/3*100),matches=finite(method.exact_matching_methods)??finite(p.matches)??0,minimum=Math.max(1,finite(method.minimum_exact_matches_required)??1),matchScore=clamp(matches/minimum*80),bars=Math.max(0,finite(life.bars_since_signal)??0),freshness=clamp(100-bars*7);
  let score=sourceScore*.38+alignment*.18+evidence*.15+rrScore*.14+matchScore*.10+freshness*.05;if(a.trade_mode==='COUNTER_TREND')score-=7;if(c.major_bias_changed_since_signal===true)score-=14;score=Math.round(clamp(score));
  const event=String(p.event||''),status=String(life.status||p.event_detail?.status_after_event||'PENDING_ENTRY');let suggestedSignal=String(p.side||'WAIT'),action='OBSERVE',label='Observe setup',explanation='MT5 SMC2000 signal recorded and monitored by Google Cloud.';
  if(status==='COMPLETED'||event==='TP3_HIT'){suggestedSignal='WAIT';action='COMPLETED';label='Final target reached';explanation='TP3 is complete; the setup is historical, not a fresh entry.';}
  else if(status==='CANCELLED'||['INVALIDATED','LIMIT_EXPIRED','LIMIT_MISSED'].includes(event)){suggestedSignal='WAIT';action=event==='INVALIDATED'?'INVALIDATED':event==='LIMIT_EXPIRED'?'EXPIRED':'MISSED';label=event==='INVALIDATED'?'Setup invalidated':event==='LIMIT_EXPIRED'?'Limit expired':'Entry missed';explanation='The MT5 lifecycle no longer considers this setup executable.';}
  else if(event==='TP2_HIT'){action='PROTECT_WINNER';label='TP2 reached';explanation='The setup is advanced; manage risk toward the final target.';}
  else if(event==='TP1_HIT'){action='MANAGE_ACTIVE';label='TP1 reached';explanation='First target reached; manage the active setup while invalidation remains intact.';}
  else if(plan.filled===true||status==='ACTIVE_FILLED'||event==='LIMIT_FILLED'){action='MANAGE_ACTIVE';label='Position phase active';explanation='The MT5 model reports entry filled; this is a management state, not a new signal.';}
  else if(c.major_bias_changed_since_signal===true){suggestedSignal='WAIT';action='WAIT_FOR_CONFIRMATION';label='Major bias changed';explanation='Current H4 bias differs from the signal snapshot.';}
  else if(a.trade_mode==='COUNTER_TREND'&&score<82){suggestedSignal='WAIT';action='HIGHER_RISK_WAIT';label='Counter trend · wait';explanation='Counter-trend setup is below the contextual actionability threshold.';}
  else if(String(plan.order_type||'').includes('LIMIT')&&plan.filled!==true){action='WAIT_FOR_ENTRY';label=`${p.side} setup · wait for limit`;explanation='Respect the planned limit entry; do not chase away from the SMC zone.';}
  else if(score>=78){action='ACTIONABLE_SIGNAL';label=`${p.side} setup confirmed`;explanation='MT5 hierarchy, SMC evidence and risk geometry remain aligned.';}
  else{suggestedSignal='WAIT';action='WAIT_FOR_CONFIRMATION';label='Signal received · confirmation weak';explanation='Source signal is stored, but contextual evidence is below threshold.';}
  const grade=score>=90?'ELITE':score>=80?'HIGH':score>=70?'GOOD':score>=60?'MODERATE':'LOW';return {score,grade,suggestedSignal,sourceSignal:String(p.side||'WAIT'),action,label,explanation,components:{sourceScore:Math.round(sourceScore),timeframeAlignment:Math.round(alignment),evidence:Math.round(evidence),riskReward:Math.round(rrScore),methodMatches:Math.round(matchScore),freshness:Math.round(freshness)},policy:'Contextualizes the MT5 SMC2000 lifecycle without inventing or reversing source direction.'};
}
function canonical(p,existing,id,receivedAt){
  const life=p.lifecycle||{},method=p.smc_method||{},plan=p.trade_plan||{},detail=p.event_detail||{},signalTimeMs=finite(life.signal_time_ms)??finite(p.candle?.bar_time_ms)??Date.now();
  return {id,schema:p.schema,source:p.source,platform:'MT5',engine:p.engine,stream:p.stream??'fxga_smc2000_mt5',symbol:String(p.symbol||p.instrument?.symbol||''),tickerId:String(p.ticker_id||p.instrument?.ticker_id||p.symbol||''),exchange:String(p.exchange||p.instrument?.exchange||'MetaTrader5'),timeframe:String(p.timeframe||p.instrument?.chart_timeframe||''),side:String(p.side),methodId:finite(p.method_id)??finite(method.id),methodCode:method.code??null,methodFamily:method.family??null,methodScore:finite(method.score),exactMatches:finite(method.exact_matching_methods),signalTime:isoMs(signalTimeMs),signalTimeMs,status:String(life.status||detail.status_after_event||'PENDING_ENTRY'),lastEvent:String(p.event),lastReason:p.reason_code??detail.reason_code??null,lastMeaning:detail.meaning??p.explanation??null,lastEventPrice:finite(detail.event_price??plan.event_price),marketPrice:finite(detail.market_price??plan.current_market_price),tradePlan:{side:plan.side??p.side,tradeMode:plan.trade_mode??null,orderType:plan.order_type??null,filled:Boolean(plan.filled),entry:finite(plan.entry),stopLoss:finite(plan.stop_loss),tp1:finite(plan.tp1),tp2:finite(plan.tp2),tp3:finite(plan.tp3),primaryTargetType:plan.primary_smc_target_type??null},riskReward:{riskPriceDistance:finite(p.risk_reward?.risk_price_distance),rrTp1:finite(p.risk_reward?.rr_tp1),rrTp2:finite(p.risk_reward?.rr_tp2),rrTp3:finite(p.risk_reward?.rr_tp3)},lifecycle:{barsSinceSignal:finite(life.bars_since_signal),entryFilled:Boolean(life.entry_filled),tp1Hit:Boolean(life.tp1_hit),tp2Hit:Boolean(life.tp2_hit),finalTargetHit:Boolean(life.final_target_hit)},timeframeHierarchy:p.timeframe_hierarchy??null,smcEvidenceAtSignal:p.smc_evidence_at_signal??null,currentMarketEvidence:p.current_market_evidence??null,dealingRange:p.dealing_range??null,pdArray:p.pd_array??null,invalidation:p.invalidation??null,intelligence:intelligence(p),createdAt:existing?.createdAt??receivedAt,updatedAt:receivedAt,lastEventAt:receivedAt,lastEventId:String(p.event_id),eventCount:Number(existing?.eventCount||0)+1};
}
function setupId(p){const time=finite(p.lifecycle?.signal_time_ms)??finite(p.candle?.bar_time_ms)??0,method=finite(p.method_id)??finite(p.smc_method?.id)??0,ticker=String(p.ticker_id||p.instrument?.ticker_id||p.symbol||'UNKNOWN');return sha(`MT5:${ticker}:${time}:${method}`).slice(0,40);}
function increments(event,side){const x={totalEvents:FieldValue.increment(1),mt5Events:FieldValue.increment(1)};if(event==='SIGNAL_NEW'){x.totalSignals=FieldValue.increment(1);x.mt5Signals=FieldValue.increment(1);x[side==='BUY'?'buySignals':'sellSignals']=FieldValue.increment(1);}if(event==='LIMIT_FILLED')x.filled=FieldValue.increment(1);if(event==='TP1_HIT')x.tp1Hits=FieldValue.increment(1);if(event==='TP2_HIT')x.tp2Hits=FieldValue.increment(1);if(event==='TP3_HIT'){x.tp3Hits=FieldValue.increment(1);x.completed=FieldValue.increment(1);}if(event==='INVALIDATED')x.invalidated=FieldValue.increment(1);if(event==='LIMIT_EXPIRED')x.expired=FieldValue.increment(1);if(event==='LIMIT_MISSED')x.missed=FieldValue.increment(1);return x;}
async function ingest(req,res){
  const ip=requestIp(req);if(!authorized(req))return sendJson(res,403,{error:'MT5 webhook token rejected'});if(!rateAllowed(ip))return sendJson(res,429,{error:'MT5 ingress rate limit exceeded'});let p;try{p=await readJson(req);}catch(error){return sendJson(res,error.statusCode||400,{error:error.message});}const problem=validate(p);if(problem)return sendJson(res,422,{error:problem});
  const id=setupId(p),eventId=sha(String(p.event_id)),signalRef=signals.doc(id),eventRef=events.doc(eventId),receivedAt=new Date().toISOString();let duplicate=false,signal=null;
  await db.runTransaction(async tx=>{const [e,s]=await Promise.all([tx.get(eventRef),tx.get(signalRef)]);if(e.exists){duplicate=true;signal=s.exists?s.data():null;return;}const existing=s.exists?s.data():null;signal=canonical(p,existing,id,receivedAt);tx.create(eventRef,{id:eventId,setupId:id,eventId:String(p.event_id),event:String(p.event),symbol:signal.symbol,side:signal.side,source:SOURCE,platform:'MT5',receivedAt,authMode:'mt5-token-sha256',payload:p});tx.set(signalRef,signal,{merge:false});tx.set(metricsRef,{...increments(String(p.event),String(p.side)),updatedAt:receivedAt,lastSignalId:id},{merge:true});tx.set(metaRef,{updatedAt:receivedAt,lastSignalId:id,lastEvent:String(p.event),lastEventId:String(p.event_id),symbol:signal.symbol,side:signal.side,status:signal.status,intelligenceScore:signal.intelligence.score,source:SOURCE,platform:'MT5'},{merge:true});});
  return sendJson(res,200,{ok:true,duplicate,setupId:id,eventId:String(p.event_id),event:String(p.event),status:signal?.status??null,intelligence:signal?.intelligence??null,receivedAt});
}
async function ingestPriceCache(req,res){const ip=requestIp(req);if(!authorized(req))return sendJson(res,403,{error:'MT5 price-cache token rejected'});if(!rateAllowed(ip))return sendJson(res,429,{error:'MT5 ingress rate limit exceeded'});try{const payload=await readJson(req),result=await priceCache.ingest(payload);return sendJson(res,200,result);}catch(error){return sendJson(res,error.statusCode||500,{error:String(error?.message||error)});}}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{...CORS,'Content-Length':'0'});return res.end();}
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/health'||url.pathname==='/api/mt5/health'))return sendJson(res,200,{ok:true,service:'FXGA MT5 Signal + Price Ingress',architecture:'google-cloud-direct',compute:'Google Cloud Run',storage:'Google Cloud Firestore',schema:SCHEMA,engine:ENGINE,source:SOURCE,endpoint:'/api/mt5/webhook',priceCache:{endpoint:'/api/mt5/price-cache',query:'/api/mt5/prices',status:'/api/mt5/price-cache/status',schema:priceCache.constants.SCHEMA,baseTimeframe:priceCache.constants.BASE_TIMEFRAME,derivedTimeframes:priceCache.constants.TIMEFRAMES,allowedSymbols:priceCache.constants.ALLOWED_SYMBOLS,cacheEnvelopeBytes:priceCache.constants.CACHE_ENVELOPE_BYTES,payloadHardBytes:priceCache.constants.PAYLOAD_HARD_BYTES,evictTargetBytes:priceCache.constants.EVICT_TARGET_BYTES},cloudflareProcessing:false,timestamp:new Date().toISOString()},'public, max-age=15');
    if(url.pathname==='/api/mt5/price-cache/status'){if(req.method!=='GET')return sendJson(res,405,{error:'Price-cache status requires GET'});return sendJson(res,200,await priceCache.status(),'public, max-age=15');}
    if(url.pathname==='/api/mt5/prices'){if(req.method!=='GET')return sendJson(res,405,{error:'MT5 price query requires GET'});try{return sendJson(res,200,await priceCache.query({symbol:url.searchParams.get('symbol'),timeframe:url.searchParams.get('timeframe')||'M1',limit:url.searchParams.get('limit')||1000}),'public, max-age=15');}catch(error){return sendJson(res,error.statusCode||500,{error:String(error?.message||error)});}}
    if(url.pathname==='/api/mt5/price-cache'){if(req.method!=='POST')return sendJson(res,405,{error:'MT5 price cache requires POST'});return await ingestPriceCache(req,res);}
    if(url.pathname==='/api/mt5/webhook'){if(req.method!=='POST')return sendJson(res,405,{error:'MT5 webhook requires POST'});return await ingest(req,res);}
    return sendJson(res,404,{error:'Not found'});
  }catch(error){console.error(error);return sendJson(res,500,{error:'MT5 ingress internal error'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`FXGA MT5 signal + bounded price-cache ingress listening on ${PORT}`));
