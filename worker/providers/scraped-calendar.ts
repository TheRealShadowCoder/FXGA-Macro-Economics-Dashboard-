import { acquireSource } from '../acquisition/engine';
import { getAcquisitionSource } from '../acquisition/registry';
import type { CalendarEvent, Env } from '../types';

const MAJOR_CURRENCIES = ['AUD','CAD','CHF','CNY','EUR','GBP','JPY','NZD','USD','ZAR'];
const SOURCE_PRIORITY = ['myfxbook', 'fxstreet', 'cnbc'];

interface ScrapedEvent extends CalendarEvent {
  provider: 'myfxbook' | 'fxstreet' | 'cnbc';
  providerId?: string;
}

interface AcquisitionDocument {
  text?: string;
  tables?: string[][][];
  embeddedJson?: Array<{ kind?: string; value?: unknown }>;
  links?: Array<{ text?: string; href?: string }>;
  fetchedAt?: string;
  browserUsed?: boolean;
  warnings?: string[];
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quote = false;
      else cell += ch;
    } else if (ch === '"') quote = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function importance(value: unknown) {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('high') || raw === '3') return 3;
  if (raw.includes('medium') || raw.includes('moderate') || raw === '2') return 2;
  return 1;
}

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(final|preliminary|prelim|flash)\b/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function canonicalKey(event: Pick<CalendarEvent, 'date' | 'currency' | 'event'>) {
  const date = new Date(event.date);
  if (!Number.isFinite(date.getTime())) return `${event.currency ?? 'UNK'}|invalid|${normalizeTitle(event.event)}`;
  date.setUTCSeconds(0, 0);
  return `${event.currency ?? 'UNK'}|${date.toISOString()}|${normalizeTitle(event.event)}`;
}

