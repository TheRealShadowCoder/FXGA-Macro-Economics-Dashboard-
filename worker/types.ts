import type { BrowserWorker } from '@cloudflare/playwright';

export interface Env {
  APP_NAME: string;
  CACHE_TTL_SECONDS: string;
  BROWSER_SOFT_BUDGET_SECONDS?: string;
  FRED_API_KEY?: string;
  TRADING_ECONOMICS_API_KEY?: string;
  NEWS_API_KEY?: string;
  BROWSER: BrowserWorker;
  FXGA_COORDINATOR: DurableObjectNamespace;
}

export interface SourceInfo {
  id: string;
  name: string;
  category: string;
  region: string;
  status: 'live' | 'needs_key' | 'error';
  note?: string;
}

export interface MacroObservation {
  seriesId: string;
  title: string;
  value: number | null;
  date: string | null;
  previous: number | null;
  change: number | null;
  units: string;
  frequency: string;
  categories: string[];
  lastUpdated?: string;
  history: Array<{ date: string; value: number }>;
}

export interface CalendarEvent {
  id: string;
  date: string;
  country: string;
  event: string;
  category: string;
  importance: number;
  actual?: string;
  previous?: string;
  forecast?: string;
  teForecast?: string;
  revised?: string;
  currency?: string;
  unit?: string;
  source?: string;
  lastUpdate?: string;
  ticker?: string;
  symbol?: string;
  providers?: string[];
  sourceCount?: number;
  confidence?: number;
  canonicalKey?: string;
}

export interface NewsItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  link: string;
  publishedAt: string;
  summary?: string;
  category: string;
  region: string;
}
