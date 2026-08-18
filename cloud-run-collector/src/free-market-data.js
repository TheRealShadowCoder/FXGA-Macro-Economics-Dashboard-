import { budgetedJson, freeTierBudgetStatus, freeTierPolicySummary } from './market-data-budget.js';

const FIFTEEN_MINUTES = 15 * 60_000;
const SIX_HOURS = 6 * 3_600_000;
const ONE_DAY = 24 * 3_600_000;

const FX_PAIRS = Object.freeze([
  { id:'EURUSD', base:'EUR', quote:'USD', twelve:'EUR/USD', label:'EUR / U.S. Dollar' },
  { id:'GBPUSD', base:'GBP', quote:'USD', twelve:'GBP/USD', label:'GBP / U.S. Dollar' },
  { id:'USDJPY', base:'USD', quote:'JPY', twelve:'USD/JPY', label:'U.S. Dollar / Japanese Yen' },
  { id:'USDZAR', base:'USD', quote:'ZAR', twelve:'USD/ZAR', label:'U.S. Dollar / South African Rand' },
]);

const US_PROXY_SYMBOLS = Object.freeze([
  { symbol:'SPY', id:'SPY_ETF', label:'SPDR S&P 500 ETF Trust', assetClass:'equity-etf' },
  { symbol:'QQQ', id:'QQQ_ETF', label:'Invesco QQQ Trust', assetClass:'equity-etf' },
  { symbol:'GLD', id:'GLD_ETF', label:'SPDR Gold Shares', assetClass:'commodity-etf' },
  { symbol:'TLT', id:'TLT_ETF', label:'iShares 20+ Year Treasury Bond ETF', assetClass:'rates-etf' },
  { symbol:'UUP', id:'UUP_ETF', label:'Invesco DB US Dollar Index Bullish Fund', assetClass:'fx-etf' },
]);

