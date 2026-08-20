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
import type { DataQualityPayload } from './data-quality-types';

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_TIMEOUT_MS = 45_000;
const WARMUP_TIMEOUT_MS = 20_000;
const WARM_FOR_MS = 60_000;
const FALLBACK_MAX_AGE_MS = 5 * 60_000;
const MAX_CONCURRENT_REQUESTS = 3;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const CACHEABLE_PREFIXES = [
  '/api/dashboard',
  '/api/analysis',
  '/api/economy-analysis',
  '/api/global-macro',
  '/api/release-impact',
  '/api/session-signals',
  '/api/technical',
  '/api/data-quality',
];

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
let warmUntil = 0;
let warmPromise: Promise<void> | null = null;
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

function responseError(path: string, status: number, text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return new Error(parsed.error || `${path} failed with HTTP ${status}`);
  } catch {
    return new Error(text || `${path} failed with HTTP ${status}`);
  }
}

function cacheKey(path: string) {
  return `fxga-api-lkg:${path}`;
}

function cacheable(path: string) {
  return CACHEABLE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function writeFallbackCache(path: string, value: unknown) {
  if (!cacheable(path)) return;
  try {
    window.sessionStorage.setItem(cacheKey(path), JSON.stringify({ at: Date.now(), value }));
  } catch {}
}

function readFallbackCache<T>(path: string): T | null {
  if (!cacheable(path)) return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; value?: T };
    if (!parsed?.at || Date.now() - parsed.at > FALLBACK_MAX_AGE_MS) {
      window.sessionStorage.removeItem(cacheKey(path));
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

async function acquireRequestSlot() {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => requestWaiters.push(resolve));
  activeRequests += 1;
}

function releaseRequestSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = requestWaiters.shift();
  if (next) next();
}

async function ensureApiWarm() {
  if (Date.now() < warmUntil) return;
  if (warmPromise) return warmPromise;

  warmPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
    try {
      const response = await fetch('/api/health', {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.ok) warmUntil = Date.now() + WARM_FOR_MS;
    } catch {
      // A failed warm-up is not fatal. The real request still gets its normal retry path.
    } finally {
      window.clearTimeout(timer);
      warmPromise = null;
    }
  })();

  return warmPromise;
}

async function getJson<T>(path: string): Promise<T> {
  let lastError: Error | null = null;

  await ensureApiWarm();
  await acquireRequestSlot();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timeoutMs = attempt === 0 ? REQUEST_TIMEOUT_MS : RETRY_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
            await sleep(500);
            continue;
          }
          throw error;
        }
        if (!text.trim()) throw new Error(`${path} returned an empty response`);
        try {
          const parsed = JSON.parse(text) as T;
          writeFallbackCache(path, parsed);
          warmUntil = Date.now() + WARM_FOR_MS;
          return parsed;
        } catch {
          throw new Error(`${path} returned invalid JSON`);
        }
      } catch (error) {
        const normalized = error instanceof DOMException && error.name === 'AbortError'
          ? new Error(`${path} timed out after ${timeoutMs / 1000} seconds`)
          : error instanceof Error ? error : new Error(`${path} request failed`);
        lastError = normalized;
        if (attempt === 0 && (normalized.name === 'TypeError' || normalized.message.includes('timed out'))) {
          await sleep(500);
          continue;
        }
        break;
      } finally {
        window.clearTimeout(timer);
      }
    }
  } finally {
    releaseRequestSlot();
  }

  const fallback = readFallbackCache<T>(path);
  if (fallback != null) {
    console.warn(`FXGA API used a short-lived last-known-good fallback for ${path}`, lastError);
    return fallback;
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

export function fetchEventStudies(days = 60, currency = ''): Promise<EventStudiesPayload> {
  const params = new URLSearchParams({ days: String(days) });
  if (currency) params.set('currency', currency);
  return getJson<EventStudiesPayload>(`/api/event-studies?${params.toString()}`);
}

export function fetchDataQuality(): Promise<DataQualityPayload> {
  return getJson<DataQualityPayload>('/api/data-quality');
}

export function fetchAcquisitionCatalog(): Promise<AcquisitionCatalogPayload> {
  return getJson<AcquisitionCatalogPayload>('/api/acquisition/catalog');
}

export function acquireSource(sourceId: string): Promise<AcquisitionDocument> {
  return getJson<AcquisitionDocument>(`/api/acquire?source=${encodeURIComponent(sourceId)}`);
}
