import type { Env, MacroObservation } from '../types';

export interface FredCategory {
  id: string;
  label: string;
  description: string;
}

export interface FredSeriesDefinition {
  id: string;
  title: string;
  units: string;
  frequency: string;
  categories: string[];
  importance: 'critical' | 'high';
}

export const FRED_CATEGORIES: FredCategory[] = [
  { id: 'inflation', label: 'Inflation', description: 'CPI, PCE and market inflation expectations that influence the policy path.' },
  { id: 'labour', label: 'Labour', description: 'Payrolls, unemployment, claims, vacancies and wage pressure.' },
  { id: 'growth', label: 'Growth', description: 'GDP and broad real-activity momentum.' },
  { id: 'liquidity', label: 'Liquidity', description: 'Fed balance sheet, reserves, reverse repo, Treasury cash and money supply.' },
  { id: 'credit', label: 'Credit', description: 'Bank credit, business lending, lending standards and corporate spreads.' },
  { id: 'policy-rates', label: 'Policy Rates', description: 'Federal funds and secured overnight policy transmission.' },
  { id: 'treasury-yields', label: 'Treasury Yields', description: 'Front-end and long-end Treasury yields most relevant to macro transmission.' },
  { id: 'yield-spreads', label: 'Yield Spreads', description: 'Curve slopes used for growth, policy and recession risk.' },
  { id: 'recession-risk', label: 'Recession Risk', description: 'Sahm Rule, recession probability and curve stress.' },
  { id: 'financial-conditions', label: 'Financial Conditions', description: 'Broad financial stress and easing/tightening conditions.' },
  { id: 'usd-fx', label: 'USD', description: 'Broad trade-weighted U.S. dollar conditions.' },
  { id: 'volatility', label: 'Volatility', description: 'Equity volatility as a cross-asset risk gauge.' },
  { id: 'consumption', label: 'Consumption', description: 'Retail demand and household sentiment.' },
  { id: 'leading-indicators', label: 'Leading', description: 'Forward-looking claims, activity, curve, sentiment and credit signals.' },
];

export const FRED_SERIES: FredSeriesDefinition[] = [
  { id: 'CPIAUCSL', title: 'Consumer Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'], importance: 'critical' },
  { id: 'CPILFESL', title: 'Core Consumer Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'], importance: 'critical' },
  { id: 'PCEPI', title: 'PCE Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'], importance: 'high' },
  { id: 'PCEPILFE', title: 'Core PCE Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'], importance: 'critical' },
  { id: 'T5YIE', title: '5-Year Breakeven Inflation Rate', units: '%', frequency: 'Daily', categories: ['inflation', 'leading-indicators'], importance: 'high' },

  { id: 'UNRATE', title: 'Unemployment Rate', units: '%', frequency: 'Monthly', categories: ['labour', 'recession-risk'], importance: 'critical' },
  { id: 'PAYEMS', title: 'Total Nonfarm Payrolls', units: 'Thousands', frequency: 'Monthly', categories: ['labour', 'growth'], importance: 'critical' },
  { id: 'ICSA', title: 'Initial Jobless Claims', units: 'Claims', frequency: 'Weekly', categories: ['labour', 'leading-indicators', 'recession-risk'], importance: 'critical' },
  { id: 'JTSJOL', title: 'Job Openings', units: 'Thousands', frequency: 'Monthly', categories: ['labour', 'leading-indicators'], importance: 'high' },
  { id: 'CES0500000003', title: 'Average Hourly Earnings', units: '$/hour', frequency: 'Monthly', categories: ['labour', 'inflation'], importance: 'critical' },

  { id: 'A191RL1Q225SBEA', title: 'Real GDP Growth', units: '% SAAR', frequency: 'Quarterly', categories: ['growth'], importance: 'critical' },
  { id: 'INDPRO', title: 'Industrial Production', units: 'Index', frequency: 'Monthly', categories: ['growth'], importance: 'high' },
  { id: 'CFNAI', title: 'Chicago Fed National Activity Index', units: 'Index', frequency: 'Monthly', categories: ['growth', 'leading-indicators'], importance: 'high' },

  { id: 'WALCL', title: 'Federal Reserve Total Assets', units: 'USD mn', frequency: 'Weekly', categories: ['liquidity'], importance: 'critical' },
  { id: 'WRESBAL', title: 'Reserve Balances with Federal Reserve Banks', units: 'USD mn', frequency: 'Weekly', categories: ['liquidity'], importance: 'critical' },
  { id: 'RRPONTSYD', title: 'Overnight Reverse Repo', units: 'USD bn', frequency: 'Daily', categories: ['liquidity'], importance: 'critical' },
  { id: 'WTREGEN', title: 'U.S. Treasury General Account', units: 'USD mn', frequency: 'Weekly', categories: ['liquidity'], importance: 'critical' },
  { id: 'M2SL', title: 'M2 Money Stock', units: 'USD bn', frequency: 'Monthly', categories: ['liquidity'], importance: 'high' },

  { id: 'TOTBKCR', title: 'Bank Credit: All Commercial Banks', units: 'USD bn', frequency: 'Weekly', categories: ['credit'], importance: 'high' },
  { id: 'BUSLOANS', title: 'Commercial & Industrial Loans', units: 'USD bn', frequency: 'Weekly', categories: ['credit'], importance: 'high' },
  { id: 'BAMLH0A0HYM2', title: 'ICE BofA U.S. High Yield OAS', units: '%', frequency: 'Daily', categories: ['credit', 'financial-conditions'], importance: 'critical' },
  { id: 'BAMLC0A4CBBB', title: 'ICE BofA BBB U.S. Corporate OAS', units: '%', frequency: 'Daily', categories: ['credit', 'financial-conditions'], importance: 'high' },
  { id: 'DRTSCILM', title: 'Banks Tightening C&I Lending Standards', units: '%', frequency: 'Quarterly', categories: ['credit', 'leading-indicators'], importance: 'high' },

  { id: 'FEDFUNDS', title: 'Effective Federal Funds Rate', units: '%', frequency: 'Monthly', categories: ['policy-rates'], importance: 'critical' },
  { id: 'SOFR', title: 'Secured Overnight Financing Rate', units: '%', frequency: 'Daily', categories: ['policy-rates', 'financial-conditions'], importance: 'high' },
  { id: 'DGS2', title: '2-Year Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'], importance: 'critical' },
  { id: 'DGS10', title: '10-Year Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'], importance: 'critical' },
  { id: 'T10Y2Y', title: '10Y-2Y Treasury Spread', units: '%', frequency: 'Daily', categories: ['yield-spreads', 'recession-risk', 'leading-indicators'], importance: 'critical' },
  { id: 'T10Y3M', title: '10Y-3M Treasury Spread', units: '%', frequency: 'Daily', categories: ['yield-spreads', 'recession-risk', 'leading-indicators'], importance: 'critical' },

  { id: 'SAHMREALTIME', title: 'Real-time Sahm Rule Recession Indicator', units: 'pp', frequency: 'Monthly', categories: ['recession-risk', 'leading-indicators'], importance: 'critical' },
  { id: 'RECPROUSM156N', title: 'Smoothed U.S. Recession Probability', units: '%', frequency: 'Monthly', categories: ['recession-risk'], importance: 'high' },
  { id: 'NFCI', title: 'Chicago Fed National Financial Conditions Index', units: 'Index', frequency: 'Weekly', categories: ['financial-conditions'], importance: 'critical' },
  { id: 'STLFSI4', title: 'St. Louis Fed Financial Stress Index', units: 'Index', frequency: 'Weekly', categories: ['financial-conditions'], importance: 'critical' },
  { id: 'DTWEXBGS', title: 'Nominal Broad U.S. Dollar Index', units: 'Index', frequency: 'Daily', categories: ['usd-fx'], importance: 'critical' },
  { id: 'VIXCLS', title: 'CBOE Volatility Index: VIX', units: 'Index', frequency: 'Daily', categories: ['volatility', 'financial-conditions'], importance: 'critical' },
  { id: 'RSAFS', title: 'Advance Retail Sales', units: 'USD mn', frequency: 'Monthly', categories: ['consumption', 'growth'], importance: 'critical' },
  { id: 'UMCSENT', title: 'University of Michigan Consumer Sentiment', units: 'Index', frequency: 'Monthly', categories: ['consumption', 'leading-indicators'], importance: 'high' },
] as const;

