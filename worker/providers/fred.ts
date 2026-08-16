import type { Env, MacroObservation } from '../types';

export const CORE_SERIES = [
  { id: 'CPIAUCSL', title: 'Consumer Price Index', units: 'Index', frequency: 'Monthly' },
  { id: 'CPILFESL', title: 'Core Consumer Price Index', units: 'Index', frequency: 'Monthly' },
  { id: 'PCEPI', title: 'PCE Price Index', units: 'Index', frequency: 'Monthly' },
  { id: 'PCEPILFE', title: 'Core PCE Price Index', units: 'Index', frequency: 'Monthly' },
  { id: 'UNRATE', title: 'Unemployment Rate', units: '%', frequency: 'Monthly' },
  { id: 'PAYEMS', title: 'Total Nonfarm Payrolls', units: 'Thousands', frequency: 'Monthly' },
  { id: 'FEDFUNDS', title: 'Effective Federal Funds Rate', units: '%', frequency: 'Monthly' },
  { id: 'DGS2', title: 'US 2-Year Treasury Yield', units: '%', frequency: 'Daily' },
  { id: 'DGS10', title: 'US 10-Year Treasury Yield', units: '%', frequency: 'Daily' },
  { id: 'T10Y2Y', title: '10Y–2Y Treasury Spread', units: '%', frequency: 'Daily' },
  { id: 'DTWEXBGS', title: 'Broad U.S. Dollar Index', units: 'Index', frequency: 'Daily' },
  { id: 'VIXCLS', title: 'VIX', units: 'Index', frequency: 'Daily' },
] as const;

function cleanNumber(value: string): number | null {
  if (!value || value === '.') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function getFredSeries(env: Env, requested?: string[]): Promise<MacroObservation[]> {
  if (!env.FRED_API_KEY) throw new Error('FRED_API_KEY is not configured');
  const allowed = new Map<string, (typeof CORE_SERIES)[number]>(CORE_SERIES.map((item) => [item.id, item]));
  const selected = (requested?.length ? requested : CORE_SERIES.map((item) => item.id))
    .map((id) => allowed.get(id.toUpperCase()))
    .filter((item): item is (typeof CORE_SERIES)[number] => Boolean(item))
    .slice(0, 20);

  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 3);
  const observationStart = start.toISOString().slice(0, 10);

  return Promise.all(selected.map(async (series) => {
    const url = new URL('https://api.stlouisfed.org/fred/series/observations');
    url.searchParams.set('series_id', series.id);
    url.searchParams.set('api_key', env.FRED_API_KEY!);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('observation_start', observationStart);
    url.searchParams.set('sort_order', 'asc');

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`FRED ${series.id} returned ${response.status}`);
    const payload = await response.json() as { observations?: Array<{ date: string; value: string }> };
    const history = (payload.observations ?? [])
      .map((row) => ({ date: row.date, value: cleanNumber(row.value) }))
      .filter((row): row is { date: string; value: number } => row.value !== null);
    const recent = history.slice(-18);
    const latest = history.at(-1);
    const previous = history.at(-2);
    const change = latest && previous ? latest.value - previous.value : null;

    return {
      seriesId: series.id,
      title: series.title,
      value: latest?.value ?? null,
      date: latest?.date ?? null,
      previous: previous?.value ?? null,
      change,
      units: series.units,
      frequency: series.frequency,
      history: recent,
    };
  }));
}
