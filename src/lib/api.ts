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
import type { EventStudiesPayload } from './event-study-types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error || `Request failed with ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error;
      throw new Error(text || `Request failed with ${response.status}`);
    }
  }
  return JSON.parse(text) as T;
}

export function fetchDashboard(): Promise<DashboardPayload> {
  return getJson<DashboardPayload>('/api/dashboard');
}

export function fetchMacroAnalysis(): Promise<MacroAnalysisPayload> {
  return getJson<MacroAnalysisPayload>('/api/analysis');
}

export function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> {
  return getJson<EconomyAnalysisPayload>('/api/economy-analysis');
}

export function fetchGlobalMacro(): Promise<GlobalMacroPayload> {
  return getJson<GlobalMacroPayload>('/api/global-macro');
}

export function fetchReleaseImpact(): Promise<ReleaseImpactPayload> {
  return getJson<ReleaseImpactPayload>('/api/release-impact');
}

export function fetchSessionSignals(): Promise<SessionSignalsPayload> {
  return getJson<SessionSignalsPayload>('/api/session-signals');
}

export function fetchFredCatalog(): Promise<FredCatalogPayload> {
  return getJson<FredCatalogPayload>('/api/fred/catalog');
}

export async function fetchFredCategory(category: string, limit = 16): Promise<MacroObservation[]> {
  const params = new URLSearchParams({ category, limit: String(limit) });
  const payload = await getJson<{ series: MacroObservation[] }>(`/api/fred?${params.toString()}`);
  return payload.series;
}

export function fetchTechnicalSnapshot(): Promise<TechnicalSnapshotPayload> {
  return getJson<TechnicalSnapshotPayload>('/api/technical');
}

export function fetchTechnicalHistory(asset: string, timeframe: string): Promise<{ generatedAt: string | null; asset: string; timeframe: string; bias: string; quality: TechnicalTimeframeState['quality']; history: TechnicalTimeframeState['history'] }> {
  const params = new URLSearchParams({ asset, timeframe });
  return getJson(`/api/technical-history?${params.toString()}`);
}

export function fetchEventStudies(days = 7, currency = ''): Promise<EventStudiesPayload> {
  const params = new URLSearchParams({ days: String(days) });
  if (currency) params.set('currency', currency);
  return getJson<EventStudiesPayload>(`/api/event-studies?${params.toString()}`);
}

export function fetchAcquisitionCatalog(): Promise<AcquisitionCatalogPayload> {
  return getJson<AcquisitionCatalogPayload>('/api/acquisition/catalog');
}

export function acquireSource(sourceId: string): Promise<AcquisitionDocument> {
  return getJson<AcquisitionDocument>(`/api/acquire?source=${encodeURIComponent(sourceId)}`);
}
