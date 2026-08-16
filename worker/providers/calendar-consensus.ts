import { acquireSource } from '../acquisition/engine';
import { renderCalendarSourcesShared, type RenderedCalendarDocument } from '../acquisition/calendar-browser';
import { getAcquisitionSource } from '../acquisition/registry';
import type { CalendarEvent, Env } from '../types';

const STATUS_KEY = 'calendar:scrape-source-status:v1';
const CURRENCIES = ['AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'JPY', 'NZD', 'USD', 'ZAR'];
const PROVIDER_ORDER = ['myfxbook', 'fxstreet', 'cnbc'] as const;
type Provider = typeof PROVIDER_ORDER[number];

interface ProviderEvent extends CalendarEvent {
  provider: Provider;
}

interface CalendarSourceStatus {
  syncedAt: string;
  horizonDays: number;
  sources: Record<string, { name: string; ok: boolean; events: number; error?: string }>;
  rawEvents: number;
  mergedEvents: number;
}

interface AcquisitionDocument {
  text?: string;
  tables?: string[][][];
  embeddedJson?: Array<{ kind?: string; value?: unknown }>;
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
}

function impact(value: unknown): number {
  const raw = String(value ?? '').toLowerCase();
  if (raw === '3' || raw.includes('high')) return 3;
  if (raw === '2' || raw.includes('medium') || raw.includes('moderate')) return 2;
  return 1;
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function normalizeTitle(value: string): string {
  return value.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bconsumer price index\b/g, 'cpi')
    .replace(/\bproducer price index\b/g, 'ppi')
    .replace(/\bgross domestic product\b/g, 'gdp')
    .replace(/\bnon[- ]?farm payrolls?\b/g, 'nfp')
    .replace(/\bpurchasing managers'? index\b/g, 'pmi')
    .replace(/\b(final|preliminary|prelim|flash|seasonally adjusted)\b/g, '')
    .replace(/\bmonth[- ]on[- ]month\b/g, 'mom')
    .replace(/\byear[- ]on[- ]year\b/g, 'yoy')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a: string, b: string): number {
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
  return aa === bb || (aa.length > 7 && bb.length > 7 && (aa.includes(bb) || bb.includes(aa))) || titleSimilarity(aa, bb) >= 0.76;
}

function parseDate(value: string): string | null {
  const raw = value.trim();
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();

  const myfx = raw.match(/^(\d{4}),\s*([A-Za-z]+)\s+(\d{1,2}),\s*([0-2]?\d):([0-5]\d)$/);
  if (myfx) {
    const month = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(myfx[2].toLowerCase());
    if (month >= 0) return new Date(Date.UTC(Number(myfx[1]), month, Number(myfx[3]), Number(myfx[4]), Number(myfx[5]))).toISOString();
  }

  const match = raw.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?[^0-9]{0,8}([0-2]?\d):([0-5]\d)/);
  if (!match) return null;
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].findIndex((name) => match[1].toLowerCase().startsWith(name));
  if (month < 0) return null;
  const year = Number(match[3] || new Date().getUTCFullYear());
  return new Date(Date.UTC(year, month, Number(match[2]), Number(match[4]), Number(match[5]))).toISOString();
}