const CRYPTO_PERPS = Object.freeze([
  { symbol:'BTCUSDT', deribit:'BTC-PERPETUAL', id:'BTCUSD_PERP', label:'Bitcoin perpetual' },
  { symbol:'ETHUSDT', deribit:'ETH-PERPETUAL', id:'ETHUSD_PERP', label:'Ether perpetual' },
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finite = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g,'').replace(/%/g,'').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

function isoFromUnix(value) {
  const number = finite(value);
  if (number == null) return null;
  const millis = number > 10_000_000_000 ? number : number * 1000;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function percentChange(price, previousClose, provided = null) {
  if (finite(provided) != null) return finite(provided);
  const p = finite(price), previous = finite(previousClose);
  if (p == null || previous == null || Math.abs(previous) < 1e-12) return null;
  return ((p - previous) / previous) * 100;
}

function normalizeAsset({
  id,label,symbol,assetClass='unknown',price=null,change=null,changePercent=null,open=null,high=null,low=null,
  previousClose=null,volume=null,bid=null,ask=null,bidSize=null,askSize=null,openInterest=null,fundingRate=null,
  source,sourceUrl=null,fetchedAt=new Date().toISOString(),providerTimestamp=null,mode='api',stale=false,metadata={},
}) {
  const normalizedPrice = finite(price);
  const normalizedPrevious = finite(previousClose);
  const normalizedChange = finite(change) ?? (normalizedPrice != null && normalizedPrevious != null ? normalizedPrice - normalizedPrevious : null);
  return {
    id,label,symbol,assetClass,
    price:normalizedPrice,
    change:normalizedChange,
    changePercent:percentChange(normalizedPrice, normalizedPrevious, changePercent),
    open:finite(open),high:finite(high),low:finite(low),previousClose:normalizedPrevious,volume:finite(volume),
    bid:finite(bid),ask:finite(ask),bidSize:finite(bidSize),askSize:finite(askSize),
    openInterest:finite(openInterest),fundingRate:finite(fundingRate),
    source,sourceUrl,fetchedAt,providerTimestamp,mode,stale:Boolean(stale),metadata,
  };
}

function sourceResult(provider, result, extra = {}) {
  return {
    provider,
    ok:Boolean(result?.ok),
    skipped:Boolean(result?.skipped),
    reason:result?.reason || result?.error || null,
    status:result?.status ?? null,
    bytes:Number(result?.bytes || 0),
    ...extra,
  };
}

async function collectAlphaVantage() {
  const key = String(process.env.ALPHA_VANTAGE_API_KEY || '').trim();
  if (!key) return { assets:[], source:{provider:'alpha_vantage',ok:false,skipped:true,reason:'credential-not-configured'} };
  const assets = [], diagnostics = [];
  for (const pair of FX_PAIRS) {
    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function','CURRENCY_EXCHANGE_RATE');
    url.searchParams.set('from_currency',pair.base);
    url.searchParams.set('to_currency',pair.quote);
    url.searchParams.set('apikey',key);
    const result = await budgetedJson('alpha_vantage', url, { taskKey:`fx:${pair.id}`, ttlMs:SIX_HOURS, timeoutMs:8000, maxResponseBytes:256_000 });
    diagnostics.push(sourceResult('alpha_vantage', result, { id:pair.id }));
    if (result.ok) {
      const row = result.data?.['Realtime Currency Exchange Rate'];
      const price = finite(row?.['5. Exchange Rate']);
      if (price != null) {
        assets.push(normalizeAsset({
          id:pair.id,label:pair.label,symbol:pair.id,assetClass:'fx',price,
          bid:row?.['8. Bid Price'],ask:row?.['9. Ask Price'],
          source:'Alpha Vantage',sourceUrl:'https://www.alphavantage.co/query',
          providerTimestamp:row?.['6. Last Refreshed'] ? new Date(`${row['6. Last Refreshed']}Z`).toISOString() : null,
          mode:'rest-scarce-cross-check',metadata:{ quotaClass:'scarce', canonical:false },
        }));
      }
    }
    if (!result.skipped) await sleep(1100);
  }
  return { assets, source:{provider:'alpha_vantage',ok:assets.length>0,attempts:diagnostics.length,usable:assets.length,diagnostics} };
}

function twelveRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  const rows = [];
  for (const pair of FX_PAIRS) {
    const candidate = payload[pair.twelve] || payload[pair.id] || null;
    if (candidate && typeof candidate === 'object') rows.push({ ...candidate, __pair:pair });
  }
  if (!rows.length && (payload.symbol || payload.close || payload.price)) rows.push(payload);
  return rows;
}

async function collectTwelveData() {
  const key = String(process.env.TWELVE_DATA_API_KEY || '').trim();
  if (!key) return { assets:[], source:{provider:'twelve_data',ok:false,skipped:true,reason:'credential-not-configured'} };
  const url = new URL('https://api.twelvedata.com/quote');
  url.searchParams.set('symbol',FX_PAIRS.map((pair)=>pair.twelve).join(','));
  url.searchParams.set('apikey',key);
  const result = await budgetedJson('twelve_data', url, { cost:FX_PAIRS.length, taskKey:'core-fx-batch', ttlMs:FIFTEEN_MINUTES, timeoutMs:8000, maxResponseBytes:512_000 });
  if (!result.ok) return { assets:[], source:sourceResult('twelve_data', result) };
  const assets = [];
  for (const row of twelveRows(result.data)) {
    const symbol = String(row?.symbol || row?.__pair?.twelve || '').toUpperCase();
    const pair = row.__pair || FX_PAIRS.find((item)=>item.twelve.toUpperCase() === symbol || item.id === symbol.replace('/',''));
    if (!pair) continue;
    const price = finite(row.close ?? row.price);
    if (price == null) continue;
    assets.push(normalizeAsset({
      id:pair.id,label:pair.label,symbol:pair.id,assetClass:'fx',price,
      open:row.open,high:row.high,low:row.low,previousClose:row.previous_close,
      change:row.change,changePercent:row.percent_change,volume:row.volume,
      source:'Twelve Data',sourceUrl:'https://api.twelvedata.com/quote',
      providerTimestamp:isoFromUnix(row.timestamp),mode:'rest-free-primary-fx',metadata:{ quotaClass:'metered', canonical:true },
    }));
  }
  return { assets, source:sourceResult('twelve_data', result, { usable:assets.length, requested:FX_PAIRS.length }) };
}

async function collectFinnhub() {
  const key = String(process.env.FINNHUB_API_KEY || '').trim();
  if (!key) return { assets:[], source:{provider:'finnhub',ok:false,skipped:true,reason:'credential-not-configured'} };
  const assets = [], diagnostics = [];
  for (const item of US_PROXY_SYMBOLS) {
    const url = new URL('https://finnhub.io/api/v1/quote');
    url.searchParams.set('symbol',item.symbol);
    url.searchParams.set('token',key);
    const result = await budgetedJson('finnhub', url, { taskKey:`quote:${item.symbol}`, ttlMs:FIFTEEN_MINUTES, timeoutMs:7000, maxResponseBytes:128_000 });
    diagnostics.push(sourceResult('finnhub', result, { symbol:item.symbol }));
    if (!result.ok) continue;
    const row = result.data || {};
    if (finite(row.c) == null) continue;
    assets.push(normalizeAsset({
      id:item.id,label:item.label,symbol:item.symbol,assetClass:item.assetClass,price:row.c,
      change:row.d,changePercent:row.dp,open:row.o,high:row.h,low:row.l,previousClose:row.pc,
      source:'Finnhub',sourceUrl:'https://finnhub.io/api/v1/quote',providerTimestamp:isoFromUnix(row.t),
      mode:'rest-us-risk-proxy',metadata:{ quotaClass:'rate-limited', canonical:false },
    }));
  }
  return { assets, source:{provider:'finnhub',ok:assets.length>0,usable:assets.length,attempts:diagnostics.length,diagnostics} };
}

async function collectMarketstack() {
  const key = String(process.env.MARKETSTACK_API_KEY || '').trim();
  if (!key) return { assets:[], source:{provider:'marketstack',ok:false,skipped:true,reason:'credential-not-configured'} };
  const url = new URL('https://api.marketstack.com/v2/eod');
  url.searchParams.set('access_key',key);
  url.searchParams.set('symbols',US_PROXY_SYMBOLS.map((item)=>item.symbol).join(','));
  url.searchParams.set('limit','25');
  url.searchParams.set('sort','DESC');
  const result = await budgetedJson('marketstack', url, { taskKey:'us-proxy-eod', ttlMs:ONE_DAY, timeoutMs:9000, maxResponseBytes:1_000_000 });
  if (!result.ok) return { assets:[], source:sourceResult('marketstack', result) };
  const rows = Array.isArray(result.data?.data) ? result.data.data : [];
  const latest = new Map();
  for (const row of rows) {
    const symbol = String(row?.symbol || '').toUpperCase();
    if (!symbol || latest.has(symbol)) continue;
    latest.set(symbol,row);
  }
  const assets = [];
  for (const item of US_PROXY_SYMBOLS) {
    const row = latest.get(item.symbol);
    if (!row || finite(row.close) == null) continue;
    assets.push(normalizeAsset({
      id:item.id,label:item.label,symbol:item.symbol,assetClass:item.assetClass,price:row.close,
      open:row.open,high:row.high,low:row.low,previousClose:null,volume:row.volume,
      source:'Marketstack',sourceUrl:'https://api.marketstack.com/v2/eod',providerTimestamp:row.date || null,
      mode:'rest-eod-scarce',metadata:{ quotaClass:'very-scarce', canonical:false, exchange:row.exchange || null },
    }));
  }
  return { assets, source:sourceResult('marketstack', result, { usable:assets.length }) };
}

async function collectFmp() {
  const key = String(process.env.FMP_API_KEY || '').trim();
  if (!key) return { assets:[], source:{provider:'fmp',ok:false,skipped:true,reason:'credential-not-configured'} };
  const url = new URL('https://financialmodelingprep.com/stable/batch-quote');
  url.searchParams.set('symbols',US_PROXY_SYMBOLS.map((item)=>item.symbol).join(','));
  url.searchParams.set('apikey',key);
  const result = await budgetedJson('fmp', url, { taskKey:'us-proxy-batch', ttlMs:30 * 60_000, timeoutMs:8000, maxResponseBytes:768_000 });
  if (!result.ok) return { assets:[], source:sourceResult('fmp', result) };
  const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.data?.data) ? result.data.data : [];
  const bySymbol = new Map(rows.map((row)=>[String(row?.symbol || '').toUpperCase(),row]));
  const assets = [];
  for (const item of US_PROXY_SYMBOLS) {
    const row = bySymbol.get(item.symbol);
    if (!row || finite(row.price) == null) continue;
    assets.push(normalizeAsset({
      id:item.id,label:item.label,symbol:item.symbol,assetClass:item.assetClass,price:row.price,
      change:row.change,changePercent:row.changePercentage ?? row.changesPercentage,
      open:row.open,high:row.dayHigh ?? row.high,low:row.dayLow ?? row.low,previousClose:row.previousClose,
      volume:row.volume,bid:row.bid,ask:row.ask,
      source:'Financial Modeling Prep',sourceUrl:'https://financialmodelingprep.com/stable/batch-quote',
      providerTimestamp:row.timestamp ? isoFromUnix(row.timestamp) : null,
      mode:'rest-batched-cross-asset',metadata:{ quotaClass:'metered-bandwidth', canonical:false },
    }));
  }
  return { assets, source:sourceResult('fmp', result, { usable:assets.length }) };
}