export const MAX_SERIES_PER_REQUEST = 16;
export const FRED_CONCURRENCY = 5;
const MAX_INTERNAL_SERIES = 40;

export const DEFAULT_DASHBOARD_SERIES = [
  'CPIAUCSL', 'CPILFESL', 'PCEPI', 'PCEPILFE', 'UNRATE', 'PAYEMS',
  'FEDFUNDS', 'DGS2', 'DGS10', 'T10Y2Y', 'DTWEXBGS', 'VIXCLS',
] as const;

const seriesById = new Map<string, FredSeriesDefinition>(FRED_SERIES.map((item) => [item.id, item]));
const categoryIds = new Set(FRED_CATEGORIES.map((item) => item.id));

function cleanNumber(value: string): number | null {
  if (!value || value === '.') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getFredCatalog() {
  return {
    total: FRED_SERIES.length,
    maxSeriesPerRequest: MAX_SERIES_PER_REQUEST,
    policy: { importantOnly: true, scope: 'Critical and high-importance series used by the FXGA macro decision engine.' },
    categories: FRED_CATEGORIES.map((category) => ({
      ...category,
      count: FRED_SERIES.filter((series) => series.categories.includes(category.id)).length,
    })),
    series: FRED_SERIES,
  };
}

export function resolveFredSeries(options: { requested?: string[]; category?: string; query?: string; limit?: number } = {}): FredSeriesDefinition[] {
  const limit = Math.min(Math.max(Number(options.limit ?? MAX_SERIES_PER_REQUEST), 1), MAX_SERIES_PER_REQUEST);
  if (options.requested?.length) {
    const unique = [...new Set(options.requested.map((id) => id.trim().toUpperCase()).filter(Boolean))];
    const invalid = unique.filter((id) => !seriesById.has(id));
    if (invalid.length) throw new Error(`Unknown or non-essential FRED series: ${invalid.join(', ')}`);
    return unique.slice(0, limit).map((id) => seriesById.get(id)!);
  }
  if (options.category && !categoryIds.has(options.category)) throw new Error(`Unknown FRED category: ${options.category}`);
  const query = options.query?.trim().toLowerCase();
  let selected = options.category
    ? FRED_SERIES.filter((series) => series.categories.includes(options.category!))
    : DEFAULT_DASHBOARD_SERIES.map((id) => seriesById.get(id)!);
  if (query) selected = selected.filter((series) => `${series.id} ${series.title} ${series.categories.join(' ')}`.toLowerCase().includes(query));
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
    seriesId: series.id, title: series.title,
    value: latest?.value ?? null, date: latest?.date ?? null,
    previous: previous?.value ?? null,
    change: latest && previous ? latest.value - previous.value : null,
    units: series.units, frequency: series.frequency, categories: series.categories, history,
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
  if (invalid.length) throw new Error(`Unknown or non-essential FRED series: ${invalid.join(', ')}`);
  return fetchSelectedFredSeries(env, unique.map((id) => seriesById.get(id)!));
}
