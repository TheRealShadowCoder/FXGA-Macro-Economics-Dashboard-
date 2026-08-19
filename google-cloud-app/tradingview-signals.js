import crypto from 'node:crypto';
import { FieldValue } from '@google-cloud/firestore';
import { createFirestoreUsageMonitor } from './firestore-usage-monitor.js';

const SCHEMA='fxga.smc.signal.v3';
const ENGINE='FXGA_SMC2000';
const ALLOWED_EVENTS=new Set(['SIGNAL_NEW','LIMIT_FILLED','TP1_HIT','TP2_HIT','TP3_HIT','INVALIDATED','LIMIT_EXPIRED','LIMIT_MISSED']);
const ACTIVE_STATUSES=new Set(['PENDING_ENTRY','ACTIVE_FILLED']);
const TRADINGVIEW_IPS=new Set(['52.89.214.238','34.212.75.30','54.218.53.128','52.32.178.7']);
const MAX_BODY_BYTES=750_000;
const MAX_PUBLIC_SIGNALS=250;
const perIpRate=new Map();

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const isoFromMs=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n).toISOString():null;};

function requestIp(req){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim()).filter(Boolean);
  return forwarded[0]||String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
}
function timingSafeEqualText(a,b){
  const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));
  return left.length===right.length&&left.length>0&&crypto.timingSafeEqual(left,right);
}
function authorized(req){
  const ip=requestIp(req);
  if(TRADINGVIEW_IPS.has(ip))return {ok:true,mode:'tradingview-ip-allowlist',ip};
  const secret=String(process.env.TRADINGVIEW_WEBHOOK_SECRET||'').trim();
  const supplied=String(req.headers['x-fxga-webhook-secret']||'').trim();
  if(secret&&timingSafeEqualText(secret,supplied))return {ok:true,mode:'manual-secret',ip};
  if(process.env.TRADINGVIEW_ALLOW_UNVERIFIED==='true')return {ok:true,mode:'development-bypass',ip};
  return {ok:false,mode:'rejected',ip};
}
function rateAllowed(ip){
  const now=Date.now(),minute=Math.floor(now/60_000),key=ip||'unknown',current=perIpRate.get(key);
  if(!current||current.minute!==minute){perIpRate.set(key,{minute,count:1});return true;}
  current.count+=1;return current.count<=180;
}
async function readJson(req){
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BODY_BYTES)throw Object.assign(new Error('TradingView payload exceeds 750 KB'),{statusCode:413});chunks.push(chunk);}
  if(!chunks.length)throw Object.assign(new Error('TradingView webhook body is empty'),{statusCode:400});
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('TradingView webhook body must be valid JSON'),{statusCode:400});}
}
function validatePayload(payload){
  if(!payload||typeof payload!=='object')return 'Payload must be a JSON object';
  if(payload.schema!==SCHEMA)return `Unsupported schema. Expected ${SCHEMA}`;
  if(String(payload.source||'')!=='TradingView')return 'source must be TradingView';
  if(String(payload.engine||'')!==ENGINE)return `engine must be ${ENGINE}`;
  if(!ALLOWED_EVENTS.has(String(payload.event||'')))return 'Unsupported lifecycle event';
  if(!String(payload.event_id||'').trim())return 'event_id is required';
  if(!String(payload.symbol||payload.instrument?.symbol||'').trim())return 'symbol is required';
  if(!['BUY','SELL'].includes(String(payload.side||'')))return 'side must be BUY or SELL';
  return null;
}
function compactTelemetry(telemetry){
  if(!telemetry||typeof telemetry!=='object')return null;
  const cap=value=>{if(typeof value!=='string')return value;return value.length>120_000?`${value.slice(0,120_000)}…[truncated]`:value;};
  return {snapshot_contract:telemetry.snapshot_contract??null,signal_snapshot:cap(telemetry.signal_snapshot),current_snapshot:cap(telemetry.current_snapshot)};
}
function compactRaw(payload){return {...payload,telemetry:compactTelemetry(payload.telemetry)};}
function trueRatio(object){
  if(!object||typeof object!=='object')return 0;
  const values=Object.values(object).filter(value=>typeof value==='boolean');if(!values.length)return 0;
  return values.filter(Boolean).length/values.length;
}
function intelligence(payload){
  const method=payload.smc_method||{},hierarchy=payload.timeframe_hierarchy||{},atSignal=hierarchy.at_signal||{},current=hierarchy.current||{};
  const lifecycle=payload.lifecycle||{},rr=payload.risk_reward||{},plan=payload.trade_plan||{},evidence=payload.smc_evidence_at_signal?.detailed||{};
  const sourceScore=clamp(method.score??payload.score??0),alignment=atSignal.fully_aligned?100:current.fully_aligned?88:55;
  const evidenceScore=clamp(trueRatio(evidence)*100),rr3=finite(rr.rr_tp3),rrScore=rr3==null?45:clamp(rr3/3*100);
  const matches=finite(method.exact_matching_methods)??finite(payload.matches)??0,minMatches=Math.max(1,finite(method.minimum_exact_matches_required)??1),matchScore=clamp(matches/minMatches*80,0,100);
  const bars=Math.max(0,finite(lifecycle.bars_since_signal)??0),freshness=clamp(100-bars*7);
  let score=sourceScore*.38+alignment*.18+evidenceScore*.15+rrScore*.14+matchScore*.1+freshness*.05;
  if(atSignal.trade_mode==='COUNTER_TREND')score-=7;
  if(current.major_bias_changed_since_signal===true)score-=14;
  score=Math.round(clamp(score));
  const status=String(lifecycle.status||payload.event_detail?.status_after_event||'PENDING_ENTRY');
  const event=String(payload.event||'');
  let suggestedSignal=String(payload.side||'WAIT'),action='OBSERVE',label='Observe setup',explanation='The indicator signal is being tracked while supporting evidence develops.';
  if(status==='COMPLETED'||event==='TP3_HIT'){
    suggestedSignal='WAIT';action='COMPLETED';label='Final target reached';explanation='The indicator lifecycle reports TP3 complete. Treat the original setup as finished rather than a fresh entry.';
  }else if(status==='CANCELLED'||['INVALIDATED','LIMIT_EXPIRED','LIMIT_MISSED'].includes(event)){
    suggestedSignal='WAIT';action=event==='INVALIDATED'?'INVALIDATED':event==='LIMIT_EXPIRED'?'EXPIRED':'MISSED';label=event==='INVALIDATED'?'Setup invalidated':event==='LIMIT_EXPIRED'?'Limit expired':'Entry missed';explanation='The indicator lifecycle no longer considers this setup executable. Wait for a new confirmed signal.';
  }else if(event==='TP2_HIT'){
    action='PROTECT_WINNER';label='TP2 reached';explanation='The setup is already advanced. Focus on the indicator invalidation and final-target logic rather than treating this as a new entry.';
  }else if(event==='TP1_HIT'){
    action='MANAGE_ACTIVE';label='TP1 reached';explanation='The first target has been reached. The signal remains active only while its structural invalidation remains intact.';
  }else if(plan.filled===true||status==='ACTIVE_FILLED'||event==='LIMIT_FILLED'){
    action='MANAGE_ACTIVE';label='Position phase active';explanation='The indicator reports the entry as filled. This is now a management state, not a new signal to chase.';
  }else if(current.major_bias_changed_since_signal===true){
    suggestedSignal='WAIT';action='WAIT_FOR_CONFIRMATION';label='Major bias changed';explanation='Current H4 direction no longer matches the original signal snapshot. Wait for the hierarchy to realign or a new signal.';
  }else if(atSignal.trade_mode==='COUNTER_TREND'&&score<82){
    suggestedSignal='WAIT';action='HIGHER_RISK_WAIT';label='Counter trend · wait';explanation='The indicator marked this setup counter trend and the contextual score is not high enough to promote it as actionable.';
  }else if(plan.order_type?.includes('LIMIT')&&plan.filled!==true){
    action='WAIT_FOR_ENTRY';label=`${payload.side} setup · wait for limit`;explanation='The indicator defined a limit entry. Keep the planned entry and invalidation geometry; do not chase price away from the setup.';
  }else if(score>=78){
    action='ACTIONABLE_SIGNAL';label=`${payload.side} setup confirmed`;explanation='The indicator signal is active and its hierarchy, SMC evidence and risk geometry remain sufficiently aligned. This is setup guidance, not a guarantee of outcome.';
  }else{
    suggestedSignal='WAIT';action='WAIT_FOR_CONFIRMATION';label='Signal received · confirmation weak';explanation='The source signal is recorded, but the contextual evidence score is below the dashboard actionability threshold.';
  }
  const grade=score>=90?'ELITE':score>=80?'HIGH':score>=70?'GOOD':score>=60?'MODERATE':'LOW';
  return {score,grade,suggestedSignal,sourceSignal:String(payload.side||'WAIT'),action,label,explanation,components:{sourceScore:Math.round(sourceScore),timeframeAlignment:Math.round(alignment),evidence:Math.round(evidenceScore),riskReward:Math.round(rrScore),methodMatches:Math.round(matchScore),freshness:Math.round(freshness)},policy:'Contextualizes the TradingView indicator lifecycle. It never fabricates a signal or reverses the indicator direction.'};
}
function canonicalSignal(payload,existing,receivedAt){
  const lifecycle=payload.lifecycle||{},method=payload.smc_method||{},plan=payload.trade_plan||{},detail=payload.event_detail||{};
  const signalTimeMs=finite(lifecycle.signal_time_ms)??finite(payload.candle?.bar_time_ms)??Date.now();
  const intelligenceLayer=intelligence(payload);
  return {
    id:existing?.id,
    schema:payload.schema,source:payload.source,engine:payload.engine,stream:payload.stream??null,
    symbol:String(payload.symbol||payload.instrument?.symbol||''),tickerId:String(payload.ticker_id||payload.instrument?.ticker_id||''),exchange:String(payload.exchange||payload.instrument?.exchange||''),timeframe:String(payload.timeframe||payload.instrument?.chart_timeframe||''),
    side:String(payload.side),methodId:finite(payload.method_id)??finite(method.id),methodCode:method.code??null,methodFamily:method.family??null,methodScore:finite(method.score),exactMatches:finite(method.exact_matching_methods),
    signalTime:isoFromMs(signalTimeMs),signalTimeMs,status:String(lifecycle.status||detail.status_after_event||'PENDING_ENTRY'),lastEvent:String(payload.event),lastReason:payload.reason_code??detail.reason_code??null,lastMeaning:detail.meaning??payload.explanation??null,lastEventPrice:finite(detail.event_price??plan.event_price),marketPrice:finite(detail.market_price??plan.current_market_price),
    tradePlan:{side:plan.side??payload.side,tradeMode:plan.trade_mode??null,orderType:plan.order_type??null,filled:Boolean(plan.filled),entry:finite(plan.entry),stopLoss:finite(plan.stop_loss),tp1:finite(plan.tp1),tp2:finite(plan.tp2),tp3:finite(plan.tp3),primaryTargetType:plan.primary_smc_target_type??null},
    riskReward:{riskPriceDistance:finite(payload.risk_reward?.risk_price_distance),rrTp1:finite(payload.risk_reward?.rr_tp1),rrTp2:finite(payload.risk_reward?.rr_tp2),rrTp3:finite(payload.risk_reward?.rr_tp3)},
    lifecycle:{barsSinceSignal:finite(lifecycle.bars_since_signal),entryFilled:Boolean(lifecycle.entry_filled),tp1Hit:Boolean(lifecycle.tp1_hit),tp2Hit:Boolean(lifecycle.tp2_hit),finalTargetHit:Boolean(lifecycle.final_target_hit)},
    timeframeHierarchy:payload.timeframe_hierarchy??null,smcEvidenceAtSignal:payload.smc_evidence_at_signal??null,currentMarketEvidence:payload.current_market_evidence??null,dealingRange:payload.dealing_range??null,pdArray:payload.pd_array??null,invalidation:payload.invalidation??null,
    intelligence:intelligenceLayer,createdAt:existing?.createdAt??receivedAt,updatedAt:receivedAt,lastEventAt:receivedAt,lastEventId:String(payload.event_id),eventCount:Number(existing?.eventCount||0)+1,
  };
}
function setupId(payload){
  const time=finite(payload.lifecycle?.signal_time_ms)??finite(payload.candle?.bar_time_ms)??0;
  const method=finite(payload.method_id)??finite(payload.smc_method?.id)??0;
  const ticker=String(payload.ticker_id||payload.instrument?.ticker_id||payload.symbol||'UNKNOWN');
  return hash(`${ticker}:${time}:${method}`).slice(0,40);
}
function eventIncrement(event,side){
  const inc={totalEvents:FieldValue.increment(1)};
  if(event==='SIGNAL_NEW'){inc.totalSignals=FieldValue.increment(1);inc[side==='BUY'?'buySignals':'sellSignals']=FieldValue.increment(1);}
  if(event==='LIMIT_FILLED')inc.filled=FieldValue.increment(1);
  if(event==='TP1_HIT')inc.tp1Hits=FieldValue.increment(1);
  if(event==='TP2_HIT')inc.tp2Hits=FieldValue.increment(1);
  if(event==='TP3_HIT'){inc.tp3Hits=FieldValue.increment(1);inc.completed=FieldValue.increment(1);}
  if(event==='INVALIDATED')inc.invalidated=FieldValue.increment(1);
  if(event==='LIMIT_EXPIRED')inc.expired=FieldValue.increment(1);
  if(event==='LIMIT_MISSED')inc.missed=FieldValue.increment(1);
  return inc;
}
function publicSignal(data){
  if(!data)return data;
  const {rawPayload,...safe}=data;return safe;
}

