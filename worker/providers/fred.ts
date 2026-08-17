import type { Env, MacroObservation } from '../types';
import { DEFAULT_DASHBOARD_SERIES, FRED_CATEGORIES, FRED_SERIES, type FredSeriesDefinition } from './fred-catalog';

export { DEFAULT_DASHBOARD_SERIES, FRED_CATEGORIES, FRED_SERIES } from './fred-catalog';
export type { FredCategory, FredSeriesDefinition, MacroEconomy } from './fred-catalog';

export const MAX_SERIES_PER_REQUEST = 16;
export const FRED_CONCURRENCY = 5;
const MAX_INTERNAL_SERIES = 40;

const seriesById = new Map<string, FredSeriesDefinition>(FRED_SERIES.map((item) => [item.id, item]));
const categoryIds = new Set(FRED_CATEGORIES.map((item) => item.id));

function cleanNumber(value: string): number | null {
  if (!value || value === '.') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getFredCatalog() {
  const economyCounts = new Map<string, number>();
  for (const series of FRED_SERIES) {
    for (const economy of series.economies) economyCounts.set(economy, (economyCounts.get(economy) ?? 0) + 1);
  }
  return {
    total: FRED_SERIES.length,
    maxSeriesPerRequest: MAX_SERIES_PER_REQUEST,
    policy: {
      importantOnly: true,
      scope: 'FXGA curated 109-series structural/risk universe. Cloud Run adds a dynamic international FRED layer for USA, Europe, UK, South Africa and Japan.',
      globalCoverage: ['USA', 'EUROPE', 'UK', 'SOUTH_AFRICA', 'JAPAN'],
      dynamicCollectorTarget: 180,
    },
    economies: Object.fromEntries(economyCounts),
    categories: FRED_CATEGORIES.map((category) => ({
      ...category,
      count: FRED_SERIES.filter((series) => series.categories.includes(category.id)).length,
    })),
    series: FRED_SERIES,
  };
}

export function resolveFredSeries(options: { requested?: string[]; category?: string; query?: string; economy?: string; limit?: number } = {}): FredSeriesDefinition[] {
  const limit = Math.min(Math.max(Number(options.limit ?? MAX_SERIES_PER_REQUEST), 1), MAX_SERIES_PER_REQUEST);
  if (options.requested?.length) {
    const unique = [...new Set(options.requested.map((id) => id.trim().toUpperCase()).filter(Boolean))];
    const invalid = unique.filter((id) => !seriesById.has(id));
    if (invalid.length) throw new Error(`Unknown or non-curated FRED series: ${invalid.join(', ')}`);
    return unique.slice(0, limit).map((id) => seriesById.get(id)!);
  }
  if (options.category && !categoryIds.has(options.category)) throw new Error(`Unknown FRED category: ${options.category}`);
  const query = options.query?.trim().toLowerCase();
  const economy = options.economy?.trim().toUpperCase();
  let selected = options.category
    ? FRED_SERIES.filter((series) => series.categories.includes(options.category!))
    : DEFAULT_DASHBOARD_SERIES.map((id) => seriesById.get(id)!);
  if (economy) selected = selected.filter((series) => series.economies.includes(economy as any));
  if (query) selected = selected.filter((series) => `${series.id} ${series.title} ${series.categories.join(' ')} ${series.economies.join(' ')}`.toLowerCase().includes(query));
  return selected.slice(0, limit);
}

async function fetchFredSeries(env: Env, series: FredSeriesDefinition): Promise<MacroObservation> {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', series.id);
  url.searchParams.set('api_key', env.FRED_API_KEY!);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '18');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`FRED ${series.id} returned ${response.status}`);
  const payload = await response.json() as { observations?: Array<{ date: string; value: string }> };
  const history = (payload.observations ?? [])
    .map((row) => ({ date: row.date, value: cleanNumber(row.value) }))
    .filter((row): row is { date: string; value: number } => row.value !== null)
    .reverse();
  const latest = history.at(-1);
  const previous = history.at(-2);
  return {
    seriesId: series.id,
    title: series.title,
    value: latest?.value ?? null,
    date: latest?.date ?? null,
    previous: previous?.value ?? null,
    change: latest && previous ? latest.value - previous.value : null,
    units: series.units,
    frequency: series.frequency,
    categories: series.categories,
    economy: series.economies[0] ?? 'USA',
    economies: series.economies,
    importance: series.importance,
    source: 'FRED',
    history,
  };
}

async function fetchSelectedFredSeries(env: Env, selected: FredSeriesDefinition[]): Promise<MacroObservation[]> {
  const results: MacroObservation[] = [];
  for (let index = 0; index < selected.length; index += FRED_CONCURRENCY) {
    const batch = selected.slice(index, index + FRED_CONCURRENCY);
    results.push(...await Promise.all(batch.map((series) => fetchFredSeries(env, series))));
  }
  return results;
}

export async function getFredSeries(env: Env, requestedIds?: string[]): Promise<MacroObservation[]> {
  if (!env.FRED_API_KEY) throw new Error('FRED_API_KEY is not configured');
  const selected = resolveFredSeries({ requested: requestedIds, limit: MAX_SERIES_PER_REQUEST });
  return fetchSelectedFredSeries(env, selected);
}

export async function getFredInternalSeries(env: Env, requestedIds: string[]): Promise<MacroObservation[]> {
  if (!env.FRED_API_KEY) throw new Error('FRED_API_KEY is not configured');
  const unique = [...new Set(requestedIds.map((id) => id.trim().toUpperCase()).filter(Boolean))];
  if (unique.length > MAX_INTERNAL_SERIES) throw new Error(`Internal FRED request exceeds ${MAX_INTERNAL_SERIES} series safety cap`);
  const invalid = unique.filter((id) => !seriesById.has(id));
  if (invalid.length) throw new Error(`Unknown or non-curated FRED series: ${invalid.join(', ')}`);
  return fetchSelectedFredSeries(env, unique.map((id) => seriesById.get(id)!));
}