function bookMetrics(levels = []) {
  const rows = Array.isArray(levels) ? levels.slice(0,10).map((row)=>({ price:finite(row?.[0]), size:finite(row?.[1]) })).filter((row)=>row.price != null && row.size != null) : [];
  const size = rows.reduce((sum,row)=>sum + row.size,0);
  const notional = rows.reduce((sum,row)=>sum + row.size * row.price,0);
  return { levels:rows.length,size,notional };
}

async function collectBybit() {
  const assets = [], diagnostics = [];
  for (const instrument of CRYPTO_PERPS) {
    const tickerUrl = new URL('https://api.bybit.com/v5/market/tickers');
    tickerUrl.searchParams.set('category','linear');
    tickerUrl.searchParams.set('symbol',instrument.symbol);
    const ticker = await budgetedJson('bybit_public', tickerUrl, { taskKey:`ticker:${instrument.symbol}`, ttlMs:60_000, timeoutMs:6000, maxResponseBytes:256_000 });
    diagnostics.push(sourceResult('bybit_public', ticker, { type:'ticker', symbol:instrument.symbol }));
    const bookUrl = new URL('https://api.bybit.com/v5/market/orderbook');
    bookUrl.searchParams.set('category','linear');
    bookUrl.searchParams.set('symbol',instrument.symbol);
    bookUrl.searchParams.set('limit','50');
    const book = await budgetedJson('bybit_public', bookUrl, { taskKey:`book:${instrument.symbol}`, ttlMs:60_000, timeoutMs:6000, maxResponseBytes:512_000 });
    diagnostics.push(sourceResult('bybit_public', book, { type:'book', symbol:instrument.symbol }));
    if (!ticker.ok) continue;
    const row = ticker.data?.result?.list?.[0];
    if (!row || finite(row.lastPrice) == null) continue;
    const bids = book.ok ? bookMetrics(book.data?.result?.b) : {levels:0,size:0,notional:0};
    const asks = book.ok ? bookMetrics(book.data?.result?.a) : {levels:0,size:0,notional:0};
    const imbalance = bids.size + asks.size > 0 ? (bids.size - asks.size) / (bids.size + asks.size) : null;
    assets.push(normalizeAsset({
      id:`${instrument.id}_BYBIT`,label:`${instrument.label} · Bybit`,symbol:instrument.symbol,assetClass:'crypto-perpetual',
      price:row.lastPrice,changePercent:finite(row.price24hPcnt) != null ? finite(row.price24hPcnt) * 100 : null,
      high:row.highPrice24h,low:row.lowPrice24h,volume:row.volume24h,bid:row.bid1Price,ask:row.ask1Price,
      bidSize:row.bid1Size,askSize:row.ask1Size,openInterest:row.openInterest,fundingRate:row.fundingRate,
      source:'Bybit public',sourceUrl:'https://api.bybit.com/v5/market',providerTimestamp:isoFromUnix(ticker.data?.time),
      mode:'public-rest-l2',metadata:{ quotaClass:'high-capacity-public', canonical:false, book:{ bid:bids,ask:asks,imbalance } },
    }));
  }
  return { assets, source:{provider:'bybit_public',ok:assets.length>0,usable:assets.length,attempts:diagnostics.length,diagnostics} };
}