function currencyFrom(value: unknown, title = ''): string | undefined {
  const raw = `${String(value ?? '')} ${title}`.toUpperCase();
  const direct = CURRENCIES.find((code) => new RegExp(`\\b${code}\\b`).test(raw));
  if (direct) return direct;
  const map: Array<[string, string]> = [
    ['UNITED STATES', 'USD'], ['USA', 'USD'], ['EURO AREA', 'EUR'], ['EMU', 'EUR'], ['GERMANY', 'EUR'], ['FRANCE', 'EUR'],
    ['UNITED KINGDOM', 'GBP'], ['JAPAN', 'JPY'], ['CANADA', 'CAD'], ['AUSTRALIA', 'AUD'], ['NEW ZEALAND', 'NZD'],
    ['SWITZERLAND', 'CHF'], ['CHINA', 'CNY'], ['SOUTH AFRICA', 'ZAR'],
  ];
  return map.find(([name]) => raw.includes(name))?.[1];
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function parseMyfxbookCsv(text: string): ProviderEvent[] {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((value) => value.toLowerCase());
  const idx = (...names: string[]) => header.findIndex((value) => names.some((name) => value === name || value.includes(name)));
  const dateI = idx('date');
  const eventI = idx('event', 'name');
  const currencyI = idx('currency');
  const impactI = idx('impact');
  const previousI = idx('previous');
  const consensusI = idx('consensus', 'forecast');
  const actualI = idx('actual');
  if (dateI < 0 || eventI < 0 || currencyI < 0) return [];

  const events: ProviderEvent[] = [];
  for (const row of rows.slice(1)) {
    const date = parseDate(row[dateI] ?? '');
    const event = clean(row[eventI]);
    const currency = clean(row[currencyI])?.toUpperCase();
    if (!date || !event || !currency) continue;
    events.push({
      id: `myfxbook-${hash(`${date}|${currency}|${event}`)}`,
      provider: 'myfxbook', date, event, currency, country: currency,
      category: 'Economic Calendar', importance: impactI >= 0 ? impact(row[impactI]) : 1,
      previous: previousI >= 0 ? clean(row[previousI]) : undefined,
      forecast: consensusI >= 0 ? clean(row[consensusI]) : undefined,
      actual: actualI >= 0 ? clean(row[actualI]) : undefined,
      source: 'Myfxbook',
    });
  }
  return events;
}

async function fetchMyfxbookCsv(from: Date, to: Date): Promise<ProviderEvent[]> {
  const url = new URL('https://www.myfxbook.com/calendar_statement.csv');
  url.searchParams.set('filter', `0-1-2-3_${CURRENCIES.join('-')}`);
  url.searchParams.set('start', from.toISOString().replace('T', ' ').replace('Z', ''));
  url.searchParams.set('end', to.toISOString().replace('T', ' ').replace('Z', ''));
  url.searchParams.set('calPeriod', '10');
  url.searchParams.set('tabType', '0');
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'FXGA-Macro-Intelligence/1.0 (+public economic research collector)',
        Referer: 'https://www.myfxbook.com/forex-economic-calendar',
      },
    });
    if (!response.ok) return [];
    return parseMyfxbookCsv(await response.text());
  } catch {
    return [];
  }
}

function tableEvents(document: AcquisitionDocument | RenderedCalendarDocument | null, provider: Provider): ProviderEvent[] {
  if (!document) return [];
  const events: ProviderEvent[] = [];
  for (const table of document.tables ?? []) {
    for (const row of table) {
      const currencyI = row.findIndex((value) => /^[A-Z]{3}$/.test(value.trim()));
      const impactI = row.findIndex((value) => /^(high|medium|moderate|low|none)$/i.test(value.trim()));
      const dateI = row.findIndex((value) => /[A-Za-z]{3,9}\s+\d{1,2}.*\d{1,2}:\d{2}/.test(value));
      if (currencyI < 0 || dateI < 0) continue;
      const date = parseDate(row[dateI]);
      const event = clean(row[currencyI + 1]);
      const currency = row[currencyI].trim().toUpperCase();
      if (!date || !event) continue;
      events.push({
        id: `${provider}-${hash(`${date}|${currency}|${event}`)}`,
        provider, date, event, currency, country: currency, category: 'Economic Calendar',
        importance: impactI >= 0 ? impact(row[impactI]) : 1,
        previous: impactI >= 0 ? clean(row[impactI + 1]) : undefined,
        forecast: impactI >= 0 ? clean(row[impactI + 2]) : undefined,
        actual: impactI >= 0 ? clean(row[impactI + 3]) : undefined,
        source: provider === 'myfxbook' ? 'Myfxbook' : provider === 'fxstreet' ? 'FXStreet' : 'CNBC',
      });
    }
  }
  return events;
}

