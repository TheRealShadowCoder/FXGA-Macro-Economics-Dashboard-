import { gunzipSync } from 'node:zlib';
import { Firestore } from '@google-cloud/firestore';

export const MT5_EVENT_ASSETS = Object.freeze([
  'DXY','EURUSD','GBPUSD','USDJPY','USDZAR','US2Y','US10Y','SPX','NASDAQ','DJI','VIX','GOLD','WTI','BRENT','BTCUSD','ETHUSD',
]);

export const MT5_EVENT_HORIZONS = Object.freeze({
  60:'1m',300:'5m',900:'15m',1800:'30m',3600:'1h',7200:'2h',14400:'4h',28800:'8h',86400:'24h',
});

export const MT5_PRE_NEWS_WINDOWS = Object.freeze({
  60:'1m',300:'5m',900:'15m',1800:'30m',3600:'1h',7200:'2h',14400:'4h',28800:'8h',86400:'24h',
});

const DAY_MS=86_400_000;
const CHUNKS='fxga_mt5_price_cache_chunks';
const BASE_TIMEFRAME='M1';
const MAX_BASELINE_LAG_MS=30*60_000;
const db=new Firestore({ignoreUndefinedProperties:true});
const chunks=db.collection(CHUNKS);

const finite=value=>{const number=Number(value);return Number.isFinite(number)?number:null;};
const dayKey=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-','');
const chunkId=(symbol,ms)=>`${symbol}_${BASE_TIMEFRAME}_${dayKey(ms)}`;
const pct=(change,base)=>base?(change/Math.abs(base))*100:null;
const round=(value,digits=6)=>Number.isFinite(Number(value))?Number(Number(value).toFixed(digits)):null;
const sign=value=>Math.abs(Number(value||0))<1e-12?0:Number(value)>0?1:-1;

function payloadBuffer(value){
  if(!value)return null;
  if(Buffer.isBuffer(value))return value;
  if(typeof value.toBuffer==='function')return value.toBuffer();
  if(typeof value.toUint8Array==='function')return Buffer.from(value.toUint8Array());
  if(value instanceof Uint8Array)return Buffer.from(value);
  return null;
}
function decodeBars(value){
  try{const buffer=payloadBuffer(value);if(!buffer)return[];const rows=JSON.parse(gunzipSync(buffer).toString('utf8'));return Array.isArray(rows)?rows.filter(row=>Array.isArray(row)&&finite(row[0])!=null):[];}catch{return[];}
}
function idsForRange(symbol,startMs,endMs){
  const ids=[];let cursor=new Date(startMs);cursor.setUTCHours(0,0,0,0);const end=new Date(endMs);end.setUTCHours(0,0,0,0);
  while(cursor.getTime()<=end.getTime()){ids.push(chunkId(symbol,cursor.getTime()));cursor=new Date(cursor.getTime()+DAY_MS);}return ids;
}

export async function loadMT5Bars(symbol,startMs,endMs,{chunkCache}={}){
  symbol=String(symbol||'').toUpperCase();
  if(!MT5_EVENT_ASSETS.includes(symbol)||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<startMs)return[];
  const ids=idsForRange(symbol,startMs,endMs),rows=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const batchIds=ids.slice(offset,offset+100),missing=batchIds.filter(id=>!chunkCache?.has(id));
    if(missing.length){
      const docs=await db.getAll(...missing.map(id=>chunks.doc(id)));
      for(let index=0;index<docs.length;index++){
        const doc=docs[index],id=missing[index],decoded=doc.exists?decodeBars(doc.data()?.payload):[];
        if(chunkCache)chunkCache.set(id,decoded);
      }
    }
    for(const id of batchIds){
      if(chunkCache?.has(id)){rows.push(...chunkCache.get(id));continue;}
      const doc=await chunks.doc(id).get();if(doc.exists)rows.push(...decodeBars(doc.data()?.payload));
    }
  }
  return [...new Map(rows.filter(row=>Number(row[0])>=startMs&&Number(row[0])<=endMs).map(row=>[Number(row[0]),row])).values()].sort((a,b)=>Number(a[0])-Number(b[0]));
}

