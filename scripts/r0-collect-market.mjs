const apiBase = String(process.env.FXGA_API_BASE || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/+$/, '');
const token = String(process.env.FXGA_INGEST_TOKEN || process.env.FXGA_MT5_REPORT_SECRET || '').trim();

if (!token) {
  throw new Error('FXGA_INGEST_TOKEN or FXGA_MT5_REPORT_SECRET is required for the R0 collector. Add one under repository Actions secrets.');
}

const FX_PAIRS = [
  { id:'EURUSD', twelve:'EUR/USD', label:'EUR / U.S. Dollar' },
  { id:'GBPUSD', twelve:'GBP/USD', label:'GBP / U.S. Dollar' },
  { id:'USDJPY', twelve:'USD/JPY', label:'U.S. Dollar / Japanese Yen' },
  { id:'USDZAR', twelve:'USD/ZAR', label:'U.S. Dollar / South African Rand' },
];

const RISK_PROXIES = [
  { symbol:'SPY', id:'SPY_ETF', label:'SPDR S&P 500 ETF Trust', assetClass:'equity-etf' },
  { symbol:'QQQ', id:'QQQ_ETF', label:'Invesco QQQ Trust', assetClass:'equity-etf' },
  { symbol:'GLD', id:'GLD_ETF', label:'SPDR Gold Shares', assetClass:'commodity-etf' },
  { symbol:'TLT', id:'TLT_ETF', label:'iShares 20+ Year Treasury Bond ETF', assetClass:'rates-etf' },
  { symbol:'UUP', id:'UUP_ETF', label:'Invesco DB US Dollar Index Bullish Fund', assetClass:'fx-etf' },
];

const COINBASE_PRODUCTS = [
  { symbol:'BTC-USD', id:'BTCUSD_SPOT', label:'Bitcoin / U.S. Dollar spot' },
  { symbol:'ETH-USD', id:'ETHUSD_SPOT', label:'Ether / U.S. Dollar spot' },
];

const finite = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g,'').replace(/%/g,'').trim());
  return Number.isFinite(number) ? number : null;
};

