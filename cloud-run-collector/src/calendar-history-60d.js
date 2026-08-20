import crypto from 'node:crypto';

const DAY_MS = 86_400_000;
const TARGET_COUNTRIES = ['US','UK','EMU','DE','FR','IT','ES','JP','ZA'];
const COUNTRY_CURRENCY = Object.freeze({
  US:'USD', USA:'USD', UK:'GBP', GB:'GBP', EMU:'EUR', EU:'EUR', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', JP:'JPY', ZA:'ZAR',
});
const CATEGORIES = [
  '8896AA26-A50C-4F8B-AA11-8B3FCCDA1DFD','FA6570F6-E494-4563-A363-00D0F2ABEC37',
  'C94405B5-5F85-4397-AB11-002A481C4B92','E229C890-80FC-40F3-B6F4-B658F3A02635',
  '24127F3B-EDCE-4DC4-AFDF-0B3BD8A964BE','E9E957EC-2927-4A77-AE0C-F5E4B5807C16',
  '91DA97BD-D94A-4CE8-A02B-B96EE2944E4C',
];

const stableHash = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function clean(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') return clean(value.displayValue ?? value.value ?? value.Value ?? value.name ?? value.Name);
  const text = String(value).trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
}

function numeric(value) {
  let text = clean(value)?.replace(/,/g,'').replace(/\s/g,'');
  if (!text) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1,-1); }
  const match = text.match(/^([+-]?\d*\.?\d+)([KMBT])?%?$/i);
  if (!match) return undefined;
  const multiplier = match[2]?.toUpperCase() === 'K' ? 1e3 : match[2]?.toUpperCase() === 'M' ? 1e6 : match[2]?.toUpperCase() === 'B' ? 1e9 : match[2]?.toUpperCase() === 'T' ? 1e12 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : undefined;
}

function normalizeTitle(value='') {
  return value.toLowerCase().replace(/&/g,' and ').replace(/\bconsumer price index\b/g,'cpi')
    .replace(/\bproducer price index\b/g,'ppi').replace(/\bgross domestic product\b/g,'gdp')
    .replace(/\bnon[- ]?farm payrolls?\b/g,'nfp').replace(/\b(final|preliminary|prelim|flash|seasonally adjusted)\b/g,'')
    .replace(/[^a-z0-9%]+/g,' ').replace(/\s+/g,' ').trim();
}

function dateValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  const object = record(value);
  for (const candidate of [object.date,object.Date,object.dateUtc,object.DateUtc,object.value,object.Value]) {
    const parsed = dateValue(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function walk(value, out, depth=0) {
  if (depth > 12 || out.length > 30_000 || value == null) return;
  if (Array.isArray(value)) { value.forEach((child) => walk(child,out,depth+1)); return; }
  if (typeof value !== 'object') return;
  out.push(value);
  Object.values(value).forEach((child) => walk(child,out,depth+1));
}

function importance(value) {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'HIGH' || raw === '3') return 3;
  if (raw === 'MEDIUM' || raw === '2') return 2;
  return 1;
}

function eventBiasRule(name='') {
  const title = normalizeTitle(name);
  if (/unemployment rate|jobless claims|initial claims|continuing claims|claimant count|unemployment claims/.test(title)) return 'lower';
  if (/cpi|consumer price|ppi|producer price|pce price|inflation rate|average hourly earnings|wage|earnings growth|interest rate|cash rate|repo rate|bank rate|refinancing rate|deposit facility|fed funds|policy rate|trade balance|current account|exports|gdp|retail sales|industrial production|manufacturing production|pmi|employment change|nonfarm payroll|nfp|consumer confidence|business confidence|building permits|housing starts|durable goods|factory orders|services|manufacturing|economic sentiment|business activity|capacity utilization|productivity/.test(title)) return 'higher';
  return 'context';
}

function enrich(event) {
  const actual = numeric(event.actual);
  const forecast = numeric(event.forecast);
  const previous = numeric(event.revised ?? event.previous);
  const reference = forecast ?? previous;
  const comparisonBasis = forecast !== undefined ? 'forecast' : previous !== undefined ? 'previous' : 'none';
  const rule = eventBiasRule(event.event);
  let currencyBias = 'neutral';
  let currencyBiasScore = 0;
  let biasConfidence = 25;
  let surpriseValue;
  let surprisePercent;
  if (actual === undefined) {
    currencyBias = 'pending';
    biasConfidence = 0;
  } else if (reference !== undefined && rule !== 'context') {
    surpriseValue = actual - reference;
    surprisePercent = reference === 0 ? undefined : (surpriseValue / Math.abs(reference)) * 100;
    const tolerance = Math.max(1e-9, Math.abs(reference) * 0.0001);
    if (Math.abs(surpriseValue) <= tolerance) {
      currencyBias = 'neutral';
      biasConfidence = 70;
    } else {
      const bullish = rule === 'higher' ? surpriseValue > 0 : surpriseValue < 0;
      currencyBias = bullish ? 'bullish' : 'bearish';
      currencyBiasScore = bullish ? 1 : -1;
      biasConfidence = Math.min(96, 60 + (event.importance >= 3 ? 12 : event.importance === 2 ? 6 : 0));
    }
  }
  const outcome = actual === undefined ? 'pending' : forecast === undefined ? 'no-consensus' : actual > forecast ? 'beat' : actual < forecast ? 'miss' : 'in-line';
  return { ...event, outcome, comparisonBasis, currencyBias, currencyBiasScore, biasConfidence, surpriseValue, surprisePercent };
}

function fxstreetUrl(from, to) {
  const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/,'Z');
  const url = new URL(`https://calendar-api.fxsstatic.com/en/api/v2/eventDates/${iso(from)}/${iso(to)}`);
  ['NONE','LOW','MEDIUM','HIGH'].forEach((value) => url.searchParams.append('volatilities',value));
  TARGET_COUNTRIES.forEach((country) => url.searchParams.append('countries',country));
  CATEGORIES.forEach((category) => url.searchParams.append('categories',category));
  return url;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers:{Accept:'application/json','User-Agent':'FXGA-Macro-Collector/2.0',Referer:'https://www.fxstreet.com/economic-calendar'},
      signal:controller.signal,
    });
    if (!response.ok) throw new Error(`FXStreet calendar HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseFxstreet(payload) {
  const objects = [];
  walk(payload,objects);
  const events = [];
  const seen = new Set();
  for (const object of objects) {
    const event = record(object.event ?? object.Event ?? object.ecoCalendarEvent ?? object.EcoCalendarEvent);
    const country = record(object.country ?? object.Country ?? event.country ?? event.Country);
    const name = clean(object.name ?? object.Name ?? object.title ?? object.Title ?? event.name ?? event.Name ?? event.title ?? event.Title);
    if (!name) continue;
    let date = null;
    for (const candidate of [object.dateUtc,object.DateUtc,object.date,object.Date,object.dateTime,object.DateTime,object.eventDate,object.EventDate,object.releaseDate,object.ReleaseDate]) {
      date = dateValue(candidate);
      if (date) break;
    }
    if (!date) continue;
    const countryCode = clean(object.countryCode ?? object.CountryCode ?? event.countryCode ?? event.CountryCode ?? country.code ?? country.Code ?? country.id ?? country.Id)?.toUpperCase();
    let currency = clean(object.currencyCode ?? object.CurrencyCode ?? object.currency ?? object.Currency ?? event.currencyCode ?? event.CurrencyCode)?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) currency = COUNTRY_CURRENCY[countryCode];
    if (!currency) continue;
    const identity = `${date}|${currency}|${normalizeTitle(name)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    events.push(enrich({
      id:`fxga-${stableHash(identity).slice(0,24)}`,
      date,
      country:clean(country.name ?? country.Name ?? object.countryName ?? object.CountryName) ?? countryCode ?? currency,
      currency,
      event:name,
      category:clean(event.categoryName ?? event.CategoryName ?? object.categoryName ?? object.CategoryName) ?? 'Economic Calendar',
      importance:importance(object.volatility ?? object.Volatility ?? event.volatility ?? event.Volatility),
      actual:clean(object.actual ?? object.Actual ?? object.displayActual ?? object.DisplayActual),
      forecast:clean(object.consensus ?? object.Consensus ?? object.displayConsensus ?? object.DisplayConsensus),
      previous:clean(object.previous ?? object.Previous ?? object.displayPrevious ?? object.DisplayPrevious),
      revised:clean(object.revised ?? object.Revised ?? object.displayRevised ?? object.DisplayRevised),
      unit:clean(object.unit ?? object.Unit ?? event.unit ?? event.Unit),
      source:'FXStreet public calendar feed',
      providers:['fxstreet'],
      sourceCount:1,
    }));
  }
  return events.sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
}

export async function fetchCalendarHistoryWindow({ days=60, segmentDays=14 }={}) {
  days = Math.min(60, Math.max(1, Number(days) || 60));
  segmentDays = Math.min(14, Math.max(3, Number(segmentDays) || 14));
  const now = Date.now();
  const start = now - days * DAY_MS;
  const events = [];
  const failures = [];
  for (let cursor = start; cursor < now; cursor += segmentDays * DAY_MS) {
    const from = new Date(cursor);
    const to = new Date(Math.min(now, cursor + segmentDays * DAY_MS - 1000));
    try {
      events.push(...parseFxstreet(await fetchJson(fxstreetUrl(from,to))));
    } catch (error) {
      failures.push({from:from.toISOString(),to:to.toISOString(),error:String(error?.message || error).slice(0,240)});
    }
  }
  const deduped = [...new Map(events.map((event) => [event.id,event])).values()]
    .filter((event) => {
      const time = Date.parse(event.date || '');
      return Number.isFinite(time) && time >= start && time <= now;
    })
    .sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
  return { generatedAt:new Date().toISOString(), days, events:deduped, failures };
}
