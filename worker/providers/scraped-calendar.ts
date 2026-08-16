import { acquireSource } from '../acquisition/engine';
import { getAcquisitionSource } from '../acquisition/registry';
import type { CalendarEvent, Env } from '../types';

const MAJOR_CURRENCIES = ['AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'JPY', 'NZD', 'USD', 'ZAR'];
const SOURCE_PRIORITY: ScrapedEvent['provider'][] = ['myfxbook', 'fxstreet', 'cnbc'];
const SOURCE_STATUS_KEY = 'calendar:scrape-source-status:v1';

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

export interface CalendarSourceStatus {
  syncedAt: string;
  horizonDays: number;
  sources: Record<string, {
    name: string;
    ok: boolean;
    events: number;
    error?: string;
  }>;
  rawEvents: number;
  mergedEvents: number;
}

function csvRows(text: string): string[][] {
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

function importance(value: unknown): number {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('high') || raw === '3') return 3;
  if (raw.includes('medium') || raw.includes('moderate') || raw === '2') return 2;
  return 1;
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' ? text : undefined;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
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

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const right = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function titlesEquivalent(a: string, b: string): boolean {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);
  if (aa === bb) return true;
  if (aa.length >= 8 && bb.length >= 8 && (aa.includes(bb) || bb.includes(aa))) return true;
  return tokenSimilarity(aa, bb) >= 0.78;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function canonicalKey(event: Pick<CalendarEvent, 'date' | 'currency' | 'event'>): string {
  const date = new Date(event.date);
  if (!Number.isFinite(date.getTime())) return `${event.currency ?? 'UNK'}|invalid|${normalizeTitle(event.event)}`;
  date.setUTCSeconds(0, 0);
  return `${event.currency ?? 'UNK'}|${date.toISOString()}|${normalizeTitle(event.event)}`;
}

function parseDate(value: string, fallbackYear = new Date().getUTCFullYear()): string | null {
  const trimmed = value.trim();
  const direct = Date.parse(trimmed);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();

  // Myfxbook CSV format: "2026, August 17, 12:30"
  const myfx = trimmed.match(/^(\d{4}),\s*([A-Za-z]+)\s+(\d{1,2}),\s*([0-2]?\d):([0-5]\d)$/i);
  if (myfx) {
    const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      .indexOf(myfx[2].toLowerCase());
    if (month >= 0) return new Date(Date.UTC(Number(myfx[1]), month, Number(myfx[3]), Number(myfx[4]), Number(myfx[5]))).toISOString();
  }

  const match = trimmed.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\w*,?\s*([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?[, ]+([0-2]?\d):([0-5]\d)/i)
    ?? trimmed.match(/([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?[, ]+([0-2]?\d):([0-5]\d)/i);
  if (!match) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  const year = Number(match[3] || fallbackYear);
  return new Date(Date.UTC(year, month, Number(match[2]), Number(match[4]), Number(match[5]))).toISOString();
}

function inferCurrency(countryOrCurrency: unknown, text = ''): string | undefined {
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
  const title = clean(row[currencyIndex + 1]);
  if (!title) return null;
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
    previous: clean(row[impactIndex + 1]),
    forecast: clean(row[impactIndex + 2]),
    actual: clean(row[impactIndex + 3]),
    source: provider === 'myfxbook' ? 'Myfxbook' : provider === 'fxstreet' ? 'FXStreet' : 'CNBC',
  };
}

function tableEvents(document: AcquisitionDocument, provider: ScrapedEvent['provider']): ScrapedEvent[] {
  const year = new Date().getUTCFullYear();
  const events: ScrapedEvent[] = [];
  for (const table of document.tables ?? []) {
    for (const row of table) {
      const event = eventFromTableRow(row, provider, year);
      if (event) events.push(event);
    }
  }
  return events;
}

function myfxbookPreferenceHeaders(): Headers {
  const loggedOffCalendar = encodeURIComponent(JSON.stringify({
    importances: [3, 2, 1, 0],
    countries: [],
    currencies: MAJOR_CURRENCIES,
  }));
  return new Headers({
    Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'FXGA-Macro-Intelligence/1.0 (+public economic research collector)',
    Referer: 'https://www.myfxbook.com/forex-economic-calendar',
    Cookie: `timezone=0; locale=en; loggedOffCalendar=${loggedOffCalendar}`,
  });
}

function parseMyfxbookCsv(text: string): ScrapedEvent[] {
  const rows = csvRows(text);
  if (rows.length <= 1) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const indexOf = (names: string[]) => header.findIndex((cell) => names.some((name) => cell === name || cell.includes(name)));
  const dateIdx = indexOf(['date']);
  const currencyIdx = indexOf(['currency']);
  const eventIdx = indexOf(['event', 'name']);
  const impactIdx = indexOf(['impact']);
  const previousIdx = indexOf(['previous']);
  const consensusIdx = indexOf(['consensus', 'forecast']);
  const actualIdx = indexOf(['actual']);
  if (dateIdx < 0 || currencyIdx < 0 || eventIdx < 0) return [];

  const parsed: ScrapedEvent[] = [];
  for (const row of rows.slice(1)) {
    const date = parseDate(row[dateIdx] ?? '');
    const currency = clean(row[currencyIdx])?.toUpperCase();
    const title = clean(row[eventIdx]);
    if (!date || !currency || !title) continue;
    parsed.push({
      id: `myfxbook-${stableHash(`${date}|${currency}|${title}`)}`,
      provider: 'myfxbook',
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
    });
  }
  return parsed;
}

async function scrapeMyfxbook(
  env: Env,
  storage: DurableObjectStorage,
  from: Date,
  to: Date,
  allowRenderedFallback = true,
): Promise<ScrapedEvent[]> {
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
    const response = await fetch(exportUrl, {
      headers: myfxbookPreferenceHeaders(),
      redirect: 'follow',
    });
    if (response.ok) {
      const parsed = parseMyfxbookCsv(await response.text());
      if (parsed.length) return parsed;
    }
  } catch {
    // The daily schedule path can fall through to rendered public HTML. The rapid
    // release-window path deliberately returns no update rather than launching Chromium.
  }

  if (!allowRenderedFallback) return [];
  const source = getAcquisitionSource('myfxbook-calendar');
  if (!source) return [];
  const document = await acquireSource(env, storage, source) as AcquisitionDocument;
  return tableEvents(document, 'myfxbook');
}

function walkObjects(value: unknown, out: Record<string, unknown>[], depth = 0): void {
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

function parseFxstreetEmbedded(document: AcquisitionDocument): ScrapedEvent[] {
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

async function scrapeFxstreet(env: Env, storage: DurableObjectStorage): Promise<ScrapedEvent[]> {
  const source = getAcquisitionSource('fxstreet-calendar');
  if (!source) return [];
  const document = await acquireSource(env, storage, source) as AcquisitionDocument;
  const embedded = parseFxstreetEmbedded(document);
  return embedded.length ? embedded : tableEvents(document, 'fxstreet');
}

function parseCnbcText(document: AcquisitionDocument, from: Date, to: Date): ScrapedEvent[] {
  const text = document.text ?? '';
  const events: ScrapedEvent[] = [];
  const months = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const pattern = new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?[^.\\n]{0,140}?\\b(\\d{1,2}):(\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)\\s*(ET|EST|EDT)\\b[^.\\n]{0,180}`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && events.length < 80) {
    const year = Number(match[3] || from.getUTCFullYear());
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .findIndex((name) => match![1].toLowerCase().startsWith(name));
    if (month < 0) continue;
    let hour = Number(match[4]);
    if (/p/i.test(match[6]) && hour < 12) hour += 12;
    if (/a/i.test(match[6]) && hour === 12) hour = 0;
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

async function scrapeCnbc(env: Env, storage: DurableObjectStorage, from: Date, to: Date): Promise<ScrapedEvent[]> {
  const source = getAcquisitionSource('cnbc-economy');
  if (!source) return [];
  const document = await acquireSource(env, storage, source) as AcquisitionDocument;
  return parseCnbcText(document, from, to);
}

function sameConsensusGroup(a: ScrapedEvent, b: ScrapedEvent): boolean {
  if (a.currency !== b.currency) return false;
  const timeDiff = Math.abs(Date.parse(a.date) - Date.parse(b.date));
  if (!Number.isFinite(timeDiff) || timeDiff > 90_000) return false;
  return titlesEquivalent(a.event, b.event);
}

function mergeEvents(events: ScrapedEvent[]): CalendarEvent[] {
  const groups: ScrapedEvent[][] = [];
  const ordered = [...events].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || SOURCE_PRIORITY.indexOf(a.provider) - SOURCE_PRIORITY.indexOf(b.provider));

  for (const event of ordered) {
    const group = groups.find((candidate) => candidate.some((member) => sameConsensusGroup(member, event)));
    if (group) group.push(event);
    else groups.push([event]);
  }

  const merged: CalendarEvent[] = [];
  for (const group of groups) {
    group.sort((a, b) => SOURCE_PRIORITY.indexOf(a.provider) - SOURCE_PRIORITY.indexOf(b.provider));
    const primary = group[0];
    if (!primary) continue;
    const providers = [...new Set(group.map((item) => item.provider))];
    const first = (field: keyof CalendarEvent) => clean(group.find((item) => clean(item[field]))?.[field]);
    const confidence = Math.min(100, 55 + (providers.includes('myfxbook') ? 20 : 0) + (providers.includes('fxstreet') ? 20 : 0) + (providers.includes('cnbc') ? 5 : 0));
    const key = canonicalKey(primary);
    merged.push({
      ...primary,
      id: `fxga-cal-${stableHash(key)}`,
      actual: first('actual'),
      previous: first('previous'),
      forecast: first('forecast'),
      revised: first('revised'),
      importance: Math.max(...group.map((item) => item.importance)),
      source: `FXGA Calendar Consensus: ${providers.map((provider) => provider === 'myfxbook' ? 'Myfxbook' : provider === 'fxstreet' ? 'FXStreet' : 'CNBC').join(' + ')}`,
      providers,
      sourceCount: providers.length,
      confidence,
      canonicalKey: key,
      lastUpdate: new Date().toISOString(),
    });
  }
  return merged.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function sourceError(reason: unknown): string {
  return reason instanceof Error ? reason.message.slice(0, 300) : String(reason ?? 'Unknown scrape failure').slice(0, 300);
}

export async function getCalendarSourceStatus(storage: DurableObjectStorage): Promise<CalendarSourceStatus | null> {
  return (await storage.get<CalendarSourceStatus>(SOURCE_STATUS_KEY)) ?? null;
}

export async function getScrapedEconomicCalendar(env: Env, storage: DurableObjectStorage, days = 14): Promise<CalendarEvent[]> {
  const horizonDays = Math.min(Math.max(days, 1), 21);
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + horizonDays);
  to.setUTCHours(23, 59, 59, 999);

  const definitions = [
    { id: 'myfxbook', name: 'Myfxbook', task: scrapeMyfxbook(env, storage, from, to, true) },
    { id: 'fxstreet', name: 'FXStreet', task: scrapeFxstreet(env, storage) },
    { id: 'cnbc', name: 'CNBC', task: scrapeCnbc(env, storage, from, to) },
  ];
  const results = await Promise.allSettled(definitions.map((definition) => definition.task));
  const events: ScrapedEvent[] = [];
  const sourceStatus: CalendarSourceStatus = {
    syncedAt: new Date().toISOString(),
    horizonDays,
    sources: {},
    rawEvents: 0,
    mergedEvents: 0,
  };

  for (let index = 0; index < results.length; index += 1) {
    const definition = definitions[index];
    const result = results[index];
    if (!definition || !result) continue;
    if (result.status === 'fulfilled') {
      events.push(...result.value);
      sourceStatus.sources[definition.id] = {
        name: definition.name,
        ok: result.value.length > 0,
        events: result.value.length,
        ...(result.value.length ? {} : { error: 'No parseable calendar events returned.' }),
      };
    } else {
      sourceStatus.sources[definition.id] = { name: definition.name, ok: false, events: 0, error: sourceError(result.reason) };
    }
  }

  const filtered = events.filter((event) => {
    const time = Date.parse(event.date);
    return Number.isFinite(time) && time >= from.getTime() - 10 * 60_000 && time <= to.getTime();
  });
  const merged = mergeEvents(filtered);
  sourceStatus.rawEvents = filtered.length;
  sourceStatus.mergedEvents = merged.length;
  await storage.put(SOURCE_STATUS_KEY, sourceStatus);

  if (!merged.length) throw new Error('All scraped economic calendar sources returned no parseable events');
  return merged;
}

export async function refreshScrapedReleaseWindow(env: Env, storage: DurableObjectStorage, scheduled: CalendarEvent[]): Promise<CalendarEvent[]> {
  if (!scheduled.length) return [];
  const times = scheduled.map((event) => Date.parse(event.date)).filter(Number.isFinite);
  if (!times.length) return scheduled;
  const from = new Date(Math.min(...times) - 10 * 60_000);
  const to = new Date(Math.max(...times) + 10 * 60_000);

  // Rapid release checks use CSV only. If the lightweight export is temporarily empty,
  // retain the scheduled state and try again at the next event-window checkpoint rather
  // than launching Chromium repeatedly.
  const myfxbook = await scrapeMyfxbook(env, storage, from, to, false).catch(() => [] as ScrapedEvent[]);
  const merged = mergeEvents(myfxbook);

  return scheduled.map((event) => {
    const exact = merged.find((candidate) => canonicalKey(candidate) === canonicalKey(event));
    if (exact) return { ...event, ...exact, id: event.id, source: event.source };
    const near = merged.find((candidate) => candidate.currency === event.currency
      && Math.abs(Date.parse(candidate.date) - Date.parse(event.date)) <= 2 * 60_000
      && titlesEquivalent(candidate.event, event.event));
    return near ? { ...event, ...near, id: event.id, source: event.source } : event;
  });
}
