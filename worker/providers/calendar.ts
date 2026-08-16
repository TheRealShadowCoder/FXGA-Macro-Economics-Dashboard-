import type { CalendarEvent, Env } from '../types';

const COUNTRIES = ['united states', 'euro area', 'united kingdom', 'japan', 'australia', 'canada', 'switzerland', 'new zealand', 'china'];

export async function getEconomicCalendar(env: Env, days = 7, importance = 1): Promise<CalendarEvent[]> {
  if (!env.TRADING_ECONOMICS_API_KEY) throw new Error('TRADING_ECONOMICS_API_KEY is not configured');
  const safeDays = Math.min(Math.max(days, 1), 31);
  const safeImportance = Math.min(Math.max(importance, 1), 3);
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + safeDays);
  const countries = COUNTRIES.map(encodeURIComponent).join(',');
  const url = new URL(`https://api.tradingeconomics.com/calendar/country/${countries}/${from.toISOString().slice(0,10)}/${to.toISOString().slice(0,10)}`);
  url.searchParams.set('c', env.TRADING_ECONOMICS_API_KEY);
  url.searchParams.set('importance', String(safeImportance));

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Trading Economics returned ${response.status}`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows.map((row, index) => ({
    id: String(row.CalendarId ?? `${row.Date ?? ''}-${row.Event ?? ''}-${index}`),
    date: String(row.Date ?? ''),
    country: String(row.Country ?? ''),
    event: String(row.Event ?? row.Category ?? 'Economic event'),
    category: String(row.Category ?? ''),
    importance: Number(row.Importance ?? 1),
    actual: row.Actual == null ? undefined : String(row.Actual),
    previous: row.Previous == null ? undefined : String(row.Previous),
    forecast: row.Forecast == null ? undefined : String(row.Forecast),
    teForecast: row.TEForecast == null ? undefined : String(row.TEForecast),
    revised: row.Revised == null ? undefined : String(row.Revised),
    currency: row.Currency == null ? undefined : String(row.Currency),
    unit: row.Unit == null ? undefined : String(row.Unit),
    source: row.Source == null ? undefined : String(row.Source),
  })).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
