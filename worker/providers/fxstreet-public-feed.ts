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
  US: 'USD', USA: 'USD',
  UK: 'GBP', GB: 'GBP',
  EMU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
  JP: 'JPY', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', CN: 'CNY', ZA: 'ZAR',
};

function clean(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return clean(object.displayValue ?? object.value ?? object.Value ?? object.name ?? object.Name);
  }
  const text = String(value).trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
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
    for (const candidate of [
      object.dateUtc, object.DateUtc, object.date, object.Date, object.dateTime, object.DateTime,
      object.eventDate, object.EventDate, object.releaseDate, object.ReleaseDate,
    ]) {
      date = dateValue(candidate);
      if (date) break;
    }
    if (!date) continue;

    const currency = currencyFrom(object, event, country);
    if (!currency) continue;

    const identity = `${date}|${currency}|${normalizeTitle(name)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    events.push({
      id: `fxstreet-feed-${clean(object.id ?? object.Id ?? object.idEcoCalendarDate ?? object.IdEcoCalendarDate) ?? identity}`,
      date,
      country: clean(country.name ?? country.Name ?? object.countryName ?? object.CountryName) ?? currency,
      currency,
      event: name,
      category: clean(event.categoryName ?? event.CategoryName ?? object.categoryName ?? object.CategoryName) ?? 'Economic Calendar',
      importance: importance(object.volatility ?? object.Volatility ?? event.volatility ?? event.Volatility),
      actual: clean(object.actual ?? object.Actual ?? object.displayActual ?? object.DisplayActual),
      forecast: clean(object.consensus ?? object.Consensus ?? object.displayConsensus ?? object.DisplayConsensus),
      previous: clean(object.previous ?? object.Previous ?? object.displayPrevious ?? object.DisplayPrevious),
      revised: clean(object.revised ?? object.Revised ?? object.displayRevised ?? object.DisplayRevised),
      lastUpdate: clean(object.lastUpdated ?? object.LastUpdated ?? object.lastUpdate ?? object.LastUpdate) ?? new Date().toISOString(),
      source: 'FXStreet public calendar feed',
    });
  }

  return events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export async function fetchFxstreetPublicWindow(from: Date, to: Date): Promise<CalendarEvent[]> {
  try {
    const response = await fetch(buildUrl(from, to), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FXGA-Macro-Intelligence/1.0 (+public economic research collector)',
        Referer: 'https://www.fxstreet.com/economic-calendar',
      },
      redirect: 'follow',
    });
    if (!response.ok) return [];
    return parsePayload(await response.json());
  } catch {
    return [];
  }
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
      importance: Math.max(event.importance, match.importance),
      lastUpdate: match.lastUpdate ?? new Date().toISOString(),
      providers: [...new Set([...(event.providers ?? []), 'fxstreet'])],
      sourceCount: Math.max(event.sourceCount ?? 1, 1),
    };
  });
}
