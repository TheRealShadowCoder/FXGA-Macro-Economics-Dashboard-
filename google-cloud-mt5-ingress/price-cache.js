import { gzipSync, gunzipSync } from 'node:zlib';

const SCHEMA='fxga.mt5.price-cache.v2';
const META_VERSION=3;
const SOURCE='MetaTrader5';
const BASE_TIMEFRAME='M1';
const INITIAL_BARS_PER_ASSET=20_000;
const INCREMENTAL_BARS_PER_SYNC=160;
const SYNC_SECONDS=300;
const CACHE_ENVELOPE_BYTES=200_000_000;
const PAYLOAD_HARD_BYTES=190_000_000;
const EVICT_TARGET_BYTES=175_000_000;
const MAX_BARS_PER_REQUEST=2_000;
const MAX_DAYS_PER_REQUEST=7;
const STALE_AFTER_MS=15*60_000;
const DEGRADED_AFTER_MS=45*60_000;
const CHUNKS='fxga_mt5_price_cache_chunks';
const META='fxga_mt5_price_cache';
const GLOBAL_ID='global';
const TIMEFRAMES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};

const WEBSITE_ASSETS=Object.freeze([
  {id:'DXY',label:'U.S. Dollar Index',assetClass:'fx-index'},
  {id:'EURUSD',label:'EUR/USD',assetClass:'fx'},
  {id:'GBPUSD',label:'GBP/USD',assetClass:'fx'},
  {id:'USDJPY',label:'USD/JPY',assetClass:'fx'},
  {id:'USDZAR',label:'USD/ZAR',assetClass:'fx'},
  {id:'US2Y',label:'U.S. 2 Year Treasury Yield',assetClass:'rates'},
  {id:'US10Y',label:'U.S. 10 Year Treasury Yield',assetClass:'rates'},
  {id:'SPX',label:'S&P 500',assetClass:'equity-index'},
  {id:'NASDAQ',label:'Nasdaq Composite',assetClass:'equity-index'},
  {id:'DJI',label:'Dow Jones Industrial Average',assetClass:'equity-index'},
  {id:'VIX',label:'CBOE Volatility Index',assetClass:'volatility'},
  {id:'GOLD',label:'Gold',assetClass:'commodity'},
  {id:'WTI',label:'WTI Crude Oil',assetClass:'commodity'},
  {id:'BRENT',label:'Brent Crude Oil',assetClass:'commodity'},
  {id:'BTCUSD',label:'Bitcoin / U.S. Dollar',assetClass:'crypto'},
  {id:'ETHUSD',label:'Ether / U.S. Dollar',assetClass:'crypto'},
]);
const ASSET_BY_ID=new Map(WEBSITE_ASSETS.map(asset=>[asset.id,asset]));
const ALLOWED_SYMBOLS=new Set(WEBSITE_ASSETS.map(asset=>asset.id));

const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const dayKey=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-','');
const chunkId=(symbol,day)=>`${symbol}_${BASE_TIMEFRAME}_${day}`;
const seriesKey=symbol=>`${symbol}_${BASE_TIMEFRAME}`;
const pct=(value,total)=>total?Number((Number(value||0)/total*100).toFixed(3)):0;
const round=(value,digits=4)=>Number(Number(value||0).toFixed(digits));

