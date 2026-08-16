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
}

export const FRED_CATEGORIES: FredCategory[] = [
  { id: 'inflation', label: 'Inflation', description: 'Consumer prices, producer prices, PCE inflation and market inflation expectations.' },
  { id: 'labour', label: 'Labour', description: 'Employment, unemployment, participation, claims, vacancies, quits and wages.' },
  { id: 'growth', label: 'Growth', description: 'GDP, industrial production, capacity utilization and broad activity momentum.' },
  { id: 'liquidity', label: 'Liquidity', description: 'Federal Reserve balance sheet, bank reserves, money supply, reverse repo and Treasury cash.' },
  { id: 'credit', label: 'Credit', description: 'Bank credit, lending, corporate spreads and bank lending standards.' },
  { id: 'housing', label: 'Housing', description: 'Starts, permits, home sales, prices, mortgage rates and rental vacancies.' },
  { id: 'manufacturing', label: 'Manufacturing', description: 'Factory production, employment, orders and manufacturing capacity utilization.' },
  { id: 'policy-rates', label: 'Policy Rates', description: 'Federal funds, SOFR, reserve remuneration and overnight funding rates.' },
  { id: 'treasury-yields', label: 'Treasury Yields', description: 'The U.S. Treasury curve from one month through thirty years.' },
  { id: 'yield-spreads', label: 'Yield & Credit Spreads', description: 'Curve slopes and corporate credit compensation versus Treasuries.' },
  { id: 'recession-risk', label: 'Recession Risk', description: 'NBER recession flags, Sahm Rule, recession probabilities and leading stress signals.' },
  { id: 'financial-conditions', label: 'Financial Conditions', description: 'Chicago, St. Louis and Kansas City financial stress and conditions gauges.' },
  { id: 'usd-fx', label: 'USD & FX', description: 'Trade-weighted U.S. dollar indexes and major foreign-exchange rates.' },
  { id: 'volatility', label: 'Volatility', description: 'Equity, Nasdaq, gold and crude-oil option-implied volatility indexes.' },
  { id: 'consumption', label: 'Consumption', description: 'Personal consumption, retail sales, disposable income, savings and sentiment.' },
  { id: 'business-activity', label: 'Business Activity', description: 'Inventories, inventory-sales ratios, orders, production and utilization.' },
  { id: 'leading-indicators', label: 'Leading Indicators', description: 'Forward-looking permits, claims, curve slope, sentiment, orders and activity signals.' },
];

