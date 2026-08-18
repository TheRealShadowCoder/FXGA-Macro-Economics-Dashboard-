import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

const db=new Firestore({ignoreUndefinedProperties:true});
const memory=db.collection('fxga_decision_memory');
const marketSnapshots=db.collection('fxga_market_snapshots');
const state=db.collection('fxga_collector_state');
const HORIZONS=[
  {id:'m15',ms:15*60_000,toleranceMs:12*60_000},
  {id:'h1',ms:60*60_000,toleranceMs:22*60_000},
  {id:'h4',ms:4*60*60_000,toleranceMs:35*60_000},
  {id:'h24',ms:24*60*60_000,toleranceMs:75*60_000},
];
const normalize=(v)=>String(v||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):0));
const hash=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;

function assetPrice(assets,id){
  const target=normalize(id);
  const asset=(assets||[]).find(item=>[item?.id,item?.symbol,item?.label].some(value=>normalize(value)===target));
  const price=Number(asset?.price);
  return Number.isFinite(price)&&price>0?{price,source:String(asset?.id||asset?.symbol||id),stale:Boolean(asset?.stale)}:null;
}
function derivedPrice(symbol,assets=[]){
  const s=normalize(symbol),direct=assetPrice(assets,s);
  if(direct)return {...direct,derived:false,sources:[direct.source]};
  if(s==='XAUUSD'){
    const gold=assetPrice(assets,'GOLD')||assetPrice(assets,'GOLDFUTURES')||assetPrice(assets,'GC');
    if(gold)return {...gold,derived:false,sources:[gold.source]};
  }
  const eurusd=assetPrice(assets,'EURUSD'),gbpusd=assetPrice(assets,'GBPUSD'),usdzar=assetPrice(assets,'USDZAR');
  if(s==='EURGBP'&&eurusd&&gbpusd)return {price:eurusd.price/gbpusd.price,derived:true,stale:eurusd.stale||gbpusd.stale,sources:[eurusd.source,gbpusd.source]};
  if(s==='EURZAR'&&eurusd&&usdzar)return {price:eurusd.price*usdzar.price,derived:true,stale:eurusd.stale||usdzar.stale,sources:[eurusd.source,usdzar.source]};
  if(s==='GBPZAR'&&gbpusd&&usdzar)return {price:gbpusd.price*usdzar.price,derived:true,stale:gbpusd.stale||usdzar.stale,sources:[gbpusd.source,usdzar.source]};
  return null;
}
function probabilityForDirection(pair,direction){
  const p=pair?.bayesian?.posterior||{};
  return direction==='BUY'?clamp(Number(p.buy||0)):direction==='SELL'?clamp(Number(p.sell||0)):clamp(Number(p.wait||0));
}
function confidenceBucket(value){const c=Number(value||0);return c>=80?'80-100':c>=65?'65-79':c>=50?'50-64':'0-49';}
function pairFeatureVector(pair){
  const posterior=pair?.bayesian?.posterior||{};
  return {
    refinedScore:Number(pair?.refined?.score||0),
    directionalProbability:Math.max(Number(posterior.buy||0),Number(posterior.sell||0)),
    evidenceQuality:Number(pair?.quality?.score||0),
    uncertainty:Number(pair?.uncertainty?.score||0),
    scenarioRobustness:Number(pair?.scenarioRobustness?.score||0),
    contradictions:Number(pair?.contradictions?.count||0),
    reactionGap:Number(pair?.reactionFunctionGap?.differential||0),
    crossAssetScore:Number(pair?.crossAsset?.score||0),
    evidenceCompleteness:Number(pair?.evidenceCompleteness?.score||0),
    releaseDifferential:Number(pair?.temporalIntelligence?.releaseDifferential||0),
    revisionDifferential:Number(pair?.temporalIntelligence?.revisionDifferential||0),
    communicationGap:Number(pair?.temporalIntelligence?.communicationGap||0),
    transitionRisk:Number(pair?.transitionRisk?.maxRisk||0),
    structuralBreakRisk:Number(pair?.structuralBreak?.risk||0),
    independenceRatio:Number(pair?.evidenceIndependence?.independenceRatio??1),
    modelHealth:Number(pair?.modelHealth?.score||0),
    counterfactualShift:Number(pair?.counterfactual?.minimumAdverseShift||100),
    causalNet:Number(pair?.causalTransmission?.netTransmission||0)
  };
}

