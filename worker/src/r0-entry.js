import coreWorker from './index.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...headers,
  },
});

const now = () => new Date().toISOString();
const finite = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, min = -100, max = 100) => Math.max(min, Math.min(max, finite(value, 0)));
const list = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

async function readState(env, name) {
  const row = await env.DB.prepare('SELECT payload, updated_at FROM state_snapshots WHERE name = ?').bind(name).first();
  if (!row) return { value: null, updatedAt: null };
  try { return { value: JSON.parse(row.payload), updatedAt: row.updated_at || null }; }
  catch { return { value: null, updatedAt: row.updated_at || null }; }
}

function latestIso(...values) {
  const times = values.flat().filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : now();
}

const FRED_GROUPS = {
  inflation: new Set(['CPIAUCSL','CPILFESL','PCEPI','PCEPILFE','PPIACO','T5YIE','T10YIE']),
  growth: new Set(['GDPC1','GDP','INDPRO','RSAFS','PCE','DSPIC96','HOUST','PERMIT']),
  labour: new Set(['PAYEMS','UNRATE','ICSA','CCSA','JTSJOL','CES0500000003','CIVPART','EMRATIO']),
  rates: new Set(['FEDFUNDS','DFF','DGS2','DGS5','DGS10','DGS30','T10Y2Y','T10Y3M']),
  financial: new Set(['NFCI','STLFSI4','WALCL','M2SL','BOGMBASE','TOTRESNS','BAMLH0A0HYM2']),
};

function fredCategory(seriesId) {
  for (const [category, ids] of Object.entries(FRED_GROUPS)) if (ids.has(seriesId)) return category;
  if (/CPI|PCEPI|INFL|PPI/i.test(seriesId)) return 'inflation';
  if (/UNRATE|PAYEMS|CLAIMS|ICSA|JTS|WAGE|EARN/i.test(seriesId)) return 'labour';
  if (/DGS|FEDFUNDS|DFF|YIELD|T10Y/i.test(seriesId)) return 'rates';
  if (/GDP|INDPRO|RSAFS|HOUST|PERMIT|PCE/i.test(seriesId)) return 'growth';
  return 'other';
}

function macroRows(macroState) {
  const macro = object(macroState?.value);
  const rows = [];
  for (const [seriesId, raw] of Object.entries(object(macro.series))) {
    const item = object(raw);
    if (item.ok === false) continue;
    const latest = object(item.latest);
    const previous = object(item.previous);
    const latestValue = finite(latest.value);
    const previousValue = finite(previous.value);
    const history = [];
    if (previous.date && previousValue !== null) history.push({date:String(previous.date), value:previousValue});
    if (latest.date && latestValue !== null) history.push({date:String(latest.date), value:latestValue});
    rows.push({
      seriesId,
      title: String(item.title || seriesId),
      value: latestValue,
      date: latest.date ? String(latest.date) : null,
      previous: previousValue,
      change: finite(item.change),
      changePercent: finite(item.changePercent),
      units: String(item.units || ''),
      frequency: String(item.frequency || ''),
      categories: [fredCategory(seriesId)],
      lastUpdated: macro.generatedAt || macroState?.updatedAt || null,
      history,
      source: String(item.source || 'Federal Reserve Bank of St. Louis FRED'),
      seriesUrl: String(item.sourceUrl || `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}`),
    });
  }
  return rows.sort((a,b) => a.seriesId.localeCompare(b.seriesId));
}