export const FRED_SERIES: FredSeriesDefinition[] = [
  { id: 'CPIAUCSL', title: 'Consumer Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'] },
  { id: 'CPILFESL', title: 'Core Consumer Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'] },
  { id: 'PCEPI', title: 'PCE Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'] },
  { id: 'PCEPILFE', title: 'Core PCE Price Index', units: 'Index', frequency: 'Monthly', categories: ['inflation'] },
  { id: 'PPIACO', title: 'Producer Price Index: All Commodities', units: 'Index', frequency: 'Monthly', categories: ['inflation'] },
  { id: 'PPIFIS', title: 'Producer Price Index: Final Demand', units: 'Index', frequency: 'Monthly', categories: ['inflation'] },
  { id: 'T5YIE', title: '5-Year Breakeven Inflation Rate', units: '%', frequency: 'Daily', categories: ['inflation', 'leading-indicators'] },
  { id: 'T10YIE', title: '10-Year Breakeven Inflation Rate', units: '%', frequency: 'Daily', categories: ['inflation'] },
  { id: 'T5YIFR', title: '5Y5Y Forward Inflation Expectation', units: '%', frequency: 'Daily', categories: ['inflation'] },

  { id: 'UNRATE', title: 'Unemployment Rate', units: '%', frequency: 'Monthly', categories: ['labour', 'recession-risk'] },
  { id: 'U6RATE', title: 'U-6 Underemployment Rate', units: '%', frequency: 'Monthly', categories: ['labour'] },
  { id: 'PAYEMS', title: 'Total Nonfarm Payrolls', units: 'Thousands', frequency: 'Monthly', categories: ['labour', 'growth'] },
  { id: 'CIVPART', title: 'Labor Force Participation Rate', units: '%', frequency: 'Monthly', categories: ['labour'] },
  { id: 'EMRATIO', title: 'Employment-Population Ratio', units: '%', frequency: 'Monthly', categories: ['labour'] },
  { id: 'ICSA', title: 'Initial Jobless Claims', units: 'Claims', frequency: 'Weekly', categories: ['labour', 'leading-indicators', 'recession-risk'] },
  { id: 'CCSA', title: 'Continued Jobless Claims', units: 'Claims', frequency: 'Weekly', categories: ['labour'] },
  { id: 'JTSJOL', title: 'Job Openings', units: 'Thousands', frequency: 'Monthly', categories: ['labour'] },
  { id: 'JTSQUR', title: 'Quits Rate', units: '%', frequency: 'Monthly', categories: ['labour'] },
  { id: 'CES0500000003', title: 'Average Hourly Earnings', units: '$/hour', frequency: 'Monthly', categories: ['labour', 'inflation'] },

  { id: 'GDPC1', title: 'Real Gross Domestic Product', units: 'Bn chained $', frequency: 'Quarterly', categories: ['growth'] },
  { id: 'GDP', title: 'Gross Domestic Product', units: 'Bn $', frequency: 'Quarterly', categories: ['growth'] },
  { id: 'A191RL1Q225SBEA', title: 'Real GDP Growth', units: '% SAAR', frequency: 'Quarterly', categories: ['growth'] },
  { id: 'INDPRO', title: 'Industrial Production', units: 'Index', frequency: 'Monthly', categories: ['growth', 'manufacturing', 'business-activity'] },
  { id: 'IPMAN', title: 'Manufacturing Production', units: 'Index', frequency: 'Monthly', categories: ['growth', 'manufacturing'] },
  { id: 'CFNAI', title: 'Chicago Fed National Activity Index', units: 'Index', frequency: 'Monthly', categories: ['growth', 'leading-indicators'] },
  { id: 'TCU', title: 'Capacity Utilization: Total', units: '%', frequency: 'Monthly', categories: ['growth', 'manufacturing', 'business-activity'] },

  { id: 'WALCL', title: 'Federal Reserve Total Assets', units: 'USD mn', frequency: 'Weekly', categories: ['liquidity'] },
  { id: 'WRESBAL', title: 'Reserve Balances with Federal Reserve Banks', units: 'USD mn', frequency: 'Weekly', categories: ['liquidity'] },
  { id: 'RRPONTSYD', title: 'Overnight Reverse Repo', units: 'USD bn', frequency: 'Daily', categories: ['liquidity'] },
  { id: 'WTREGEN', title: 'U.S. Treasury General Account', units: 'USD mn', frequency: 'Weekly', categories: ['liquidity'] },
  { id: 'M2SL', title: 'M2 Money Stock', units: 'USD bn', frequency: 'Monthly', categories: ['liquidity'] },
  { id: 'M1SL', title: 'M1 Money Stock', units: 'USD bn', frequency: 'Monthly', categories: ['liquidity'] },
  { id: 'BOGMBASE', title: 'Monetary Base: Total', units: 'USD mn', frequency: 'Monthly', categories: ['liquidity'] },

  { id: 'TOTBKCR', title: 'Bank Credit: All Commercial Banks', units: 'USD bn', frequency: 'Weekly', categories: ['credit'] },
  { id: 'BUSLOANS', title: 'Commercial & Industrial Loans', units: 'USD bn', frequency: 'Weekly', categories: ['credit', 'business-activity'] },
  { id: 'CONSUMER', title: 'Consumer Loans at Commercial Banks', units: 'USD bn', frequency: 'Weekly', categories: ['credit', 'consumption'] },
  { id: 'REALLN', title: 'Real Estate Loans at Commercial Banks', units: 'USD bn', frequency: 'Weekly', categories: ['credit', 'housing'] },
  { id: 'BAMLH0A0HYM2', title: 'ICE BofA U.S. High Yield OAS', units: '%', frequency: 'Daily', categories: ['credit', 'yield-spreads', 'financial-conditions'] },
  { id: 'BAMLC0A4CBBB', title: 'ICE BofA BBB U.S. Corporate OAS', units: '%', frequency: 'Daily', categories: ['credit', 'yield-spreads', 'financial-conditions'] },
  { id: 'DRTSCILM', title: 'Banks Tightening C&I Lending Standards', units: '%', frequency: 'Quarterly', categories: ['credit', 'leading-indicators'] },

  { id: 'HOUST', title: 'Housing Starts', units: 'Thousands SAAR', frequency: 'Monthly', categories: ['housing', 'growth'] },
  { id: 'PERMIT', title: 'Building Permits', units: 'Thousands SAAR', frequency: 'Monthly', categories: ['housing', 'leading-indicators'] },
  { id: 'HSN1F', title: 'New One-Family Houses Sold', units: 'Thousands SAAR', frequency: 'Monthly', categories: ['housing'] },
  { id: 'EXHOSLUSM495S', title: 'Existing Home Sales', units: 'Millions SAAR', frequency: 'Monthly', categories: ['housing'] },
  { id: 'CSUSHPINSA', title: 'S&P CoreLogic Case-Shiller U.S. Home Price Index', units: 'Index', frequency: 'Monthly', categories: ['housing'] },
  { id: 'MORTGAGE30US', title: '30-Year Fixed Mortgage Rate', units: '%', frequency: 'Weekly', categories: ['housing', 'leading-indicators'] },
  { id: 'MSPUS', title: 'Median Sales Price of Houses Sold', units: '$', frequency: 'Quarterly', categories: ['housing'] },
  { id: 'RRVRUSQ156N', title: 'Rental Vacancy Rate', units: '%', frequency: 'Quarterly', categories: ['housing'] },

  { id: 'MANEMP', title: 'Manufacturing Employment', units: 'Thousands', frequency: 'Monthly', categories: ['manufacturing', 'labour'] },
  { id: 'AMTMNO', title: 'Manufacturers New Orders: Total', units: 'USD mn', frequency: 'Monthly', categories: ['manufacturing', 'business-activity', 'leading-indicators'] },
  { id: 'DGORDER', title: 'Manufacturers New Orders: Durable Goods', units: 'USD mn', frequency: 'Monthly', categories: ['manufacturing', 'business-activity', 'leading-indicators'] },
  { id: 'MCUMFN', title: 'Manufacturing Capacity Utilization', units: '%', frequency: 'Monthly', categories: ['manufacturing'] },

  { id: 'FEDFUNDS', title: 'Effective Federal Funds Rate', units: '%', frequency: 'Monthly', categories: ['policy-rates'] },
  { id: 'DFF', title: 'Effective Federal Funds Rate: Daily', units: '%', frequency: 'Daily', categories: ['policy-rates'] },
  { id: 'SOFR', title: 'Secured Overnight Financing Rate', units: '%', frequency: 'Daily', categories: ['policy-rates', 'financial-conditions'] },
  { id: 'IORB', title: 'Interest Rate on Reserve Balances', units: '%', frequency: 'Daily', categories: ['policy-rates'] },
  { id: 'OBFR', title: 'Overnight Bank Funding Rate', units: '%', frequency: 'Daily', categories: ['policy-rates'] },

  { id: 'DGS1MO', title: '1-Month Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'] },
  { id: 'DGS3MO', title: '3-Month Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'] },
  { id: 'DGS2', title: '2-Year Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'] },
  { id: 'DGS5', title: '5-Year Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'] },
  { id: 'DGS10', title: '10-Year Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'] },
  { id: 'DGS30', title: '30-Year Treasury Yield', units: '%', frequency: 'Daily', categories: ['treasury-yields'] },

  { id: 'T10Y2Y', title: '10Y-2Y Treasury Spread', units: '%', frequency: 'Daily', categories: ['yield-spreads', 'recession-risk', 'leading-indicators'] },
  { id: 'T10Y3M', title: '10Y-3M Treasury Spread', units: '%', frequency: 'Daily', categories: ['yield-spreads', 'recession-risk', 'leading-indicators'] },
  { id: 'AAA10Y', title: 'Aaa Corporate Yield Minus 10Y Treasury', units: '%', frequency: 'Daily', categories: ['yield-spreads', 'credit'] },
  { id: 'BAA10Y', title: 'Baa Corporate Yield Minus 10Y Treasury', units: '%', frequency: 'Daily', categories: ['yield-spreads', 'credit'] },

  { id: 'USREC', title: 'NBER Recession Indicator: Monthly', units: '0/1', frequency: 'Monthly', categories: ['recession-risk'] },
  { id: 'USRECM', title: 'NBER Recession Indicator: Peak through Trough', units: '0/1', frequency: 'Monthly', categories: ['recession-risk'] },
  { id: 'SAHMREALTIME', title: 'Real-time Sahm Rule Recession Indicator', units: 'pp', frequency: 'Monthly', categories: ['recession-risk', 'leading-indicators'] },
  { id: 'RECPROUSM156N', title: 'Smoothed U.S. Recession Probability', units: '%', frequency: 'Monthly', categories: ['recession-risk'] },

  { id: 'NFCI', title: 'Chicago Fed National Financial Conditions Index', units: 'Index', frequency: 'Weekly', categories: ['financial-conditions'] },
  { id: 'ANFCI', title: 'Chicago Fed Adjusted Financial Conditions Index', units: 'Index', frequency: 'Weekly', categories: ['financial-conditions'] },
  { id: 'STLFSI4', title: 'St. Louis Fed Financial Stress Index', units: 'Index', frequency: 'Weekly', categories: ['financial-conditions'] },
  { id: 'KCFSI', title: 'Kansas City Financial Stress Index', units: 'Index', frequency: 'Monthly', categories: ['financial-conditions'] },

  { id: 'DTWEXBGS', title: 'Nominal Broad U.S. Dollar Index', units: 'Index', frequency: 'Daily', categories: ['usd-fx'] },
  { id: 'DTWEXAFEGS', title: 'U.S. Dollar Index: Advanced Foreign Economies', units: 'Index', frequency: 'Daily', categories: ['usd-fx'] },
  { id: 'DEXUSEU', title: 'U.S. Dollar to Euro Exchange Rate', units: 'USD/EUR', frequency: 'Daily', categories: ['usd-fx'] },
  { id: 'DEXUSUK', title: 'U.S. Dollar to British Pound Exchange Rate', units: 'USD/GBP', frequency: 'Daily', categories: ['usd-fx'] },
  { id: 'DEXJPUS', title: 'Japanese Yen to U.S. Dollar Exchange Rate', units: 'JPY/USD', frequency: 'Daily', categories: ['usd-fx'] },
  { id: 'DEXCAUS', title: 'Canadian Dollar to U.S. Dollar Exchange Rate', units: 'CAD/USD', frequency: 'Daily', categories: ['usd-fx'] },

  { id: 'VIXCLS', title: 'CBOE VIX', units: 'Index', frequency: 'Daily', categories: ['volatility', 'financial-conditions'] },
  { id: 'VXNCLS', title: 'CBOE Nasdaq 100 Volatility Index', units: 'Index', frequency: 'Daily', categories: ['volatility'] },
  { id: 'GVZCLS', title: 'CBOE Gold ETF Volatility Index', units: 'Index', frequency: 'Daily', categories: ['volatility'] },
  { id: 'OVXCLS', title: 'CBOE Crude Oil ETF Volatility Index', units: 'Index', frequency: 'Daily', categories: ['volatility'] },

  { id: 'PCEC96', title: 'Real Personal Consumption Expenditures', units: 'Bn chained $', frequency: 'Monthly', categories: ['consumption', 'growth'] },
  { id: 'PCE', title: 'Personal Consumption Expenditures', units: 'USD bn', frequency: 'Monthly', categories: ['consumption'] },
  { id: 'RSAFS', title: 'Advance Retail & Food Services Sales', units: 'USD mn', frequency: 'Monthly', categories: ['consumption', 'business-activity'] },
  { id: 'RRSFS', title: 'Advance Real Retail & Food Services Sales', units: 'Index/real', frequency: 'Monthly', categories: ['consumption'] },
  { id: 'DSPIC96', title: 'Real Disposable Personal Income', units: 'Bn chained $', frequency: 'Monthly', categories: ['consumption'] },
  { id: 'PSAVERT', title: 'Personal Saving Rate', units: '%', frequency: 'Monthly', categories: ['consumption'] },
  { id: 'UMCSENT', title: 'University of Michigan Consumer Sentiment', units: 'Index', frequency: 'Monthly', categories: ['consumption', 'leading-indicators'] },

  { id: 'BUSINV', title: 'Total Business Inventories', units: 'USD mn', frequency: 'Monthly', categories: ['business-activity'] },
  { id: 'ISRATIO', title: 'Business Inventories-to-Sales Ratio', units: 'Ratio', frequency: 'Monthly', categories: ['business-activity'] },
];

