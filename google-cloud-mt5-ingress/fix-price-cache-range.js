import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('./price-cache.js', import.meta.url);
let source = await readFile(file, 'utf8');

const oldFinite = "const finite=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};";
const newFinite = "const finite=value=>{if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};";

if (source.includes(oldFinite)) {
  source = source.replace(oldFinite, newFinite);
} else if (!source.includes(newFinite)) {
  throw new Error('Could not locate MT5 finite-number parser for range fix');
}

const oldRange = "if(fromMs!=null||toMs!=null){fromMs=Math.max(retentionCutoff,fromMs??retentionCutoff);toMs=Math.min(Date.now(),toMs??Date.now());if(toMs<fromMs)throw Object.assign(new Error('MT5 price query to must be greater than or equal to from'),{statusCode:400});}";
const newRange = "if(fromMs!=null||toMs!=null){const nowMs=Date.now();fromMs=Math.max(retentionCutoff,fromMs??retentionCutoff);toMs=Math.min(nowMs,toMs??nowMs);if(toMs<fromMs){if(fromMs>nowMs)fromMs=nowMs;else fromMs=toMs;}}";

if (source.includes(oldRange)) {
  source = source.replace(oldRange, newRange);
} else if (!source.includes(newRange)) {
  throw new Error('Could not locate MT5 date-range normalization block');
}

const oldTimeframes = "const TIMEFRAMES={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};";
const newTimeframes = "const TIMEFRAMES={M1:1,M2:2,M3:3,M4:4,M5:5,M6:6,M10:10,M12:12,M15:15,M20:20,M30:30,H1:60,H2:120,H3:180,H4:240,H6:360,H8:480,H12:720,D1:1440,W1:10080,MN1:44640};";

if (source.includes(oldTimeframes)) {
  source = source.replace(oldTimeframes, newTimeframes);
} else if (!source.includes(newTimeframes)) {
  throw new Error('Could not locate MT5 timeframe registry');
}

const fullTimeframeAggregate = `function timeframeBucketStart(ms,timeframe){
  const value=Number(ms);
  if(timeframe==='MN1'){
    const d=new Date(value);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
  }
  if(timeframe==='W1'){
    const d=new Date(value);
    d.setUTCHours(0,0,0,0);
    d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
    return d.getTime();
  }
  const minutes=TIMEFRAMES[timeframe]||1;
  const bucketMs=minutes*60_000;
  return Math.floor(value/bucketMs)*bucketMs;
}

function aggregateBars(rows,timeframe){
  if(timeframe==='M1')return rows;
  const map=new Map();
  for(const row of rows){
    const t=timeframeBucketStart(row[0],timeframe);let x=map.get(t);
    if(!x){x=[t,row[1],row[2],row[3],row[4],Number(row[5]||0),Number(row[6]||0),Number(row[7]||0)];map.set(t,x);continue;}
    x[2]=Math.max(x[2],row[2]);x[3]=Math.min(x[3],row[3]);x[4]=row[4];x[5]+=Number(row[5]||0);x[6]=Number(row[6]||x[6]);x[7]+=Number(row[7]||0);
  }
  return [...map.values()].sort((a,b)=>a[0]-b[0]);
}`;

if (!source.includes('function timeframeBucketStart(ms,timeframe)')) {
  const aggregatePattern = /function aggregateBars\(rows,timeframe\)\{[\s\S]*?\n\}\n\nfunction emptySeries/;
  if (!aggregatePattern.test(source)) throw new Error('Could not locate MT5 aggregateBars implementation');
  source = source.replace(aggregatePattern, `${fullTimeframeAggregate}\n\nfunction emptySeries`);
}

const oldPolicy = "reconstruction:'M5/M15/M30/H1/H4/D1 derived from retained M1 at query/SMC time'";
const newPolicy = "reconstruction:'all 21 official MT5 chart periods reconstructed from retained canonical M1 at query/SMC time; W1 Monday-aligned UTC; MN1 calendar-month UTC'";
if (source.includes(oldPolicy)) source = source.replace(oldPolicy, newPolicy);
else if (!source.includes(newPolicy)) throw new Error('Could not locate MT5 reconstruction policy');

await writeFile(file, source, 'utf8');
console.log('MT5 price-cache normalized: safe range semantics + all 21 official timeframes from canonical M1 (M1..MN1)');