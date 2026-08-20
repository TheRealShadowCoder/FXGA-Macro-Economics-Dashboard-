import fs from 'node:fs';

const site=String(process.env.SITE_URL||'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message);};

async function request(url,{json=true,timeoutMs=45_000,attempts=3}={}){
  let last;
  for(let attempt=1;attempt<=attempts;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{headers:{Accept:json?'application/json':'text/html,*/*','Cache-Control':'no-cache'},cache:'no-store',signal:controller.signal});
      const text=await response.text();
      clearTimeout(timer);
      if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,300)}`);
      if(!json)return {response,text};
      let body;
      try{body=JSON.parse(text);}catch{throw new Error(`Invalid JSON: ${text.slice(0,200)}`);}
      return {response,text,body};
    }catch(error){
      clearTimeout(timer);
      last=error;
      if(attempt<attempts)await sleep(attempt*1500);
    }
  }
  throw last;
}

async function check(name,fn){
  const startedAt=Date.now();
  try{
    const detail=await fn();
    checks.push({name,passed:true,durationMs:Date.now()-startedAt,detail});
  }catch(error){
    checks.push({name,passed:false,durationMs:Date.now()-startedAt,error:String(error?.message||error)});
  }
}

let root='';
let build=null;
let backend='';
let mt5='';

await check('cloudflare-root',async()=>{
  root=(await request(`${site}/?audit=${Date.now()}`,{json:false})).text;
  assert(/id=["']root["']/.test(root),'React root missing');
  return 'React shell present';
});

await check('release-marker',async()=>{
  build=(await request(`${site}/fxga-build.json?audit=${Date.now()}`)).body;
  assert(build.release==='cross-asset-mt5-60d-event-research',`Unexpected release ${build.release}`);
  backend=String(build.backendUrl||'').replace(/\/$/,'');
  assert(backend.startsWith('https://'),'Backend URL missing');
  return {commit:build.commit,backend};
});

await check('frontend-current-bundle',async()=>{
  const scripts=[...root.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/g)].map(match=>new URL(match[1],site).toString());
  assert(scripts.length>0,'Compiled JavaScript bundle missing');
  let source='';
  for(const script of scripts.slice(0,8))source+=(await request(script,{json:false,timeoutMs:30_000})).text;
  assert(!source.includes('timed out after 12 seconds'),'Obsolete 12-second core bundle is still live');
  assert(!source.includes('Cloud Monitoring permission required'),'Obsolete raw Cloud Monitoring permission banner is still live');
  for(const label of ['Macro Dashboard','Cross Asset Prices','Macro Analysis','Research & Risk','Currency Outlook','Live Signal Intelligence','Economic Calendar','Core Indicators','Macro Data Library','Data Operations','Central Bank News','Data Coverage'])assert(source.includes(label),`Missing compiled navigation: ${label}`);
  assert(source.includes('FRED supplies macro-series evidence'),'Event Study source-provenance UI is not live');
  return `${scripts.length} script bundle(s)`;
});

await check('cloudflare-static-only',async()=>{
  const {response,text}=await request(`${site}/api/health?audit=${Date.now()}`,{json:false});
  assert(!String(response.headers.get('content-type')||'').includes('application/json'),'Cloudflare unexpectedly returned an application API response');
  assert(/id=["']root["']/.test(text),'Cloudflare SPA fallback missing');
  return 'static only';
});

await check('google-health',async()=>{
  assert(backend,'Backend unresolved');
  const body=(await request(`${backend}/api/health`)).body;
  assert(body.ok===true&&body.compute==='Google Cloud Run'&&body.state==='Google Cloud Firestore','Google Cloud health contract failed');
  assert(body.cloudflareProcessing===false,'Cloudflare processing must be false');
  return body.updatedAt;
});

const endpoints=[
  ['dashboard','/api/dashboard',body=>Array.isArray(body.macro)&&Array.isArray(body.calendar)&&Array.isArray(body.market)&&Array.isArray(body.news)&&Array.isArray(body.sources)],
  ['analysis','/api/analysis',body=>Array.isArray(body.dimensions)],
  ['economy-analysis','/api/economy-analysis',body=>body&&typeof body==='object'],
  ['release-impact','/api/release-impact',body=>body&&typeof body==='object'],
  ['research','/api/research',body=>body.dataQuality&&body.risk&&Array.isArray(body.forecasts)&&Array.isArray(body.scenarios)&&Array.isArray(body.regimes)&&body.operatingStandards],
  ['session-signals','/api/session-signals',body=>Array.isArray(body.sessions)&&Array.isArray(body.rankedOpportunities)],
  ['market-prices','/api/market-prices',body=>Array.isArray(body.assets)],
  ['technical','/api/technical',body=>body.assets&&typeof body.assets==='object'],
  ['calendar','/api/calendar?days=7&importance=1',body=>Array.isArray(body.events)],
  ['calendar-history','/api/calendar-history?days=60',body=>body.days===60&&Array.isArray(body.events)],
  ['event-studies','/api/event-studies?days=60&limit=20',body=>body.days===60&&Array.isArray(body.studies)&&body.studies.length>0&&Array.isArray(body.preNewsWindows)&&Array.isArray(body.horizons)],
  ['event-patterns','/api/event-pattern-profiles?minObservations=1&limit=20',body=>Array.isArray(body.profiles)],
  ['data-quality','/api/data-quality',body=>body.macro&&body.market&&body.technical&&body.calendar],
  ['global-macro','/api/global-macro',body=>typeof body.totalObservations==='number'&&body.economies],
  ['fred-catalog','/api/fred/catalog',body=>typeof body.total==='number'&&typeof body.maxSeriesPerRequest==='number'&&Array.isArray(body.categories)&&Array.isArray(body.series)&&(body.total===0||body.categories.length>0)],
  ['acquisition-catalog','/api/acquisition/catalog',body=>Array.isArray(body.sources)&&body.policy],
  ['super-economist','/api/super-economist',body=>body&&typeof body==='object'&&body.operationalHealth],
  ['news','/api/news',body=>Array.isArray(body.items)],
  ['sources','/api/sources',body=>Array.isArray(body.sources)&&body.sources.length>0],
  ['tradingview-live','/api/tradingview/signals/live?limit=5',body=>typeof body.generatedAt==='string'&&typeof body.count==='number'&&Array.isArray(body.signals)],
  ['tradingview-history','/api/tradingview/signals?limit=5',body=>typeof body.generatedAt==='string'&&typeof body.count==='number'&&Array.isArray(body.signals)],
  ['tradingview-metrics','/api/tradingview/signals/metrics',body=>body&&typeof body==='object'&&typeof body.totalSignals==='number'&&typeof body.totalEvents==='number'],
];

for(const [name,path,validate] of endpoints){
  await check(name,async()=>{
    assert(backend,'Backend unresolved');
    const body=(await request(`${backend}${path}`)).body;
    assert(validate(body),'Payload contract failed');
    if(name==='fred-catalog'&&body.categories?.length){
      const category=body.categories[0].id;
      const categoryBody=(await request(`${backend}/api/fred?category=${encodeURIComponent(category)}&limit=16`)).body;
      assert(Array.isArray(categoryBody.series),'FRED category query missing series array');
    }
    return name==='event-studies'?{studies:body.studies.length,measurements:body.summary?.assetMeasurements??null}:'contract OK';
  });
}

await check('event-study-source-fusion',async()=>{
  const body=(await request(`${backend}/api/event-study-sources`)).body;
  assert(body?.sources?.fred?.seriesCount>0,'FRED evidence is empty');
  assert(body?.sources?.cnbc?.assetCount>0,'CNBC cross-asset evidence is empty');
  assert(body?.sources?.fxstreet?.eventCount>0,'FXStreet release evidence is empty');
  assert(body?.sources?.mt5?.studyCount>0,'MT5 event-study evidence is empty');
  assert(String(body?.policy?.cnbc||'').includes('not treated as a historical event candle'),'CNBC historical-use guard missing');
  return {fred:body.sources.fred.seriesCount,cnbc:body.sources.cnbc.assetCount,fxstreet:body.sources.fxstreet.eventCount,mt5Studies:body.sources.mt5.studyCount};
});

await check('firestore-telemetry-safe-fallback',async()=>{
  const {text,body}=await request(`${backend}/api/tradingview/firestore-usage`);
  assert(!/PERMISSION_DENIED|Permission denied/i.test(text),'Raw Cloud Monitoring permission error is public');
  assert(['cloud-monitoring','firestore-ledger-fallback'].includes(String(body.monitoringMode||'')),'Safe monitoring mode missing');
  assert(typeof body.signalPipeline?.totalEvents==='number'&&typeof body.signalPipeline?.totalSignals==='number','Signal ledger totals missing');
  return {mode:body.monitoringMode,events:body.signalPipeline.totalEvents,signals:body.signalPipeline.totalSignals};
});

await check('mt5-config',async()=>{
  const config=(await request(`${site}/mt5-cloud.json?audit=${Date.now()}`)).body;
  mt5=String(config.baseUrl||'').replace(/\/$/,'');
  assert(config.priceCache?.retentionDays===60,'MT5 retention is not 60 days');
  assert(Array.isArray(config.priceCache?.symbols)&&config.priceCache.symbols.length===16,'MT5 16-asset config missing');
  assert(mt5.startsWith('https://'),'MT5 base URL missing');
  return mt5;
});

await check('mt5-health',async()=>{
  const body=(await request(`${mt5}/api/mt5/health`)).body;
  assert(body.ok===true&&body.source==='MetaTrader5'&&body.priceCache?.retentionDays===60,'MT5 health contract failed');
  return body.priceCache;
});

await check('mt5-status',async()=>{
  const body=(await request(`${mt5}/api/mt5/price-cache/status`)).body;
  assert(body.retentionDays===60&&body.allowedSymbols?.length===16&&body.management?.timeFifoActive===true,'MT5 cache status contract failed');
  return {bars:body.totalBars,chunks:body.totalChunks,health:body.databaseHealth?.state};
});

await check('mt5-current-query',async()=>{
  const body=(await request(`${mt5}/api/mt5/prices?symbol=EURUSD&timeframe=M1&limit=10`)).body;
  assert(Array.isArray(body.bars),'MT5 current query missing bars array');
  return {count:body.count,newestMs:body.newestMs};
});

await check('mt5-range-query',async()=>{
  const to=Date.now();
  const from=to-86_400_000;
  const body=(await request(`${mt5}/api/mt5/prices?symbol=EURUSD&timeframe=M1&limit=2000&from=${from}&to=${to}`)).body;
  assert(Array.isArray(body.bars),'MT5 range query missing bars array');
  return {count:body.count,oldestMs:body.oldestMs,newestMs:body.newestMs};
});

await check('mt5-future-reversed-normalization',async()=>{
  const now=Date.now();
  const body=(await request(`${mt5}/api/mt5/prices?symbol=EURUSD&timeframe=M1&limit=10&from=${now+7_200_000}&to=${now+3_600_000}`)).body;
  assert(Array.isArray(body.bars),'MT5 normalized future range missing bars array');
  return {count:body.count};
});

await check('mt5-smc',async()=>{
  const body=(await request(`${mt5}/api/mt5/smc-snapshot`)).body;
  assert(body.canonicalTimeframe==='M1'&&body.methodology==='canonical-mt5-m1-reconstructed-multi-timeframe-smc','SMC contract failed');
  return body.counts;
});

const passed=checks.every(check=>check.passed);
const report={
  schema:'fxga.production.audit.v3',
  passed,
  generatedAt:new Date().toISOString(),
  site,
  release:build?.release??null,
  releaseCommit:build?.commit??null,
  backend:backend||null,
  mt5:mt5||null,
  summary:{passed:checks.filter(check=>check.passed).length,failed:checks.filter(check=>!check.passed).length,total:checks.length},
  checks,
};

fs.mkdirSync('runtime',{recursive:true});
fs.writeFileSync('runtime/production-audit.json',JSON.stringify(report,null,2)+'\n');
console.table(checks.map(check=>({check:check.name,status:check.passed?'PASS':'FAIL',ms:check.durationMs,error:check.error||''})));
if(!passed)process.exitCode=1;
