import { gzipSync, gunzipSync } from 'node:zlib';

const SCHEMA='fxga.mt5.price-cache.v1';
const SOURCE='MetaTrader5';
const BASE_TIMEFRAME='M1';
const ALLOWED_SYMBOLS=new Set(['EURUSD','GBPUSD','USDJPY','USDZAR']);
const CACHE_ENVELOPE_BYTES=200_000_000;
const PAYLOAD_HARD_BYTES=190_000_000;
const EVICT_TARGET_BYTES=175_000_000;
const MAX_BARS_PER_REQUEST=2_000;
const MAX_DAYS_PER_REQUEST=5;
const CHUNKS='fxga_mt5_price_cache_chunks';
const META='fxga_mt5_price_cache';
const GLOBAL_ID='global';
const TIMEFRAMES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};

const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const dayKey=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-','');
const chunkId=(symbol,day)=>`${symbol}_${BASE_TIMEFRAME}_${day}`;
const seriesKey=symbol=>`${symbol}_${BASE_TIMEFRAME}`;

function normalizeBar(row){
  const x=Array.isArray(row)?row:[row?.time_ms,row?.open,row?.high,row?.low,row?.close,row?.tick_volume,row?.spread,row?.real_volume];
  const timeMs=finite(x[0]),open=finite(x[1]),high=finite(x[2]),low=finite(x[3]),close=finite(x[4]),tickVolume=Math.max(0,Math.round(finite(x[5])??0)),spread=Math.max(0,Math.round(finite(x[6])??0)),realVolume=Math.max(0,Math.round(finite(x[7])??0));
  if(!timeMs||timeMs<946684800000||!open||!high||!low||!close)return null;
  if(high<Math.max(open,close)||low>Math.min(open,close)||high<low)return null;
  return [Math.round(timeMs),open,high,low,close,tickVolume,spread,realVolume];
}
function validatePayload(payload){
  if(!payload||typeof payload!=='object')return 'Payload must be a JSON object';
  if(payload.schema!==SCHEMA)return `schema must be ${SCHEMA}`;
  if(String(payload.source||'')!==SOURCE)return `source must be ${SOURCE}`;
  const symbol=String(payload.symbol||'').toUpperCase();
  if(!ALLOWED_SYMBOLS.has(symbol))return `symbol must be one of ${[...ALLOWED_SYMBOLS].join(', ')}`;
  if(String(payload.timeframe||'').toUpperCase()!==BASE_TIMEFRAME)return 'Only M1 source bars are accepted; higher timeframes are derived server-side';
  if(!Array.isArray(payload.bars)||!payload.bars.length)return 'bars must be a non-empty array';
  if(payload.bars.length>MAX_BARS_PER_REQUEST)return `bars cannot exceed ${MAX_BARS_PER_REQUEST} per request`;
  return null;
}
function decodeBlob(data){if(!data)return [];try{return JSON.parse(gunzipSync(Buffer.from(data)).toString('utf8'));}catch{return [];}}
function encodeBars(bars){const raw=Buffer.from(JSON.stringify(bars));const compressed=gzipSync(raw,{level:9});return {raw,compressed};}
function mergeBars(existing,incoming){const map=new Map();for(const row of existing)if(Array.isArray(row)&&row[0])map.set(Number(row[0]),row);for(const row of incoming)map.set(Number(row[0]),row);return [...map.values()].sort((a,b)=>a[0]-b[0]);}
function subtractUtcDays(ms,days){return ms-days*86400_000;}
function dateRangeIds(symbol,newestMs,days){const ids=[];let cursor=Number(newestMs||Date.now());for(let i=0;i<days;i++){ids.push(chunkId(symbol,dayKey(cursor)));cursor=subtractUtcDays(cursor,1);}return ids;}
function aggregateBars(rows,timeframe){
  const minutes=TIMEFRAMES[timeframe]||1;if(minutes===1)return rows;
  const bucketMs=minutes*60_000,map=new Map();
  for(const row of rows){const t=Math.floor(Number(row[0])/bucketMs)*bucketMs;let x=map.get(t);if(!x){x=[t,row[1],row[2],row[3],row[4],Number(row[5]||0),Number(row[6]||0),Number(row[7]||0)];map.set(t,x);continue;}x[2]=Math.max(x[2],row[2]);x[3]=Math.min(x[3],row[3]);x[4]=row[4];x[5]+=Number(row[5]||0);x[6]=Number(row[6]||x[6]);x[7]+=Number(row[7]||0);}
  return [...map.values()].sort((a,b)=>a[0]-b[0]);
}
async function rebuildMeta(db){
  const snap=await db.collection(CHUNKS).get();let totalCompressedBytes=0,totalRawBytes=0,totalBars=0;const series={};
  for(const doc of snap.docs){const d=doc.data();totalCompressedBytes+=Number(d.compressedBytes||0);totalRawBytes+=Number(d.rawBytes||0);totalBars+=Number(d.count||0);const key=seriesKey(String(d.symbol||''));const row=series[key]||{symbol:d.symbol,timeframe:BASE_TIMEFRAME,bars:0,chunks:0,oldestMs:null,newestMs:null,lastIngestAt:null,brokerSymbol:null};row.bars+=Number(d.count||0);row.chunks+=1;row.oldestMs=row.oldestMs==null?d.startMs:Math.min(row.oldestMs,Number(d.startMs||row.oldestMs));row.newestMs=row.newestMs==null?d.endMs:Math.max(row.newestMs,Number(d.endMs||row.newestMs));series[key]=row;}
  const value={schema:SCHEMA,cacheEnvelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,evictTargetBytes:EVICT_TARGET_BYTES,totalCompressedBytes,totalRawBytes,totalBars,totalChunks:snap.size,evictedChunks:0,evictedBars:0,series,reconciledAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await db.collection(META).doc(GLOBAL_ID).set(value,{merge:true});return value;
}
async function getMeta(db){const ref=db.collection(META).doc(GLOBAL_ID),snap=await ref.get();return snap.exists?snap.data():rebuildMeta(db);}
async function evictOldest(db,meta,requiredBytes,protectedIds=new Set()){
  let current=Number(meta.totalCompressedBytes||0),evictedBytes=0,evictedRawBytes=0,evictedBars=0,evictedChunks=0;
  if(current+requiredBytes<=PAYLOAD_HARD_BYTES)return {meta,evictedBytes,evictedBars,evictedChunks};
  const target=Math.min(EVICT_TARGET_BYTES,Math.max(0,PAYLOAD_HARD_BYTES-requiredBytes));let guard=0;
  while(current>target&&guard++<20){const snap=await db.collection(CHUNKS).orderBy('endMs','asc').limit(40).get();if(snap.empty)break;const batch=db.batch();let removed=0;for(const doc of snap.docs){if(protectedIds.has(doc.id))continue;const d=doc.data();batch.delete(doc.ref);current-=Number(d.compressedBytes||0);evictedBytes+=Number(d.compressedBytes||0);evictedRawBytes+=Number(d.rawBytes||0);evictedBars+=Number(d.count||0);evictedChunks++;removed++;if(current<=target)break;}if(!removed)break;await batch.commit();}
  meta={...meta,totalCompressedBytes:Math.max(0,Number(meta.totalCompressedBytes||0)-evictedBytes),totalRawBytes:Math.max(0,Number(meta.totalRawBytes||0)-evictedRawBytes),totalBars:Math.max(0,Number(meta.totalBars||0)-evictedBars),totalChunks:Math.max(0,Number(meta.totalChunks||0)-evictedChunks),evictedBytes:Number(meta.evictedBytes||0)+evictedBytes,evictedBars:Number(meta.evictedBars||0)+evictedBars,evictedChunks:Number(meta.evictedChunks||0)+evictedChunks,lastEvictionAt:evictedChunks?new Date().toISOString():meta.lastEvictionAt??null};return {meta,evictedBytes,evictedBars,evictedChunks};
}
function recomputeSeriesAfterWrite(meta,symbol,barDelta,chunkDelta,startMs,endMs,brokerSymbol){const key=seriesKey(symbol),series={...(meta.series||{})},old=series[key]||{symbol,timeframe:BASE_TIMEFRAME,bars:0,chunks:0,oldestMs:null,newestMs:null,lastIngestAt:null,brokerSymbol:null};series[key]={...old,symbol,timeframe:BASE_TIMEFRAME,bars:Math.max(0,Number(old.bars||0)+barDelta),chunks:Math.max(0,Number(old.chunks||0)+chunkDelta),oldestMs:old.oldestMs==null?startMs:Math.min(Number(old.oldestMs),startMs),newestMs:old.newestMs==null?endMs:Math.max(Number(old.newestMs),endMs),lastIngestAt:new Date().toISOString(),brokerSymbol:brokerSymbol||old.brokerSymbol||symbol};return series;}

export function createMT5PriceCache({db}){
  const chunks=db.collection(CHUNKS),metaRef=db.collection(META).doc(GLOBAL_ID);
  async function ingest(payload){
    const problem=validatePayload(payload);if(problem)throw Object.assign(new Error(problem),{statusCode:422});
    const symbol=String(payload.symbol).toUpperCase(),brokerSymbol=String(payload.broker_symbol||symbol),normalized=payload.bars.map(normalizeBar).filter(Boolean);if(!normalized.length)throw Object.assign(new Error('No valid bars in payload'),{statusCode:422});
    const groups=new Map();for(const bar of normalized){const day=dayKey(bar[0]);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(bar);}if(groups.size>MAX_DAYS_PER_REQUEST)throw Object.assign(new Error(`Payload spans more than ${MAX_DAYS_PER_REQUEST} UTC days`),{statusCode:422});
    let meta=await getMeta(db),accepted=0,deduplicated=0,evictedChunks=0,evictedBars=0;const protectedIds=new Set([...groups.keys()].map(day=>chunkId(symbol,day)));
    for(const [day,incoming] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      const id=chunkId(symbol,day),ref=chunks.doc(id),snap=await ref.get(),existing=snap.exists?decodeBlob(snap.data()?.payload):[],merged=mergeBars(existing,incoming),oldCount=existing.length,newCount=merged.length;accepted+=Math.max(0,newCount-oldCount);deduplicated+=Math.max(0,incoming.length-(newCount-oldCount));
      const encoded=encodeBars(merged),oldCompressed=Number(snap.data()?.compressedBytes||0),oldRaw=Number(snap.data()?.rawBytes||0),compressedDelta=encoded.compressed.length-oldCompressed,rawDelta=encoded.raw.length-oldRaw;
      if(compressedDelta>0){const evicted=await evictOldest(db,meta,compressedDelta,protectedIds);meta=evicted.meta;evictedChunks+=evicted.evictedChunks;evictedBars+=evicted.evictedBars;}
      if(Number(meta.totalCompressedBytes||0)+compressedDelta>PAYLOAD_HARD_BYTES)throw Object.assign(new Error('Price cache safety governor could not free enough space; write rejected before the 200 MB envelope could be exceeded'),{statusCode:507});
      const now=new Date().toISOString(),startMs=merged[0][0],endMs=merged.at(-1)[0];await ref.set({schema:SCHEMA,symbol,brokerSymbol,timeframe:BASE_TIMEFRAME,day,startMs,endMs,count:newCount,compressedBytes:encoded.compressed.length,rawBytes:encoded.raw.length,compressionRatio:encoded.raw.length?Number((encoded.compressed.length/encoded.raw.length).toFixed(4)):1,payload:encoded.compressed,updatedAt:now,createdAt:snap.data()?.createdAt??now},{merge:false});
      const chunkDelta=snap.exists?0:1,barDelta=newCount-oldCount;meta={...meta,totalCompressedBytes:Number(meta.totalCompressedBytes||0)+compressedDelta,totalRawBytes:Number(meta.totalRawBytes||0)+rawDelta,totalBars:Number(meta.totalBars||0)+barDelta,totalChunks:Number(meta.totalChunks||0)+chunkDelta,series:recomputeSeriesAfterWrite(meta,symbol,barDelta,chunkDelta,startMs,endMs,brokerSymbol),lastIngestAt:now,updatedAt:now};
    }
    meta.utilizationPercent=Number((Number(meta.totalCompressedBytes||0)/CACHE_ENVELOPE_BYTES*100).toFixed(3));meta.payloadUtilizationPercent=Number((Number(meta.totalCompressedBytes||0)/PAYLOAD_HARD_BYTES*100).toFixed(3));meta.freeEnvelopeBytes=Math.max(0,CACHE_ENVELOPE_BYTES-Number(meta.totalCompressedBytes||0));meta.policy={source:'MetaTrader5',baseTimeframe:BASE_TIMEFRAME,allowedSymbols:[...ALLOWED_SYMBOLS],dedupe:'bar open time',compression:'gzip level 9',eviction:'global FIFO oldest completed UTC-day chunk first',absoluteEnvelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,evictionTargetBytes:EVICT_TARGET_BYTES};await metaRef.set(meta,{merge:false});
    return {ok:true,schema:SCHEMA,symbol,brokerSymbol,timeframe:BASE_TIMEFRAME,receivedBars:normalized.length,acceptedBars:accepted,deduplicatedBars:deduplicated,evictedChunks,evictedBars,cache:{totalCompressedBytes:meta.totalCompressedBytes,totalRawBytes:meta.totalRawBytes,totalBars:meta.totalBars,totalChunks:meta.totalChunks,envelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,utilizationPercent:meta.utilizationPercent},receivedAt:new Date().toISOString()};
  }
  async function status(){const meta=await getMeta(db);return {...meta,cacheEnvelopeBytes:CACHE_ENVELOPE_BYTES,payloadHardBytes:PAYLOAD_HARD_BYTES,evictTargetBytes:EVICT_TARGET_BYTES,allowedSymbols:[...ALLOWED_SYMBOLS],baseTimeframe:BASE_TIMEFRAME,derivedTimeframes:Object.keys(TIMEFRAMES)};}
  async function query({symbol,timeframe='M1',limit=1000}){
    symbol=String(symbol||'').toUpperCase();timeframe=String(timeframe||'M1').toUpperCase();limit=Math.min(5000,Math.max(1,Number(limit)||1000));if(!ALLOWED_SYMBOLS.has(symbol))throw Object.assign(new Error(`Unknown MT5 cache symbol ${symbol}`),{statusCode:400});if(!TIMEFRAMES[timeframe])throw Object.assign(new Error(`Unsupported derived timeframe ${timeframe}`),{statusCode:400});
    const meta=await getMeta(db),series=meta.series?.[seriesKey(symbol)];if(!series?.newestMs)return {schema:SCHEMA,source:SOURCE,symbol,timeframe,baseTimeframe:BASE_TIMEFRAME,bars:[],count:0,cache:await status()};
    const rawBarsNeeded=Math.min(5000*TIMEFRAMES[timeframe],Math.max(limit*TIMEFRAMES[timeframe]+TIMEFRAMES[timeframe]*2,limit)),days=Math.min(365,Math.max(3,Math.ceil(rawBarsNeeded/1440*1.7)+5)),ids=dateRangeIds(symbol,series.newestMs,days),rows=[];
    for(let i=0;i<ids.length;i+=100){const refs=ids.slice(i,i+100).map(id=>chunks.doc(id)),snaps=await db.getAll(...refs);for(const snap of snaps)if(snap.exists)rows.push(...decodeBlob(snap.data()?.payload));}
    const dedup=[...new Map(rows.map(row=>[Number(row[0]),row])).values()].sort((a,b)=>a[0]-b[0]),aggregated=aggregateBars(dedup,timeframe).slice(-limit);return {schema:SCHEMA,source:SOURCE,symbol,brokerSymbol:series.brokerSymbol||symbol,timeframe,baseTimeframe:BASE_TIMEFRAME,derived:timeframe!==BASE_TIMEFRAME,count:aggregated.length,bars:aggregated,oldestMs:aggregated[0]?.[0]??null,newestMs:aggregated.at(-1)?.[0]??null,generatedAt:new Date().toISOString(),cache:{totalCompressedBytes:Number(meta.totalCompressedBytes||0),cacheEnvelopeBytes:CACHE_ENVELOPE_BYTES,utilizationPercent:Number(meta.totalCompressedBytes||0)/CACHE_ENVELOPE_BYTES*100}};
  }
  return {ingest,status,query,constants:{SCHEMA,BASE_TIMEFRAME,CACHE_ENVELOPE_BYTES,PAYLOAD_HARD_BYTES,EVICT_TARGET_BYTES,ALLOWED_SYMBOLS:[...ALLOWED_SYMBOLS],TIMEFRAMES:Object.keys(TIMEFRAMES)}};
}