function parseDate(value: string, fallbackYear = new Date().getUTCFullYear()) {
  const trimmed = value.trim();
  const direct = Date.parse(trimmed);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  const match = trimmed.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\w*,?\s*([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?[, ]+([0-2]?\d):([0-5]\d)/i)
    ?? trimmed.match(/([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?[, ]+([0-2]?\d):([0-5]\d)/i);
  if (!match) return null;
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  const year = Number(match[3] || fallbackYear);
  return new Date(Date.UTC(year, month, Number(match[2]), Number(match[4]), Number(match[5]))).toISOString();
}

function inferCurrency(countryOrCurrency: unknown, text = '') {
  const raw = `${String(countryOrCurrency ?? '')} ${text}`.toUpperCase();
  const direct = MAJOR_CURRENCIES.find((code) => new RegExp(`\\b${code}\\b`).test(raw));
  if (direct) return direct;
  const map: Record<string, string> = {
    'UNITED STATES': 'USD', US: 'USD', USA: 'USD',
    'EURO AREA': 'EUR', EMU: 'EUR', GERMANY: 'EUR', FRANCE: 'EUR', ITALY: 'EUR', SPAIN: 'EUR',
    'UNITED KINGDOM': 'GBP', UK: 'GBP', JAPAN: 'JPY', CANADA: 'CAD', AUSTRALIA: 'AUD',
    'NEW ZEALAND': 'NZD', SWITZERLAND: 'CHF', CHINA: 'CNY', 'SOUTH AFRICA': 'ZAR',
  };
  return Object.entries(map).find(([name]) => raw.includes(name))?.[1];
}

function eventFromTableRow(row: string[], provider: ScrapedEvent['provider'], year: number): ScrapedEvent | null {
  const currencyIndex = row.findIndex((cell) => /^[A-Z]{3}$/.test(cell.trim()));
  const impactIndex = row.findIndex((cell) => /^(high|medium|moderate|low|none)$/i.test(cell.trim()));
  const dateIndex = row.findIndex((cell) => /[A-Za-z]{3}\s+\d{1,2}.*\d{1,2}:\d{2}/.test(cell));
  if (currencyIndex < 0 || impactIndex < 0 || dateIndex < 0) return null;
  const date = parseDate(row[dateIndex], year);
  if (!date) return null;
  const eventIndex = currencyIndex + 1;
  const title = clean(row[eventIndex]);
  if (!title) return null;
  const previous = clean(row[impactIndex + 1]);
  const forecast = clean(row[impactIndex + 2]);
  const actual = clean(row[impactIndex + 3]);
  const currency = row[currencyIndex].trim().toUpperCase();
  return {
    id: `${provider}-${stableHash(`${date}|${currency}|${title}`)}`,
    provider,
    date,
    country: currency,
    currency,
    event: title,
    category: 'Economic Calendar',
    importance: importance(row[impactIndex]),
    previous,
    forecast,
    actual,
    source: provider === 'myfxbook' ? 'Myfxbook' : provider === 'fxstreet' ? 'FXStreet' : 'CNBC',
  };
}

function parseMyfxbookTables(document: AcquisitionDocument) {
  const year = new Date().getUTCFullYear();
  return (document.tables ?? []).flatMap((table) => table.map((row) => eventFromTableRow(row, 'myfxbook', year)).filter((event): event is ScrapedEvent => Boolean(event)));
}

async function scrapeMyfxbook(env: Env, storage: DurableObjectStorage, from: Date, to: Date) {
  // Myfxbook's own calendar exposes an Export function. Prefer the lightweight CSV export,
  // then fall back to the public HTML table if the export layout changes.
  const start = from.toISOString().replace('T', ' ').replace('Z', '');
  const end = to.toISOString().replace('T', ' ').replace('Z', '');
  const filter = `0-1-2-3_${MAJOR_CURRENCIES.join('-')}`;
  const exportUrl = new URL('https://www.myfxbook.com/calendar_statement.csv');
  exportUrl.searchParams.set('filter', filter);
  exportUrl.searchParams.set('start', start);
  exportUrl.searchParams.set('end', end);
  exportUrl.searchParams.set('calPeriod', '10');
  exportUrl.searchParams.set('tabType', '0');

  try {
    const response = await fetch(exportUrl, { headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'FXGA-Macro-Intelligence/1.0' } });
    if (response.ok) {
      const rows = csvRows(await response.text());
      if (rows.length > 1) {
        const header = rows[0].map((cell) => cell.toLowerCase());
        const idx = (names: string[]) => header.findIndex((cell) => names.some((name) => cell.includes(name)));
        const dateIdx = idx(['date', 'time']);
        const currencyIdx = idx(['currency']);
        const eventIdx = idx(['event', 'name']);
        const impactIdx = idx(['impact']);
        const previousIdx = idx(['previous']);
        const consensusIdx = idx(['consensus', 'forecast']);
        const actualIdx = idx(['actual']);
        const parsed = rows.slice(1).map((row) => {
          if (dateIdx < 0 || currencyIdx < 0 || eventIdx < 0) return null;
          const date = parseDate(row[dateIdx] ?? '');
          const currency = clean(row[currencyIdx])?.toUpperCase();
          const title = clean(row[eventIdx]);
          if (!date || !currency || !title) return null;
          return {
            id: `myfxbook-${stableHash(`${date}|${currency}|${title}`)}`,
            provider: 'myfxbook' as const,
            date,
            country: currency,
            currency,
            event: title,
            category: 'Economic Calendar',
            importance: impactIdx >= 0 ? importance(row[impactIdx]) : 1,
            previous: previousIdx >= 0 ? clean(row[previousIdx]) : undefined,
            forecast: consensusIdx >= 0 ? clean(row[consensusIdx]) : undefined,
            actual: actualIdx >= 0 ? clean(row[actualIdx]) : undefined,
            source: 'Myfxbook',
          } satisfies ScrapedEvent;
        }).filter((event): event is ScrapedEvent => Boolean(event));
        if (parsed.length) return parsed;
      }
    }
  } catch {
    // Fall through to public page extraction.
  }

  const source = getAcquisitionSource('myfxbook-calendar');
  if (!source) return [];
  const document = await acquireSource(env, storage, source) as AcquisitionDocument;
  return parseMyfxbookTables(document);
}

function walkObjects(value: unknown, out: Record<string, unknown>[], depth = 0) {
  if (depth > 10 || out.length > 5000 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  out.push(object);
  for (const child of Object.values(object)) walkObjects(child, out, depth + 1);
}

function parseFxstreetEmbedded(document: AcquisitionDocument) {
  const objects: Record<string, unknown>[] = [];
  for (const payload of document.embeddedJson ?? []) walkObjects(payload.value, objects);
  const events: ScrapedEvent[] = [];
  for (const object of objects) {
    const dateRaw = object.dateUtc ?? object.DateUtc ?? object.date ?? object.Date ?? object.datetime ?? object.dateTime;
    const titleRaw = object.name ?? object.Name ?? object.event ?? object.Event ?? object.title ?? object.Title;
    if (!dateRaw || !titleRaw) continue;
    const dateMs = Date.parse(String(dateRaw));
    if (!Number.isFinite(dateMs)) continue;
    const currency = inferCurrency(object.currency ?? object.Currency ?? object.country ?? object.Country, String(titleRaw));
    if (!currency) continue;
    const title = String(titleRaw).trim();
    const providerId = clean(object.id ?? object.Id ?? object.eventDateId ?? object.idEcoCalendarDate ?? object.IdEcoCalendarDate);
    events.push({
      id: `fxstreet-${providerId ?? stableHash(`${new Date(dateMs).toISOString()}|${currency}|${title}`)}`,
      provider: 'fxstreet',
      providerId,
      date: new Date(dateMs).toISOString(),
      country: clean(object.country ?? object.Country) ?? currency,
      currency,
      event: title,
      category: clean(object.category ?? object.Category ?? object.type ?? object.Type) ?? 'Economic Calendar',
      importance: importance(object.volatility ?? object.Volatility ?? object.impact ?? object.Impact),
      actual: clean(object.actual ?? object.Actual ?? object.displayActual ?? object.DisplayActual),
      previous: clean(object.previous ?? object.Previous ?? object.displayPrevious ?? object.DisplayPrevious),
      forecast: clean(object.consensus ?? object.Consensus ?? object.forecast ?? object.Forecast ?? object.displayConsensus ?? object.DisplayConsensus),
      revised: clean(object.revised ?? object.Revised ?? object.displayRevised ?? object.DisplayRevised),
      lastUpdate: clean(object.lastUpdated ?? object.lastUpdate ?? object.LastUpdated),
      source: 'FXStreet',
    });
  }
  return events;
}

async function scrapeFxstreet(env: Env, storage: DurableObjectStorage) {
  const source = getAcquisitionSource('fxstreet-calendar');
  if (!source) return [];
  const document = await acquireSource(env, storage, source) as AcquisitionDocument;
  const embedded = parseFxstreetEmbedded(document);
  if (embedded.length) return embedded;
  const year = new Date().getUTCFullYear();
  return (document.tables ?? []).flatMap((table) => table.map((row) => eventFromTableRow(row, 'fxstreet', year)).filter((event): event is ScrapedEvent => Boolean(event)));
}

function parseCnbcText(document: AcquisitionDocument, from: Date, to: Date) {
  // CNBC does not expose a stable public calendar grid. This parser only accepts explicit
  // future schedule statements with a date and clock time; it never manufactures times.
  const text = document.text ?? '';
  const events: ScrapedEvent[] = [];
  const months = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const pattern = new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?[^.\\n]{0,140}?\\b(\\d{1,2}):(\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)\\s*(ET|EST|EDT)\\b[^.\\n]{0,180}`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && events.length < 80) {
    const year = Number(match[3] || from.getUTCFullYear());
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].findIndex((m) => match![1].toLowerCase().startsWith(m));
    let hour = Number(match[4]);
    if (/p/i.test(match[6]) && hour < 12) hour += 12;
    if (/a/i.test(match[6]) && hour === 12) hour = 0;
    // CNBC U.S. economic schedule references are Eastern Time. EDT=UTC-4, EST=UTC-5.
    const offset = match[7].toUpperCase() === 'EST' ? 5 : 4;
    const date = new Date(Date.UTC(year, month, Number(match[2]), hour + offset, Number(match[5])));
    if (date < from || date > to) continue;
    const context = match[0].replace(/\s+/g, ' ').trim();
    const title = context.replace(/^.*?\b(?:ET|EST|EDT)\b/i, '').replace(/^[-–—: ]+/, '').trim() || context;
    events.push({
      id: `cnbc-${stableHash(`${date.toISOString()}|USD|${title}`)}`,
      provider: 'cnbc',
      date: date.toISOString(),
      country: 'United States',
      currency: 'USD',
      event: title.slice(0, 180),
      category: 'CNBC Economic Schedule',
      importance: 2,
      source: 'CNBC',
    });
  }
  return events;
}

async function scrapeCnbc(env: Env, storage: DurableObjectStorage, from: Date, to: Date) {
  const source = getAcquisitionSource('cnbc-economy');
  if (!source) return [];
  try {
    const document = await acquireSource(env, storage, source) as AcquisitionDocument;
    return parseCnbcText(document, from, to);
  } catch {
    return [];
  }
}

function mergeEvents(events: ScrapedEvent[]) {
  const groups = new Map<string, ScrapedEvent[]>();
  for (const event of events) {
    const key = canonicalKey(event);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const merged = [...groups.entries()].map(([key, group]) => {
    group.sort((a, b) => SOURCE_PRIORITY.indexOf(a.provider) - SOURCE_PRIORITY.indexOf(b.provider));
    const primary = group[0];
    const providers = [...new Set(group.map((item) => item.provider))];
    const first = (field: keyof CalendarEvent) => clean(group.find((item) => clean(item[field]))?.[field]);
    const confidence = Math.min(1, 0.55 + (providers.includes('myfxbook') ? 0.2 : 0) + (providers.includes('fxstreet') ? 0.2 : 0) + (providers.includes('cnbc') ? 0.05 : 0));
    return {
      ...primary,
      id: `fxga-cal-${stableHash(key)}`,
      actual: first('actual'),
      previous: first('previous'),
      forecast: first('forecast'),
      revised: first('revised'),
      importance: Math.max(...group.map((item) => item.importance)),
      source: `FXGA Calendar Consensus: ${providers.map((p) => p === 'myfxbook' ? 'Myfxbook' : p === 'fxstreet' ? 'FXStreet' : 'CNBC').join(' + ')}`,
      providers,
      sourceCount: providers.length,
      confidence: Math.round(confidence * 100),
      canonicalKey: key,
      lastUpdate: new Date().toISOString(),
    } as CalendarEvent & { providers: string[]; sourceCount: number; confidence: number; canonicalKey: string };
  });

  return merged.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export async function getScrapedEconomicCalendar(env: Env, storage: DurableObjectStorage, days = 14) {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + Math.min(Math.max(days, 1), 21));
  to.setUTCHours(23, 59, 59, 999);

  const results = await Promise.allSettled([
    scrapeMyfxbook(env, storage, from, to),
    scrapeFxstreet(env, storage),
    scrapeCnbc(env, storage, from, to),
  ]);
  const events = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const filtered = events.filter((event) => {
    const time = Date.parse(event.date);
    return Number.isFinite(time) && time >= from.getTime() - 10 * 60_000 && time <= to.getTime();
  });
  const merged = mergeEvents(filtered);
  if (!merged.length) throw new Error('All scraped economic calendar sources returned no parseable events');
  return merged;
}

export async function refreshScrapedReleaseWindow(env: Env, storage: DurableObjectStorage, scheduled: CalendarEvent[]) {
  // Release-window checks stay cheap: Myfxbook is the primary real-time actual source.
  // FXStreet/CNBC remain schedule/corroboration sources and are not forced through Chromium
  // every few seconds, preserving Browser Run quota.
  const earliest = Math.min(...scheduled.map((event) => Date.parse(event.date)).filter(Number.isFinite));
  const latest = Math.max(...scheduled.map((event) => Date.parse(event.date)).filter(Number.isFinite));
  const from = new Date(earliest - 10 * 60_000);
  const to = new Date(latest + 10 * 60_000);
  const myfxbook = await scrapeMyfxbook(env, storage, from, to).catch(() => []);
  const merged = mergeEvents(myfxbook);

  return scheduled.map((event) => {
    const key = canonicalKey(event);
    const exact = merged.find((candidate) => canonicalKey(candidate) === key);
    if (exact) return { ...event, ...exact, id: event.id, source: event.source };
    const title = normalizeTitle(event.event);
    const currency = event.currency;
    const near = merged.find((candidate) => candidate.currency === currency && Math.abs(Date.parse(candidate.date) - Date.parse(event.date)) <= 2 * 60_000 && normalizeTitle(candidate.event) === title);
    return near ? { ...event, ...near, id: event.id, source: event.source } : event;
  });
}
