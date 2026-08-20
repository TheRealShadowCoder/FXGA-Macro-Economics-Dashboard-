import { gunzipSync } from 'node:zlib';

const PAIRS=['EURUSD','GBPUSD','USDJPY','USDZAR'];
const CHUNKS='fxga_mt5_price_cache_chunks';
const META='fxga_mt5_price_cache';
const GLOBAL='global';
const MINUTE=60_000;
const TIMEFRAMES={M1:1,M5:5,M15:15,H1:60,H4:240,D1:1440};
const CAPS={M1:2000,M5:720,M15:640,H1:480,H4:300,D1:220};
const BOOTSTRAP_DAYS=45;
const INCREMENTAL_OVERLAP_DAYS=2;

const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const dayStart=ms=>{const d=new Date(ms);d.setUTCHours(0,0,0,0);return d.getTime();};
const dayKey=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-','');
const chunkId=(symbol,ms)=>`${symbol}_M1_${dayKey(ms)}`;

function decode(data){
  if(!data)return [];
  try{return JSON.parse(gunzipSync(Buffer.from(data)).toString('utf8'));}catch{return [];}
}
function validRow(row){
  if(!Array.isArray(row)||row.length<5)return false;
  const [t,o,h,l,c]=row.map(finite);
  return Boolean(t&&o&&h&&l&&c&&h>=Math.max(o,c)&&l<=Math.min(o,c)&&h>=l);
}
function dedupe(rows){return [...new Map(rows.filter(validRow).map(row=>[Number(row[0]),row])).values()].sort((a,b)=>Number(a[0])-Number(b[0]));}
function toTechnical(row,timeframe='M1',samples=1){
  const minutes=TIMEFRAMES[timeframe]||1,t=Number(row[0]);
  return {
    start:new Date(t).toISOString(),end:new Date(t+minutes*MINUTE).toISOString(),
    open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),
    samples:Number(samples||1),tickVolume:Number(row[5]||0),spread:Number(row[6]||0),realVolume:Number(row[7]||0),
    providerOhlc:true,synthetic:false,source:timeframe==='M1'?'mt5-cache-m1':`mt5-cache-derived-${timeframe}`,
  };
}
function aggregate(rows,timeframe){
  if(timeframe==='M1')return rows.map(row=>toTechnical(row,'M1',1));
  const minutes=TIMEFRAMES[timeframe],bucketMs=minutes*MINUTE,map=new Map();
  for(const row of rows){
    const bucket=Math.floor(Number(row[0])/bucketMs)*bucketMs;
    let x=map.get(bucket);
    if(!x){x=[bucket,Number(row[1]),Number(row[2]),Number(row[3]),Number(row[4]),Number(row[5]||0),Number(row[6]||0),Number(row[7]||0),1];map.set(bucket,x);continue;}
    x[2]=Math.max(x[2],Number(row[2]));x[3]=Math.min(x[3],Number(row[3]));x[4]=Number(row[4]);x[5]+=Number(row[5]||0);x[6]=Number(row[6]||x[6]);x[7]+=Number(row[7]||0);x[8]+=1;
  }
  return [...map.values()].sort((a,b)=>a[0]-b[0]).map(x=>toTechnical(x,timeframe,x[8]));
}
function mergeProvider(existing,incoming,cap,oldestRetainedMs){
  const retained=(Array.isArray(existing)?existing:[]).filter(bar=>String(bar?.source||'').startsWith('mt5-cache-')&&Date.parse(bar.start)>=Number(oldestRetainedMs||0));
  const map=new Map(retained.map(bar=>[Date.parse(bar.start),bar]));
  for(const bar of incoming)map.set(Date.parse(bar.start),bar);
  return [...map.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(-cap);
}
function idsBetween(symbol,fromMs,toMs,maxDays){
  const ids=[];let cursor=dayStart(fromMs),end=dayStart(toMs),guard=0;
  while(cursor<=end&&guard++<maxDays){ids.push(chunkId(symbol,cursor));cursor+=86_400_000;}
  return ids;
}
async function readChunks(db,symbol,ids){
  if(!ids.length)return [];
  const rows=[];
  for(let i=0;i<ids.length;i+=100){
    const refs=ids.slice(i,i+100).map(id=>db.collection(CHUNKS).doc(id));
    const snaps=await db.getAll(...refs);
    for(const snap of snaps)if(snap.exists)rows.push(...decode(snap.data()?.payload));
  }
  return dedupe(rows);
}

export async function overlayMT5TechnicalHistory(db,states={},generatedAt=new Date().toISOString()){
  const metaSnap=await db.collection(META).doc(GLOBAL).get();
  if(!metaSnap.exists)return {states,diagnostics:{available:false,pairs:0,reason:'mt5-price-cache-meta-not-initialized'}};
  const meta=metaSnap.data()||{},next={...states},diagnostics={available:true,pairs:0,updatedAt:meta.updatedAt??null,series:{}};

  for(const symbol of PAIRS){
    const series=meta.series?.[`${symbol}_M1`];
    if(!series?.newestMs)continue;
    const previous=next[symbol]&&typeof next[symbol]==='object'?next[symbol]:{id:symbol,bars:{}};
    const priorBridge=previous.mt5Bridge||{};
    const newest=Number(series.newestMs),oldest=Number(series.oldestMs||newest);
    const alreadyCurrent=Number(priorBridge.lastImportedMs||0)>=newest&&String(priorBridge.lastIngestAt||'')===String(series.lastIngestAt||'');
    if(alreadyCurrent){diagnostics.pairs++;diagnostics.series[symbol]={skipped:true,newestMs:newest,lastImportedMs:priorBridge.lastImportedMs};continue;}

    const bootstrap=!Number(priorBridge.lastImportedMs||0);
    const from=bootstrap?Math.max(oldest,newest-(BOOTSTRAP_DAYS-1)*86_400_000):Math.max(oldest,Number(priorBridge.lastImportedMs)-INCREMENTAL_OVERLAP_DAYS*86_400_000);
    const ids=idsBetween(symbol,from,newest,bootstrap?BOOTSTRAP_DAYS:INCREMENTAL_OVERLAP_DAYS+3);
    const raw=await readChunks(db,symbol,ids);
    if(!raw.length){diagnostics.series[symbol]={skipped:false,chunksRequested:ids.length,rows:0};continue;}

    const bars={...(previous.bars||{})};
    for(const timeframe of Object.keys(TIMEFRAMES)){
      const provider=aggregate(raw,timeframe);
      bars[timeframe]=mergeProvider(bars[timeframe],provider,CAPS[timeframe],oldest);
    }
    const last=raw.at(-1);
    next[symbol]={
      ...previous,id:symbol,label:previous.label||symbol,symbol,synthetic:false,bars,
      updatedAt:generatedAt,lastPrice:Number(last?.[4]??previous.lastPrice??0)||previous.lastPrice??null,
      priceSource:'MetaTrader5',
      mt5Bridge:{
        source:'MetaTrader5',schema:meta.schema??'fxga.mt5.price-cache.v1',brokerSymbol:series.brokerSymbol||symbol,
        lastImportedMs:newest,lastIngestAt:series.lastIngestAt??null,oldestRetainedMs:oldest,
        integrityScore:series.integrityScore??null,health:series.health??null,alerts:Array.isArray(series.alerts)?series.alerts:[],
        compressedBytes:Number(series.compressedBytes||0),barsRetained:Number(series.bars||0),chunksRetained:Number(series.chunks||0),
        bootstrap,rowsImported:raw.length,chunksRequested:ids.length,derivedTimeframes:Object.keys(TIMEFRAMES),
      },
    };
    diagnostics.pairs++;
    diagnostics.series[symbol]={bootstrap,rowsImported:raw.length,chunksRequested:ids.length,newestMs:newest,oldestRetainedMs:oldest,integrityScore:series.integrityScore??null,health:series.health??null};
  }
  return {states:next,diagnostics};
}

export const MT5_TECHNICAL_BRIDGE={pairs:PAIRS,timeframes:Object.keys(TIMEFRAMES),bootstrapDays:BOOTSTRAP_DAYS,incrementalOverlapDays:INCREMENTAL_OVERLAP_DAYS};
