import type { CalendarEvent } from '../types';

const COUNTRIES = ['US', 'UK', 'EMU', 'DE', 'CN', 'JP', 'CA', 'AU', 'NZ', 'CH', 'FR', 'IT', 'ES', 'UA'];
const CATEGORIES = [
  '8896AA26-A50C-4F8B-AA11-8B3FCCDA1DFD',
  'FA6570F6-E494-4563-A363-00D0F2ABEC37',
  'C94405B5-5F85-4397-AB11-002A481C4B92',
  'E229C890-80FC-40F3-B6F4-B658F3A02635',
  '24127F3B-EDCE-4DC4-AFDF-0B3BD8A964BE',
  'E9E957EC-2927-4A77-AE0C-F5E4B5807C16',
  '91DA97BD-D94A-4CE8-A02B-B96EE2944E4C',
];

const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', USA: 'USD', UK: 'GBP', GB: 'GBP',
  EMU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
  JP: 'JPY', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', CN: 'CNY', ZA: 'ZAR',
};

const HOT_WINDOW_MS = 10 * 60_000;
const HOT_CACHE_TTL_SECONDS = 2;
const SCHEDULE_CACHE_TTL_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 3_500;
const SCHEDULE_BUCKET_MS = 5 * 60_000;

function clean(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return clean(object.displayValue ?? object.value ?? object.Value ?? object.name ?? object.Name);
  }
  const text = String(value).trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
}

function numberValue(value: unknown) {
  const text = clean(value)?.replace(/,/g, '').replace(/%/g, '');
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolValue(value: unknown): boolean | null | undefined {
  if (typeof value === 'boolean') return value;
  if (value == null) return undefined;
  const text = String(value).toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  if (text === 'null') return null;
  return undefined;
}

function normalizeTitle(value: string) {
  return value.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bconsumer price index\b/g, 'cpi')
    .replace(/\bproducer price index\b/g, 'ppi')
    .replace(/\bgross domestic product\b/g, 'gdp')
    .replace(/\bnon[- ]?farm payrolls?\b/g, 'nfp')
    .replace(/\b(final|preliminary|prelim|flash|seasonally adjusted)\b/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string) {
  const aa = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const bb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / new Set([...aa, ...bb]).size;
}

function titlesMatch(a: string, b: string) {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);
  return aa === bb || (aa.length > 7 && bb.length > 7 && (aa.includes(bb) || bb.includes(aa))) || similarity(aa, bb) >= 0.74;
}

