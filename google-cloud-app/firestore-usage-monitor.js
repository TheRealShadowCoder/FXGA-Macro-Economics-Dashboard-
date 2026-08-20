import { MetricServiceClient } from '@google-cloud/monitoring';

const GIB=1024**3;
const PROJECT_ID=process.env.GCP_PROJECT_ID||process.env.GOOGLE_CLOUD_PROJECT||'';
const DATABASE_ID='(default)';
const QUOTA_TIMEZONE='America/Los_Angeles';
const FREE={storageBytes:GIB,reads:50_000,writes:20_000,deletes:20_000,outboundBytes:10*GIB};
const monitoring=new MetricServiceClient();

const number=value=>{if(value==null)return 0;const raw=typeof value==='object'&&value?.toString?value.toString():value;const n=Number(raw);return Number.isFinite(n)?n:0;};
const pointValue=point=>number(point?.value?.int64Value??point?.value?.doubleValue);
const pointTime=point=>{const seconds=number(point?.interval?.endTime?.seconds);return seconds>0?new Date(seconds*1000).toISOString():null;};
const ratio=(used,limit)=>({used,limit,remaining:Math.max(0,limit-used),percent:limit?Number((used/limit*100).toFixed(2)):0});

function zonedParts(date,timeZone){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
}
function zoneOffsetMs(date,timeZone){
  const p=zonedParts(date,timeZone);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(date.getTime()/1000)*1000;
}
function quotaDayStart(now=new Date()){
  const p=zonedParts(now,QUOTA_TIMEZONE);const rough=Date.UTC(p.year,p.month-1,p.day,0,0,0);let candidate=new Date(rough-zoneOffsetMs(new Date(rough),QUOTA_TIMEZONE));candidate=new Date(rough-zoneOffsetMs(candidate,QUOTA_TIMEZONE));return candidate;
}
function ts(date){return {seconds:Math.floor(date.getTime()/1000)};}
function metricFilter(type){return `metric.type="${type}" AND resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="${DATABASE_ID}"`;}
async function series(type,start,end,aggregation){
  if(!PROJECT_ID)throw new Error('GCP_PROJECT_ID is unavailable');
  const request={name:`projects/${PROJECT_ID}`,filter:metricFilter(type),interval:{startTime:ts(start),endTime:ts(end)},view:'FULL'};
  if(aggregation)request.aggregation=aggregation;
  const [rows]=await monitoring.listTimeSeries(request);return rows||[];
}
function sumRows(rows){let total=0;for(const row of rows)for(const point of row.points||[])total+=pointValue(point);return total;}
function latestRows(rows){let winner={value:0,time:null,ms:0};for(const row of rows)for(const point of row.points||[]){const time=pointTime(point),ms=time?Date.parse(time):0;if(ms>=winner.ms)winner={value:pointValue(point),time,ms};}return winner;}
function monitoringFallback(error){
  const message=String(error?.message||error||'');
  const permission=/permission_denied|permission denied|code\s*7/i.test(message);
  return {
    mode:'firestore-ledger-fallback',
    diagnostic:permission?'monitoring-viewer-unavailable':'monitoring-query-unavailable',
    notice:permission
      ?'Cloud Monitoring project metrics are not readable by this runtime. Firestore signal lifecycle totals remain live through the internal ledger while project-wide quota gauges are hidden.'
      :'Cloud Monitoring project metrics are temporarily unavailable. Firestore signal lifecycle totals remain live through the internal ledger while project-wide quota gauges are hidden.',
  };
}

