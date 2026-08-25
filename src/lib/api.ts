import type {
  AcquisitionCatalogPayload,
  AcquisitionDocument,
  DashboardPayload,
  FredCatalogPayload,
  MacroAnalysisPayload,
  MacroObservation,
  ReleaseImpactPayload,
  SessionSignalsPayload,
  TechnicalSnapshotPayload,
  TechnicalTimeframeState,
} from './types';
import type { EconomyAnalysisPayload, GlobalMacroPayload } from './economy-types';
import type { EventPatternBacktestPayload, EventStudiesPayload, EventStudyHorizon } from './event-study-types';
import type { DataQualityPayload } from './data-quality-types';
import { apiGetJson } from './api-runtime';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const asFinite = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asNullableFinite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function normalizeObservation(value: unknown): MacroObservation {
  const row = asRecord(value);
  return {
    ...row,
    seriesId: asString(row.seriesId),
    title: asString(row.title, asString(row.seriesId)),
    value: asNullableFinite(row.value),
    date: row.date == null ? null : asString(row.date) || null,
    previous: asNullableFinite(row.previous),
    change: asNullableFinite(row.change),
    units: asString(row.units),
    frequency: asString(row.frequency),
    categories: asArray(row.categories).map(String),
    history: asArray(row.history)
      .map((item) => asRecord(item))
      .filter((item) => typeof item.date === 'string' && Number.isFinite(Number(item.value)))
      .map((item) => ({ date: String(item.date), value: Number(item.value) })),
  } as MacroObservation;
}

function normalizeCalendarEvent(value: unknown): DashboardPayload['calendar'][number] {
  const row = asRecord(value);
  const optionalNumbers = ['deviation', 'normalizedSurprise', 'standardizedSurprise', 'surprisePercent', 'revisionDelta', 'releaseScore', 'analysisConfidence', 'currencyBiasScore', 'biasConfidence', 'surpriseValue'] as const;
  const normalized: JsonRecord = { ...row };
  for (const key of optionalNumbers) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') normalized[key] = asFinite(row[key]);
    else delete normalized[key];
  }
  return {
    ...normalized,
    id: asString(row.id, `${asString(row.date)}:${asString(row.currency)}:${asString(row.event)}`),
    date: asString(row.date),
    country: asString(row.country),
    event: asString(row.event, 'Unnamed event'),
    category: asString(row.category),
    importance: Math.max(1, Math.min(3, Math.round(asFinite(row.importance, 1)))),
    providers: row.providers === undefined ? undefined : asArray(row.providers).map(String),
  } as DashboardPayload['calendar'][number];
}

function normalizeDashboardPayload(value: unknown): DashboardPayload {
  const raw = asRecord(value);
  const sources = asArray(raw.sources).map((value) => {
    const row = asRecord(value);
    const status = asString(row.status, 'error');
    return {
      ...row,
      id: asString(row.id),
      name: asString(row.name, asString(row.id, 'Source')),
      category: asString(row.category),
      region: asString(row.region),
      status: status === 'live' || status === 'needs_key' ? status : 'error',
    };
  }) as DashboardPayload['sources'];

  return {
    generatedAt: asString(raw.generatedAt, new Date(0).toISOString()),
    macro: asArray(raw.macro).map(normalizeObservation),
    calendar: asArray(raw.calendar).map(normalizeCalendarEvent),
    market: asArray(raw.market).map((value) => {
      const row = asRecord(value);
      return {
        ...row,
        id: asString(row.id, asString(row.symbol)),
        symbol: asString(row.symbol, asString(row.id)),
        label: asString(row.label, asString(row.symbol, asString(row.id))),
        price: asNullableFinite(row.price),
        change: asNullableFinite(row.change),
        changePercent: asNullableFinite(row.changePercent),
      };
    }) as NonNullable<DashboardPayload['market']>,
    news: asArray(raw.news).map((value) => {
      const row = asRecord(value);
      return {
        ...row,
        id: asString(row.id, asString(row.link)),
        sourceId: asString(row.sourceId),
        sourceName: asString(row.sourceName, 'Official source'),
        title: asString(row.title, 'Untitled publication'),
        link: asString(row.link, '#'),
        publishedAt: asString(row.publishedAt),
        category: asString(row.category),
        region: asString(row.region),
      };
    }) as DashboardPayload['news'],
    sources,
    errors: asArray(raw.errors).map((value) => {
      const row = asRecord(value);
      return { provider: asString(row.provider, 'Data source'), message: asString(row.message, 'Unknown collector error') };
    }),
  };
}