function normalizeBar(row){
  const x=Array.isArray(row)?row:[row?.time_ms,row?.open,row?.high,row?.low,row?.close,row?.tick_volume,row?.spread,row?.real_volume];
  const timeMs=finite(x[0]),open=finite(x[1]),high=finite(x[2]),low=finite(x[3]),close=finite(x[4]);
  const tickVolume=Math.max(0,Math.round(finite(x[5])??0)),spread=Math.max(0,Math.round(finite(x[6])??0)),realVolume=Math.max(0,Math.round(finite(x[7])??0));
  if(!timeMs||timeMs<946684800000||open==null||high==null||low==null||close==null)return null;
  if(high<Math.max(open,close)||low>Math.min(open,close)||high<low)return null;
  return [Math.round(timeMs),open,high,low,close,tickVolume,spread,realVolume];
}
function validatePayload(payload){
  if(!payload||typeof payload!=='object')return 'Payload must be a JSON object';
  if(!['fxga.mt5.price-cache.v1',SCHEMA].includes(String(payload.schema||'')))return `schema must be ${SCHEMA}`;
  if(String(payload.source||'')!==SOURCE)return `source must be ${SOURCE}`;
  const symbol=String(payload.symbol||'').toUpperCase();
  if(!ALLOWED_SYMBOLS.has(symbol))return `symbol must be one of ${[...ALLOWED_SYMBOLS].join(', ')}`;
  if(String(payload.timeframe||'').toUpperCase()!==BASE_TIMEFRAME)return 'Only M1 source bars are accepted; every higher timeframe is reconstructed from canonical M1';
  if(!Array.isArray(payload.bars)||!payload.bars.length)return 'bars must be a non-empty array';
  if(payload.bars.length>MAX_BARS_PER_REQUEST)return `bars cannot exceed ${MAX_BARS_PER_REQUEST} per request; bootstrap must be chunked`;
  return null;
}
function decodeBlob(data){if(!data)return [];try{return JSON.parse(gunzipSync(Buffer.from(data)).toString('utf8'));}catch{return [];}}
function encodeBars(bars){const raw=Buffer.from(JSON.stringify(bars));const compressed=gzipSync(raw,{level:9});return {raw,compressed};}
function mergeBars(existing,incoming){const map=new Map();for(const row of existing)if(Array.isArray(row)&&row[0])map.set(Number(row[0]),row);for(const row of incoming)map.set(Number(row[0]),row);return [...map.values()].sort((a,b)=>a[0]-b[0]);}
function hasWeekendBetween(a,b){const start=new Date(a);start.setUTCHours(0,0,0,0);const end=new Date(b);end.setUTCHours(0,0,0,0);for(let t=start.getTime();t<=end.getTime();t+=86400_000){const d=new Date(t).getUTCDay();if(d===0||d===6)return true;}return false;}
function diagnoseBars(rows){
  if(!rows.length)return {uniqueBars:[],duplicateTimestamps:0,outOfOrder:0,gapEvents:0,missingMinutes:0,maxGapMinutes:0};
  let duplicateTimestamps=0,outOfOrder=0;const seen=new Set();
  for(let i=0;i<rows.length;i++){const ts=Number(rows[i][0]);if(seen.has(ts))duplicateTimestamps++;seen.add(ts);if(i>0&&ts<Number(rows[i-1][0]))outOfOrder++;}
  const uniqueBars=[...new Map(rows.map(row=>[Number(row[0]),row])).values()].sort((a,b)=>a[0]-b[0]);
  let gapEvents=0,missingMinutes=0,maxGapMinutes=0;
  for(let i=1;i<uniqueBars.length;i++){
    const delta=Number(uniqueBars[i][0])-Number(uniqueBars[i-1][0]);
    if(delta<=60_000||hasWeekendBetween(uniqueBars[i-1][0],uniqueBars[i][0]))continue;
    const gapMinutes=Math.max(0,Math.round(delta/60_000)-1);
    if(gapMinutes){gapEvents++;missingMinutes+=gapMinutes;maxGapMinutes=Math.max(maxGapMinutes,gapMinutes);}
  }
  return {uniqueBars,duplicateTimestamps,outOfOrder,gapEvents,missingMinutes,maxGapMinutes};
}
function subtractUtcDays(ms,days){return ms-days*86400_000;}
function dateRangeIds(symbol,newestMs,days){const ids=[];let cursor=Number(newestMs||Date.now());for(let i=0;i<days;i++){ids.push(chunkId(symbol,dayKey(cursor)));cursor=subtractUtcDays(cursor,1);}return ids;}
function aggregateBars(rows,timeframe){
  const minutes=TIMEFRAMES[timeframe]||1;if(minutes===1)return rows;
  const bucketMs=minutes*60_000,map=new Map();
  for(const row of rows){const t=Math.floor(Number(row[0])/bucketMs)*bucketMs;let x=map.get(t);if(!x){x=[t,row[1],row[2],row[3],row[4],Number(row[5]||0),Number(row[6]||0),Number(row[7]||0)];map.set(t,x);continue;}x[2]=Math.max(x[2],row[2]);x[3]=Math.min(x[3],row[3]);x[4]=row[4];x[5]+=Number(row[5]||0);x[6]=Number(row[6]||x[6]);x[7]+=Number(row[7]||0);}
  return [...map.values()].sort((a,b)=>a[0]-b[0]);
}
function emptySeries(symbol){
  const asset=ASSET_BY_ID.get(symbol)||{label:symbol,assetClass:'market'};
  return {symbol,label:asset.label,assetClass:asset.assetClass,timeframe:BASE_TIMEFRAME,bars:0,chunks:0,oldestMs:null,newestMs:null,lastIngestAt:null,brokerSymbol:null,compressedBytes:0,rawBytes:0,wireBytesReceived:0,normalizedBytesReceived:0,normalizedCompressedBytesReceived:0,ingestBatches:0,receivedBars:0,acceptedBars:0,deduplicatedBars:0,rejectedBars:0,duplicateTimestamps:0,outOfOrderBars:0,gapEvents:0,missingCandleEstimate:0,maxGapMinutes:0,evictedChunks:0,evictedBars:0,evictedBytes:0,brokerSymbolChanges:0,lastBrokerSymbolChangeAt:null,lastBatch:null,latestClose:null,latestTickVolume:null,latestSpread:null};
}
function mergeSeriesChunk(row,d){
  const next={...(row||emptySeries(String(d.symbol||'')))};next.symbol=d.symbol;next.timeframe=BASE_TIMEFRAME;next.bars+=Number(d.count||0);next.chunks+=1;next.compressedBytes+=Number(d.compressedBytes||0);next.rawBytes+=Number(d.rawBytes||0);next.oldestMs=next.oldestMs==null?Number(d.startMs):Math.min(next.oldestMs,Number(d.startMs||next.oldestMs));next.newestMs=next.newestMs==null?Number(d.endMs):Math.max(next.newestMs,Number(d.endMs||next.newestMs));if(d.brokerSymbol)next.brokerSymbol=d.brokerSymbol;if(d.latestClose!=null)next.latestClose=Number(d.latestClose);if(d.latestTickVolume!=null)next.latestTickVolume=Number(d.latestTickVolume);if(d.latestSpread!=null)next.latestSpread=Number(d.latestSpread);return next;
}
async function rebuildMeta(db,previous={}){
  const snap=await db.collection(CHUNKS).get();let totalCompressedBytes=0,totalRawBytes=0,totalBars=0;const series={},latestChunk=new Map();
  for(const doc of snap.docs){const d=doc.data();totalCompressedBytes+=Number(d.compressedBytes||0);totalRawBytes+=Number(d.rawBytes||0);totalBars+=Number(d.count||0);const key=seriesKey(String(d.symbol||''));series[key]=mergeSeriesChunk(series[key],d);const prior=latestChunk.get(key);if(!prior||Number(d.endMs||0)>Number(prior.endMs||0))latestChunk.set(key,d);}
  for(const symbol of ALLOWED_SYMBOLS){const key=seriesKey(symbol),row=series[key]||emptySeries(symbol),old=previous.series?.[key]||{};for(const field of ['ingestBatches','receivedBars','acceptedBars','deduplicatedBars','rejectedBars','duplicateTimestamps','outOfOrderBars','gapEvents','missingCandleEstimate','maxGapMinutes','evictedChunks','evictedBars','evictedBytes','brokerSymbolChanges','wireBytesReceived','normalizedBytesReceived','normalizedCompressedBytesReceived'])if(old[field]!=null)row[field]=Number(old[field]||0);row.lastBrokerSymbolChangeAt=old.lastBrokerSymbolChangeAt??null;row.lastBatch=old.lastBatch??null;row.lastIngestAt=old.lastIngestAt??row.lastIngestAt??null;const latest=latestChunk.get(key);if(latest){const bars=decodeBlob(latest.payload),last=bars.at(-1);if(last){row.latestClose=Number(last[4]);row.latestTickVolume=Number(last[5]||0);row.latestSpread=Number(last[6]||0);}}series[key]=row;}
  const now=new Date().toISOString(),value={...previous,metaVersion:META_VERSION,schema:SCHEMA,cacheEnvelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,evictTargetBytes:EVICT_TARGET_BYTES,totalCompressedBytes,totalRawBytes,totalBars,totalChunks:snap.size,evictedChunks:Number(previous.evictedChunks||0),evictedBars:Number(previous.evictedBars||0),evictedBytes:Number(previous.evictedBytes||0),series,reconciledAt:now,updatedAt:previous.updatedAt??now};
  await db.collection(META).doc(GLOBAL_ID).set(value,{merge:false});return value;
}
async function getMeta(db){const ref=db.collection(META).doc(GLOBAL_ID),snap=await ref.get();if(!snap.exists)return rebuildMeta(db,{});const data=snap.data();if(Number(data?.metaVersion||0)!==META_VERSION||data?.schema!==SCHEMA)return rebuildMeta(db,data||{});return data;}
function applyEvictionToSeries(meta,deleted){const series={...(meta.series||{})};for(const d of deleted){const key=seriesKey(String(d.symbol||'')),old=series[key]||emptySeries(String(d.symbol||''));series[key]={...old,bars:Math.max(0,Number(old.bars||0)-Number(d.count||0)),chunks:Math.max(0,Number(old.chunks||0)-1),compressedBytes:Math.max(0,Number(old.compressedBytes||0)-Number(d.compressedBytes||0)),rawBytes:Math.max(0,Number(old.rawBytes||0)-Number(d.rawBytes||0)),evictedChunks:Number(old.evictedChunks||0)+1,evictedBars:Number(old.evictedBars||0)+Number(d.count||0),evictedBytes:Number(old.evictedBytes||0)+Number(d.compressedBytes||0)};}return series;}
async function reconcileSeriesBounds(db,meta,symbols){
  const series={...(meta.series||{})};
  for(const symbol of symbols){const snap=await db.collection(CHUNKS).where('symbol','==',symbol).get(),preserved=series[seriesKey(symbol)]||emptySeries(symbol);let row={...emptySeries(symbol),...Object.fromEntries(['ingestBatches','receivedBars','acceptedBars','deduplicatedBars','rejectedBars','duplicateTimestamps','outOfOrderBars','gapEvents','missingCandleEstimate','maxGapMinutes','evictedChunks','evictedBars','evictedBytes','brokerSymbolChanges','wireBytesReceived','normalizedBytesReceived','normalizedCompressedBytesReceived'].map(field=>[field,Number(preserved[field]||0)])),lastBrokerSymbolChangeAt:preserved.lastBrokerSymbolChangeAt,lastBatch:preserved.lastBatch,lastIngestAt:preserved.lastIngestAt,brokerSymbol:preserved.brokerSymbol,latestClose:preserved.latestClose,latestTickVolume:preserved.latestTickVolume,latestSpread:preserved.latestSpread};for(const doc of snap.docs)row=mergeSeriesChunk(row,doc.data());series[seriesKey(symbol)]=row;}
  return {...meta,series};
}
async function evictOldest(db,meta,requiredBytes,protectedIds=new Set()){
  let current=Number(meta.totalCompressedBytes||0),evictedBytes=0,evictedRawBytes=0,evictedBars=0,evictedChunks=0;const deleted=[],affectedSymbols=new Set();if(current+requiredBytes<=PAYLOAD_HARD_BYTES)return {meta,evictedBytes,evictedBars,evictedChunks};const target=Math.min(EVICT_TARGET_BYTES,Math.max(0,PAYLOAD_HARD_BYTES-requiredBytes));let guard=0;
  while(current>target&&guard++<20){const snap=await db.collection(CHUNKS).orderBy('endMs','asc').limit(40).get();if(snap.empty)break;const batch=db.batch();let removed=0;for(const doc of snap.docs){if(protectedIds.has(doc.id))continue;const d=doc.data();batch.delete(doc.ref);deleted.push(d);affectedSymbols.add(String(d.symbol||''));current-=Number(d.compressedBytes||0);evictedBytes+=Number(d.compressedBytes||0);evictedRawBytes+=Number(d.rawBytes||0);evictedBars+=Number(d.count||0);evictedChunks++;removed++;if(current<=target)break;}if(!removed)break;await batch.commit();}
  meta={...meta,totalCompressedBytes:Math.max(0,Number(meta.totalCompressedBytes||0)-evictedBytes),totalRawBytes:Math.max(0,Number(meta.totalRawBytes||0)-evictedRawBytes),totalBars:Math.max(0,Number(meta.totalBars||0)-evictedBars),totalChunks:Math.max(0,Number(meta.totalChunks||0)-evictedChunks),evictedBytes:Number(meta.evictedBytes||0)+evictedBytes,evictedBars:Number(meta.evictedBars||0)+evictedBars,evictedChunks:Number(meta.evictedChunks||0)+evictedChunks,lastEvictionAt:evictedChunks?new Date().toISOString():meta.lastEvictionAt??null,series:applyEvictionToSeries(meta,deleted)};if(affectedSymbols.size)meta=await reconcileSeriesBounds(db,meta,[...affectedSymbols].filter(Boolean));return {meta,evictedBytes,evictedBars,evictedChunks};
}
function updateSeriesStorage(meta,symbol,{barDelta,chunkDelta,compressedDelta,rawDelta,startMs,endMs,brokerSymbol,latestBar}){
  const key=seriesKey(symbol),series={...(meta.series||{})},old=series[key]||emptySeries(symbol),changed=old.brokerSymbol&&brokerSymbol&&old.brokerSymbol!==brokerSymbol;series[key]={...old,symbol,timeframe:BASE_TIMEFRAME,bars:Math.max(0,Number(old.bars||0)+barDelta),chunks:Math.max(0,Number(old.chunks||0)+chunkDelta),compressedBytes:Math.max(0,Number(old.compressedBytes||0)+compressedDelta),rawBytes:Math.max(0,Number(old.rawBytes||0)+rawDelta),oldestMs:old.oldestMs==null?startMs:Math.min(Number(old.oldestMs),startMs),newestMs:old.newestMs==null?endMs:Math.max(Number(old.newestMs),endMs),lastIngestAt:new Date().toISOString(),brokerSymbol:brokerSymbol||old.brokerSymbol||symbol,brokerSymbolChanges:Number(old.brokerSymbolChanges||0)+(changed?1:0),lastBrokerSymbolChangeAt:changed?new Date().toISOString():old.lastBrokerSymbolChangeAt??null,latestClose:latestBar?.[4]??old.latestClose??null,latestTickVolume:latestBar?.[5]??old.latestTickVolume??null,latestSpread:latestBar?.[6]??old.latestSpread??null};return series;
}
function updateBatchStats(meta,symbol,stats){
  const key=seriesKey(symbol),series={...(meta.series||{})},old=series[key]||emptySeries(symbol);series[key]={...old,ingestBatches:Number(old.ingestBatches||0)+1,receivedBars:Number(old.receivedBars||0)+stats.receivedBars,acceptedBars:Number(old.acceptedBars||0)+stats.acceptedBars,deduplicatedBars:Number(old.deduplicatedBars||0)+stats.deduplicatedBars,rejectedBars:Number(old.rejectedBars||0)+stats.rejectedBars,duplicateTimestamps:Number(old.duplicateTimestamps||0)+stats.duplicateTimestamps,outOfOrderBars:Number(old.outOfOrderBars||0)+stats.outOfOrderBars,gapEvents:Number(old.gapEvents||0)+stats.gapEvents,missingCandleEstimate:Number(old.missingCandleEstimate||0)+stats.missingCandleEstimate,maxGapMinutes:Math.max(Number(old.maxGapMinutes||0),stats.maxGapMinutes),wireBytesReceived:Number(old.wireBytesReceived||0)+stats.wireBytes,normalizedBytesReceived:Number(old.normalizedBytesReceived||0)+stats.normalizedBytes,normalizedCompressedBytesReceived:Number(old.normalizedCompressedBytesReceived||0)+stats.normalizedCompressedBytes,lastBatch:{...stats,at:new Date().toISOString()}};return series;
}
function weeklyMarketOpen(now,assetClass){
  if(assetClass==='crypto')return true;
  const d=new Date(now),day=d.getUTCDay(),hour=d.getUTCHours();
  if(assetClass==='fx'||assetClass==='fx-index'){if(day===6)return false;if(day===0)return hour>=21;if(day===5)return hour<22;return true;}
  return day!==0&&day!==6;
}
function sizeProjection(row){
  const bars=Number(row.bars||0),raw=Number(row.rawBytes||0),compressed=Number(row.compressedBytes||0),rawPerBar=bars?raw/bars:null,compressedPerBar=bars?compressed/bars:null,wirePerBar=Number(row.receivedBars||0)?Number(row.wireBytesReceived||0)/Number(row.receivedBars):null;
  return {exactStoredRawBytes:raw,exactStoredCompressedBytes:compressed,rawBytesPerBar:rawPerBar==null?null:round(rawPerBar,3),compressedBytesPerBar:compressedPerBar==null?null:round(compressedPerBar,3),wireBytesPerReceivedBar:wirePerBar==null?null:round(wirePerBar,3),projectedRawBytesAt20000:rawPerBar==null?null:Math.round(rawPerBar*INITIAL_BARS_PER_ASSET),projectedCompressedBytesAt20000:compressedPerBar==null?null:Math.round(compressedPerBar*INITIAL_BARS_PER_ASSET),projectedWireBytesFor160Bars:wirePerBar==null?null:Math.round(wirePerBar*INCREMENTAL_BARS_PER_SYNC)};
}
function enrichSeriesStatus(row,now=Date.now()){
  const r={...row},asset=ASSET_BY_ID.get(r.symbol)||{assetClass:'market'},latest=Number(r.newestMs||0),freshnessMs=latest?Math.max(0,now-latest):null,marketOpen=weeklyMarketOpen(now,asset.assetClass),lastBatch=r.lastBatch||{},alerts=[];
  if(!r.bars)alerts.push('No retained M1 bars');
  if(marketOpen&&freshnessMs!=null&&freshnessMs>STALE_AFTER_MS)alerts.push(`Feed latency ${Math.round(freshnessMs/60_000)} minutes`);
  if(Number(lastBatch.rejectedBars||0)>0)alerts.push(`${lastBatch.rejectedBars} malformed OHLC bars rejected in latest batch`);
  if(Number(lastBatch.outOfOrderBars||0)>0)alerts.push(`${lastBatch.outOfOrderBars} out-of-order bars in latest batch`);
  if(Number(lastBatch.missingCandleEstimate||0)>0)alerts.push(`≈${lastBatch.missingCandleEstimate} missing M1 candles detected in latest continuous-session batch`);
  if(Number(r.brokerSymbolChanges||0)>0&&r.lastBrokerSymbolChangeAt)alerts.push(`Broker symbol changed ${r.brokerSymbolChanges} time(s)`);
  let integrityScore=100;integrityScore-=Math.min(35,Number(lastBatch.missingCandleEstimate||0)*3);integrityScore-=Math.min(25,Number(lastBatch.rejectedBars||0)*8);integrityScore-=Math.min(15,Number(lastBatch.outOfOrderBars||0)*5);integrityScore-=Math.min(10,Number(lastBatch.duplicateTimestamps||0)*2);if(marketOpen&&freshnessMs!=null&&freshnessMs>STALE_AFTER_MS)integrityScore-=freshnessMs>DEGRADED_AFTER_MS?35:15;integrityScore=Math.max(0,integrityScore);
  let health='EXCELLENT';if(!r.bars)health='WAITING';else if(marketOpen&&freshnessMs!=null&&freshnessMs>DEGRADED_AFTER_MS)health='STALE';else if(integrityScore<70)health='DEGRADED';else if(integrityScore<90||alerts.length)health='GOOD';else if(!marketOpen)health='MARKET_CLOSED';
  return {...r,freshnessMs,freshnessMinutes:freshnessMs==null?null:round(freshnessMs/60_000,2),marketOpen,storagePercentOfCache:pct(r.compressedBytes,CACHE_ENVELOPE_BYTES),compressionRatio:r.rawBytes?round(Number(r.compressedBytes||0)/Number(r.rawBytes),4):null,retainedDays:r.oldestMs&&r.newestMs?round((r.newestMs-r.oldestMs)/86400_000,2):0,integrityScore,health,alerts,size:sizeProjection(r),bootstrapProgressPercent:Math.min(100,round(Number(r.bars||0)/INITIAL_BARS_PER_ASSET*100,2)),bootstrapTargetBars:INITIAL_BARS_PER_ASSET};
}
function databaseHealth(series){const rows=Object.values(series||{}),rank={WAITING:5,STALE:4,DEGRADED:3,GOOD:2,MARKET_CLOSED:1,EXCELLENT:0};let worst='EXCELLENT';for(const row of rows)if((rank[row.health]??0)>(rank[worst]??0))worst=row.health;const assetsOnline=rows.filter(r=>r.bars>0).length,assetsHealthy=rows.filter(r=>['EXCELLENT','GOOD','MARKET_CLOSED'].includes(r.health)).length,integrityIssues=rows.reduce((sum,r)=>sum+(r.alerts?.length||0),0);return {state:worst,assetsOnline,assetsHealthy,assetsExpected:ALLOWED_SYMBOLS.size,pairsOnline:assetsOnline,pairsHealthy:assetsHealthy,pairsExpected:ALLOWED_SYMBOLS.size,integrityIssues};}
function globalSizeCalculator(meta,series){
  const rows=Object.values(series||{}),measured=rows.filter(row=>Number(row.bars||0)>0),totalBars=Number(meta.totalBars||0),raw=Number(meta.totalRawBytes||0),compressed=Number(meta.totalCompressedBytes||0),avgRaw=totalBars?raw/totalBars:null,avgCompressed=totalBars?compressed/totalBars:null,totalTargetBars=INITIAL_BARS_PER_ASSET*ALLOWED_SYMBOLS.size;
  const projectedRaw=avgRaw==null?null:Math.round(avgRaw*totalTargetBars),projectedCompressed=avgCompressed==null?null:Math.round(avgCompressed*totalTargetBars);
  return {measurement:'actual JSON byte counts + actual gzip byte counts',initialBarsPerAsset:INITIAL_BARS_PER_ASSET,incrementalBarsPerSync:INCREMENTAL_BARS_PER_SYNC,syncSeconds:SYNC_SECONDS,assetsExpected:ALLOWED_SYMBOLS.size,assetsMeasured:measured.length,totalInitialTargetBars:totalTargetBars,exactStoredRawBytes:raw,exactStoredCompressedBytes:compressed,averageRawBytesPerBar:avgRaw==null?null:round(avgRaw,3),averageCompressedBytesPerBar:avgCompressed==null?null:round(avgCompressed,3),projectedInitialRawBytesAllAssets:projectedRaw,projectedInitialCompressedBytesAllAssets:projectedCompressed,projectedInitialCompressedPercentOf200MB:projectedCompressed==null?null:pct(projectedCompressed,CACHE_ENVELOPE_BYTES),projectedHeadroomAfterInitial:projectedCompressed==null?null:CACHE_ENVELOPE_BYTES-projectedCompressed,compressionSavingBytes:Math.max(0,raw-compressed),compressionSavingPercent:raw?round((1-compressed/raw)*100,2):0};
}