export async function recordDecisionMemory(engine,marketData=[]){
  const pairs=engine?.decisionGovernance?.pairDecisions||[],decisionAt=engine?.generatedAt||new Date().toISOString(),bucketMs=Math.floor(Date.parse(decisionAt)/900000)*900000,bucket=new Date(bucketMs).toISOString();
  let recorded=0,skipped=0;
  for(const pair of pairs){
    const symbol=normalize(pair.symbol),direction=String(pair?.final?.direction||'WAIT').toUpperCase(),baseline=derivedPrice(symbol,marketData),id=hash(`${bucket}|${symbol}`).slice(0,40),ref=memory.doc(id),existing=await ref.get();
    if(existing.exists){skipped++;continue;}
    const directional=direction==='BUY'||direction==='SELL',canEvaluate=directional&&baseline&&Number.isFinite(baseline.price)&&!baseline.stale;
    const document={id,symbol,decisionAt,bucket,direction,primaryDirection:String(pair.originalDirection||'WAIT'),primaryScore:Number(pair.originalScore||0),refinedScore:Number(pair?.refined?.score||0),confidence:Number(pair?.final?.confidence||0),directionProbability:probabilityForDirection(pair,direction),posterior:pair?.bayesian?.posterior||null,evidenceQuality:Number(pair?.quality?.score||0),uncertainty:Number(pair?.uncertainty?.score||0),scenarioRobustness:Number(pair?.scenarioRobustness?.score||0),contradictions:Number(pair?.contradictions?.count||0),featureVector:pairFeatureVector(pair),governanceReasons:pair?.final?.reason||[],thesis:pair?.thesis?.statement||null,baseline:baseline?{price:baseline.price,derived:baseline.derived,stale:baseline.stale,sources:baseline.sources}:null,outcomes:{},complete:!canEvaluate,evaluationStatus:canEvaluate?'pending':directional?'no-verified-baseline':'wait-decision',recordedAt:new Date().toISOString()};
    await ref.set(document,{merge:false});recorded++;
  }
  return {recorded,skipped,total:pairs.length};
}
async function loadMarketHistory(limit=260){
  const snap=await marketSnapshots.orderBy('capturedAt','desc').limit(Math.min(400,Math.max(50,limit))).get();
  return snap.docs.map(doc=>doc.data()).filter(data=>Number.isFinite(Date.parse(data?.capturedAt||'')));
}
function closestSnapshot(history,targetMs,toleranceMs,symbol){
  let best=null;
  for(const data of history){const time=Date.parse(data?.capturedAt||'');if(!Number.isFinite(time)||Math.abs(time-targetMs)>toleranceMs)continue;const price=derivedPrice(symbol,data?.assets||[]);if(!price||price.stale)continue;const distance=Math.abs(time-targetMs);if(!best||distance<best.distance)best={capturedAt:data.capturedAt,price:price.price,derived:price.derived,sources:price.sources,distance};}
  return best;
}
function scoreOutcome(document,horizon,point){
  const baseline=Number(document?.baseline?.price),current=Number(point?.price);if(!Number.isFinite(baseline)||baseline<=0||!Number.isFinite(current)||current<=0)return null;
  const rawReturn=(current/baseline)-1,signedReturn=document.direction==='SELL'?-rawReturn:rawReturn,signedBps=signedReturn*10000,rawBps=rawReturn*10000,target=Math.abs(rawBps)<2?.5:signedBps>0?1:0,p=clamp(Number(document.directionProbability||0));
  return {horizon:horizon.id,targetAt:new Date(Date.parse(document.decisionAt)+horizon.ms).toISOString(),capturedAt:point.capturedAt,price:current,derived:Boolean(point.derived),sources:point.sources,rawBps:Number(rawBps.toFixed(2)),signedBps:Number(signedBps.toFixed(2)),outcome:target===.5?'flat':target===1?'correct':'wrong',target,brier:Number(((p-target)**2).toFixed(5)),directionProbability:p};
}
function accumulator(){return {count:0,correct:0,wrong:0,flat:0,signedBps:[],brier:[]};}
function add(acc,outcome){acc.count++;if(outcome.outcome==='correct')acc.correct++;else if(outcome.outcome==='wrong')acc.wrong++;else acc.flat++;acc.signedBps.push(Number(outcome.signedBps||0));acc.brier.push(Number(outcome.brier||0));}
function finalize(acc){return {count:acc.count,correct:acc.correct,wrong:acc.wrong,flat:acc.flat,hitRate:acc.count?Number((100*acc.correct/acc.count).toFixed(1)):null,nonLossRate:acc.count?Number((100*(acc.correct+acc.flat)/acc.count).toFixed(1)):null,averageSignedBps:acc.count?Number(mean(acc.signedBps).toFixed(2)):null,brier:acc.count?Number(mean(acc.brier).toFixed(4)):null};}
async function summarizeDecisionMemory(){
  const snap=await memory.orderBy('decisionAt','desc').limit(500).get(),documents=snap.docs.map(doc=>doc.data()),byHorizon=Object.fromEntries(HORIZONS.map(h=>[h.id,accumulator()])),symbolAcc={},bucketAcc={};let directionalRecorded=0,waitRecorded=0,pending=0,noBaseline=0;
  for(const document of documents){if(document.direction==='WAIT')waitRecorded++;else directionalRecorded++;if(document.evaluationStatus==='pending')pending++;if(document.evaluationStatus==='no-verified-baseline')noBaseline++;for(const horizon of HORIZONS){const outcome=document?.outcomes?.[horizon.id];if(!outcome)continue;add(byHorizon[horizon.id],outcome);symbolAcc[document.symbol]??=Object.fromEntries(HORIZONS.map(h=>[h.id,accumulator()]));add(symbolAcc[document.symbol][horizon.id],outcome);const bucket=confidenceBucket(document.confidence);bucketAcc[bucket]??=Object.fromEntries(HORIZONS.map(h=>[h.id,accumulator()]));add(bucketAcc[bucket][horizon.id],outcome);}}
  const latestBySymbol={};for(const document of documents){const symbol=String(document.symbol||'').toUpperCase();if(!symbol)continue;const row=latestBySymbol[symbol]??{latest:null,previous:null};if(!row.latest)row.latest=document;else if(!row.previous)row.previous=document;latestBySymbol[symbol]=row;}
  const compactDecision=document=>document?{id:document.id,symbol:document.symbol,decisionAt:document.decisionAt,direction:document.direction,primaryDirection:document.primaryDirection,refinedScore:Number(document.refinedScore||0),confidence:Number(document.confidence||0),directionProbability:Number(document.directionProbability||0),uncertainty:Number(document.uncertainty||0),scenarioRobustness:Number(document.scenarioRobustness||0),contradictions:Number(document.contradictions||0),evaluationStatus:document.evaluationStatus}:null;
  const decisionChanges=Object.fromEntries(Object.entries(latestBySymbol).map(([symbol,row])=>[symbol,{latest:compactDecision(row.latest),previous:compactDecision(row.previous)}]));
  const analogueLibrary={};for(const document of documents){const symbol=String(document.symbol||'').toUpperCase();if(!symbol||document.direction==='WAIT'||!document.featureVector)continue;const outcomes=document.outcomes||{},usable=['h1','h4','h24'].some(h=>outcomes[h]);if(!usable)continue;const arr=analogueLibrary[symbol]??[];if(arr.length>=16)continue;arr.push({decisionAt:document.decisionAt,direction:document.direction,confidence:Number(document.confidence||0),featureVector:document.featureVector,outcomes:Object.fromEntries(['m15','h1','h4','h24'].filter(h=>outcomes[h]).map(h=>[h,{outcome:outcomes[h].outcome,signedBps:Number(outcomes[h].signedBps||0),brier:Number(outcomes[h].brier||0)}]))});analogueLibrary[symbol]=arr;}
  const summary={generatedAt:new Date().toISOString(),sampledDecisions:documents.length,directionalRecorded,waitRecorded,pending,noVerifiedBaseline:noBaseline,horizons:Object.fromEntries(Object.entries(byHorizon).map(([k,v])=>[k,finalize(v)])),bySymbol:Object.fromEntries(Object.entries(symbolAcc).map(([symbol,map])=>[symbol,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),byConfidence:Object.fromEntries(Object.entries(bucketAcc).map(([bucket,map])=>[bucket,{horizons:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,finalize(v)]))}])),decisionChanges,analogueLibrary,methodology:'Governed decisions are frozen with verified or derived baseline prices, then evaluated only against persisted market snapshots near fixed horizons. Flat moves receive a neutral 0.5 calibration target. Missing snapshots remain missing. Recent completed states retain compact feature vectors for no-lookahead historical analogue reasoning.'};
  await state.doc('decision-memory-summary').set({hash:hash(JSON.stringify(summary)),updatedAt:summary.generatedAt,payload:summary},{merge:false});return summary;
}
export async function evaluateDecisionMemory({limit=80}={}){
  const [pending,history]=await Promise.all([memory.where('complete','==',false).limit(Math.min(120,Math.max(1,limit))).get(),loadMarketHistory()]),now=Date.now();let evaluatedHorizons=0,completed=0,expired=0;
  for(const doc of pending.docs){const data=doc.data(),decisionMs=Date.parse(data.decisionAt||'');if(!Number.isFinite(decisionMs)){await doc.ref.set({complete:true,evaluationStatus:'invalid-decision-time'},{merge:true});continue;}const outcomes={...(data.outcomes||{})};for(const horizon of HORIZONS){if(outcomes[horizon.id])continue;const targetMs=decisionMs+horizon.ms;if(now<targetMs+horizon.toleranceMs)continue;const point=closestSnapshot(history,targetMs,horizon.toleranceMs,data.symbol);if(point){const scored=scoreOutcome(data,horizon,point);if(scored){outcomes[horizon.id]=scored;evaluatedHorizons++;}}}const all=HORIZONS.every(h=>Boolean(outcomes[h.id])),tooOld=now>decisionMs+72*3600000;const complete=all||tooOld;if(complete){completed++;if(!all)expired++;}await doc.ref.set({outcomes,complete,evaluationStatus:all?'complete':tooOld?'expired-missing-horizons':'pending',lastEvaluatedAt:new Date().toISOString()},{merge:true});}
  const summary=await summarizeDecisionMemory();return {evaluatedHorizons,completed,expired,summary};
}
export async function readDecisionMemorySummary(){const snap=await state.doc('decision-memory-summary').get();return snap.exists?snap.data()?.payload||null:null;}
export { HORIZONS };