export const DEFAULT_DASHBOARD_SERIES = [
  'CPIAUCSL', 'PCEPILFE', 'UNRATE', 'PAYEMS', 'A191RL1Q225SBEA', 'INDPRO',
  'WALCL', 'FEDFUNDS', 'DGS2', 'DGS10', 'T10Y2Y', 'DTWEXBGS', 'VIXCLS', 'NFCI',
] as const;

export const MAX_SERIES_PER_REQUEST = 16;
const FRED_CONCURRENCY = 5;
const seriesById = new Map(FRED_SERIES.map((series) => [series.id, series]));
const categoryIds = new Set(FRED_CATEGORIES.map((category) => category.id));

function cleanNumber(value: string): number | null {
  if (!value || value === '.') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getFredCatalog() {
  return {
    total: FRED_SERIES.length,
    maxSeriesPerRequest: MAX_SERIES_PER_REQUEST,
    categories: FRED_CATEGORIES.map((category) => ({
      ...category,
      count: FRED_SERIES.filter((series) => series.categories.includes(category.id)).length,
    })),
    series: FRED_SERIES,
  };
}

export function resolveFredSeries(options: {
  requested?: string[];
  category?: string;
  query?: string;
  limit?: number;
} = {}): FredSeriesDefinition[] {
  const limit = Math.min(Math.max(Number(options.limit || 12), 1), MAX_SERIES_PER_REQUEST);

  if (options.requested?.length) {
    const requested = options.requested.map((id) => id.trim().toUpperCase()).filter(Boolean);
    const unknown = requested.filter((id) => !seriesById.has(id));
    if (unknown.length) throw new Error(`Unknown or unsupported FRED series: ${unknown.join(', ')}`);
    return requested.slice(0, MAX_SERIES_PER_REQUEST).map((id) => seriesById.get(id)!);
  }

  if (options.category && !categoryIds.has(options.category)) {
    throw new Error(`Unknown FRED category: ${options.category}`);
  }

  const query = options.query?.trim().toLowerCase();
  let selected = options.category
    ? FRED_SERIES.filter((series) => series.categories.includes(options.category!))
    : DEFAULT_DASHBOARD_SERIES.map((id) => seriesById.get(id)!);

  if (query) {
    selected = selected.filter((series) => `${series.id} ${series.title} ${series.categories.join(' ')}`.toLowerCase().includes(query));
  }

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
    history,
  };
}

export async function getFredSeries(env: Env, requestedIds?: string[]): Promise<MacroObservation[]> {
  if (!env.FRED_API_KEY) throw new Error('FRED_API_KEY is not configured');

  const selected = resolveFredSeries({ requested: requestedIds, limit: MAX_SERIES_PER_REQUEST });
  const results: MacroObservation[] = [];

  for (let index = 0; index < selected.length; index += FRED_CONCURRENCY) {
    const batch = selected.slice(index, index + FRED_CONCURRENCY);
    results.push(...await Promise.all(batch.map((series) => fetchFredSeries(env, series))));
  }

  return results;
}