function marketRows(marketState) {
  const market = object(marketState?.value);
  const all = [...list(market.canonicalFx), ...list(market.contextAssets), ...list(market.microstructureAssets)];
  const seen = new Set();
  return all.filter((row) => {
    const key = String(row?.id || row?.symbol || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((row) => ({...row, id:String(row.id || row.symbol), symbol:String(row.symbol || row.id), label:String(row.label || row.symbol || row.id)}));
}

function extractCalendar(calendarState) {
  const value = calendarState?.value;
  if (Array.isArray(value)) return value;
  const data = object(value);
  return list(data.events).length ? list(data.events) : list(data.calendar).length ? list(data.calendar) : list(data.data);
}

function extractNews(researchState) {
  const value = object(researchState?.value);
  return list(value.news).filter((row) => row && typeof row === 'object');
}

function dashboardSources(macroState, marketState) {
  const macro = object(macroState?.value);
  const market = object(marketState?.value);
  const sources = [];
  if (macroState?.value) {
    sources.push({
      id:'fred', name:'FRED', category:'macro', region:'US',
      status: finite(macro.healthy, 0) > 0 ? 'live' : 'error',
      note:`${finite(macro.healthy,0)} of ${finite(macro.requested,0)} requested series healthy in the latest R0 snapshot.`,
    });
  }
  for (const [id, raw] of Object.entries(object(market.sources))) {
    const source = object(raw);
    if (source.skipped === true && source.ok !== true) continue;
    sources.push({
      id,
      name:String(source.provider || id),
      category:'market',
      region:'global',
      status:source.ok === true ? 'live' : source.configured === false ? 'needs_key' : 'error',
      note:String(source.reason || (source.ok === true ? 'Healthy in latest R0 collection.' : 'Provider unavailable in latest R0 collection.')),
    });
  }
  if (!sources.length) sources.push({id:'cloudflare-d1',name:'Cloudflare D1 snapshot store',category:'runtime',region:'global',status:'live',note:'Runtime is available; scheduled data has not populated yet.'});
  return sources;
}

function dashboardErrors(macroState, marketState) {
  const macro = object(macroState?.value);
  const market = object(marketState?.value);
  const errors = list(macro.failures).slice(0,20).map((failure) => ({
    provider:'FRED', message:`${String(failure?.seriesId || 'series')}: ${String(failure?.error || failure?.message || 'collection failed')}`,
  }));
  for (const [id, raw] of Object.entries(object(market.sources))) {
    const source = object(raw);
    if (source.ok === true || source.skipped === true || source.configured === false) continue;
    errors.push({provider:id,message:String(source.reason || source.error || 'market provider unavailable')});
  }
  return errors.slice(0,30);
}

function deltaScore(row, invert = false) {
  let pct = finite(row?.changePercent);
  if (pct === null && finite(row?.change) !== null) pct = finite(row.change);
  if (pct === null) return 0;
  const score = clamp(pct * 12, -40, 40);
  return invert ? -score : score;
}

function dimensionFrom(rows, id, label, ids, invertIds = new Set()) {
  const selected = rows.filter((row) => ids.has(row.seriesId));
  const contributors = selected.map((row) => ({
    seriesId:row.seriesId,
    title:row.title,
    score:deltaScore(row, invertIds.has(row.seriesId)),
  }));
  const score = contributors.length ? clamp(contributors.reduce((sum,row) => sum + row.score,0) / contributors.length) : 0;
  return {
    id,label,
    description:`Deterministic direction score from ${selected.length} persisted FRED series in D1; no unstored values are inferred.`,
    score,
    direction:score > 4 ? 'positive' : score < -4 ? 'negative' : 'neutral',
    coverage:`${selected.length} observed series`,
    contributors,
  };
}

function buildAnalysis(macroState) {
  const stored = object(macroState?.value?.analysis);
  if (Array.isArray(stored.dimensions) && stored.regime && stored.policy) return stored;
  const rows = macroRows(macroState);
  const growth = dimensionFrom(rows,'growth','Growth',FRED_GROUPS.growth);
  const inflation = dimensionFrom(rows,'inflation','Inflation',FRED_GROUPS.inflation);
  const labour = dimensionFrom(rows,'labour','Jobs & wages',FRED_GROUPS.labour,new Set(['UNRATE','ICSA','CCSA']));
  const financial = dimensionFrom(rows,'financial','Financial conditions',FRED_GROUPS.financial,new Set(['NFCI','STLFSI4','BAMLH0A0HYM2']));
  const policy = dimensionFrom(rows,'policy','Policy & rates',FRED_GROUPS.rates);
  const fed = rows.find((row) => row.seriesId === 'DFF') || rows.find((row) => row.seriesId === 'FEDFUNDS');
  const ratesMomentum = deltaScore(fed || {});
  const growthScore = clamp((growth.score * 0.65) + (labour.score * 0.35));
  const inflationScore = inflation.score;
  const recessionRisk = clamp(50 - growthScore * 0.75 - labour.score * 0.35, 0, 100);
  let name = 'Mixed / neutral';
  if (growthScore > 8 && inflationScore <= 8) name = 'Growth resilient / inflation contained';
  else if (growthScore > 8 && inflationScore > 8) name = 'Firm growth / sticky inflation';
  else if (growthScore < -8 && inflationScore > 8) name = 'Stagflation-like pressure';
  else if (growthScore < -8 && inflationScore <= 8) name = 'Growth slowdown / disinflation';
  const stance = ratesMomentum > 4 ? 'Rates moving higher / restrictive impulse' : ratesMomentum < -4 ? 'Rates moving lower / easing impulse' : 'Rates broadly stable / mixed policy impulse';
  const requested = finite(macroState?.value?.requested, rows.length) || rows.length;
  const observed = rows.length;
  const confidence = clamp(requested ? (observed / requested) * 100 : 0, 0, 100);
  const topSignals = rows
    .map((row) => ({seriesId:row.seriesId,title:row.title,score:deltaScore(row),value:row.value,date:row.date}))
    .sort((a,b) => Math.abs(b.score)-Math.abs(a.score)).slice(0,8);
  return {
    generatedAt:String(macroState?.value?.generatedAt || macroState?.updatedAt || now()),
    regime:{name,growthScore,inflationScore,recessionRisk,summary:`${name}. This compatibility regime is calculated only from persisted FRED changes and is not a forecast or profitability claim.`},
    dimensions:[growth,inflation,labour,policy,financial],
    policy:{fedReactionScore:policy.score,stance,ratesMomentum},
    assets:[],
    confidence,
    coverage:{observed,requested},
    topSignals,
    methodology:{
      scoreRange:'-100 to +100 bounded directional change score',
      principle:'R0 compatibility analytics use only persisted Cloudflare D1/FRED evidence.',
      caution:'This deterministic compatibility layer restores the dashboard contract; missing observations, forecasts and trade signals are never fabricated.',
    },
  };
}

function minutesOfDay(date = new Date()) { return date.getUTCHours() * 60 + date.getUTCMinutes(); }
function windowActive(minute, start, end) { return start <= end ? minute >= start && minute < end : minute >= start || minute < end; }
function minutesUntilStart(minute, start) { return (start - minute + 1440) % 1440; }
function buildSessions(calendar, analysis, storedSignals) {
  if (Array.isArray(storedSignals?.sessions)) return storedSignals;
  const current = new Date();
  const minute = minutesOfDay(current);
  const templates = [
    ['sydney','Sydney','21:00–06:00 UTC',1260,360,['AUD','NZD']],
    ['tokyo','Tokyo','00:00–09:00 UTC',0,540,['JPY','AUD','NZD']],
    ['london','London','07:00–16:00 UTC',420,960,['GBP','EUR','CHF']],
    ['new-york','New York','12:00–21:00 UTC',720,1260,['USD','CAD']],
    ['overlap','London / New York overlap','12:00–16:00 UTC',720,960,['USD','EUR','GBP']],
  ];
  const upcomingEvents = calendar
    .filter((event) => Number.isFinite(Date.parse(event?.date)) && Date.parse(event.date) >= Date.now()-5*60_000)
    .sort((a,b) => Date.parse(a.date)-Date.parse(b.date));
  const catalyst = upcomingEvents[0];
  const sessions = templates.map(([id,label,windowUtc,start,end,focusCurrencies]) => {
    const active = windowActive(minute,start,end);
    const until = minutesUntilStart(minute,start);
    const state = active ? 'active' : until <= 360 ? 'upcoming' : 'closed';
    const eventSoon = catalyst && Date.parse(catalyst.date)-Date.now() <= 45*60_000;
    return {
      id,label,windowUtc,active,state,
      risk:eventSoon ? 'event-lockout' : 'normal',
      focusCurrencies,
      nextCatalyst:catalyst ? `${String(catalyst.currency || '')} ${String(catalyst.event || 'scheduled event')}`.trim() : 'No high-impact catalyst loaded in the persisted R0 calendar.',
      eventCount:upcomingEvents.length,
      signals:[],
    };
  });
  return {
    generatedAt:now(),
    methodology:'R0 session clock + persisted calendar/technical evidence. No trade direction is created without a stored signal.',
    caution:'No fabricated BUY/SELL signals. Empty signals mean WAIT for confirmed evidence.',
    macroRegime:String(analysis.regime?.name || 'Mixed / unavailable'),
    macroConfidence:finite(analysis.confidence,0),
    sessions,
    technicalGeneratedAt:null,
  };
}

function buildTechnical(marketState, technicalState) {
  const stored = object(technicalState?.value);
  if (stored.assets && stored.counts) return stored;
  const rows = marketRows(marketState);
  const assets = {};
  for (const row of rows) {
    assets[row.id] = {
      id:row.id,label:row.label,symbol:row.symbol,synthetic:false,updatedAt:String(stored.generatedAt || marketState?.value?.generatedAt || now()),lastPrice:finite(row.price),
      timeframes:{},models:{},
      decisionGate:{status:'unavailable',direction:'neutral',confidence:0,model:null,reason:'R0 price snapshot is live, but historical bars required for technical confirmation are not persisted in this snapshot.'},
    };
  }
  return {
    generatedAt:String(stored.generatedAt || marketState?.value?.generatedAt || now()),
    methodology:'R0 compatibility snapshot: live persisted prices are exposed; technical confirmation stays unavailable until historical bars are persisted.',
    sequence:[],hierarchy:[],sourcePolicy:'Cloudflare D1 persisted free-market snapshot; no synthetic historical bars.',
    counts:{assets:rows.length,confirmed:0,contextAligned:0,conflict:0,warming:rows.length},
    assets,
  };
}

function buildDataQuality(macroState, marketState, calendarState) {
  const macro = object(macroState?.value);
  const market = object(marketState?.value);
  const marketAssets = marketRows(marketState);
  const failures = list(macro.failures);
  const requested = finite(macro.requested,0);
  const healthy = finite(macro.healthy, macroRows(macroState).length);
  return {
    generatedAt:latestIso(macro.generatedAt,market.generatedAt,macroState?.updatedAt,marketState?.updatedAt),
    macro:{
      coverage:{requested,liveFetched:healthy,retainedLastKnownGood:0,usableObservations:healthy,unresolved:failures.length,liveCoveragePercent:requested ? healthy/requested*100 : null,effectiveCoveragePercent:requested ? healthy/requested*100 : null,status:requested && healthy/requested >= .8 ? 'strong' : healthy ? 'acceptable' : 'unknown'},
      failures:{total:failures.length,retryable:failures.length,nonRetryable:0,unresolved:failures.length,byType:{},byEconomy:{},byCategory:{},series:failures.map((failure) => ({seriesId:String(failure?.seriesId||''),title:String(failure?.seriesId||''),economy:'US',category:fredCategory(String(failure?.seriesId||'')),type:'collector',retryable:true})).slice(0,100)},
    },
    market:{assets:marketAssets.length,priced:marketAssets.filter((row)=>finite(row.price)!==null).length,stale:marketAssets.filter((row)=>row.stale===true).length},
    technical:{assets:marketAssets.length,confirmed:0,warming:marketAssets.length},
    calendar:{events:extractCalendar(calendarState).length,sourceHealth:{}},
    publicPolicy:String(market.policy || 'R0 free/public providers via GitHub Actions; Cloudflare D1 persistence; Firestore disabled.'),
    budget:market.budget || null,
    architecture:'cloudflare-r0',
  };
}

function fredCatalog(rows) {
  const labels = {inflation:'Inflation',growth:'Growth & activity',labour:'Labour market',rates:'Rates & yield curve',financial:'Financial conditions',other:'Other macro series'};
  const counts = {};
  for (const row of rows) for (const category of row.categories) counts[category] = (counts[category] || 0) + 1;
  const categories = Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0])).map(([id,count]) => ({id,label:labels[id] || id,description:`Persisted FRED series classified under ${labels[id] || id}.`,count}));
  return {
    total:rows.length,
    maxSeriesPerRequest:Math.max(1,Math.min(100,rows.length || 100)),
    categories,
    series:rows.map((row) => ({id:row.seriesId,title:row.title,units:row.units,frequency:row.frequency,categories:row.categories})),
    policy:{importantOnly:false,scope:'Series currently persisted by the R0 FRED collector.'},
  };
}

