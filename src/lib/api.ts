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

export function fetchDashboard(): Promise<DashboardPayload> {
  return apiGetJson<DashboardPayload>('/api/dashboard', 'critical');
}

export function fetchMacroAnalysis(): Promise<MacroAnalysisPayload> {
  return apiGetJson<MacroAnalysisPayload>('/api/analysis', 'critical');
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

export function fetchSessionSignals(): Promise<SessionSignalsPayload> {
  return apiGetJson<SessionSignalsPayload>('/api/session-signals', 'critical');
}

export function fetchFredCatalog(): Promise<FredCatalogPayload> {
  return apiGetJson<FredCatalogPayload>('/api/fred/catalog');
}

export async function fetchFredCategory(category: string, limit = 16): Promise<MacroObservation[]> {
  const params = new URLSearchParams({ category, limit: String(limit) });
  const payload = await apiGetJson<{ series: MacroObservation[] }>(`/api/fred?${params.toString()}`);
  return payload.series;
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