export function createMT5PriceCache({db}){
  const chunks=db.collection(CHUNKS),metaRef=db.collection(META).doc(GLOBAL_ID);
  async function ingest(payload){
    const problem=validatePayload(payload);if(problem)throw Object.assign(new Error(problem),{statusCode:422});
    const symbol=String(payload.symbol).toUpperCase(),brokerSymbol=String(payload.broker_symbol||symbol),receivedBars=payload.bars.length,normalized=payload.bars.map(normalizeBar).filter(Boolean),rejectedBars=receivedBars-normalized.length;
    if(!normalized.length)throw Object.assign(new Error('No valid bars in payload'),{statusCode:422});
    const diagnosis=diagnoseBars(normalized),incomingEncoded=encodeBars(diagnosis.uniqueBars),groups=new Map();
    for(const bar of diagnosis.uniqueBars){const day=dayKey(bar[0]);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(bar);}
    if(groups.size>MAX_DAYS_PER_REQUEST)throw Object.assign(new Error(`Payload spans more than ${MAX_DAYS_PER_REQUEST} UTC days`),{statusCode:422});
    let meta=await getMeta(db),accepted=0,deduplicated=0,evictedChunks=0,evictedBars=0;const protectedIds=new Set([...groups.keys()].map(day=>chunkId(symbol,day)));
    for(const [day,incoming] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      const id=chunkId(symbol,day),ref=chunks.doc(id),snap=await ref.get(),existing=snap.exists?decodeBlob(snap.data()?.payload):[],merged=mergeBars(existing,incoming),oldCount=existing.length,newCount=merged.length;
      accepted+=Math.max(0,newCount-oldCount);deduplicated+=Math.max(0,incoming.length-(newCount-oldCount));
      const encoded=encodeBars(merged),oldCompressed=Number(snap.data()?.compressedBytes||0),oldRaw=Number(snap.data()?.rawBytes||0),compressedDelta=encoded.compressed.length-oldCompressed,rawDelta=encoded.raw.length-oldRaw;
      if(compressedDelta>0){const evicted=await evictOldest(db,meta,compressedDelta,protectedIds);meta=evicted.meta;evictedChunks+=evicted.evictedChunks;evictedBars+=evicted.evictedBars;}
      if(Number(meta.totalCompressedBytes||0)+compressedDelta>PAYLOAD_HARD_BYTES)throw Object.assign(new Error('Price cache safety governor could not free enough space; write rejected before the 200 MB envelope could be exceeded'),{statusCode:507});
      const now=new Date().toISOString(),startMs=merged[0][0],endMs=merged.at(-1)[0],latestBar=merged.at(-1);
      await ref.set({schema:SCHEMA,symbol,brokerSymbol,timeframe:BASE_TIMEFRAME,day,startMs,endMs,count:newCount,compressedBytes:encoded.compressed.length,rawBytes:encoded.raw.length,compressionRatio:encoded.raw.length?round(encoded.compressed.length/encoded.raw.length,4):1,latestClose:latestBar[4],latestTickVolume:latestBar[5],latestSpread:latestBar[6],payload:encoded.compressed,updatedAt:now,createdAt:snap.data()?.createdAt??now},{merge:false});
      const chunkDelta=snap.exists?0:1,barDelta=newCount-oldCount;
      meta={...meta,totalCompressedBytes:Number(meta.totalCompressedBytes||0)+compressedDelta,totalRawBytes:Number(meta.totalRawBytes||0)+rawDelta,totalBars:Number(meta.totalBars||0)+barDelta,totalChunks:Number(meta.totalChunks||0)+chunkDelta,series:updateSeriesStorage(meta,symbol,{barDelta,chunkDelta,compressedDelta,rawDelta,startMs,endMs,brokerSymbol,latestBar}),lastIngestAt:now,updatedAt:now};
    }
    const wireBytes=Math.max(0,Number(payload.__transportBytes||payload.client_payload_bytes||0));
    const batchStats={receivedBars,acceptedBars:accepted,deduplicatedBars:deduplicated+diagnosis.duplicateTimestamps,rejectedBars,duplicateTimestamps:diagnosis.duplicateTimestamps,outOfOrderBars:diagnosis.outOfOrder,gapEvents:diagnosis.gapEvents,missingCandleEstimate:diagnosis.missingMinutes,maxGapMinutes:diagnosis.maxGapMinutes,wireBytes,normalizedBytes:incomingEncoded.raw.length,normalizedCompressedBytes:incomingEncoded.compressed.length,mode:String(payload.cache_mode||'incremental'),bootstrapTargetBars:Number(payload.bootstrap_target_bars||INITIAL_BARS_PER_ASSET),bootstrapComplete:Boolean(payload.bootstrap_complete)};
    meta.metaVersion=META_VERSION;meta.schema=SCHEMA;meta.series=updateBatchStats(meta,symbol,batchStats);meta.utilizationPercent=pct(meta.totalCompressedBytes,CACHE_ENVELOPE_BYTES);meta.payloadUtilizationPercent=pct(meta.totalCompressedBytes,PAYLOAD_HARD_BYTES);meta.freeEnvelopeBytes=Math.max(0,CACHE_ENVELOPE_BYTES-Number(meta.totalCompressedBytes||0));meta.freeToHardBytes=Math.max(0,PAYLOAD_HARD_BYTES-Number(meta.totalCompressedBytes||0));meta.policy={source:'MetaTrader5',canonicalDataset:'M1 only',reconstruction:'M5/M15/M30/H1/H4/D1 derived from retained M1 at query/SMC time',initialBarsPerAsset:INITIAL_BARS_PER_ASSET,incrementalBarsPerSync:INCREMENTAL_BARS_PER_SYNC,syncSeconds:SYNC_SECONDS,allowedSymbols:[...ALLOWED_SYMBOLS],dedupe:'bar open time',compression:'gzip level 9',eviction:'global FIFO oldest UTC-day chunk first',absoluteEnvelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,evictionTargetBytes:EVICT_TARGET_BYTES,integrity:'ingest-time OHLC validation + gap/order/duplicate/staleness diagnostics'};
    await metaRef.set(meta,{merge:false});
    const seriesStatus=enrichSeriesStatus(meta.series[seriesKey(symbol)]||emptySeries(symbol));
    return {ok:true,schema:SCHEMA,symbol,brokerSymbol,timeframe:BASE_TIMEFRAME,receivedBars,acceptedBars:accepted,deduplicatedBars:batchStats.deduplicatedBars,rejectedBars,gapEvents:batchStats.gapEvents,missingCandleEstimate:batchStats.missingCandleEstimate,evictedChunks,evictedBars,size:{wireBytes,normalizedBytes:incomingEncoded.raw.length,normalizedCompressedBytes:incomingEncoded.compressed.length,storedRawBytes:seriesStatus.rawBytes,storedCompressedBytes:seriesStatus.compressedBytes,rawBytesPerBar:seriesStatus.size.rawBytesPerBar,compressedBytesPerBar:seriesStatus.size.compressedBytesPerBar,projectedCompressedBytesAt20000:seriesStatus.size.projectedCompressedBytesAt20000},bootstrap:{targetBars:INITIAL_BARS_PER_ASSET,retainedBars:seriesStatus.bars,progressPercent:seriesStatus.bootstrapProgressPercent,complete:seriesStatus.bars>=INITIAL_BARS_PER_ASSET||Boolean(payload.bootstrap_complete)},cache:{totalCompressedBytes:meta.totalCompressedBytes,totalRawBytes:meta.totalRawBytes,totalBars:meta.totalBars,totalChunks:meta.totalChunks,envelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,utilizationPercent:meta.utilizationPercent},receivedAt:new Date().toISOString()};
  }
  async function status(){
    const meta=await getMeta(db),now=Date.now(),series={};for(const symbol of ALLOWED_SYMBOLS){const key=seriesKey(symbol),row=meta.series?.[key]||emptySeries(symbol);series[key]=enrichSeriesStatus(row,now);}const health=databaseHealth(series),totalCompressedBytes=Number(meta.totalCompressedBytes||0);return {...meta,series,databaseHealth:health,sizeCalculator:globalSizeCalculator(meta,series),cacheEnvelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,evictTargetBytes:EVICT_TARGET_BYTES,allowedSymbols:[...ALLOWED_SYMBOLS],websiteAssets:WEBSITE_ASSETS,baseTimeframe:BASE_TIMEFRAME,derivedTimeframes:Object.keys(TIMEFRAMES),initialBarsPerAsset:INITIAL_BARS_PER_ASSET,incrementalBarsPerSync:INCREMENTAL_BARS_PER_SYNC,syncSeconds:SYNC_SECONDS,utilizationPercent:pct(totalCompressedBytes,CACHE_ENVELOPE_BYTES),payloadUtilizationPercent:pct(totalCompressedBytes,PAYLOAD_HARD_BYTES),freeEnvelopeBytes:Math.max(0,CACHE_ENVELOPE_BYTES-totalCompressedBytes),freeToHardBytes:Math.max(0,PAYLOAD_HARD_BYTES-totalCompressedBytes),management:{governorState:totalCompressedBytes>=PAYLOAD_HARD_BYTES?'BLOCKING':totalCompressedBytes>=EVICT_TARGET_BYTES?'EVICTION_ZONE':totalCompressedBytes>=PAYLOAD_HARD_BYTES*.8?'WATCH':'ARMED',evictionArmed:true,compressionActive:true,deduplicationActive:true,integrityMonitoring:true,canonicalM1Only:true,reconstructionOnDemand:true,nextAction:totalCompressedBytes>=EVICT_TARGET_BYTES?'Oldest UTC-day M1 chunks will be retired before protected payload ceiling is threatened':'Continue 300-second rolling M1 ingestion'}};
  }
  async function query({symbol,timeframe='M1',limit=1000}){
    symbol=String(symbol||'').toUpperCase();timeframe=String(timeframe||'M1').toUpperCase();limit=Math.min(20_000,Math.max(1,Number(limit)||1000));
    if(!ALLOWED_SYMBOLS.has(symbol))throw Object.assign(new Error(`Unknown MT5 cache symbol ${symbol}`),{statusCode:400});if(!TIMEFRAMES[timeframe])throw Object.assign(new Error(`Unsupported derived timeframe ${timeframe}`),{statusCode:400});
    const meta=await getMeta(db),series=meta.series?.[seriesKey(symbol)];if(!series?.newestMs)return {schema:SCHEMA,source:SOURCE,symbol,timeframe,baseTimeframe:BASE_TIMEFRAME,bars:[],count:0,cache:await status()};
    const rawBarsNeeded=Math.max(limit,limit*TIMEFRAMES[timeframe]+TIMEFRAMES[timeframe]*2),days=Math.min(730,Math.max(3,Math.ceil(rawBarsNeeded/1440*1.7)+7)),ids=dateRangeIds(symbol,series.newestMs,days),rows=[];
    for(let i=0;i<ids.length;i+=100){const refs=ids.slice(i,i+100).map(id=>chunks.doc(id)),snaps=await db.getAll(...refs);for(const snap of snaps)if(snap.exists)rows.push(...decodeBlob(snap.data()?.payload));}
    const dedup=[...new Map(rows.map(row=>[Number(row[0]),row])).values()].sort((a,b)=>a[0]-b[0]),aggregated=aggregateBars(dedup,timeframe).slice(-limit);
    return {schema:SCHEMA,source:SOURCE,symbol,brokerSymbol:series.brokerSymbol||symbol,timeframe,baseTimeframe:BASE_TIMEFRAME,derived:timeframe!==BASE_TIMEFRAME,reconstructionSource:'canonical retained M1',count:aggregated.length,bars:aggregated,oldestMs:aggregated[0]?.[0]??null,newestMs:aggregated.at(-1)?.[0]??null,generatedAt:new Date().toISOString(),cache:{totalCompressedBytes:Number(meta.totalCompressedBytes||0),cacheEnvelopeBytes:CACHE_ENVELOPE_BYTES,utilizationPercent:pct(meta.totalCompressedBytes,CACHE_ENVELOPE_BYTES)}};
  }
  return {ingest,status,query,constants:{SCHEMA,BASE_TIMEFRAME,CACHE_ENVELOPE_BYTES,PAYLOAD_HARD_BYTES,EVICT_TARGET_BYTES,INITIAL_BARS_PER_ASSET,INCREMENTAL_BARS_PER_SYNC,SYNC_SECONDS,MAX_BARS_PER_REQUEST,ALLOWED_SYMBOLS:[...ALLOWED_SYMBOLS],WEBSITE_ASSETS,TIMEFRAMES:Object.keys(TIMEFRAMES)}};
}