function buildEconomyAnalysis(macroState, analysis) {
  const rows = macroRows(macroState);
  const dimensions = analysis.dimensions.map((row) => ({id:row.id,label:row.label,score:row.score,coverage:row.contributors.length,contributors:row.contributors.map((item)=>({...item,category:row.id}))}));
  return {
    generatedAt:analysis.generatedAt,
    methodology:'R0 D1/FRED compatibility economy analysis; United States is populated from the current FRED collector universe.',
    minimumCoverageNote:'Only economies with persisted R0 evidence are reported; missing economies are not fabricated.',
    collectorMode:'github-actions-r0-fred',
    observationCount:rows.length,
    economies:[{
      id:'US',label:'United States',currency:'USD',centralBank:'Federal Reserve',observationCount:rows.length,confidence:analysis.confidence,coverageRatio:analysis.coverage.requested ? analysis.coverage.observed/analysis.coverage.requested : 0,reportStatus:rows.length?'partial':'unavailable',missingDimensions:[],
      regime:analysis.regime.name,policyStance:analysis.policy.stance,currencyBias:'neutral',currencyScore:0,dimensions,topSignals:analysis.topSignals,summary:analysis.regime.summary,source:'FRED via Cloudflare D1',sourcePolicy:'Persisted R0 evidence only',generatedAt:analysis.generatedAt,
    }],
  };
}