function isoWeek(ms){
  const date=new Date(ms);date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));const yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1));return Math.ceil((((date-yearStart)/DAY_MS)+1)/7);
}
function marketSession(hour){
  if(hour<7)return'ASIA';if(hour<12)return'LONDON';if(hour<16)return'LONDON_NEW_YORK_OVERLAP';if(hour<21)return'NEW_YORK';return'AFTER_HOURS';
}
export function buildEventTimeSignature(event){
  const releaseMs=Date.parse(event?.date||event?.releaseAt||'');if(!Number.isFinite(releaseMs))return null;
  const date=new Date(releaseMs),hour=date.getUTCHours(),minute=date.getUTCMinutes(),weekday=date.getUTCDay();
  return {releaseAt:new Date(releaseMs).toISOString(),releaseEpochMs:releaseMs,dateUtc:new Date(releaseMs).toISOString().slice(0,10),year:date.getUTCFullYear(),month:date.getUTCMonth()+1,quarter:Math.floor(date.getUTCMonth()/3)+1,dayOfMonth:date.getUTCDate(),weekdayIndex:weekday,weekday:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][weekday],isoWeek:isoWeek(releaseMs),hourUtc:hour,minuteUtc:minute,minuteOfDayUtc:hour*60+minute,fiveMinuteBucketUtc:hour*60+Math.floor(minute/5)*5,sessionUtc:marketSession(hour),weekend:weekday===0||weekday===6};
}

function mean(values){const rows=values.filter(Number.isFinite);return rows.length?rows.reduce((sum,value)=>sum+value,0)/rows.length:null;}
function std(values){const avg=mean(values);if(avg==null)return null;const rows=values.filter(Number.isFinite);return Math.sqrt(rows.reduce((sum,value)=>sum+(value-avg)**2,0)/Math.max(1,rows.length-1));}
function rangeOf(rows){if(!rows.length)return null;const highs=rows.map(row=>finite(row[2])).filter(v=>v!=null),lows=rows.map(row=>finite(row[3])).filter(v=>v!=null);if(!highs.length||!lows.length)return null;return{high:Math.max(...highs),low:Math.min(...lows)};}
function regression(closes){
  const n=closes.length;if(n<3)return{slope:null,r2:null};const xMean=(n-1)/2,yMean=mean(closes);let numerator=0,denominator=0,ssTot=0,ssRes=0;
  for(let i=0;i<n;i++){numerator+=(i-xMean)*(closes[i]-yMean);denominator+=(i-xMean)**2;}const slope=denominator?numerator/denominator:0,intercept=yMean-slope*xMean;
  for(let i=0;i<n;i++){ssTot+=(closes[i]-yMean)**2;ssRes+=(closes[i]-(intercept+slope*i))**2;}return{slope,r2:ssTot>0?Math.max(0,Math.min(1,1-ssRes/ssTot)):1};
}
function lastDirectionalRun(rows){let direction=0,count=0;for(let i=rows.length-1;i>=0;i--){const d=sign(Number(rows[i][4])-Number(rows[i][1]));if(!d)continue;if(!direction){direction=d;count=1;continue;}if(d!==direction)break;count++;}return{direction:direction>0?'up':direction<0?'down':'flat',count};}
function segmentMove(rows){if(rows.length<2)return null;const first=finite(rows[0][1]),last=finite(rows.at(-1)[4]);return first==null||last==null?pct(0,1):pct(last-first,first);}

