import type { BrowserWorker } from '@cloudflare/playwright';

export interface Env {
  APP_NAME: string;
  CACHE_TTL_SECONDS: string;
  BROWSER_SOFT_BUDGET_SECONDS?: string;
  COLLECTOR_MODE?: string;
  COLLECTOR_WEBHOOK_SECRET?: string;
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
  units?: string;
  frequency?: string;
  categories?: string[];
  lastUpdated?: string;
  history: Array<{ date: string; value: number }>;
}

export type ReleaseOutcome = 'beat' | 'miss' | 'in-line' | 'pending' | 'no-consensus';

export interface ReleaseProbabilities {
  beat: number;
  miss: number;
  inLine: number;
  sampleSize: number;
  method: 'empirical-bayesian';
}

export interface FxstreetStyleAnalytics {
  expectedImpact: 'none' | 'low' | 'medium' | 'high';
  expectedImpactScore: number;
  nativeDeviation?: number;
  deviationPercentile?: number;
  consensusErrorZ?: number;
  revisionZ?: number;
  revisionAdjustedScore?: number;
  surpriseMomentum: 'accelerating' | 'decelerating' | 'stable' | 'insufficient-history';
  directionalConsistency?: number;
  historicalReliability: number;
  historicalMeanDeviation?: number;
  historicalDeviationStd?: number;
  sampleSize: number;
  methodology: 'fxga-transparent-fxstreet-style';
  marketImpactAvailability: {
    trueRange: 'requires-market-price-history';
    volatilityRatio: 'requires-market-price-history';
    trueRangeVsDeviation: 'requires-market-price-history';
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
  lastUpdate?: string;
  ticker?: string;
  symbol?: string;
  providers?: string[];
  sourceCount?: number;
  confidence?: number;
  canonicalKey?: string;
  deviation?: number;
  normalizedSurprise?: number;
  standardizedSurprise?: number;
  surprisePercent?: number;
  revisionDelta?: number;
  releaseScore?: number;
  outcome?: ReleaseOutcome;
  probabilities?: ReleaseProbabilities;
  fxstreetAnalytics?: FxstreetStyleAnalytics;
  relation?: boolean | null;
  betterThanExpected?: boolean;
  worseThanExpected?: boolean;
  preliminary?: boolean;
  eventId?: string;
  eventDateId?: string;
  analysisConfidence?: number;
  analysisNote?: string;
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