export function createFirestoreUsageMonitor({metricsRef}){
  let cache={at:0,value:null};
  async function snapshot(){
    const now=new Date();if(cache.value&&Date.now()-cache.at<60_000)return cache.value;
    const metricSnap=await metricsRef.get().catch(()=>null),m=metricSnap?.exists?metricSnap.data():{};
    const base={generatedAt:now.toISOString(),projectId:PROJECT_ID,databaseId:DATABASE_ID,quotaTimezone:QUOTA_TIMEZONE,quotaDayStart:quotaDayStart(now).toISOString(),monitoringAvailable:false,monitoringMode:'firestore-ledger-fallback',monitoringError:null,monitoringNotice:'Project-wide Cloud Monitoring metrics are not yet available; the Firestore signal ledger remains active.',monitoringDiagnostic:null,storage:{...ratio(0,FREE.storageBytes),usedGiB:0,limitGiB:1,remainingGiB:1,growthBytesPerDay:null,projectedDaysRemaining:null},reads:ratio(0,FREE.reads),writes:ratio(0,FREE.writes),deletes:ratio(0,FREE.deletes),outbound:{limitBytes:FREE.outboundBytes,limitGiB:10,usedBytes:null,note:'Firestore free tier includes 10 GiB/month outbound. This monitor does not infer billable egress from response payloads.'},signalPipeline:{totalEvents:Number(m.totalEvents||0),mt5Events:Number(m.mt5Events||0),totalSignals:Number(m.totalSignals||0),mt5Signals:Number(m.mt5Signals||0),estimatedWritesPerAcceptedEvent:4,remainingAcceptedEventsAtCurrentWriteHeadroom:null},notes:['Free-tier operation quotas reset around midnight Pacific Time.','Project-wide quota gauges are shown only when Cloud Monitoring returns verified metrics.','Signal lifecycle counts are read directly from the FXGA Firestore ledger and remain available without Cloud Monitoring.']};
    try{
      const dayStart=quotaDayStart(now),weekStart=new Date(now.getTime()-8*86400_000);
      const [readRows,writeRows,deleteRows,storageRows,storageDaily]=await Promise.all([
        series('firestore.googleapis.com/document/read_ops_count',dayStart,now),
        series('firestore.googleapis.com/document/write_ops_count',dayStart,now),
        series('firestore.googleapis.com/document/delete_ops_count',dayStart,now),
        series('firestore.googleapis.com/storage/data_and_index_storage_bytes',new Date(now.getTime()-20*60_000),now),
        series('firestore.googleapis.com/storage/data_and_index_storage_bytes',weekStart,now,{alignmentPeriod:{seconds:86400},perSeriesAligner:'ALIGN_MEAN',crossSeriesReducer:'REDUCE_MAX'}),
      ]);
      const reads=Math.round(sumRows(readRows)),writes=Math.round(sumRows(writeRows)),deletes=Math.round(sumRows(deleteRows)),storageLatest=latestRows(storageRows),storageBytes=Math.max(0,storageLatest.value);
      const dailyPoints=[];for(const row of storageDaily)for(const point of row.points||[]){const time=pointTime(point);if(time)dailyPoints.push({time,ms:Date.parse(time),value:pointValue(point)});}dailyPoints.sort((a,b)=>a.ms-b.ms);
      let growthBytesPerDay=null,projectedDaysRemaining=null;
      if(dailyPoints.length>=2){const first=dailyPoints[0],last=dailyPoints[dailyPoints.length-1],days=Math.max(1,(last.ms-first.ms)/86400_000);growthBytesPerDay=(last.value-first.value)/days;if(growthBytesPerDay>0&&storageBytes<FREE.storageBytes)projectedDaysRemaining=(FREE.storageBytes-storageBytes)/growthBytesPerDay;}
      const storageRatio=ratio(storageBytes,FREE.storageBytes),writeRatio=ratio(writes,FREE.writes);
      const metricTimes=[storageLatest.time,...readRows.flatMap(r=>(r.points||[]).map(pointTime)),...writeRows.flatMap(r=>(r.points||[]).map(pointTime)),...deleteRows.flatMap(r=>(r.points||[]).map(pointTime))].filter(Boolean).sort();
      base.monitoringAvailable=true;base.monitoringMode='cloud-monitoring';base.monitoringNotice=null;base.monitoringDiagnostic=null;base.metricTimestamp=metricTimes.at(-1)||null;
      base.storage={...storageRatio,usedGiB:storageBytes/GIB,limitGiB:1,remainingGiB:storageRatio.remaining/GIB,growthBytesPerDay,projectedDaysRemaining};
      base.reads=ratio(reads,FREE.reads);base.writes=writeRatio;base.deletes=ratio(deletes,FREE.deletes);
      base.signalPipeline.remainingAcceptedEventsAtCurrentWriteHeadroom=Math.max(0,Math.floor(writeRatio.remaining/4));
    }catch(error){const fallback=monitoringFallback(error);base.monitoringAvailable=false;base.monitoringMode=fallback.mode;base.monitoringNotice=fallback.notice;base.monitoringDiagnostic=fallback.diagnostic;base.monitoringError=null;}
    cache={at:Date.now(),value:base};return base;
  }
  return {snapshot,freeTier:FREE};
}