function normalizeMacroAnalysisPayload(value: unknown): MacroAnalysisPayload {
  const raw = asRecord(value);
  const regime = asRecord(raw.regime);
  const policy = asRecord(raw.policy);
  const coverage = asRecord(raw.coverage);
  const methodology = asRecord(raw.methodology);

  return {
    generatedAt: asString(raw.generatedAt, new Date(0).toISOString()),
    regime: {
      name: asString(regime.name, 'Mixed / insufficient evidence'),
      growthScore: asFinite(regime.growthScore),
      inflationScore: asFinite(regime.inflationScore),
      recessionRisk: asFinite(regime.recessionRisk),
      summary: asString(regime.summary, 'The stored macro snapshot does not contain a complete regime summary yet.'),
    },
    dimensions: asArray(raw.dimensions).map((value) => {
      const row = asRecord(value);
      const direction = asString(row.direction, 'neutral');
      return {
        id: asString(row.id),
        label: asString(row.label, asString(row.id, 'Macro dimension')),
        description: asString(row.description),
        score: asFinite(row.score),
        direction: direction === 'positive' || direction === 'negative' ? direction : 'neutral',
        coverage: asString(row.coverage),
        contributors: asArray(row.contributors).map((value) => {
          const item = asRecord(value);
          return { seriesId: asString(item.seriesId), title: asString(item.title, asString(item.seriesId)), score: asFinite(item.score) };
        }),
      };
    }) as MacroAnalysisPayload['dimensions'],
    policy: {
      fedReactionScore: asFinite(policy.fedReactionScore),
      stance: asString(policy.stance, 'Mixed policy stance'),
      ratesMomentum: asFinite(policy.ratesMomentum),
    },
    assets: asArray(raw.assets).map((value) => {
      const row = asRecord(value);
      return { id: asString(row.id), label: asString(row.label, asString(row.id)), score: asFinite(row.score), bias: asString(row.bias, 'neutral') };
    }),
    confidence: Math.max(0, Math.min(100, asFinite(raw.confidence))),
    coverage: { observed: Math.max(0, asFinite(coverage.observed)), requested: Math.max(0, asFinite(coverage.requested)) },
    topSignals: asArray(raw.topSignals).map((value) => {
      const row = asRecord(value);
      return {
        seriesId: asString(row.seriesId),
        title: asString(row.title, asString(row.seriesId, 'Macro signal')),
        score: asFinite(row.score),
        value: asNullableFinite(row.value),
        date: row.date == null ? null : asString(row.date) || null,
      };
    }),
    methodology: {
      scoreRange: asString(methodology.scoreRange, 'Normalized evidence score'),
      principle: asString(methodology.principle, 'Use only persisted evidence; missing fields remain unavailable.'),
      caution: asString(methodology.caution, 'Incomplete historical snapshots are compatibility-normalized and must not be interpreted as new evidence.'),
    },
  };
}

function normalizeSessionSignalsPayload(value: unknown): SessionSignalsPayload {
  const raw = asRecord(value);
  const sessions = asArray(raw.sessions).map((value) => {
    const row = asRecord(value);
    const state = asString(row.state, 'closed');
    const risk = asString(row.risk, 'normal');
    return {
      ...row,
      id: asString(row.id, 'overlap'),
      label: asString(row.label, 'Session'),
      windowUtc: asString(row.windowUtc),
      active: row.active === true,
      state: state === 'active' || state === 'upcoming' ? state : 'closed',
      risk: risk === 'elevated' || risk === 'event-lockout' ? risk : 'normal',
      focusCurrencies: asArray(row.focusCurrencies).map(String),
      eventCount: Math.max(0, asFinite(row.eventCount)),
      signals: asArray(row.signals).map((value) => {
        const signal = asRecord(value);
        const direction = asString(signal.direction, 'WAIT').toUpperCase();
        return {
          ...signal,
          symbol: asString(signal.symbol, 'UNKNOWN'),
          direction: direction === 'BUY' || direction === 'SELL' ? direction : 'WAIT',
          score: asFinite(signal.score),
          confidence: Math.max(0, Math.min(100, asFinite(signal.confidence))),
          rationale: asArray(signal.rationale).map(String),
          invalidation: asString(signal.invalidation, 'No stored invalidation is available.'),
        };
      }),
    };
  });

  return {
    ...raw,
    generatedAt: asString(raw.generatedAt, new Date(0).toISOString()),
    methodology: asString(raw.methodology, 'Persisted FXGA evidence'),
    caution: asString(raw.caution, 'Missing historical fields are not fabricated.'),
    macroRegime: asString(raw.macroRegime, 'Mixed / unavailable'),
    macroConfidence: Math.max(0, Math.min(100, asFinite(raw.macroConfidence))),
    sessions,
    technicalGeneratedAt: raw.technicalGeneratedAt == null ? null : asString(raw.technicalGeneratedAt) || null,
  } as SessionSignalsPayload;
}