async function collectDeribit() {
  const assets = [], diagnostics = [];
  for (const instrument of CRYPTO_PERPS) {
    const url = new URL('https://www.deribit.com/api/v2/public/get_book_summary_by_instrument');
    url.searchParams.set('instrument_name',instrument.deribit);
    const result = await budgetedJson('deribit_public', url, { taskKey:`summary:${instrument.deribit}`, ttlMs:60_000, timeoutMs:6000, maxResponseBytes:256_000 });
    diagnostics.push(sourceResult('deribit_public', result, { symbol:instrument.deribit }));
    if (!result.ok) continue;
    const row = result.data?.result?.[0];
    if (!row || finite(row.last) == null) continue;
    assets.push(normalizeAsset({
      id:`${instrument.id}_DERIBIT`,label:`${instrument.label} · Deribit`,symbol:instrument.deribit,assetClass:'crypto-perpetual',
      price:row.last,high:row.high,low:row.low,volume:row.volume,bid:row.bid_price,ask:row.ask_price,
      openInterest:row.open_interest,fundingRate:row.funding_8h,
      source:'Deribit public',sourceUrl:'https://www.deribit.com/api/v2/public/get_book_summary_by_instrument',
      mode:'public-rest-derivatives',metadata:{ quotaClass:'public-throttled', canonical:false, volumeUsd:finite(row.volume_usd), markPrice:finite(row.mark_price) },
    }));
  }
  return { assets, source:{provider:'deribit_public',ok:assets.length>0,usable:assets.length,attempts:diagnostics.length,diagnostics} };
}

