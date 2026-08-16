export type AcquisitionMethod =
  | 'api-json'
  | 'csv-tsv'
  | 'xml-sdmx'
  | 'rss-atom'
  | 'static-html'
  | 'json-ld'
  | 'embedded-json'
  | 'data-attributes'
  | 'html-table'
  | 'playwright';

export interface AcquisitionSource {
  id: string;
  name: string;
  url: string;
  category: string;
  region: string;
  methods: string[];
  cacheTtlSeconds: number;
  minIntervalSeconds: number;
  allowBrowser: boolean;
  official: boolean;
  expectedMarkers?: string[];
}

export const ACQUISITION_METHODS: Array<{
  id: AcquisitionMethod;
  label: string;
  description: string;
  cost: 'low' | 'medium' | 'high';
}> = [
  { id: 'api-json', label: 'REST / JSON API', description: 'Preferred machine-readable API path with schema validation.', cost: 'low' },
  { id: 'csv-tsv', label: 'CSV / TSV', description: 'Structured delimited files with explicit column mapping and revision handling.', cost: 'low' },
  { id: 'xml-sdmx', label: 'XML / SDMX', description: 'Official XML and statistical SDMX feeds.', cost: 'low' },
  { id: 'rss-atom', label: 'RSS / Atom', description: 'Official release, speech and news feeds.', cost: 'low' },
  { id: 'static-html', label: 'Static HTML', description: 'Public page HTML extraction without JavaScript execution.', cost: 'low' },
  { id: 'json-ld', label: 'JSON-LD', description: 'Structured application/ld+json payloads embedded in public pages.', cost: 'low' },
  { id: 'embedded-json', label: 'Embedded App State', description: '__NEXT_DATA__, __NUXT_DATA__, application/json and hydration-state extraction.', cost: 'low' },
  { id: 'data-attributes', label: 'Semantic data-*', description: 'Public semantic data attributes and hydration metadata.', cost: 'low' },
  { id: 'html-table', label: 'HTML Tables', description: 'Semantic table extraction with row/cell normalization.', cost: 'low' },
  { id: 'playwright', label: 'Playwright / Chromium', description: 'JavaScript-rendered public-page fallback via Cloudflare Browser Run.', cost: 'high' },
];

export const ACQUISITION_SOURCES: AcquisitionSource[] = [
  {
    id: 'fed-press',
    name: 'Federal Reserve Press Releases',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    category: 'Central Bank',
    region: 'United States',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'fed-speeches',
    name: 'Federal Reserve Speeches',
    url: 'https://www.federalreserve.gov/feeds/speeches.xml',
    category: 'Central Bank',
    region: 'United States',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'ecb-press',
    name: 'European Central Bank Press & Speeches',
    url: 'https://www.ecb.europa.eu/rss/press.html',
    category: 'Central Bank',
    region: 'Euro Area',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'ecb-statistics',
    name: 'European Central Bank Statistical Releases',
    url: 'https://www.ecb.europa.eu/rss/statpress.html',
    category: 'Official Statistics',
    region: 'Euro Area',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'boe-speeches',
    name: 'Bank of England Speeches',
    url: 'https://www.bankofengland.co.uk/rss/speeches',
    category: 'Central Bank',
    region: 'United Kingdom',
    methods: ['rss-atom'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'boe-news',
    name: 'Bank of England News',
    url: 'https://www.bankofengland.co.uk/rss/news',
    category: 'Central Bank',
    region: 'United Kingdom',
    methods: ['rss-atom'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'rba-speeches',
    name: 'Reserve Bank of Australia Speeches',
    url: 'https://www.rba.gov.au/rss/rss-cb-speeches.xml',
    category: 'Central Bank',
    region: 'Australia',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'bls-latest',
    name: 'U.S. Bureau of Labor Statistics',
    url: 'https://www.bls.gov/feed/bls_latest.rss',
    category: 'Official Statistics',
    region: 'United States',
    methods: ['rss-atom'],
    cacheTtlSeconds: 300,
    minIntervalSeconds: 120,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'bea-news',
    name: 'U.S. Bureau of Economic Analysis News',
    url: 'https://www.bea.gov/news/rss.xml',
    category: 'Official Statistics',
    region: 'United States',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 600,
    minIntervalSeconds: 300,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'eia-today-in-energy',
    name: 'U.S. EIA Today in Energy',
    url: 'https://www.eia.gov/rss/todayinenergy.xml',
    category: 'Energy / Commodities',
    region: 'United States',
    methods: ['rss-atom', 'xml-sdmx'],
    cacheTtlSeconds: 900,
    minIntervalSeconds: 300,
    allowBrowser: false,
    official: true,
  },
  {
    id: 'treasury-press',
    name: 'U.S. Treasury Press Releases',
    url: 'https://home.treasury.gov/news/press-releases',
    category: 'Fiscal / Policy',
    region: 'United States',
    methods: ['static-html', 'json-ld', 'embedded-json', 'data-attributes'],
    cacheTtlSeconds: 600,
    minIntervalSeconds: 300,
    allowBrowser: false,
    official: true,
    expectedMarkers: ['Press Releases'],
  },
  {
    id: 'fxstreet-calendar',
    name: 'FXStreet Public Economic Calendar',
    url: 'https://www.fxstreet.com/economic-calendar',
    category: 'Economic Calendar',
    region: 'Global',
    methods: ['embedded-json', 'json-ld', 'data-attributes', 'html-table', 'static-html', 'playwright'],
    cacheTtlSeconds: 600,
    minIntervalSeconds: 300,
    allowBrowser: true,
    official: false,
    expectedMarkers: ['economic', 'calendar', 'actual', 'forecast', 'previous'],
  },
];

export function getAcquisitionSource(id: string) {
  return ACQUISITION_SOURCES.find((source) => source.id === id);
}