function buildGlobalMacro(macroState) {
  const rows = macroRows(macroState);
  const requested = finite(macroState?.value?.requested,rows.length) || rows.length;
  return {
    generatedAt:String(macroState?.value?.generatedAt || macroState?.updatedAt || now()),mode:'r0-fred',targetEconomies:['US'],totalObservations:rows.length,counts:{US:rows.length},economies:{US:rows},global:[],
    coverage:{requested,usableObservations:rows.length,effectiveCoveragePercent:requested?rows.length/requested*100:0,liveCoveragePercent:requested?rows.length/requested*100:0,boundedPercentages:true},
    policy:{canonicalEconomyAuthority:'FRED R0 collector',hardCodedPublicEconomyList:false,missingData:'not fabricated'},
  };
}

function buildAcquisitionCatalog() {
  const methods = [
    {id:'github-actions',label:'GitHub Actions collector',description:'Scheduled free-provider collection writes normalized snapshots into Cloudflare D1.',cost:'low'},
    {id:'mt5-ingress',label:'MT5 authenticated ingress',description:'Authenticated MT5 batches can write market evidence into the R0 Worker.',cost:'low'},
  ];
  const sources = [
    {id:'fred',name:'FRED',url:'https://fred.stlouisfed.org/',category:'macro',region:'US',methods:['github-actions'],cacheTtlSeconds:3600,minIntervalSeconds:3600,allowBrowser:false,official:true},
    {id:'r0-market',name:'R0 free market providers',url:'',category:'market',region:'global',methods:['github-actions'],cacheTtlSeconds:900,minIntervalSeconds:900,allowBrowser:false,official:false},
    {id:'mt5',name:'MT5 ingress',url:'',category:'market',region:'global',methods:['mt5-ingress'],cacheTtlSeconds:0,minIntervalSeconds:0,allowBrowser:false,official:false},
  ];
  return {
    methods,sources,
    status:{websocketClients:0,inFlightSources:0,browserBudget:{dayUtc:now().slice(0,10),usedSeconds:0,softLimitSeconds:0,remainingSeconds:0,browserSessionReuse:false,reason:'Browser acquisition is disabled in strict R0 mode.',nextLaunchAllowedAt:null},sources:sources.length},
    limits:{externalSubrequestsPerInvocation:0,simultaneousOutgoingConnections:0,browserSoftBudgetSecondsPerUtcDay:0,browserConcurrentJobsInFxga:0,minBrowserLaunchGapSeconds:0},
    policy:{cloudflareR0:true,scheduleDriven:true,browserDisabled:true,firestoreDisabled:true,r2Disabled:true},
  };
}