function priceActionMetrics(rows,releaseMs,windowSeconds){
  const startMs=releaseMs-windowSeconds*1000,windowRows=rows.filter(row=>Number(row[0])>=startMs&&Number(row[0])<releaseMs);
  if(windowRows.length<2)return{available:false,windowSeconds,bars:windowRows.length,quality:'insufficient-pre-news-bars'};
  const first=windowRows[0],last=windowRows.at(-1),open=finite(first[1]),close=finite(last[4]),range=rangeOf(windowRows);if(open==null||close==null||!range)return{available:false,windowSeconds,bars:windowRows.length,quality:'invalid-pre-news-price'};
  const closes=windowRows.map(row=>finite(row[4])).filter(v=>v!=null),returns=[];for(let i=1;i<closes.length;i++)if(closes[i-1])returns.push(Math.log(closes[i]/closes[i-1])*100);
  const regressionStats=regression(closes),pathDistance=closes.slice(1).reduce((sum,value,index)=>sum+Math.abs(value-closes[index]),0),movePct=pct(close-open,open),rangePct=pct(range.high-range.low,open),closeLocation=range.high===range.low?.5:(close-range.low)/(range.high-range.low);
  let trSum=0,trCount=0;for(let i=0;i<windowRows.length;i++){const h=finite(windowRows[i][2]),l=finite(windowRows[i][3]),prev=i?finite(windowRows[i-1][4]):open;if(h==null||l==null||prev==null)continue;trSum+=Math.max(h-l,Math.abs(h-prev),Math.abs(l-prev));trCount++;}
  const quarter=Math.max(2,Math.floor(windowRows.length/4)),recent=windowRows.slice(-quarter),previousQuarter=windowRows.slice(-quarter*2,-quarter),recentRange=rangeOf(recent),previousRange=rangeOf(previousQuarter),rangeRatio=recentRange&&previousRange&&previousRange.high!==previousRange.low?(recentRange.high-recentRange.low)/(previousRange.high-previousRange.low):null;
  const recentMove=segmentMove(recent),previousMove=segmentMove(previousQuarter),priorRows=windowRows.slice(0,Math.max(1,windowRows.length-quarter)),priorRange=rangeOf(priorRows),breakoutUp=Boolean(priorRange&&close>priorRange.high),breakoutDown=Boolean(priorRange&&close<priorRange.low);
  const volumes=windowRows.map(row=>Math.max(0,finite(row[5])??0)),spreads=windowRows.map(row=>finite(row[6])).filter(v=>v!=null),earlyVolumes=volumes.slice(0,Math.max(1,volumes.length-quarter)),recentVolumes=volumes.slice(-quarter),earlySpreads=spreads.slice(0,Math.max(1,spreads.length-quarter)),recentSpreads=spreads.slice(-quarter),volumeAcceleration=mean(earlyVolumes)?mean(recentVolumes)/mean(earlyVolumes):null,spreadAcceleration=mean(earlySpreads)?mean(recentSpreads)/mean(earlySpreads):null;
  const efficiency=pathDistance?Math.abs(close-open)/pathDistance:0,slopePctPerBar=open?regressionStats.slope/open*100:null,returnStdPct=std(returns),atrPct=trCount&&open?pct(trSum/trCount,open):null,lastRun=lastDirectionalRun(windowRows),tags=[];
  if(regressionStats.r2>=.55&&efficiency>=.28&&sign(movePct)>0)tags.push('bullish-trend');else if(regressionStats.r2>=.55&&efficiency>=.28&&sign(movePct)<0)tags.push('bearish-trend');else tags.push('range-or-chop');
  if(rangeRatio!=null&&rangeRatio<=.65)tags.push('compression');if(rangeRatio!=null&&rangeRatio>=1.5)tags.push('expansion');if(breakoutUp)tags.push('breakout-up');if(breakoutDown)tags.push('breakout-down');
  if(recentMove!=null&&previousMove!=null&&sign(recentMove)===sign(previousMove)&&Math.abs(recentMove)>Math.abs(previousMove)*1.45)tags.push(sign(recentMove)>0?'momentum-acceleration-up':'momentum-acceleration-down');
  if(recentMove!=null&&sign(recentMove)!==0&&sign(movePct)!==0&&sign(recentMove)!==sign(movePct))tags.push(sign(recentMove)>0?'late-reversal-up':'late-reversal-down');
  if(closeLocation>=.8)tags.push('close-near-high');else if(closeLocation<=.2)tags.push('close-near-low');if(volumeAcceleration!=null&&volumeAcceleration>=1.5)tags.push('volume-expansion');if(volumeAcceleration!=null&&volumeAcceleration<=.7)tags.push('volume-contraction');if(spreadAcceleration!=null&&spreadAcceleration>=1.5)tags.push('spread-widening');
  let peakAt=null,troughAt=null;for(const row of windowRows){if(finite(row[2])===range.high)peakAt=Number(row[0]);if(finite(row[3])===range.low)troughAt=Number(row[0]);}
  return{available:true,windowSeconds,bars:windowRows.length,startAt:new Date(Number(first[0])).toISOString(),endAt:new Date(Number(last[0])).toISOString(),open,close,high:range.high,low:range.low,movePct:round(movePct),rangePct:round(rangePct),maxUpsidePct:round(pct(range.high-open,open)),maxDownsidePct:round(pct(range.low-open,open)),closeLocation:round(closeLocation,4),slopePctPerBar:round(slopePctPerBar,8),trendR2:round(regressionStats.r2,4),efficiencyRatio:round(efficiency,4),returnStdPct:round(returnStdPct,6),atrPct:round(atrPct,6),rangeRatioRecentVsPrior:round(rangeRatio,4),recentMovePct:round(recentMove),priorQuarterMovePct:round(previousMove),volumeAverage:round(mean(volumes),2),volumeAcceleration:round(volumeAcceleration,4),spreadAverage:round(mean(spreads),4),spreadAcceleration:round(spreadAcceleration,4),lastDirectionalRun:lastRun,peakAt:peakAt==null?null:new Date(peakAt).toISOString(),troughAt:troughAt==null?null:new Date(troughAt).toISOString(),patterns:tags,patternKey:tags.join('|')};
}