function walk(value: unknown, objects: Record<string, unknown>[], depth = 0) {
  if (depth > 12 || objects.length > 10_000 || value == null) return;
  if (Array.isArray(value)) { for (const child of value) walk(child, objects, depth + 1); return; }
  if (typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  objects.push(object);
  for (const child of Object.values(object)) walk(child, objects, depth + 1);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseFxstreet(document: RenderedCalendarDocument | null): ProviderEvent[] {
  if (!document) return [];
  const objects: Record<string, unknown>[] = [];
  for (const payload of document.embeddedJson ?? []) walk(payload.value, objects);
  const events: ProviderEvent[] = [];
  const seen = new Set<string>();

  for (const object of objects) {
    const nested = record(object.event ?? object.Event ?? object.calendarEvent ?? object.CalendarEvent);
    const dateRaw = object.dateUtc ?? object.DateUtc ?? object.date ?? object.Date ?? object.dateTime ?? object.datetime
      ?? object.startDate ?? object.releaseDate ?? object.eventDate ?? object.EventDate;
    const titleRaw = object.name ?? object.Name ?? object.title ?? object.Title ?? nested.name ?? nested.Name ?? nested.title ?? nested.Title;
    if (!dateRaw || !titleRaw || typeof titleRaw === 'object') continue;
    const dateMs = Date.parse(String(dateRaw));
    if (!Number.isFinite(dateMs)) continue;

    const country = record(object.country ?? object.Country ?? nested.country ?? nested.Country);
    const currency = currencyFrom(
      object.currency ?? object.Currency ?? nested.currency ?? nested.Currency ?? country.currency ?? country.Currency ?? country.code ?? country.Code,
      String(titleRaw),
    );
    if (!currency) continue;

    const date = new Date(dateMs).toISOString();
    const event = String(titleRaw).trim();
    const identity = `${date}|${currency}|${normalizeTitle(event)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    events.push({
      id: `fxstreet-${clean(object.id ?? object.Id ?? object.eventDateId ?? object.idEcoCalendarDate ?? object.IdEcoCalendarDate) ?? hash(identity)}`,
      provider: 'fxstreet', date, event, currency,
      country: clean(country.name ?? country.Name ?? object.countryName ?? nested.countryName) ?? currency,
      category: clean(object.category ?? object.Category ?? nested.category ?? nested.Category ?? object.ecoCalendarType) ?? 'Economic Calendar',
      importance: impact(object.volatility ?? object.Volatility ?? nested.volatility ?? object.impact ?? object.Impact),
      actual: clean(object.actual ?? object.Actual ?? object.displayActual ?? object.DisplayActual),
      previous: clean(object.previous ?? object.Previous ?? object.displayPrevious ?? object.DisplayPrevious),
      forecast: clean(object.consensus ?? object.Consensus ?? object.forecast ?? object.Forecast ?? object.displayConsensus ?? object.DisplayConsensus),
      revised: clean(object.revised ?? object.Revised ?? object.displayRevised ?? object.DisplayRevised),
      lastUpdate: clean(object.lastUpdated ?? object.lastUpdate ?? object.LastUpdated),
      source: 'FXStreet',
    });
  }

  return events.length ? events : tableEvents(document, 'fxstreet');
}

function parseCnbc(document: AcquisitionDocument | null, from: Date, to: Date): ProviderEvent[] {
  const text = document?.text ?? '';
  const events: ProviderEvent[] = [];
  const monthPattern = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const regex = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?[^.\\n]{0,140}?\\b(\\d{1,2}):(\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)\\s*(ET|EST|EDT)\\b[^.\\n]{0,180}`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) && events.length < 50) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].findIndex((name) => match![1].toLowerCase().startsWith(name));
    if (month < 0) continue;
    let hour = Number(match[4]);
    if (/p/i.test(match[6]) && hour < 12) hour += 12;
    if (/a/i.test(match[6]) && hour === 12) hour = 0;
    const offset = match[7].toUpperCase() === 'EST' ? 5 : 4;
    const date = new Date(Date.UTC(Number(match[3] || from.getUTCFullYear()), month, Number(match[2]), hour + offset, Number(match[5])));
    if (date < from || date > to) continue;
    const event = match[0].replace(/\s+/g, ' ').trim();
    events.push({ id: `cnbc-${hash(`${date.toISOString()}|${event}`)}`, provider: 'cnbc', date: date.toISOString(), event, country: 'United States', currency: 'USD', category: 'CNBC Economic Schedule', importance: 2, source: 'CNBC' });
  }
  return events;
}

function sameGroup(a: ProviderEvent, b: ProviderEvent) {
  return a.currency === b.currency
    && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 90_000
    && titlesMatch(a.event, b.event);
}

function merge(events: ProviderEvent[]): CalendarEvent[] {
  const groups: ProviderEvent[][] = [];
  for (const event of [...events].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    const group = groups.find((candidate) => candidate.some((member) => sameGroup(member, event)));
    if (group) group.push(event); else groups.push([event]);
  }

  return groups.map((group) => {
    group.sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider));
    const primary = group[0];
    const providers = [...new Set(group.map((event) => event.provider))];
    const first = (field: keyof CalendarEvent) => clean(group.find((event) => clean(event[field]))?.[field]);
    const key = `${primary.currency ?? 'UNK'}|${new Date(primary.date).toISOString()}|${normalizeTitle(primary.event)}`;
    return {
      ...primary,
      id: `fxga-cal-${hash(key)}`,
      actual: first('actual'), previous: first('previous'), forecast: first('forecast'), revised: first('revised'),
      importance: Math.max(...group.map((event) => event.importance)),
      providers, sourceCount: providers.length,
      confidence: Math.min(100, 55 + (providers.includes('myfxbook') ? 20 : 0) + (providers.includes('fxstreet') ? 20 : 0) + (providers.includes('cnbc') ? 5 : 0)),
      canonicalKey: key,
      source: `FXGA Calendar Consensus: ${providers.map((provider) => provider === 'myfxbook' ? 'Myfxbook' : provider === 'fxstreet' ? 'FXStreet' : 'CNBC').join(' + ')}`,
      lastUpdate: new Date().toISOString(),
    } satisfies CalendarEvent;
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function err(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 400) : String(error ?? 'Unknown source failure').slice(0, 400);
}