export async function fetchDashboard(): Promise<DashboardPayload> {
  return normalizeDashboardPayload(await apiGetJson<unknown>('/api/dashboard', 'critical'));
}

export async function fetchMacroAnalysis(): Promise<MacroAnalysisPayload> {
  return normalizeMacroAnalysisPayload(await apiGetJson<unknown>('/api/analysis', 'critical'));
}

export function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> {
  return apiGetJson<EconomyAnalysisPayload>('/api/economy-analysis');
}

export function fetchGlobalMacro(): Promise<GlobalMacroPayload> {
  return apiGetJson<GlobalMacroPayload>('/api/global-macro');
}

export function fetchReleaseImpact(): Promise<ReleaseImpactPayload> {
  return apiGetJson<ReleaseImpactPayload>('/api/release-impact');
}

export async function fetchSessionSignals(): Promise<SessionSignalsPayload> {
  return normalizeSessionSignalsPayload(await apiGetJson<unknown>('/api/session-signals', 'critical'));
}

export function fetchFredCatalog(): Promise<FredCatalogPayload> {
  return apiGetJson<FredCatalogPayload>('/api/fred/catalog');
}

export async function fetchFredCategory(category: string, limit = 16): Promise<MacroObservation[]> {
  const params = new URLSearchParams({ category, limit: String(limit) });
  const payload = await apiGetJson<{ series: unknown[] }>(`/api/fred?${params.toString()}`);
  return asArray(payload.series).map(normalizeObservation);
}

export function fetchTechnicalSnapshot(): Promise<TechnicalSnapshotPayload> {
  return apiGetJson<TechnicalSnapshotPayload>('/api/technical');
}

export function fetchTechnicalHistory(asset: string, timeframe: string): Promise<{ generatedAt: string | null; asset: string; timeframe: string; bias: string; quality: TechnicalTimeframeState['quality']; history: TechnicalTimeframeState['history'] }> {
  const params = new URLSearchParams({ asset, timeframe });
  return apiGetJson(`/api/technical-history?${params.toString()}`);
}

export function fetchEventStudies(days = 60, currency = ''): Promise<EventStudiesPayload> {
  const params = new URLSearchParams({ days: String(days) });
  if (currency) params.set('currency', currency);
  return apiGetJson<EventStudiesPayload>(`/api/event-studies?${params.toString()}`, 'critical');
}

export function fetchEventPatternBacktests(options: { asset?: string; currency?: string; eventFamily?: string; horizon?: EventStudyHorizon; validatedOnly?: boolean; limit?: number } = {}): Promise<EventPatternBacktestPayload> {
  const params = new URLSearchParams();
  if (options.asset) params.set('asset', options.asset);
  if (options.currency) params.set('currency', options.currency);
  if (options.eventFamily) params.set('eventFamily', options.eventFamily);
  if (options.horizon) params.set('horizon', options.horizon);
  if (options.validatedOnly) params.set('validatedOnly', 'true');
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return apiGetJson<EventPatternBacktestPayload>(`/api/event-pattern-backtests${query ? `?${query}` : ''}`);
}

export function fetchEventStudySources<T>(): Promise<T> {
  return apiGetJson<T>('/api/event-study-sources');
}

export function fetchDataQuality(): Promise<DataQualityPayload> {
  return apiGetJson<DataQualityPayload>('/api/data-quality');
}

export function fetchAcquisitionCatalog(): Promise<AcquisitionCatalogPayload> {
  return apiGetJson<AcquisitionCatalogPayload>('/api/acquisition/catalog');
}

export function acquireSource(sourceId: string): Promise<AcquisitionDocument> {
  return apiGetJson<AcquisitionDocument>(`/api/acquire?source=${encodeURIComponent(sourceId)}`);
}