function isoSeconds(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isHotWindow(from: Date, to: Date, now = Date.now()) {
  return from.getTime() <= now + HOT_WINDOW_MS && to.getTime() >= now - HOT_WINDOW_MS;
}

function canonicalWindow(from: Date, to: Date) {
  if (isHotWindow(from, to)) return { from, to, hot: true };
  const start = Math.floor(from.getTime() / SCHEDULE_BUCKET_MS) * SCHEDULE_BUCKET_MS;
  const end = Math.ceil(to.getTime() / SCHEDULE_BUCKET_MS) * SCHEDULE_BUCKET_MS;
  return { from: new Date(start), to: new Date(end), hot: false };
}

function buildUrl(from: Date, to: Date) {
  const url = new URL(`https://calendar-api.fxsstatic.com/en/api/v2/eventDates/${isoSeconds(from)}/${isoSeconds(to)}`);
  for (const volatility of ['NONE', 'LOW', 'MEDIUM', 'HIGH']) url.searchParams.append('volatilities', volatility);
  for (const country of COUNTRIES) url.searchParams.append('countries', country);
  for (const category of CATEGORIES) url.searchParams.append('categories', category);
  return url;
}

function walk(value: unknown, objects: Record<string, unknown>[], depth = 0) {
  if (depth > 12 || objects.length > 20_000 || value == null) return;
  if (Array.isArray(value)) {
    for (const child of value) walk(child, objects, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  objects.push(object);
  for (const child of Object.values(object)) walk(child, objects, depth + 1);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const object = record(value);
  for (const candidate of [object.date, object.Date, object.dateUtc, object.DateUtc, object.value, object.Value]) {
    const parsed = dateValue(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function currencyFrom(object: Record<string, unknown>, event: Record<string, unknown>, country: Record<string, unknown>) {
  const direct = clean(
    object.currencyCode ?? object.CurrencyCode ?? object.currency ?? object.Currency
    ?? event.currencyCode ?? event.CurrencyCode ?? event.currency ?? event.Currency
    ?? country.currencyCode ?? country.CurrencyCode ?? country.currency ?? country.Currency,
  )?.toUpperCase();
  if (direct && /^[A-Z]{3}$/.test(direct)) return direct;
  const countryCode = clean(
    object.countryCode ?? object.CountryCode ?? event.countryCode ?? event.CountryCode
    ?? country.code ?? country.Code ?? country.id ?? country.Id,
  )?.toUpperCase();
  return countryCode ? COUNTRY_CURRENCY[countryCode] : undefined;
}

function importance(value: unknown) {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'HIGH' || raw === '3') return 3;
  if (raw === 'MEDIUM' || raw === '2') return 2;
  return 1;
}

function parsePayload(payload: unknown): CalendarEvent[] {
  const objects: Record<string, unknown>[] = [];
  walk(payload, objects);
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();

  for (const object of objects) {
    const event = record(object.event ?? object.Event ?? object.ecoCalendarEvent ?? object.EcoCalendarEvent);
    const country = record(object.country ?? object.Country ?? event.country ?? event.Country);
    const name = clean(object.name ?? object.Name ?? object.title ?? object.Title ?? event.name ?? event.Name ?? event.title ?? event.Title);
    if (!name) continue;
    let date: string | null = null;
    for (const candidate of [object.dateUtc, object.DateUtc, object.date, object.Date, object.dateTime, object.DateTime, object.eventDate, object.EventDate, object.releaseDate, object.ReleaseDate]) {
      date = dateValue(candidate);
      if (date) break;
    }
    if (!date) continue;
    const currency = currencyFrom(object, event, country);
    if (!currency) continue;
    const identity = `${date}|${currency}|${normalizeTitle(name)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const eventDateId = clean(object.id ?? object.Id ?? object.idEcoCalendarDate ?? object.IdEcoCalendarDate);
    const eventId = clean(event.id ?? event.Id ?? object.eventId ?? object.EventId ?? object.idEcoCalendar ?? object.IdEcoCalendar);
    const rawVolatility = object.volatility ?? object.Volatility ?? event.volatility ?? event.Volatility;
    const unit = clean(object.unit ?? object.Unit ?? event.unit ?? event.Unit);

    events.push({
      id: `fxstreet-feed-${eventDateId ?? identity}`,
      eventDateId,
      eventId,
      date,
      country: clean(country.name ?? country.Name ?? object.countryName ?? object.CountryName) ?? currency,
      currency,
      event: name,
      category: clean(event.categoryName ?? event.CategoryName ?? object.categoryName ?? object.CategoryName) ?? 'Economic Calendar',
      importance: importance(rawVolatility),
      actual: clean(object.actual ?? object.Actual ?? object.displayActual ?? object.DisplayActual),
      forecast: clean(object.consensus ?? object.Consensus ?? object.displayConsensus ?? object.DisplayConsensus),
      previous: clean(object.previous ?? object.Previous ?? object.displayPrevious ?? object.DisplayPrevious),
      revised: clean(object.revised ?? object.Revised ?? object.displayRevised ?? object.DisplayRevised),
      deviation: numberValue(object.deviation ?? object.Deviation ?? object.dev ?? object.Dev ?? object.displayDeviation ?? object.DisplayDeviation),
      relation: boolValue(object.relation ?? object.Relation),
      betterThanExpected: boolValue(object.better ?? object.Better) ?? undefined,
      worseThanExpected: boolValue(object.worst ?? object.Worst) ?? undefined,
      preliminary: boolValue(object.preliminar ?? object.Preliminar ?? object.preliminary ?? object.Preliminary) ?? undefined,
      unit,
      lastUpdate: clean(object.lastUpdated ?? object.LastUpdated ?? object.lastUpdate ?? object.LastUpdate) ?? new Date().toISOString(),
      source: 'FXStreet public calendar feed',
      providers: ['fxstreet'],
      sourceCount: 1,
    });
  }
  return events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

async function fetchJsonFast(url: URL, ttlSeconds: number) {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  const cached = await cache.match(cacheKey);
  if (cached) {
    try { return await cached.json(); } catch { /* Fall through to origin. */ }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('FXStreet public feed timeout'), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FXGA-Macro-Intelligence/1.0 (+public economic research collector)',
        Referer: 'https://www.fxstreet.com/economic-calendar',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return null; }

    if (ttlSeconds > 0) {
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      await cache.put(cacheKey, new Response(text, { status: 200, headers }));
    }
    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFxstreetPublicWindow(from: Date, to: Date): Promise<CalendarEvent[]> {
  const window = canonicalWindow(from, to);
  const ttl = window.hot ? HOT_CACHE_TTL_SECONDS : SCHEDULE_CACHE_TTL_SECONDS;
  const payload = await fetchJsonFast(buildUrl(window.from, window.to), ttl);
  if (!payload) return [];
  return parsePayload(payload)
    .filter((event) => Date.parse(event.date) >= from.getTime() - 1000 && Date.parse(event.date) <= to.getTime() + 1000);
}

export function mergeFxstreetReleaseValues(scheduled: CalendarEvent[], fresh: CalendarEvent[]) {
  return scheduled.map((event) => {
    const match = fresh.find((candidate) => candidate.currency === event.currency
      && Math.abs(Date.parse(candidate.date) - Date.parse(event.date)) <= 120_000
      && titlesMatch(candidate.event, event.event));
    if (!match) return event;
    return {
      ...event,
      actual: match.actual ?? event.actual,
      forecast: match.forecast ?? event.forecast,
      previous: match.previous ?? event.previous,
      revised: match.revised ?? event.revised,
      deviation: match.deviation ?? event.deviation,
      relation: match.relation ?? event.relation,
      betterThanExpected: match.betterThanExpected ?? event.betterThanExpected,
      worseThanExpected: match.worseThanExpected ?? event.worseThanExpected,
      preliminary: match.preliminary ?? event.preliminary,
      eventId: match.eventId ?? event.eventId,
      eventDateId: match.eventDateId ?? event.eventDateId,
      importance: Math.max(event.importance, match.importance),
      unit: match.unit ?? event.unit,
      lastUpdate: match.lastUpdate ?? new Date().toISOString(),
      providers: [...new Set([...(event.providers ?? []), 'fxstreet'])],
      sourceCount: Math.max(event.sourceCount ?? 1, 1),
    };
  });
}