function emptyEventStudies(url) {
  const days = Math.max(1,finite(url.searchParams.get('days'),60));
  const currency = url.searchParams.get('currency') || null;
  return {generatedAt:null,days,currency,source:'cloudflare-d1',priceUniverse:[],preNewsWindows:[],horizons:[],summary:{studies:0,measuredHorizons:0,assetMeasurements:0,byHorizon:{}},studies:[]};
}

async function handleCompatibility(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type,authorization,x-fxga-webhook-secret'}});

  if (path === '/api/live') {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({error:'websocket_upgrade_required',architecture:'cloudflare-r0'},426);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.send(JSON.stringify({type:'data-update',sourceId:'cloudflare-r0',timestamp:now()}));
    server.addEventListener('message', () => {
      try { server.send(JSON.stringify({type:'data-update',sourceId:'cloudflare-r0',timestamp:now()})); } catch {}
    });
    return new Response(null,{status:101,webSocket:client});
  }

  if (request.method !== 'GET') return null;

  if (path === '/api/dashboard') {
    const [macro,market,calendar,research] = await Promise.all(['macro','market','calendar','research'].map((name)=>readState(env,name)));
    return json({
      generatedAt:latestIso(macro.value?.generatedAt,market.value?.generatedAt,calendar.value?.generatedAt,macro.updatedAt,market.updatedAt),
      macro:macroRows(macro),market:marketRows(market),calendar:extractCalendar(calendar),news:extractNews(research),sources:dashboardSources(macro,market),errors:dashboardErrors(macro,market),
      _r0:{architecture:'cloudflare-r0',database:'Cloudflare D1 Free',googleCloudRuntime:false},
    });
  }

  if (path === '/api/analysis') {
    const macro = await readState(env,'macro');
    return json(buildAnalysis(macro));
  }

  if (path === '/api/session-signals') {
    const [macro,calendar,signals] = await Promise.all(['macro','calendar','signals'].map((name)=>readState(env,name)));
    return json(buildSessions(extractCalendar(calendar),buildAnalysis(macro),signals.value));
  }

  if (path === '/api/fred/catalog' || path === '/api/fred') {
    const macro = await readState(env,'macro');
    const rows = macroRows(macro);
    if (path === '/api/fred/catalog') return json(fredCatalog(rows));
    const category = url.searchParams.get('category') || '';
    const limit = Math.max(1,Math.min(100,finite(url.searchParams.get('limit'),16)));
    const filtered = category ? rows.filter((row)=>row.categories.includes(category)) : rows;
    return json({generatedAt:String(macro.value?.generatedAt || macro.updatedAt || now()),category:category || null,total:filtered.length,series:filtered.slice(0,limit)});
  }

  if (path === '/api/economy-analysis') {
    const macro = await readState(env,'macro');
    const analysis = buildAnalysis(macro);
    return json(buildEconomyAnalysis(macro,analysis));
  }

  if (path === '/api/global-macro') {
    const macro = await readState(env,'macro');
    return json(buildGlobalMacro(macro));
  }

  if (path === '/api/release-impact') {
    const [macro,release] = await Promise.all([readState(env,'macro'),readState(env,'release-impact')]);
    if (release.value?.assets && Array.isArray(release.value.assets)) return json(release.value);
    const analysis = buildAnalysis(macro);
    return json({generatedAt:analysis.generatedAt,regime:analysis.regime.name,methodology:'No R0 release-impact snapshot is persisted. Empty contributor/asset arrays are returned instead of fabricated release effects.',contributors:[],assets:[]});
  }

  if (path === '/api/technical') {
    const [market,technical] = await Promise.all([readState(env,'market'),readState(env,'technical')]);
    return json(buildTechnical(market,technical));
  }

  if (path === '/api/technical-history') {
    const asset = url.searchParams.get('asset') || '';
    const timeframe = url.searchParams.get('timeframe') || '';
    const technical = await readState(env,'technical');
    const stored = object(technical.value);
    const candidate = object(object(object(stored.assets)[asset]).timeframes)[timeframe];
    if (candidate?.history && Array.isArray(candidate.history)) return json({generatedAt:stored.generatedAt || technical.updatedAt,asset,timeframe,bias:candidate.bias || 'neutral',quality:candidate.quality || {grade:'unavailable',score:0,averageSamples:0,providerOhlc:false},history:candidate.history});
    return json({generatedAt:stored.generatedAt || technical.updatedAt || null,asset,timeframe,bias:'neutral',quality:{grade:'unavailable',score:0,averageSamples:0,providerOhlc:false},history:[]});
  }

  if (path === '/api/data-quality') {
    const [macro,market,calendar] = await Promise.all(['macro','market','calendar'].map((name)=>readState(env,name)));
    return json(buildDataQuality(macro,market,calendar));
  }

  if (path === '/api/event-studies') {
    const state = await readState(env,'event-studies');
    if (Array.isArray(state.value?.studies) && state.value?.summary) return json(state.value);
    return json(emptyEventStudies(url));
  }

  if (path === '/api/event-pattern-backtests') {
    const state = await readState(env,'event-pattern-backtests');
    if (Array.isArray(state.value?.tests)) return json(state.value);
    return json({generatedAt:null,generation:'r0-empty',summary:{schema:'fxga.event-pattern-backtests.v1',generatedAt:null,methodology:'No R0 event-pattern backtest snapshot has been ingested.',totalObservations:0,tests:0,validatedCandidates:0,assumptions:{}},tests:[],policy:{validatedCandidateIsNotProfitabilityGuarantee:true,outOfSample:true,fdrControlled:true,costsApplied:true}});
  }

  if (path === '/api/event-study-sources') {
    const names = ['calendar','event-studies','macro','market'];
    const states = await Promise.all(names.map((name)=>readState(env,name)));
    return json({generatedAt:latestIso(...states.map((state)=>state.updatedAt)),architecture:'cloudflare-r0',sources:names.map((name,index)=>({id:name,available:Boolean(states[index].value),updatedAt:states[index].updatedAt,source:'cloudflare-d1'}))});
  }

  if (path === '/api/acquisition/catalog') return json(buildAcquisitionCatalog());

  if (path === '/api/acquire') {
    const sourceId = url.searchParams.get('source') || 'unknown';
    const catalog = buildAcquisitionCatalog();
    const source = catalog.sources.find((item)=>item.id===sourceId);
    return json({
      sourceId,sourceName:source?.name || sourceId,sourceUrl:source?.url || '',finalUrl:source?.url || '',fetchedAt:now(),contentType:'application/json',official:Boolean(source?.official),methodsAvailable:source?.methods || [],methodsUsed:[],browserUsed:false,changed:false,
      warnings:['Strict R0 acquisition is schedule-driven. This request does not launch paid or browser infrastructure; use the scheduled GitHub collector or authenticated MT5 ingress.'],title:'R0 acquisition status',text:'No on-demand external acquisition was executed.',extraction:{textCharacters:0,links:0,embeddedPayloads:0,dataAttributes:0,tables:0},
    });
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const compatibility = await handleCompatibility(request, env);
      if (compatibility) return compatibility;
      return coreWorker.fetch(request, env, ctx);
    } catch (error) {
      return json({error:'r0_compatibility_error',message:String(error?.message || error),architecture:'cloudflare-r0'},500);
    }
  },
};
