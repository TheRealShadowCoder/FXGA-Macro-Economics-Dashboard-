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

export interface MacroDimension {
  id: string;
  label: string;
  description: string;
  score: number;
  direction: 'positive' | 'negative' | 'neutral';
  coverage: string;
  contributors: Array<{ seriesId: string; title: string; score: number }>;
}

export interface MacroAnalysisPayload {
  generatedAt: string;
  regime: {
    name: string;
    growthScore: number;
    inflationScore: number;
    recessionRisk: number;
    summary: string;
  };
  dimensions: MacroDimension[];
  policy: {
    fedReactionScore: number;
    stance: string;
    ratesMomentum: number;
  };
  assets: Array<{ id: string; label: string; score: number; bias: string }>;
  confidence: number;
  coverage: { observed: number; requested: number };
  topSignals: Array<{ seriesId: string; title: string; score: number; value: number | null; date: string | null }>;
  methodology: {
    scoreRange: string;
    principle: string;
    caution: string;
  };
}

export interface AcquisitionMethodInfo {
  id: string;
  label: string;
  description: string;
  cost: 'low' | 'medium' | 'high';
}

export interface AcquisitionSourceInfo {
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

export interface BrowserBudgetStatus {
  dayUtc: string;
  usedSeconds: number;
  softLimitSeconds: number;
  remainingSeconds: number;
  browserSessionReuse: boolean;
  reason: string;
  nextLaunchAllowedAt: string | null;
}

export interface AcquisitionCatalogPayload {
  methods: AcquisitionMethodInfo[];
  sources: AcquisitionSourceInfo[];
  status: {
    websocketClients: number;
    inFlightSources: number;
    browserBudget: BrowserBudgetStatus;
    sources: number;
  } | null;
  limits: {
    externalSubrequestsPerInvocation: number;
    simultaneousOutgoingConnections: number;
    browserSoftBudgetSecondsPerUtcDay: number;
    browserConcurrentJobsInFxga: number;
    minBrowserLaunchGapSeconds: number;
  };
  policy: Record<string, boolean>;
}

export interface AcquisitionDocument {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  finalUrl: string;
  fetchedAt: string;
  contentType: string;
  official: boolean;
  methodsAvailable: string[];
  methodsUsed: string[];
  browserUsed: boolean;
  changed: boolean;
  warnings: string[];
  title: string;
  text: string;
  extraction: {
    textCharacters: number;
    links: number;
    embeddedPayloads: number;
    dataAttributes: number;
    tables: number;
  };
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
