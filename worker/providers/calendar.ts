import type { CalendarEvent, Env } from '../types';

const COUNTRIES = ['united states', 'euro area', 'united kingdom', 'japan', 'australia', 'canada', 'switzerland', 'new zealand', 'china'];
const MAX_CALENDAR_IDS_PER_REQUEST = 40;

function normalizeCalendarRow(row: Record<string, unknown>, index = 0): CalendarEvent {
  return {
    id: String(row.CalendarId ?? row.CalendarID ?? `${row.Date ?? ''}-${row.Event ?? ''}-${index}`),
    date: String(row.Date ?? ''),
    country: String(row.Country ?? ''),
    event: String(row.Event ?? row.Category ?? 'Economic event'),
    category: String(row.Category ?? ''),
    importance: Number(row.Importance ?? 1),
    actual: row.Actual == null || row.Actual === '' ? undefined : String(row.Actual),
    previous: row.Previous == null || row.Previous === '' ? undefined : String(row.Previous),
    forecast: row.Forecast == null || row.Forecast === '' ? undefined : String(row.Forecast),
    teForecast: row.TEForecast == null || row.TEForecast === '' ? undefined : String(row.TEForecast),
    revised: row.Revised == null || row.Revised === '' ? undefined : String(row.Revised),
    currency: row.Currency == null || row.Currency === '' ? undefined : String(row.Currency),
    unit: row.Unit == null || row.Unit === '' ? undefined : String(row.Unit),
    source: row.Source == null || row.Source === '' ? undefined : String(row.Source),
    lastUpdate: row.LastUpdate == null || row.LastUpdate === '' ? undefined : String(row.LastUpdate),
    ticker: row.Ticker == null || row.Ticker === '' ? undefined : String(row.Ticker),
    symbol: row.Symbol == null || row.Symbol === '' ? undefined : String(row.Symbol),
  };
}

async function fetchCalendarJson(env: Env, url: URL): Promise<CalendarEvent[]> {
  if (!env.TRADING_ECONOMICS_API_KEY) throw new Error('TRADING_ECONOMICS_API_KEY is not configured');
  url.searchParams.set('c', env.TRADING_ECONOMICS_API_KEY);
  url.searchParams.set('f', 'json');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Trading Economics returned ${response.status}`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map(normalizeCalendarRow).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export async function getEconomicCalendar(env: Env, days = 14, importance = 1): Promise<CalendarEvent[]> {
  const safeDays = Math.min(Math.max(days, 1), 31);
  const safeImportance = Math.min(Math.max(importance, 1), 3);
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + safeDays);
  const countries = COUNTRIES.map(encodeURIComponent).join(',');
  const url = new URL(`https://api.tradingeconomics.com/calendar/country/${countries}/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`);
  url.searchParams.set('importance', String(safeImportance));
  return fetchCalendarJson(env, url);
}

export async function getCalendarEventsByIds(env: Env, ids: string[]): Promise<CalendarEvent[]> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_CALENDAR_IDS_PER_REQUEST);
  if (!unique.length) return [];
  const url = new URL(`https://api.tradingeconomics.com/calendar/calendarid/${unique.map(encodeURIComponent).join(',')}`);
  return fetchCalendarJson(env, url);
}