const isoFromUnix = (value) => {
  const n = finite(value);
  if (n == null) return null;
  const date = new Date(n > 10_000_000_000 ? n : n * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

function normalizeAsset({id,label,symbol,assetClass,price,change=null,changePercent=null,open=null,high=null,low=null,previousClose=null,volume=null,bid=null,ask=null,bidSize=null,askSize=null,source,sourceUrl,providerTimestamp=null,mode,metadata={}}) {
  const p = finite(price);
  const pc = finite(previousClose);
  const computedChange = finite(change) ?? (p != null && pc != null ? p - pc : null);
  const computedPct = finite(changePercent) ?? (p != null && pc != null && Math.abs(pc) > 1e-12 ? ((p - pc) / pc) * 100 : null);
  return {
    id,label,symbol,assetClass,price:p,change:computedChange,changePercent:computedPct,
    open:finite(open),high:finite(high),low:finite(low),previousClose:pc,volume:finite(volume),
    bid:finite(bid),ask:finite(ask),bidSize:finite(bidSize),askSize:finite(askSize),
    source,sourceUrl,fetchedAt:new Date().toISOString(),providerTimestamp,mode,stale:false,metadata,
  };
}

async function fetchJson(provider, url, {timeoutMs=8000,maxBytes=800_000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers:{Accept:'application/json','User-Agent':'FXGA-R0-Free-Market-Collector/2.0'},
      signal:controller.signal,
      redirect:'follow',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) return {ok:false,provider,status:response.status,error:'response-too-large',bytes:bytes.length,durationMs:Date.now()-started};
    const text = bytes.toString('utf8');
    if (!response.ok) return {ok:false,provider,status:response.status,error:text.slice(0,220),bytes:bytes.length,durationMs:Date.now()-started};
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { return {ok:false,provider,status:response.status,error:'invalid-json',bytes:bytes.length,durationMs:Date.now()-started}; }
    return {ok:true,provider,status:response.status,data,bytes:bytes.length,durationMs:Date.now()-started};
  } catch (error) {
    return {ok:false,provider,status:null,error:String(error?.message || error).slice(0,220),bytes:0,durationMs:Date.now()-started};
  } finally {
    clearTimeout(timer);
  }
}

function sourceSummary(result, extra={}) {
  return {provider:result.provider,ok:Boolean(result.ok),status:result.status ?? null,bytes:Number(result.bytes || 0),durationMs:Number(result.durationMs || 0),reason:result.ok ? null : (result.error || 'request-failed'),...extra};
}

async function collectTwelveData() {
  const key = String(process.env.TWELVE_DATA_API_KEY || '').trim();
  if (!key) return {assets:[],source:{provider:'twelve_data',ok:false,skipped:true,reason:'credential-not-configured'}};
  const url = new URL('https://api.twelvedata.com/quote');
  url.searchParams.set('symbol', FX_PAIRS.map((pair)=>pair.twelve).join(','));
  url.searchParams.set('apikey', key);
  const result = await fetchJson('twelve_data', url, {maxBytes:512_000});
  if (!result.ok) return {assets:[],source:sourceSummary(result)};
  const payload = result.data || {};
  const assets = [];
  for (const pair of FX_PAIRS) {
    const row = payload[pair.twelve] || payload[pair.id] || (payload.symbol === pair.twelve ? payload : null);
    if (!row || typeof row !== 'object') continue;
    const price = finite(row.close ?? row.price);
    if (price == null) continue;
    assets.push(normalizeAsset({
      id:pair.id,label:pair.label,symbol:pair.id,assetClass:'fx',price,
      open:row.open,high:row.high,low:row.low,previousClose:row.previous_close,
      change:row.change,changePercent:row.percent_change,volume:row.volume,
      source:'Twelve Data',sourceUrl:'https://api.twelvedata.com/quote',providerTimestamp:isoFromUnix(row.timestamp),
      mode:'rest-free-primary-fx',metadata:{quotaClass:'conservative-r0',canonical:true,scheduledCadenceMinutes:15},
    }));
  }
  return {assets,source:sourceSummary(result,{usable:assets.length,requested:FX_PAIRS.length})};
}

async function collectFinnhub() {
  const key = String(process.env.FINNHUB_API_KEY || '').trim();
  if (!key) return {assets:[],source:{provider:'finnhub',ok:false,skipped:true,reason:'credential-not-configured'}};
  const rows = await Promise.all(RISK_PROXIES.map(async (item) => {
    const url = new URL('https://finnhub.io/api/v1/quote');
    url.searchParams.set('symbol', item.symbol);
    url.searchParams.set('token', key);
    const result = await fetchJson('finnhub', url, {timeoutMs:7000,maxBytes:128_000});
    const row = result.data || {};
    const asset = result.ok && finite(row.c) != null ? normalizeAsset({
      id:item.id,label:item.label,symbol:item.symbol,assetClass:item.assetClass,price:row.c,
      change:row.d,changePercent:row.dp,open:row.o,high:row.h,low:row.l,previousClose:row.pc,
      source:'Finnhub',sourceUrl:'https://finnhub.io/api/v1/quote',providerTimestamp:isoFromUnix(row.t),
      mode:'rest-free-risk-proxy',metadata:{quotaClass:'conservative-r0',canonical:false,scheduledCadenceMinutes:15},
    }) : null;
    return {item,result,asset};
  }));
  const assets = rows.map((row)=>row.asset).filter(Boolean);
  return {
    assets,
    source:{provider:'finnhub',ok:assets.length>0,usable:assets.length,attempts:rows.length,diagnostics:rows.map(({item,result})=>({symbol:item.symbol,ok:result.ok,status:result.status ?? null,reason:result.ok?null:result.error}))},
  };
}

function bookMetrics(levels=[]) {
  const rows = (Array.isArray(levels) ? levels : []).slice(0,20).map((row)=>({price:finite(row?.[0]),size:finite(row?.[1])})).filter((row)=>row.price != null && row.size != null);
  return {levels:rows.length,size:rows.reduce((sum,row)=>sum+row.size,0),notional:rows.reduce((sum,row)=>sum+row.size*row.price,0),top:rows[0] || null};
}

async function collectCoinbasePublic() {
  const rows = await Promise.all(COINBASE_PRODUCTS.map(async (item) => {
    const [ticker,book] = await Promise.all([
      fetchJson('coinbase_exchange', `https://api.exchange.coinbase.com/products/${item.symbol}/ticker`, {timeoutMs:6000,maxBytes:150_000}),
      fetchJson('coinbase_exchange', `https://api.exchange.coinbase.com/products/${item.symbol}/book?level=2`, {timeoutMs:6000,maxBytes:750_000}),
    ]);
    const bids = book.ok ? bookMetrics(book.data?.bids) : bookMetrics([]);
    const asks = book.ok ? bookMetrics(book.data?.asks) : bookMetrics([]);
    const bid = finite(ticker.data?.bid) ?? bids.top?.price ?? null;
    const ask = finite(ticker.data?.ask) ?? asks.top?.price ?? null;
    const price = finite(ticker.data?.price) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
    const asset = price == null ? null : normalizeAsset({
      id:item.id,label:item.label,symbol:item.symbol,assetClass:'crypto-spot',price,
      bid,ask,bidSize:bids.top?.size,askSize:asks.top?.size,volume:ticker.data?.volume,
      source:'Coinbase Exchange public',sourceUrl:`https://api.exchange.coinbase.com/products/${item.symbol}`,
      providerTimestamp:ticker.data?.time || null,mode:'public-l2-rest',
      metadata:{quotaClass:'high-capacity-public',book:{bid:bids,ask:asks,imbalance:(bids.size+asks.size)>0?(bids.size-asks.size)/(bids.size+asks.size):null}},
    });
    return {item,ticker,book,asset};
  }));
  const assets = rows.map((row)=>row.asset).filter(Boolean);
  return {
    assets,
    source:{provider:'coinbase_exchange',ok:assets.length>0,usable:assets.length,attempts:rows.length*2,diagnostics:rows.map(({item,ticker,book})=>({symbol:item.symbol,ticker:ticker.ok,book:book.ok,tickerStatus:ticker.status ?? null,bookStatus:book.status ?? null}))},
  };
}

async function writeState(name, payload) {
  const response = await fetch(`${apiBase}/api/internal/state/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'fxga-r0-github-actions-collector/2.0',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data?.ok !== true) {
    throw new Error(`D1 state write failed for ${name}: HTTP ${response.status} ${JSON.stringify(data).slice(0,800)}`);
  }
  return data;
}

const startedMs = Date.now();
const startedAt = new Date(startedMs).toISOString();
const [twelveResult,finnhubResult,coinbaseResult] = await Promise.allSettled([
  collectTwelveData(),
  collectFinnhub(),
  collectCoinbasePublic(),
]);

const unwrap = (result, provider) => result.status === 'fulfilled' ? result.value : {assets:[],source:{provider,ok:false,reason:String(result.reason?.message || result.reason).slice(0,220)}};
const twelve = unwrap(twelveResult,'twelve_data');
const finnhub = unwrap(finnhubResult,'finnhub');
const coinbase = unwrap(coinbaseResult,'coinbase_exchange');
const completedAt = new Date().toISOString();

const sources = {
  twelve_data:twelve.source,
  finnhub:finnhub.source,
  coinbase_exchange:coinbase.source,
  alpha_vantage:{provider:'alpha_vantage',ok:false,skipped:true,reason:'reserved-scarce-cross-check-not-scheduled-in-15m-r0-loop',configured:Boolean(String(process.env.ALPHA_VANTAGE_API_KEY || '').trim())},
  marketstack:{provider:'marketstack',ok:false,skipped:true,reason:'reserved-scarce-eod-not-scheduled-in-15m-r0-loop',configured:Boolean(String(process.env.MARKETSTACK_API_KEY || '').trim())},
  fmp:{provider:'fmp',ok:false,skipped:true,reason:'reserved-cross-check-not-required-for-r0-core-loop',configured:Boolean(String(process.env.FMP_API_KEY || '').trim())},
  nasdaq_data_link:{provider:'nasdaq_data_link',ok:false,skipped:true,reason:'historical-research-only-not-scheduled-in-r0-core-loop',configured:Boolean(String(process.env.NASDAQ_DATA_LINK_API_KEY || '').trim())},
};

const canonicalFx = twelve.assets || [];
const contextAssets = finnhub.assets || [];
const microstructureAssets = coinbase.assets || [];
const healthySources = Object.entries(sources).filter(([,source])=>source?.ok).map(([name])=>name);

const snapshot = {
  schema:'fxga.r0.market-data.v1',
  generatedAt:completedAt,
  architecture:'github-actions-cloudflare-d1-free-market-router-v1',
  policy:'R0 core loop uses a single batched FX request, conservative risk-proxy requests, and low-volume public exchange requests every 15 minutes. Scarce daily/monthly APIs are deliberately reserved instead of consumed by the core loop.',
  sources,
  canonicalFx,
  slowFxCrossChecks:[],
  contextAssets,
  microstructureAssets,
  publicMicrostructurePolicies:{coinbase_exchange:{scheduledCadenceMinutes:15,requestsPerRun:4,maxProducts:2}},
  budget:{
    mode:'deterministic-r0-schedule',
    firestore:false,
    d1UsageTrackingRequired:false,
    coreLoop:{twelveDataRequestsPerRun:1,finnhubRequestsPerRun:RISK_PROXIES.length,coinbaseRequestsPerRun:COINBASE_PRODUCTS.length*2,scheduledCadenceMinutes:15},
    scarceProvidersReserved:['alpha_vantage','marketstack','fmp','nasdaq_data_link'],
  },
  counts:{canonicalFx:canonicalFx.length,slowFxCrossChecks:0,contextAssets:contextAssets.length,microstructureAssets:microstructureAssets.length,providersHealthy:healthySources.length,providersConfigured:Object.values(sources).filter((source)=>source?.configured || source?.ok || source?.skipped===false).length},
  durationMs:Date.now()-startedMs,
  collector:'github-actions-r0',
  startedAt,
  completedAt,
};

const technical = {
  schema:'fxga.r0.technical-market-context.v1',
  generatedAt:completedAt,
  canonicalFx,
  slowFxCrossChecks:[],
  contextAssets,
  microstructureAssets,
  publicMicrostructurePolicies:snapshot.publicMicrostructurePolicies,
  sourceCount:Object.keys(sources).length,
  collector:'github-actions-r0',
};

const dataQuality = {
  schema:'fxga.r0.data-quality.v1',
  generatedAt:completedAt,
  architecture:snapshot.architecture,
  policy:snapshot.policy,
  counts:snapshot.counts,
  budget:snapshot.budget,
  sources,
  durationMs:snapshot.durationMs,
  collector:'github-actions-r0',
};

await Promise.all([
  writeState('market', snapshot),
  writeState('technical', technical),
  writeState('data-quality', dataQuality),
]);

console.log(JSON.stringify({
  ok:true,
  architecture:'github-actions-to-cloudflare-d1',
  generatedAt:completedAt,
  counts:snapshot.counts,
  healthySources,
  statesWritten:['market','technical','data-quality'],
  firestoreDependency:false,
}, null, 2));
