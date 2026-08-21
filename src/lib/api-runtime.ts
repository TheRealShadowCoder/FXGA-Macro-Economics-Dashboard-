export type RequestPriority = 'critical' | 'normal' | 'background';

export type ApiRuntimeMetric = {
  path: string;
  startedAt: number;
  durationMs: number;
  status: number | null;
  attempt: number;
  fromCache: boolean;
  outcome: 'success' | 'fallback' | 'failure';
};

const TIMEOUTS = { first: 30_000, retry: 45_000, warmup: 20_000 } as const;
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
const LKG_MAX_AGE_MS = 5 * 60_000;
const WARM_FOR_MS = 60_000;
const MAX_CONCURRENT = 4;
const CIRCUIT_FAILURES = 4;
const CIRCUIT_COOLDOWN_MS = 20_000;
const metrics: ApiRuntimeMetric[] = [];
const inFlight = new Map<string, Promise<unknown>>();
const failures = new Map<string, { count: number; openedAt: number | null }>();
const waiters: Array<() => void> = [];
let active = 0;
let warmUntil = 0;
let warmPromise: Promise<void> | null = null;

const now = () => Date.now();
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
const jitter = (base: number) => Math.round(base * (0.8 + Math.random() * 0.4));
const cacheKey = (path: string) => `fxga:lkg:${path}`;
const circuitKey = (path: string) => path.split('?')[0];

function record(metric: ApiRuntimeMetric) {
  metrics.push(metric);
  if (metrics.length > 500) metrics.splice(0, metrics.length - 500);
}

export function apiRuntimeMetrics() {
  return metrics.slice();
}

export function apiRuntimeSummary() {
  const recent = metrics.slice(-100);
  const durations = recent.filter(x => x.outcome === 'success').map(x => x.durationMs).sort((a,b)=>a-b);
  const percentile = (p: number) => durations.length ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * p))] : null;
  return {
    requests: recent.length,
    successes: recent.filter(x => x.outcome === 'success').length,
    fallbacks: recent.filter(x => x.outcome === 'fallback').length,
    failures: recent.filter(x => x.outcome === 'failure').length,
    p50Ms: percentile(.50),
    p95Ms: percentile(.95),
    circuitsOpen: [...failures.entries()].filter(([,v]) => v.openedAt && now() - v.openedAt < CIRCUIT_COOLDOWN_MS).map(([k]) => k),
  };
}

function writeLkg(path: string, value: unknown) {
  try { sessionStorage.setItem(cacheKey(path), JSON.stringify({ at: now(), value })); } catch {}
}

function readLkg<T>(path: string): T | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; value?: T };
    if (!parsed.at || now() - parsed.at > LKG_MAX_AGE_MS) { sessionStorage.removeItem(cacheKey(path)); return null; }
    return parsed.value ?? null;
  } catch { return null; }
}

async function acquire(priority: RequestPriority) {
  const limit = priority === 'critical' ? MAX_CONCURRENT + 1 : MAX_CONCURRENT;
  if (active < limit) { active += 1; return; }
  await new Promise<void>(resolve => waiters.push(resolve));
  active += 1;
}
function release() { active = Math.max(0, active - 1); waiters.shift()?.(); }

function circuitOpen(path: string) {
  const state = failures.get(circuitKey(path));
  return Boolean(state?.openedAt && now() - state.openedAt < CIRCUIT_COOLDOWN_MS);
}
function success(path: string) { failures.delete(circuitKey(path)); }
function failure(path: string) {
  const key = circuitKey(path), state = failures.get(key) ?? { count: 0, openedAt: null };
  state.count += 1;
  if (state.count >= CIRCUIT_FAILURES) state.openedAt = now();
  failures.set(key, state);
}

async function warmApi() {
  if (now() < warmUntil) return;
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUTS.warmup);
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: controller.signal });
      if (response.ok) warmUntil = now() + WARM_FOR_MS;
    } catch {} finally { clearTimeout(timer); warmPromise = null; }
  })();
  return warmPromise;
}

function errorFrom(path: string, status: number, text: string) {
  try { const parsed = JSON.parse(text) as { error?: string }; return new Error(parsed.error || `${path} failed with HTTP ${status}`); }
  catch { return new Error(text || `${path} failed with HTTP ${status}`); }
}

async function perform<T>(path: string, priority: RequestPriority): Promise<T> {
  const startedAt = now();
  if (circuitOpen(path)) {
    const cached = readLkg<T>(path);
    if (cached != null) { record({ path, startedAt, durationMs: now()-startedAt, status: null, attempt: 0, fromCache: true, outcome: 'fallback' }); return cached; }
  }
  await warmApi();
  await acquire(priority);
  let lastError: Error | null = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = attempt ? TIMEOUTS.retry : TIMEOUTS.first;
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const requestStarted = now();
      try {
        const response = await fetch(path, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: controller.signal });
        const text = await response.text();
        if (!response.ok) {
          const error = errorFrom(path, response.status, text);
          if (attempt === 0 && TRANSIENT.has(response.status)) { lastError = error; await sleep(jitter(500)); continue; }
          throw error;
        }
        if (!text.trim()) throw new Error(`${path} returned an empty response`);
        const value = JSON.parse(text) as T;
        writeLkg(path, value); success(path); warmUntil = now() + WARM_FOR_MS;
        record({ path, startedAt: requestStarted, durationMs: now()-requestStarted, status: response.status, attempt: attempt+1, fromCache: false, outcome: 'success' });
        return value;
      } catch (caught) {
        const error = caught instanceof DOMException && caught.name === 'AbortError' ? new Error(`${path} timed out after ${timeoutMs/1000} seconds`) : caught instanceof Error ? caught : new Error(`${path} request failed`);
        lastError = error;
        if (attempt === 0 && (error.name === 'TypeError' || error.message.includes('timed out'))) { await sleep(jitter(500)); continue; }
        break;
      } finally { clearTimeout(timer); }
    }
  } finally { release(); }
  failure(path);
  const cached = readLkg<T>(path);
  if (cached != null) { record({ path, startedAt, durationMs: now()-startedAt, status: null, attempt: 2, fromCache: true, outcome: 'fallback' }); return cached; }
  record({ path, startedAt, durationMs: now()-startedAt, status: null, attempt: 2, fromCache: false, outcome: 'failure' });
  throw lastError ?? new Error(`${path} request failed`);
}

export function apiGetJson<T>(path: string, priority: RequestPriority = 'normal'): Promise<T> {
  const key = `GET:${path}`;
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const request = perform<T>(path, priority).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