export async function getScrapedEconomicCalendar(env: Env, storage: DurableObjectStorage, days = 14): Promise<CalendarEvent[]> {
  const horizonDays = Math.min(Math.max(days, 1), 21);
  const from = new Date(); from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from); to.setUTCDate(to.getUTCDate() + horizonDays); to.setUTCHours(23, 59, 59, 999);
  const status: CalendarSourceStatus = { syncedAt: new Date().toISOString(), horizonDays, sources: {}, rawEvents: 0, mergedEvents: 0 };

  const [csvResult, cnbcResult] = await Promise.allSettled([
    fetchMyfxbookCsv(from, to),
    (async () => {
      const source = getAcquisitionSource('cnbc-economy');
      if (!source) return [] as ProviderEvent[];
      return parseCnbc(await acquireSource(env, storage, source) as AcquisitionDocument, from, to);
    })(),
  ]);

  let myfxbook = csvResult.status === 'fulfilled' ? csvResult.value : [];
  let cnbc = cnbcResult.status === 'fulfilled' ? cnbcResult.value : [];
  let fxstreet: ProviderEvent[] = [];

  // One browser launch, two public calendar pages, then close. This is the only
  // Chromium work in the broad schedule sync and is cached for six hours.
  const rendered = await renderCalendarSourcesShared(env, storage, ['myfxbook-calendar', 'fxstreet-calendar']);
  if (!myfxbook.length) myfxbook = tableEvents(rendered['myfxbook-calendar'] ?? null, 'myfxbook');
  fxstreet = parseFxstreet(rendered['fxstreet-calendar'] ?? null);

  status.sources.myfxbook = { name: 'Myfxbook', ok: myfxbook.length > 0, events: myfxbook.length, ...(myfxbook.length ? {} : { error: csvResult.status === 'rejected' ? err(csvResult.reason) : 'CSV and rendered public calendar returned no parseable events.' }) };
  status.sources.fxstreet = { name: 'FXStreet', ok: fxstreet.length > 0, events: fxstreet.length, ...(fxstreet.length ? {} : { error: 'Rendered widget/network responses returned no parseable events.' }) };
  status.sources.cnbc = { name: 'CNBC', ok: cnbc.length > 0, events: cnbc.length, ...(cnbc.length ? {} : { error: cnbcResult.status === 'rejected' ? err(cnbcResult.reason) : 'No explicit dated/timed CNBC schedule references found.' }) };

  const all = [...myfxbook, ...fxstreet, ...cnbc].filter((event) => {
    const time = Date.parse(event.date);
    return Number.isFinite(time) && time >= from.getTime() - 600_000 && time <= to.getTime();
  });
  const merged = merge(all);
  status.rawEvents = all.length;
  status.mergedEvents = merged.length;
  await storage.put(STATUS_KEY, status);

  if (!merged.length) throw new Error('Myfxbook, FXStreet and CNBC produced no parseable economic-calendar events');
  return merged;
}

export async function refreshScrapedReleaseWindow(_env: Env, _storage: DurableObjectStorage, scheduled: CalendarEvent[]): Promise<CalendarEvent[]> {
  if (!scheduled.length) return [];
  const times = scheduled.map((event) => Date.parse(event.date)).filter(Number.isFinite);
  if (!times.length) return scheduled;
  const from = new Date(Math.min(...times) - 10 * 60_000);
  const to = new Date(Math.max(...times) + 10 * 60_000);

  // Myfxbook's CSV is the only repeated calendar-source request in a release window.
  // It is one lightweight request for the whole release cluster. If Myfxbook blocks it,
  // keep the persisted state and let later official-source collectors supply the actual.
  const fresh = await fetchMyfxbookCsv(from, to);
  if (!fresh.length) return scheduled;

  return scheduled.map((event) => {
    const match = fresh.find((candidate) => candidate.currency === event.currency
      && Math.abs(Date.parse(candidate.date) - Date.parse(event.date)) <= 120_000
      && titlesMatch(candidate.event, event.event));
    return match ? { ...event, ...match, id: event.id, source: event.source, providers: [...new Set([...(event.providers ?? []), 'myfxbook'])] } : event;
  });
}