function buildPreNewsAssetProfile(symbol,rows,releaseMs){
  const windows={};for(const[offsetText,label]of Object.entries(MT5_PRE_NEWS_WINDOWS))windows[label]=priceActionMetrics(rows,releaseMs,Number(offsetText));
  const decisionWindows=['5m','15m','30m','1h','2h','4h'].map(label=>windows[label]).filter(row=>row?.available),up=decisionWindows.filter(row=>sign(row.movePct)>0).length,down=decisionWindows.filter(row=>sign(row.movePct)<0).length,flat=decisionWindows.length-up-down,dominantDirection=up>down?'up':down>up?'down':'mixed';
  const patterns=[...new Set(decisionWindows.flatMap(row=>row.patterns||[]))],compressionWindows=decisionWindows.filter(row=>row.patterns?.includes('compression')).length,expansionWindows=decisionWindows.filter(row=>row.patterns?.includes('expansion')).length;
  return{assetId:symbol,available:decisionWindows.length>0,dominantDirection,directionalAgreement:decisionWindows.length?Math.max(up,down,flat)/decisionWindows.length:null,upWindows:up,downWindows:down,flatWindows:flat,compressionWindows,expansionWindows,patterns,profileSignature:`${dominantDirection}|${compressionWindows>expansionWindows?'compression':expansionWindows>compressionWindows?'expansion':'balanced-vol'}|${(windows['1h']?.patterns||[]).slice(0,3).join('+')||'no-1h'}`,windows};
}
function buildCrossAssetPreNewsProfile(profiles,timeSignature){
  const rows=profiles.filter(row=>row.available),up=rows.filter(row=>row.dominantDirection==='up').length,down=rows.filter(row=>row.dominantDirection==='down').length,mixed=rows.length-up-down,compressing=rows.filter(row=>row.compressionWindows>row.expansionWindows).length,expanding=rows.filter(row=>row.expansionWindows>row.compressionWindows).length,breadth=rows.length?(up-down)/rows.length:null;
  const state=breadth==null?'unavailable':breadth>.25?'broad-risk-up':breadth<-.25?'broad-risk-down':'mixed-breadth',volatilityState=compressing>expanding?'pre-news-compression':expanding>compressing?'pre-news-expansion':'mixed-volatility';
  return{usableAssets:rows.length,totalAssets:MT5_EVENT_ASSETS.length,up,down,mixed,compressing,expanding,breadth:round(breadth,4),state,volatilityState,timeSignature:timeSignature?.sessionUtc||null,profileSignature:`${timeSignature?.weekday||'NA'}|${timeSignature?.sessionUtc||'NA'}|${state}|${volatilityState}`};
}

function baselineBar(rows,releaseMs){let best=null;for(const row of rows){const time=Number(row[0]);if(time>releaseMs)break;best=row;}if(!best)return null;return releaseMs-Number(best[0])<=MAX_BASELINE_LAG_MS?best:null;}
function observationBar(rows,targetMs,toleranceMs){let best=null,distance=Infinity;for(const row of rows){const time=Number(row[0]);if(time<targetMs-toleranceMs)continue;if(time>targetMs+toleranceMs)break;const nextDistance=Math.abs(time-targetMs);if(nextDistance<distance){best=row;distance=nextDistance;}}return best;}
function pathMetrics(rows,baseline,observation){
  const basePrice=finite(baseline?.[4]),endPrice=finite(observation?.[4]);if(basePrice==null||endPrice==null||Math.abs(basePrice)<Number.EPSILON)return null;const startMs=Number(baseline[0]),endMs=Number(observation[0]),path=rows.filter(row=>Number(row[0])>=startMs&&Number(row[0])<=endMs);if(!path.length)return null;
  let high=-Infinity,low=Infinity,peakAt=null,troughAt=null,volume=0,spreadSum=0,spreadCount=0;for(const row of path){const rowHigh=finite(row[2]),rowLow=finite(row[3]);if(rowHigh!=null&&rowHigh>high){high=rowHigh;peakAt=Number(row[0]);}if(rowLow!=null&&rowLow<low){low=rowLow;troughAt=Number(row[0]);}volume+=Math.max(0,finite(row[5])??0);const spread=finite(row[6]);if(spread!=null){spreadSum+=spread;spreadCount++;}}
  const move=endPrice-basePrice,movePercent=pct(move,basePrice),maxUpsidePct=Number.isFinite(high)?pct(high-basePrice,basePrice):null,maxDownsidePct=Number.isFinite(low)?pct(low-basePrice,basePrice):null,rangePct=Number.isFinite(high)&&Number.isFinite(low)?pct(high-low,basePrice):null;
  return{baselinePrice:basePrice,observationPrice:endPrice,rawMove:move,rawMovePct:movePercent,direction:movePercent==null||Math.abs(movePercent)<1e-12?'flat':movePercent>0?'up':'down',maxUpsidePct,maxDownsidePct,maxAbsoluteExcursionPct:Math.max(Math.abs(maxUpsidePct??0),Math.abs(maxDownsidePct??0)),rangePct,barsObserved:path.length,tickVolume:volume,averageSpread:spreadCount?spreadSum/spreadCount:null,peakAt:peakAt==null?null:new Date(peakAt).toISOString(),troughAt:troughAt==null?null:new Date(troughAt).toISOString()};
}
function reactionForHorizon(symbol,rows,releaseMs,offsetSeconds){
  const baseline=baselineBar(rows,releaseMs);if(!baseline)return{assetId:symbol,available:false,quality:'baseline-unavailable'};const targetMs=releaseMs+offsetSeconds*1000,toleranceMs=Math.max(180_000,Math.min(30*60_000,offsetSeconds*1000*.10)),observation=observationBar(rows,targetMs,toleranceMs);
  if(!observation)return{assetId:symbol,available:false,quality:'observation-unavailable',baselineAt:new Date(Number(baseline[0])).toISOString(),baselinePrice:finite(baseline[4])};const metrics=pathMetrics(rows,baseline,observation);
  return{assetId:symbol,available:Boolean(metrics),quality:metrics?'measured':'invalid-price',baselineAt:new Date(Number(baseline[0])).toISOString(),observationAt:new Date(Number(observation[0])).toISOString(),targetAt:new Date(targetMs).toISOString(),observationLagSeconds:Math.round((Number(observation[0])-targetMs)/1000),...metrics};
}

