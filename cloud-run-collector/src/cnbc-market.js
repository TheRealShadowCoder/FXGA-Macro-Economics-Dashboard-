import { load as loadHtml } from 'cheerio';
import { chromium } from 'playwright';

export const CNBC_ASSETS = [
  { symbol: '.DXY', id: 'DXY', label: 'U.S. Dollar Index', assetClass: 'fx-index', currency: 'USD' },
  { symbol: 'EUR=', id: 'EURUSD', label: 'EUR/USD', assetClass: 'fx', currency: 'USD' },
  { symbol: 'GBP=', id: 'GBPUSD', label: 'GBP/USD', assetClass: 'fx', currency: 'USD' },
  { symbol: 'JPY=', id: 'USDJPY', label: 'USD/JPY', assetClass: 'fx', currency: 'JPY' },
  { symbol: 'ZAR=', id: 'USDZAR', label: 'USD/ZAR', assetClass: 'fx', currency: 'ZAR' },
  { symbol: 'US2Y', id: 'US2Y', label: 'U.S. 2 Year Treasury Yield', assetClass: 'rates', currency: 'USD', quoteKind: 'yield' },
  { symbol: 'US10Y', id: 'US10Y', label: 'U.S. 10 Year Treasury Yield', assetClass: 'rates', currency: 'USD', quoteKind: 'yield' },
  { symbol: '.SPX', id: 'SPX', label: 'S&P 500', assetClass: 'equity-index', currency: 'USD' },
  { symbol: '.IXIC', id: 'NASDAQ', label: 'Nasdaq Composite', assetClass: 'equity-index', currency: 'USD' },
  { symbol: '.DJI', id: 'DJI', label: 'Dow Jones Industrial Average', assetClass: 'equity-index', currency: 'USD' },
  { symbol: '.VIX', id: 'VIX', label: 'CBOE Volatility Index', assetClass: 'volatility', currency: 'USD' },
  { symbol: '@GC.1', id: 'GOLD', label: 'Gold Futures', assetClass: 'commodity', currency: 'USD' },
  { symbol: '@CL.1', id: 'WTI', label: 'WTI Crude Oil Futures', assetClass: 'commodity', currency: 'USD' },
  { symbol: '@LCO.1', id: 'BRENT', label: 'Brent Crude Oil Futures', assetClass: 'commodity', currency: 'USD' },
  { symbol: 'BTC=', id: 'BTCUSD', label: 'Bitcoin / U.S. Dollar', assetClass: 'crypto', currency: 'USD' },
  { symbol: 'ETH=', id: 'ETHUSD', label: 'Ether / U.S. Dollar', assetClass: 'crypto', currency: 'USD' },
];

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 FXGA-Macro-Collector/4.0';

function asText(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    for (const key of ['formattedValue', 'formatted', 'displayValue', 'value', 'Value', 'raw']) {
      if (value[key] != null) return asText(value[key]);
    }
    return undefined;
  }
  const text = String(value).trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'undefined' ? text : undefined;
}

function asNumber(value) {
  const text = asText(value);
  if (!text) return null;
  let normalized = text.replace(/[$,%\s]/g, '').replace(/,/g, '');
  let multiplier = 1;
  if (/[-+]?\d*\.?\d+[KMBT]$/i.test(normalized)) {
    const suffix = normalized.slice(-1).toUpperCase();
    normalized = normalized.slice(0, -1);
    multiplier = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1e12;
  }
  if (/^\(.*\)$/.test(normalized)) normalized = `-${normalized.slice(1, -1)}`;
  const number = Number(normalized);
  return Number.isFinite(number) ? number * multiplier : null;
}

function firstText($, selectors) {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }
  return undefined;
}

