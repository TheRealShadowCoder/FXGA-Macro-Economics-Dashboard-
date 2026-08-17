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
  importance?: 'critical' | 'high';
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
  policy?: { importantOnly: boolean; scope: string };
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
  regime: { name: string; growthScore: number; inflationScore: number; recessionRisk: number; summary: string };
  dimensions: MacroDimension[];
  policy: { fedReactionScore: number; stance: string; ratesMomentum: number };
  assets: Array<{ id: string; label: string; score: number; bias: string }>;
  confidence: number;
  coverage: { observed: number; requested: number };
  topSignals: Array<{ seriesId: string; title: string; score: number; value: number | null; date: string | null }>;
  methodology: { scoreRange: string; principle: string; caution: string };
}

export interface AcquisitionMethodInfo { id: string; label: string; description: string; cost: 'low' | 'medium' | 'high' }
export interface AcquisitionSourceInfo {
  id: string; name: string; url: string; category: string; region: string; methods: string[];
  cacheTtlSeconds: number; minIntervalSeconds: number; allowBrowser: boolean; official: boolean; expectedMarkers?: string[];
}
export interface BrowserBudgetStatus {
  dayUtc: string; usedSeconds: number; softLimitSeconds: number; remainingSeconds: number;
  browserSessionReuse: boolean; reason: string; nextLaunchAllowedAt: string | null;
}
export interface AcquisitionCatalogPayload {
  methods: AcquisitionMethodInfo[]; sources: AcquisitionSourceInfo[];
  status: { websocketClients: number; inFlightSources: number; browserBudget: BrowserBudgetStatus; sources: number } | null;
  limits: { externalSubrequestsPerInvocation: number; simultaneousOutgoingConnections: number; browserSoftBudgetSecondsPerUtcDay: number; browserConcurrentJobsInFxga: number; minBrowserLaunchGapSeconds: number };
  policy: Record<string, boolean>;
}
export interface AcquisitionDocument {
  sourceId: string; sourceName: string; sourceUrl: string; finalUrl: string; fetchedAt: string; contentType: string;
  official: boolean; methodsAvailable: string[]; methodsUsed: string[]; browserUsed: boolean; changed: boolean; warnings: string[];
  title: string; text: string;
  extraction: { textCharacters: number; links: number; embeddedPayloads: number; dataAttributes: number; tables: number };
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
  id: string; date: string; country: string; event: string; category: string; importance: number;
  actual?: string; previous?: string; forecast?: string; teForecast?: string; revised?: string; currency?: string; unit?: string;
  source?: string; providers?: string[]; sourceCount?: number; confidence?: number;
  deviation?: number; normalizedSurprise?: number; standardizedSurprise?: number; surprisePercent?: number;
  revisionDelta?: number; releaseScore?: number; outcome?: ReleaseOutcome; probabilities?: ReleaseProbabilities;
  fxstreetAnalytics?: FxstreetStyleAnalytics;
  relation?: boolean | null; betterThanExpected?: boolean; worseThanExpected?: boolean;
  analysisConfidence?: number; analysisNote?: string;
}

export interface ReleaseImpactAsset {
  id: 'usd' | 'rates' | 'gold' | 'equities' | 'crypto';
  label: string;
  score: number;
  baselineScore: number;
  releaseImpulse: number;
  bias: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ReleaseImpactPayload {
  generatedAt: string;
  regime: string;
  methodology: string;
  contributors: Array<{ event: string; currency: string; score: number; family: string; ageMinutes: number }>;
  assets: ReleaseImpactAsset[];
}

export interface SessionTradeSignal {
  symbol: string; direction: 'BUY' | 'SELL' | 'WAIT'; score: number; confidence: number; rationale: string[]; invalidation: string; catalyst?: string;
}
export interface SessionSignal {
  id: 'sydney' | 'tokyo' | 'london' | 'new-york' | 'overlap'; label: string; windowUtc: string; active: boolean;
  state: 'active' | 'upcoming' | 'closed'; risk: 'normal' | 'elevated' | 'event-lockout';
  focusCurrencies: string[]; nextCatalyst?: string; eventCount: number; signals: SessionTradeSignal[];
}
export interface SessionSignalsPayload {
  generatedAt: string; methodology: string; caution: string; macroRegime: string; macroConfidence: number; sessions: SessionSignal[];
}

export interface NewsItem {
  id: string; sourceId: string; sourceName: string; title: string; link: string; publishedAt: string; summary?: string; category: string; region: string;
}

export interface DashboardPayload {
  generatedAt: string; macro: MacroObservation[]; calendar: CalendarEvent[]; news: NewsItem[]; sources: SourceInfo[]; errors: Array<{ provider: string; message: string }>;
}