export async function buildMT5EventPriceStudy(event,{chunkCache}={}){
  const releaseMs=Date.parse(event?.date||event?.releaseAt||'');if(!Number.isFinite(releaseMs))return null;const maxHorizonSeconds=Math.max(...Object.keys(MT5_EVENT_HORIZONS).map(Number)),maxPreSeconds=Math.max(...Object.keys(MT5_PRE_NEWS_WINDOWS).map(Number)),windowStart=releaseMs-maxPreSeconds*1000-MAX_BASELINE_LAG_MS,windowEnd=releaseMs+maxHorizonSeconds*1000+30*60_000,assetRows=new Map();
  await Promise.all(MT5_EVENT_ASSETS.map(async symbol=>assetRows.set(symbol,await loadMT5Bars(symbol,windowStart,windowEnd,{chunkCache}))));
  const timeSignature=buildEventTimeSignature(event),preAssets=MT5_EVENT_ASSETS.map(symbol=>buildPreNewsAssetProfile(symbol,assetRows.get(symbol)||[],releaseMs)),preNews={source:'MetaTrader5 canonical M1 Firestore cache',sourceTimeframe:'M1',windows:Object.values(MT5_PRE_NEWS_WINDOWS),assets:preAssets,crossAsset:buildCrossAssetPreNewsProfile(preAssets,timeSignature)};
  const horizons={};for(const[offsetText,horizon]of Object.entries(MT5_EVENT_HORIZONS)){const offsetSeconds=Number(offsetText),reactions=MT5_EVENT_ASSETS.map(symbol=>reactionForHorizon(symbol,assetRows.get(symbol)||[],releaseMs,offsetSeconds)),usable=reactions.filter(row=>row.available),positive=usable.filter(row=>Number(row.rawMovePct)>0).length,negative=usable.filter(row=>Number(row.rawMovePct)<0).length,flat=usable.length-positive-negative,averageAbsoluteMovePct=usable.length?usable.reduce((sum,row)=>sum+Math.abs(Number(row.rawMovePct||0)),0)/usable.length:null;horizons[horizon]={horizon,offsetSeconds,releaseAt:new Date(releaseMs).toISOString(),capturedAt:new Date().toISOString(),source:'MetaTrader5 canonical M1 Firestore cache',quality:usable.length?'measured':'market-data-unavailable',usableAssets:usable.length,totalAssets:MT5_EVENT_ASSETS.length,positive,negative,flat,crossAssetBreadth:usable.length?(positive-negative)/usable.length:null,averageAbsoluteMovePct,reactions};}
  return{source:'MetaTrader5 canonical M1 Firestore cache',sourceTimeframe:'M1',assets:[...MT5_EVENT_ASSETS],timeSignature,preNews,profileSignature:`${event?.currency||'NA'}|I${event?.importance||0}|${timeSignature?.weekday||'NA'}|${timeSignature?.sessionUtc||'NA'}|${preNews.crossAsset.profileSignature}`,horizons};
}