function chooseContextAssets(groups) {
  const priority = new Map([['Financial Modeling Prep',4],['Finnhub',3],['Marketstack',2]]);
  const byId = new Map();
  for (const asset of groups.flat()) {
    const existing = byId.get(asset.id);
    if (!existing || (priority.get(asset.source) || 0) > (priority.get(existing.source) || 0)) byId.set(asset.id,asset);
  }
  return [...byId.values()];
}

export async function collectFreeTierMarketData() {
  const started = Date.now();
  const settled = await Promise.allSettled([
    collectTwelveData(),
    collectAlphaVantage(),
    collectFinnhub(),
    collectMarketstack(),
    collectFmp(),
    collectBybit(),
    collectDeribit(),
  ]);
  const names = ['twelve_data','alpha_vantage','finnhub','marketstack','fmp','bybit_public','deribit_public'];
  const results = settled.map((result,index)=>result.status === 'fulfilled' ? result.value : { assets:[],source:{provider:names[index],ok:false,error:String(result.reason?.message || result.reason).slice(0,240)} });
  const byProvider = Object.fromEntries(results.map((result,index)=>[names[index],result]));
  const canonicalFx = byProvider.twelve_data.assets || [];
  const slowFxCrossChecks = byProvider.alpha_vantage.assets || [];
  const contextAssets = chooseContextAssets([
    byProvider.finnhub.assets || [],
    byProvider.fmp.assets || [],
    byProvider.marketstack.assets || [],
  ]);
  const microstructureAssets = [
    ...(byProvider.bybit_public.assets || []),
    ...(byProvider.deribit_public.assets || []),
  ];
  const sources = Object.fromEntries(names.map((name)=>[name,byProvider[name].source]));
  const budget = await freeTierBudgetStatus();
  return {
    generatedAt:new Date().toISOString(),
    architecture:'delegated-free-tier-market-data-router-v1',
    policy:'High-capacity public feeds carry microstructure. Metered providers are assigned narrow roles and are hard-stopped below their published free-tier ceilings.',
    providerPolicies:freeTierPolicySummary(),
    sources,
    canonicalFx,
    slowFxCrossChecks,
    contextAssets,
    microstructureAssets,
    nasdaqDataLink:{
      configured:Boolean(String(process.env.NASDAQ_DATA_LINK_API_KEY || '').trim()),
      activeCollection:false,
      reason:'Nasdaq Data Link is dataset-specific. Its high-capacity authenticated budget is registered for historical/table jobs rather than spending calls without a selected dataset contract.',
    },
    budget,
    counts:{
      canonicalFx:canonicalFx.length,
      slowFxCrossChecks:slowFxCrossChecks.length,
      contextAssets:contextAssets.length,
      microstructureAssets:microstructureAssets.length,
      providersHealthy:Object.values(sources).filter((source)=>source?.ok).length,
      providersConfigured:Object.values(freeTierPolicySummary()).filter((policy)=>policy.configured).length,
    },
    durationMs:Date.now()-started,
  };
}