function statFromText(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s*([+\\-]?(?:\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.\\d+)?(?:[KMBT])?%?)`, 'i'));
    if (match) return asNumber(match[1]);
  }
  return null;
}

function walk(value, visit, depth = 0, seen = new Set()) {
  if (value == null || depth > 14 || seen.has(value)) return;
  if (typeof value !== 'object') return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit, depth + 1, seen);
    return;
  }
  for (const child of Object.values(value)) walk(child, visit, depth + 1, seen);
}

function field(object, keys) {
  for (const key of keys) {
    if (object?.[key] != null) return object[key];
  }
  return undefined;
}

function quoteCandidateFromObject(object, asset) {
  const symbol = asText(field(object, ['symbol', 'ticker', 'quoteSymbol', 'shortSymbol', 'issueSymbol']));
  const price = asNumber(field(object, ['last', 'lastPrice', 'last_price', 'price', 'lastTradePrice', 'lastTrade', 'yield', 'value']));
  const previousClose = asNumber(field(object, ['previousClose', 'prevClose', 'previous_close', 'prev_close']));
  const change = asNumber(field(object, ['change', 'priceChange', 'changeValue', 'netChange']));
  const changePercent = asNumber(field(object, ['changePercent', 'percentChange', 'change_pct', 'pctChange', 'percentageChange']));
  if (price == null && previousClose == null) return null;
  let score = 0;
  if (symbol && symbol.toUpperCase() === asset.symbol.toUpperCase()) score += 8;
  else if (symbol && symbol.toUpperCase().includes(asset.symbol.toUpperCase())) score += 4;
  if (price != null) score += 4;
  if (previousClose != null) score += 2;
  if (change != null) score += 1;
  if (changePercent != null) score += 1;
  return {
    score,
    symbol,
    name: asText(field(object, ['name', 'shortName', 'displayName', 'description', 'issueName'])),
    exchange: asText(field(object, ['exchange', 'exchangeName', 'source', 'market'])),
    currency: asText(field(object, ['currency', 'currencyCode'])),
    price,
    change,
    changePercent,
    open: asNumber(field(object, ['open', 'openPrice'])),
    high: asNumber(field(object, ['high', 'dayHigh', 'highPrice'])),
    low: asNumber(field(object, ['low', 'dayLow', 'lowPrice'])),
    previousClose,
    volume: asNumber(field(object, ['volume', 'totalVolume'])),
  };
}

function parseEmbeddedJson($, asset) {
  const candidates = [];
  $('script').each((_, node) => {
    const type = ($(node).attr('type') || '').toLowerCase();
    const raw = $(node).html()?.trim();
    if (!raw || raw.length > 4_000_000) return;
    if (!(type.includes('json') || raw.startsWith('{') || raw.startsWith('['))) return;
    try {
      const parsed = JSON.parse(raw);
      walk(parsed, (object) => {
        const candidate = quoteCandidateFromObject(object, asset);
        if (candidate) candidates.push(candidate);
      });
    } catch {}
  });
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function parseQuoteHtml(html, asset, finalUrl) {
  const $ = loadHtml(html);
  const embedded = parseEmbeddedJson($, asset);
  const bodyText = $('body').text().replace(/\u00a0/g, ' ').replace(/[\t\r]+/g, ' ').replace(/ +/g, ' ');
  const domPrice = asNumber(firstText($, [
    '[class*="QuoteStrip-lastPrice"]',
    '[class*="QuoteStrip-price"]',
    '[data-testid*="lastPrice"]',
    '[data-test*="lastPrice"]',
    '[data-testid*="quote"] [class*="price"]',
  ]));
  const previousClose = embedded?.previousClose ?? statFromText(bodyText, ['Yield Prev Close', 'Price Prev Close', 'Prev Close', 'Previous Close']);
  let price = embedded?.price ?? domPrice;
  let change = embedded?.change ?? asNumber(firstText($, ['[class*="QuoteStrip-change"]', '[class*="changeUp"]', '[class*="changeDown"]']));
  let changePercent = embedded?.changePercent ?? asNumber(firstText($, ['[class*="QuoteStrip-changePercent"]', '[class*="percentChange"]']));
  if (price == null && previousClose != null && change != null) price = previousClose + change;
  if (change == null && price != null && previousClose != null) change = price - previousClose;
  if (changePercent == null && change != null && previousClose) changePercent = (change / previousClose) * 100;
  const title = firstText($, ['h1']) || $('title').text().split(' - ')[0].trim() || asset.label;
  const quote = {
    id: asset.id,
    symbol: asset.symbol,
    label: asset.label,
    sourceName: title,
    assetClass: asset.assetClass,
    quoteKind: asset.quoteKind || 'price',
    currency: embedded?.currency || asset.currency || null,
    exchange: embedded?.exchange || null,
    price,
    change,
    changePercent,
    open: embedded?.open ?? statFromText(bodyText, [asset.quoteKind === 'yield' ? 'Yield Open' : 'Open']),
    high: embedded?.high ?? statFromText(bodyText, [asset.quoteKind === 'yield' ? 'Yield Day High' : 'Day High', 'Price Day High']),
    low: embedded?.low ?? statFromText(bodyText, [asset.quoteKind === 'yield' ? 'Yield Day Low' : 'Day Low', 'Price Day Low']),
    previousClose,
    volume: embedded?.volume ?? statFromText(bodyText, ['Volume']),
    source: 'CNBC',
    sourceUrl: finalUrl,
    fetchedAt: new Date().toISOString(),
    mode: embedded ? 'embedded-json+html' : 'html',
    stale: false,
  };
  return quote;
}

async function fetchQuote(asset, userAgent) {
  const url = `https://www.cnbc.com/quotes/${encodeURIComponent(asset.symbol)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'Cache-Control': 'no-cache',
        'User-Agent': userAgent,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CNBC ${asset.symbol} HTTP ${response.status}`);
    const html = await response.text();
    const quote = parseQuoteHtml(html, asset, response.url || url);
    return quote.price != null ? quote : { ...quote, error: 'Price not found in server HTML' };
  } finally {
    clearTimeout(timer);
  }
}

function bestCandidateFromPayloads(payloads, asset) {
  const candidates = [];
  for (const payload of payloads) {
    walk(payload, (object) => {
      const candidate = quoteCandidateFromObject(object, asset);
      if (candidate) candidates.push(candidate);
    });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

async function browserQuote(browser, asset, maxBrowserSeconds, userAgent) {
  const url = `https://www.cnbc.com/quotes/${encodeURIComponent(asset.symbol)}`;
  const context = await browser.newContext({ userAgent, locale: 'en-US' });
  const page = await context.newPage();
  const payloads = [];
  page.on('response', async (response) => {
    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;
      if (!/cnbc|nbcuni|quote|market|finance/i.test(response.url())) return;
      const body = await response.body();
      if (body.length > 1_500_000) return;
      payloads.push(JSON.parse(body.toString('utf8')));
    } catch {}
  });
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    const requestUrl = route.request().url();
    if (['image', 'font', 'media'].includes(type) || /doubleclick|google-analytics|googletagmanager|taboola|adservice|adsystem/i.test(requestUrl)) return route.abort();
    return route.continue();
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: maxBrowserSeconds * 1000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    const domQuote = parseQuoteHtml(html, asset, page.url());
    const candidate = bestCandidateFromPayloads(payloads, asset);
    const merged = candidate ? {
      ...domQuote,
      sourceName: candidate.name || domQuote.sourceName,
      exchange: candidate.exchange || domQuote.exchange,
      currency: candidate.currency || domQuote.currency,
      price: candidate.price ?? domQuote.price,
      change: candidate.change ?? domQuote.change,
      changePercent: candidate.changePercent ?? domQuote.changePercent,
      open: candidate.open ?? domQuote.open,
      high: candidate.high ?? domQuote.high,
      low: candidate.low ?? domQuote.low,
      previousClose: candidate.previousClose ?? domQuote.previousClose,
      volume: candidate.volume ?? domQuote.volume,
      mode: 'playwright+network+dom',
    } : { ...domQuote, mode: 'playwright+dom' };
    return merged.price != null ? merged : { ...merged, error: 'Price not found after browser fallback' };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function collectCnbcMarket({ maxBrowserSeconds = 25, userAgent = DEFAULT_UA } = {}) {
  const started = Date.now();
  const direct = [];
  for (let index = 0; index < CNBC_ASSETS.length; index += 4) {
    const batch = CNBC_ASSETS.slice(index, index + 4);
    const settled = await Promise.allSettled(batch.map((asset) => fetchQuote(asset, userAgent)));
    settled.forEach((result, offset) => {
      const asset = batch[offset];
      direct.push(result.status === 'fulfilled' ? result.value : {
        ...asset,
        quoteKind: asset.quoteKind || 'price',
        price: null,
        source: 'CNBC',
        sourceUrl: `https://www.cnbc.com/quotes/${encodeURIComponent(asset.symbol)}`,
        fetchedAt: new Date().toISOString(),
        mode: 'html-error',
        stale: false,
        error: String(result.reason?.message || result.reason).slice(0, 240),
      });
    });
  }

  const missing = direct.filter((quote) => quote.price == null);
  if (missing.length) {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const missingQuote of missing) {
        const asset = CNBC_ASSETS.find((item) => item.id === missingQuote.id);
        if (!asset) continue;
        try {
          const replacement = await browserQuote(browser, asset, maxBrowserSeconds, userAgent);
          const index = direct.findIndex((item) => item.id === asset.id);
          if (index >= 0) direct[index] = replacement;
        } catch (error) {
          missingQuote.error = `${missingQuote.error ? `${missingQuote.error}; ` : ''}${String(error?.message || error).slice(0, 220)}`;
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  const live = direct.filter((quote) => quote.price != null);
  return {
    generatedAt: new Date().toISOString(),
    source: 'CNBC',
    sourcePolicy: 'Public CNBC quote pages; server HTML/embedded JSON first, Playwright DOM/network fallback. No access-control or CAPTCHA bypass.',
    requested: CNBC_ASSETS.length,
    live: live.length,
    failed: direct.length - live.length,
    durationMs: Date.now() - started,
    assets: direct,
  };
}