export function createTradingViewSignalService({db,broadcast=()=>{}}){
  const signals=db.collection('fxga_tradingview_signals');
  const signalEvents=db.collection('fxga_tradingview_signal_events');
  const live=db.collection('fxga_tradingview_live');
  const metricsRef=live.doc('metrics');
  const metaRef=live.doc('meta');
  const usageMonitor=createFirestoreUsageMonitor({metricsRef});
  let metaCache={at:0,data:null,promise:null};
  let rowsCache={version:null,rows:[]};
  let metricsCache={version:null,value:null};

  async function cachedMeta(force=false){
    if(!force&&metaCache.data&&Date.now()-metaCache.at<10_000)return metaCache.data;
    if(metaCache.promise)return metaCache.promise;
    metaCache.promise=metaRef.get().then(snap=>snap.exists?snap.data():{}).catch(()=>({})).then(data=>{metaCache={at:Date.now(),data,promise:null};return data;});
    return metaCache.promise;
  }
  function invalidateReadCaches(){metaCache={at:0,data:null,promise:null};rowsCache={version:null,rows:[]};metricsCache={version:null,value:null};}

  async function ingest(req,res,sendJson,apiError){
    const auth=authorized(req);
    if(!auth.ok)return apiError(res,403,'TradingView webhook source is not authorized');
    if(!rateAllowed(auth.ip))return apiError(res,429,'TradingView webhook rate limit exceeded');
    let payload;try{payload=await readJson(req);}catch(error){return apiError(res,error.statusCode||400,error.message);}
    const problem=validatePayload(payload);if(problem)return apiError(res,422,problem);
    const receivedAt=new Date().toISOString(),id=setupId(payload),eventDocId=hash(payload.event_id),signalRef=signals.doc(id),eventRef=signalEvents.doc(eventDocId);
    let duplicate=false,signal=null;
    await db.runTransaction(async tx=>{
      const [eventSnap,signalSnap]=await Promise.all([tx.get(eventRef),tx.get(signalRef)]);
      if(eventSnap.exists){duplicate=true;signal=signalSnap.exists?publicSignal(signalSnap.data()):null;return;}
      const existing=signalSnap.exists?signalSnap.data():null;
      signal=canonicalSignal(payload,{...existing,id},receivedAt);
      tx.create(eventRef,{id:eventDocId,setupId:id,eventId:String(payload.event_id),event:String(payload.event),symbol:signal.symbol,side:signal.side,receivedAt,authMode:auth.mode,payload:compactRaw(payload)});
      tx.set(signalRef,signal,{merge:false});
      tx.set(metricsRef,{...eventIncrement(String(payload.event),String(payload.side)),updatedAt:receivedAt,lastSignalId:id},{merge:true});
      tx.set(metaRef,{updatedAt:receivedAt,lastSignalId:id,lastEvent:String(payload.event),lastEventId:String(payload.event_id),symbol:signal.symbol,side:signal.side,status:signal.status,intelligenceScore:signal.intelligence.score},{merge:true});
    });
    if(!duplicate){invalidateReadCaches();}
    if(!duplicate&&signal){broadcast({type:'tradingview-signal',updateType:'tradingview-signal',timestamp:receivedAt,event:signal.lastEvent,signal:publicSignal(signal)});}
    return sendJson(res,200,{ok:true,duplicate,setupId:id,eventId:String(payload.event_id),event:String(payload.event),status:signal?.status??null,intelligence:signal?.intelligence??null,receivedAt});
  }

  async function allSignalsCached(){
    const meta=await cachedMeta(),version=String(meta?.updatedAt||'none');
    if(rowsCache.version===version&&rowsCache.rows.length)return rowsCache.rows;
    const snap=await signals.orderBy('updatedAt','desc').limit(MAX_PUBLIC_SIGNALS).get();
    const rows=snap.docs.map(doc=>publicSignal({id:doc.id,...doc.data()}));rowsCache={version,rows};return rows;
  }
  async function listSignals(url,liveOnly=false){
    const limit=Math.min(MAX_PUBLIC_SIGNALS,Math.max(1,Number(url.searchParams.get('limit')||80)));
    let rows=[...(await allSignalsCached())];
    if(liveOnly)rows=rows.filter(row=>ACTIVE_STATUSES.has(String(row.status)));
    const symbol=String(url.searchParams.get('symbol')||'').toUpperCase(),timeframe=String(url.searchParams.get('timeframe')||'').toUpperCase(),side=String(url.searchParams.get('side')||'').toUpperCase(),status=String(url.searchParams.get('status')||'').toUpperCase();
    if(symbol)rows=rows.filter(row=>String(row.symbol).toUpperCase()===symbol);
    if(timeframe)rows=rows.filter(row=>String(row.timeframe).toUpperCase()===timeframe);
    if(side)rows=rows.filter(row=>String(row.side).toUpperCase()===side);
    if(status)rows=rows.filter(row=>String(row.status).toUpperCase()===status);
    return rows.slice(0,limit);
  }
  async function signalMetrics(){
    const meta=await cachedMeta(),version=String(meta?.updatedAt||'none');
    if(metricsCache.version===version&&metricsCache.value)return metricsCache.value;
    const metrics=await metricsRef.get(),m=metrics.exists?metrics.data():{};
    const total=Number(m.totalSignals||0),completed=Number(m.completed||0),tp1=Number(m.tp1Hits||0),tp2=Number(m.tp2Hits||0),tp3=Number(m.tp3Hits||0);
    const value={...m,totalSignals:total,completionRate:total?Number((completed/total*100).toFixed(1)):0,tp1Rate:total?Number((tp1/total*100).toFixed(1)):0,tp2Rate:total?Number((tp2/total*100).toFixed(1)):0,tp3Rate:total?Number((tp3/total*100).toFixed(1)):0,latest:meta||null};
    metricsCache={version,value};return value;
  }

  async function handle(req,res,url,sendJson,apiError){
    if(url.pathname==='/api/tradingview/webhook'){
      if(req.method!=='POST')return apiError(res,405,'TradingView webhook requires POST');
      await ingest(req,res,sendJson,apiError);return true;
    }
    if(!url.pathname.startsWith('/api/tradingview/'))return false;
    if(req.method!=='GET')return apiError(res,405,'Method not allowed'),true;
    if(url.pathname==='/api/tradingview/config'){
      sendJson(res,200,{schema:SCHEMA,engine:ENGINE,stream:'fxga_smc2000',transport:'TradingView HTTPS POST → Google Cloud Run → Firestore → WebSocket',authorization:'TradingView official webhook IP allowlist with optional manual secret header',allowedLifecycleEvents:[...ALLOWED_EVENTS],cloudflareProcessing:false,capacityMonitoring:'Google Cloud Monitoring'},'public, max-age=30');return true;
    }
    if(url.pathname==='/api/tradingview/firestore-usage'){
      sendJson(res,200,await usageMonitor.snapshot(),'no-store');return true;
    }
    if(url.pathname==='/api/tradingview/signals/live'){
      const rows=await listSignals(url,true);sendJson(res,200,{generatedAt:new Date().toISOString(),count:rows.length,signals:rows},'no-store');return true;
    }
    if(url.pathname==='/api/tradingview/signals'){
      const rows=await listSignals(url,false);sendJson(res,200,{generatedAt:new Date().toISOString(),count:rows.length,signals:rows},'no-store');return true;
    }
    if(url.pathname==='/api/tradingview/signals/metrics'){
      sendJson(res,200,await signalMetrics(),'no-store');return true;
    }
    const match=url.pathname.match(/^\/api\/tradingview\/signals\/([a-f0-9]{40})$/);
    if(match){const [signalSnap,eventSnap]=await Promise.all([signals.doc(match[1]).get(),signalEvents.where('setupId','==',match[1]).limit(80).get()]);if(!signalSnap.exists)return apiError(res,404,'Signal not found'),true;const events=eventSnap.docs.map(doc=>{const data=doc.data();return {id:doc.id,eventId:data.eventId,event:data.event,receivedAt:data.receivedAt,payload:data.payload};}).sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));sendJson(res,200,{signal:publicSignal({id:signalSnap.id,...signalSnap.data()}),events},'no-store');return true;}
    return apiError(res,404,'TradingView signal route not found'),true;
  }

  function health(){return {schema:SCHEMA,engine:ENGINE,stream:'fxga_smc2000',officialIpAllowlist:true,optionalManualSecretConfigured:Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),storage:'Google Cloud Firestore',capacityMonitoring:'Google Cloud Monitoring',readGovernor:'version-aware shared signal cache',realtime:'Google Cloud Run WebSocket',cloudflareProcessing:false};}
  return {handle,health};
}
