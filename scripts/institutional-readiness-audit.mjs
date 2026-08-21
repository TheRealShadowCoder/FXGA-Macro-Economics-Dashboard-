import fs from 'node:fs';

const site=String(process.env.SITE_URL||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function json(url,{attempts=3,timeoutMs=30_000}={}){
  let last;
  for(let attempt=1;attempt<=attempts;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{headers:{Accept:'application/json','Cache-Control':'no-cache'},cache:'no-store',signal:controller.signal});
      const text=await response.text();
      if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,300)}`);
      return JSON.parse(text);
    }catch(error){last=error;if(attempt<attempts)await sleep(1000*attempt);}finally{clearTimeout(timer);}
  }
  throw last;
}

const result=(name,ready,detail,blocking=true)=>({name,ready:Boolean(ready),blocking,detail});
const finite=value=>Number.isFinite(Number(value));
const ageMinutes=value=>{const t=Date.parse(value||'');return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/60_000)):Infinity;};
function fxMarketExpectedOpen(now=new Date()){
  const day=now.getUTCDay(),hour=now.getUTCHours();
  if(day===6)return false;
  if(day===0)return hour>=21;
  if(day===5)return hour<21;
  return true;
}

let build={},backend='',mt5='';
const dimensions=[];
try{
  build=await json(`${site}/fxga-build.json?readiness=${Date.now()}`);
  backend=String(build.backendUrl||'').replace(/\/$/,'');
  dimensions.push(result('release-evidence',Boolean(build.commit&&backend.startsWith('https://')),{commit:build.commit||null,release:build.release||null,backend}));
}catch(error){dimensions.push(result('release-evidence',false,{error:String(error?.message||error)}));}

if(backend){
  try{
    const health=await json(`${backend}/api/health`);
    dimensions.push(result('service-health',health.ok===true&&health.compute==='Google Cloud Run'&&health.state==='Google Cloud Firestore'&&health.cloudflareProcessing===false,{updatedAt:health.updatedAt||null,compute:health.compute,state:health.state}));
    const intelligenceAge=ageMinutes(health?.updatedAt?.intelligence),macroAge=ageMinutes(health?.updatedAt?.macro),marketAge=ageMinutes(health?.updatedAt?.market);
    dimensions.push(result('intelligence-freshness',intelligenceAge<=30&&macroAge<=180&&marketAge<=30,{intelligenceAgeMinutes:intelligenceAge,macroAgeMinutes:macroAge,marketAgeMinutes:marketAge,thresholds:{intelligence:30,macro:180,market:30}}));
  }catch(error){dimensions.push(result('service-health',false,{error:String(error?.message||error)}));dimensions.push(result('intelligence-freshness',false,{error:String(error?.message||error)}));}

  try{
    const quality=await json(`${backend}/api/data-quality`);
    const coverage=Number(quality?.macro?.coverage?.effectiveCoveragePercent),liveCoverage=Number(quality?.macro?.coverage?.liveCoveragePercent),requested=Number(quality?.macro?.coverage?.requested||0),unresolved=Number(quality?.macro?.failures?.unresolved??0);
    const bounded=Number.isFinite(coverage)&&coverage>=0&&coverage<=100&&Number.isFinite(liveCoverage)&&liveCoverage>=0&&liveCoverage<=100;
    const sufficientlyComplete=coverage>=75&&unresolved<=Math.max(10,requested*0.25);
    const meaningfulLiveCoverage=liveCoverage>=25;
    dimensions.push(result('macro-data-health',bounded&&sufficientlyComplete&&meaningfulLiveCoverage,{coveragePercent:coverage,liveCoveragePercent:liveCoverage,minimumLiveCoveragePercent:25,requested,unresolved,status:quality?.macro?.coverage?.status||null,boundedPercentages:Boolean(quality?.macro?.coverage?.boundedPercentages),lastKnownGoodAllowed:true}));
  }catch(error){dimensions.push(result('macro-data-health',false,{error:String(error?.message||error)}));}

  try{
    const global=await json(`${backend}/api/global-macro`);
    const targets=Array.isArray(global.targetEconomies)?global.targetEconomies:[];
    const populated=targets.filter(id=>Number(global?.counts?.[id]||0)>0),coverage=Number(global?.coverage?.effectiveCoveragePercent);
    const coverageValid=!Number.isFinite(coverage)||(coverage>=0&&coverage<=100);
    dimensions.push(result('global-economy-data',targets.length>=21&&populated.length>=Math.min(16,targets.length)&&coverageValid,{targets:targets.length,populated:populated.length,mode:global.mode||null,coveragePercent:Number.isFinite(coverage)?coverage:null,hardCodedPublicEconomyList:global?.policy?.hardCodedPublicEconomyList??null}));
  }catch(error){dimensions.push(result('global-economy-data',false,{error:String(error?.message||error)}));}

  try{
    const economy=await json(`${backend}/api/economy-analysis`);
    const rows=Array.isArray(economy?.economies)?economy.economies:[];
    const ids=new Set(rows.map(row=>row.id));
    const structurallyValid=rows.filter(row=>Array.isArray(row.dimensions)&&row.dimensions.length===5&&row.dimensions.every(d=>finite(d.score))&&finite(row.confidence)&&Number(row.confidence)>=0&&Number(row.confidence)<=100&&finite(row.currencyScore));
    const modelAge=ageMinutes(economy?.generatedAt);
    dimensions.push(result('global-economy-model',rows.length>=21&&ids.size===rows.length&&structurallyValid.length===rows.length&&modelAge<=30,{economies:rows.length,unique:ids.size,structurallyValid:structurallyValid.length,generatedAt:economy?.generatedAt||null,ageMinutes:modelAge}));
  }catch(error){dimensions.push(result('global-economy-model',false,{error:String(error?.message||error)}));}

  try{
    const sources=await json(`${backend}/api/event-study-sources`);
    const provenanceReady=Number(sources?.sources?.fred?.seriesCount)>0&&Number(sources?.sources?.fxstreet?.eventCount)>0&&Number(sources?.sources?.mt5?.studyCount)>0;
    dimensions.push(result('research-provenance',provenanceReady,{fred:Number(sources?.sources?.fred?.seriesCount||0),cnbc:Number(sources?.sources?.cnbc?.assetCount||0),fxstreet:Number(sources?.sources?.fxstreet?.eventCount||0),mt5Studies:Number(sources?.sources?.mt5?.studyCount||0)}));
  }catch(error){dimensions.push(result('research-provenance',false,{error:String(error?.message||error)}));}

  try{
    const telemetry=await json(`${backend}/api/tradingview/firestore-usage`);
    const raw=JSON.stringify(telemetry);
    dimensions.push(result('public-security-telemetry',!/PERMISSION_DENIED|Permission denied/i.test(raw)&&['cloud-monitoring','firestore-ledger-fallback'].includes(String(telemetry.monitoringMode||'')),{mode:telemetry.monitoringMode||null,signals:Number(telemetry?.signalPipeline?.totalSignals||0),events:Number(telemetry?.signalPipeline?.totalEvents||0)}));
  }catch(error){dimensions.push(result('public-security-telemetry',false,{error:String(error?.message||error)}));}

  try{
    const studies=await json(`${backend}/api/event-studies?days=60&limit=20`);
    const backtests=await json(`${backend}/api/event-pattern-backtests?limit=10`);
    const studyCount=Number(studies?.summary?.studies??studies?.studies?.length??0),tests=Number(backtests?.summary?.tests??backtests?.tests?.length??0),validated=Number(backtests?.summary?.validatedCandidates??backtests?.tests?.filter?.(x=>x.promotionEligible)?.length??0);
    dimensions.push(result('research-maturity',studyCount>=100,{studies:studyCount,tests,validatedCandidates:validated,status:validated>0?'validated-candidates-exist':tests>0?'oos-testing-active':'descriptive-research-only'},false));
    dimensions.push(result('trade-model-readiness',validated>0,{validatedCandidates:validated,policy:'Zero validated candidates is an acceptable research result; automated trade promotion remains blocked.'},false));
  }catch(error){dimensions.push(result('research-maturity',false,{error:String(error?.message||error)},false));dimensions.push(result('trade-model-readiness',false,{error:String(error?.message||error)},false));}
}

try{
  const config=await json(`${site}/mt5-cloud.json?readiness=${Date.now()}`);
  mt5=String(config.baseUrl||'').replace(/\/$/,'');
  if(!mt5.startsWith('https://'))throw new Error('MT5 endpoint missing');
  const [status,current,health]=await Promise.all([json(`${mt5}/api/mt5/price-cache/status`),json(`${mt5}/api/mt5/prices?symbol=EURUSD&timeframe=M1&limit=10`),json(`${mt5}/api/mt5/health`)]);
  const dbState=String(status?.databaseHealth?.state||'UNKNOWN').toUpperCase();
  const newest=Number(current?.newestMs||0),ageMs=newest?Date.now()-newest:Infinity,marketOpen=fxMarketExpectedOpen();
  const freshnessReady=marketOpen?ageMs<=20*60_000:true;
  const secretBacked=health?.authentication?.configured===true&&String(health?.authentication?.mode||'').includes('sha256-token');
  dimensions.push(result('mt5-data-readiness',status.retentionDays===60&&status.allowedSymbols?.length===16&&dbState!=='STALE'&&freshnessReady&&secretBacked,{databaseHealth:dbState,totalBars:Number(status.totalBars||0),assetsExpected:Number(status?.databaseHealth?.assetsExpected||0),newestEURUSD:newest||null,ageMinutes:Number.isFinite(ageMs)?Math.round(ageMs/60_000):null,marketExpectedOpen:marketOpen,secretBackedAuthentication:secretBacked}));
}catch(error){dimensions.push(result('mt5-data-readiness',false,{error:String(error?.message||error)}));}

const blocking=dimensions.filter(row=>row.blocking);
const institutionalReady=blocking.every(row=>row.ready);
const report={
  schema:'fxga.institutional.readiness.v3',
  generatedAt:new Date().toISOString(),
  institutionalReady,
  tradeModelReady:dimensions.find(row=>row.name==='trade-model-readiness')?.ready??false,
  site,
  backend:backend||null,
  mt5:mt5||null,
  summary:{ready:dimensions.filter(row=>row.ready).length,notReady:dimensions.filter(row=>!row.ready).length,blockingFailures:blocking.filter(row=>!row.ready).length,total:dimensions.length},
  dimensions,
  interpretation:{institutionalReady:'Core infrastructure, bounded/fresh evidence, global macro and MT5 readiness. This is not a regulatory certification.',tradeModelReady:'At least one event-pattern candidate has passed the configured OOS promotion gates. It is never a profitability guarantee.',confidence:'UI confidence values are evidence-quality scores until empirical calibration proves probability reliability.',lastKnownGood:'Last-known-good data preserves continuity but cannot by itself satisfy institutional live-data readiness.'},
};
fs.mkdirSync('runtime',{recursive:true});
fs.writeFileSync('runtime/institutional-readiness.json',JSON.stringify(report,null,2)+'\n');
console.table(dimensions.map(row=>({dimension:row.name,status:row.ready?'READY':'NOT READY',blocking:row.blocking?'YES':'NO',detail:JSON.stringify(row.detail).slice(0,120)})));
if(!institutionalReady)process.exitCode=1;
