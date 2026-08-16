export type SourceStatus = 'live' | 'needs_key' | 'error';

export interface SourceInfo {
  id: string;
  name: string;
  category: string;
  region: string;
  status: SourceStatus;
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

export interface FredSeriesDefinition {
  id: string;
  title: string;
  units: string;
  frequency: string;
  categories: string[];
}

export interface FredCategory {
  id: string;
  label: string;
  description: string;
  count: number;
}

export interface FredCatalogPayload {
  total: number;
  maxSeriesPerRequest: number;
  categories: FredCategory[];
  series: FredSeriesDefinition[];
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

export interface DashboardPayload {
  generatedAt: string;
  macro: MacroObservation[];
  calendar: CalendarEvent[];
  news: NewsItem[];
  sources: SourceInfo[];
  errors: Array<{ provider: string; message: string }>;
}
