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

const REQUEST_TIMEOUT_MS = 12_000;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function responseError(path: string, status: number, text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return new Error(parsed.error || `${path} failed with HTTP ${status}`);
  } catch {
    return new Error(text || `${path} failed with HTTP ${status}`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(path, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const error = responseError(path, response.status, text);
        if (attempt === 0 && TRANSIENT_STATUS.has(response.status)) {
          lastError = error;
          await sleep(350);
          continue;
        }
        throw error;
      }
      if (!text.trim()) throw new Error(`${path} returned an empty response`);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`${path} returned invalid JSON`);
      }
    } catch (error) {
      const normalized = error instanceof DOMException && error.name === 'AbortError'
        ? new Error(`${path} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`)
        : error instanceof Error ? error : new Error(`${path} request failed`);
      lastError = normalized;
      if (attempt === 0 && (normalized.name === 'TypeError' || normalized.message.includes('timed out'))) {
        await sleep(350);
        continue;
      }
      throw normalized;
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`${path} request failed`);
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
