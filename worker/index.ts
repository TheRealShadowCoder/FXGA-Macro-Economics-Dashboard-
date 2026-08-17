import { ACQUISITION_METHODS, ACQUISITION_SOURCES, getAcquisitionSource } from './acquisition/registry';
import { analyzeCalendar } from './analysis/calendar';
import { buildReleaseImpact } from './analysis/release-impact';
import { buildSessionSignals } from './analysis/sessions';
import { verifyCollectorWebhook } from './collector-webhook';
import { FxgaCoordinator } from './coordinator';
import { DEFAULT_DASHBOARD_SERIES, getFredCatalog, getFredSeries, resolveFredSeries } from './providers/fred';
import { getOfficialNews } from './providers/rss';
import { sourceRegistry } from './sources';
import type { CalendarEvent, Env, MacroObservation } from './types';

export { FxgaCoordinator };

const CALENDAR_ENGINE_VERSION = 'scraped-consensus-v5';
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(data), { ...init, headers });
}
function error(message: string, status = 400) { return json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function cached(request: Request, env: Env, handler: () => Promise<Response>, ttlOverride?: number): Promise<Response> {
  if (request.method !== 'GET') return handler();
  const configured = Number(env.CACHE_TTL_SECONDS || 300);
  const ttl = Math.min(Math.max(ttlOverride ?? configured, 30), 3600);
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await handler();
  if (response.ok) {
    const copy = new Response(response.body, response);
    copy.headers.set('Cache-Control', `public, max-age=${ttl}`);
    await cache.put(key, copy.clone());
    return copy;
  }
  return response;
}
function coordinator(env: Env) { return env.FXGA_COORDINATOR.getByName('global-calendar-v3'); }
async function getSchedulerState(env: Env, bootstrap = false) {
  const response = await coordinator(env).fetch(`https://fxga-coordinator.internal/scheduler/state${bootstrap ? '?bootstrap=1' : ''}`);
  const payload = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(String(payload.error ?? 'Scheduler state unavailable'));
  return payload;
}
function coreMacroFromBaseline(observations: MacroObservation[]) {
  const ids = new Set<string>(DEFAULT_DASHBOARD_SERIES);
  return observations.filter((item) => ids.has(item.seriesId));
}
function schedulerEvents(scheduler: Record<string, any>) {
  const runtimes = [...(scheduler.active ?? []), ...(scheduler.upcoming ?? []), ...(scheduler.recent ?? [])];
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const runtime of runtimes) {
    const event = runtime?.event as CalendarEvent | undefined;
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id); events.push(event);
  }
  return events;
}
async function dashboard(env: Env) {
  const errors: Array<{ provider: string; message: string }> = [];
  let scheduler: Record<string, any> | null = null;
  let news: Awaited<ReturnType<typeof getOfficialNews>> = [];
  try { scheduler = await getSchedulerState(env, true); }
  catch (caught) { errors.push({ provider: 'Release Scheduler', message: caught instanceof Error ? caught.message : 'Scheduler failed' }); }
  try { news = await getOfficialNews(); }
  catch (caught) { errors.push({ provider: 'Official RSS', message: caught instanceof Error ? caught.message : 'Collector failed' }); }
  const observations = (scheduler?.baseline?.observations ?? []) as MacroObservation[];
  const upcoming = Array.isArray(scheduler?.upcoming) ? scheduler.upcoming.map((item: any) => item.event) : [];
  const active = Array.isArray(scheduler?.active) ? scheduler.active.map((item: any) => item.event) : [];
  return {
    generatedAt: new Date().toISOString(), macro: coreMacroFromBaseline(observations), calendar: analyzeCalendar([...active, ...upcoming].slice(0, 120)), news,
    sources: sourceRegistry(env), scheduler: scheduler ? {
      initialized: scheduler.initialized, mode: scheduler.mode ?? null, calendarSources: scheduler.calendarSources ?? [], calendarSyncedAt: scheduler.calendarSyncedAt ?? null,
      nextCalendarSyncAt: scheduler.nextCalendarSyncAt ?? null, nextReleaseAt: scheduler.nextReleaseAt ?? null, nextAlarmAt: scheduler.nextAlarmAt ?? null,
      active: scheduler.active ?? [], recent: scheduler.recent ?? [], stats: scheduler.stats ?? null, baselineGeneratedAt: scheduler.baseline?.generatedAt ?? null,
    } : null, errors,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 404 });

    if (url.pathname === '/api/collector-webhook') {
      if (request.method !== 'POST') return error('Method not allowed', 405);
      if (!env.COLLECTOR_WEBHOOK_SECRET) return error('Collector webhook is not configured', 503);
      try {
        const verified = await verifyCollectorWebhook(request, env.COLLECTOR_WEBHOOK_SECRET);
        const upstream = await coordinator(env).fetch(new Request('https://fxga-coordinator.internal/collector/webhook', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FXGA-Verified': '1', 'X-FXGA-Request-Id': verified.requestId }, body: verified.rawBody,
        }));
        return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders } });
      } catch (caught) { return error(caught instanceof Error ? caught.message : 'Collector webhook rejected', 401); }
    }

    if (url.pathname === '/api/live') {
      if (request.method !== 'GET') return error('Method not allowed', 405);
      return coordinator(env).fetch(new Request('https://fxga-coordinator.internal/ws', request));
    }
    if (request.method !== 'GET') return error('Method not allowed', 405);

    try {
      if (url.pathname === '/api/health') {
        const statusResponse = await coordinator(env).fetch('https://fxga-coordinator.internal/status');
        const acquisition = statusResponse.ok ? await statusResponse.json() as Record<string, any> : null;
        const external = env.COLLECTOR_MODE === 'external-webhook';
        return json({
          ok: true, app: env.APP_NAME || 'FXGA Macro Intelligence', calendarEngineVersion: CALENDAR_ENGINE_VERSION,
          collectorMode: external ? 'google-cloud-run-webhook' : 'cloudflare-native', timestamp: new Date().toISOString(),
          configured: {
            fred: Boolean(env.FRED_API_KEY), calendarScraping: !external, externalCollectorWebhook: Boolean(env.COLLECTOR_WEBHOOK_SECRET),
            calendarSources: ['Myfxbook', 'FXStreet', 'CNBC'], tradingEconomicsLegacyOptional: Boolean(env.TRADING_ECONOMICS_API_KEY),
            browserRun: Boolean(env.BROWSER), durableCoordinator: Boolean(env.FXGA_COORDINATOR),
          },
          fredUniverse: getFredCatalog().total, acquisition, scheduler: acquisition?.scheduler ?? null,
          safety: {
            workerSubrequestCeiling: 45, platformSubrequestLimitFree: 50, collectorMaxConcurrentConnections: external ? 0 : 5,
            platformOutgoingConnectionLimit: 6, browserSoftBudgetSecondsPerUtcDay: external ? 0 : Math.min(Number(env.BROWSER_SOFT_BUDGET_SECONDS || 480), 480),
            browserSessionReuse: !external, websocketMode: 'Durable Object Hibernation',
            releaseMode: external ? 'Google Cloud Tasks -> signed webhook' : 'Event-driven Durable Object alarms',
            normalStateUpstreamCalendarRequests: 0, normalStateUpstreamFredRequests: 0,
            releaseWindowPrimary: external ? 'Google Cloud Run collector' : 'FXStreet public calendar feed',
          },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (url.pathname === '/api/sources') return json({ sources: sourceRegistry(env) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
      if (url.pathname === '/api/dashboard') return cached(request, env, async () => json(await dashboard(env)), 60);
      if (url.pathname === '/api/analysis') {
        const scheduler = await getSchedulerState(env, true);
        if (!scheduler?.baseline?.analysis) return error('Macro baseline is not initialized', 503);
        return json(scheduler.baseline.analysis, { headers: { 'Cache-Control': 'public, max-age=60' } });
      }
      if (url.pathname === '/api/release-impact') {
        const scheduler = await getSchedulerState(env, true);
        if (!scheduler?.baseline?.analysis) return error('Macro baseline is not initialized', 503);
        return json(buildReleaseImpact(scheduler.baseline.analysis, schedulerEvents(scheduler)), { headers: { 'Cache-Control': 'public, max-age=15' } });
      }
      if (url.pathname === '/api/session-signals') {
        const scheduler = await getSchedulerState(env, true);
        if (!scheduler?.baseline?.analysis) return error('Macro baseline is not initialized', 503);
        return json(buildSessionSignals(scheduler.baseline.analysis, schedulerEvents(scheduler)), { headers: { 'Cache-Control': 'public, max-age=30' } });
      }
      if (url.pathname === '/api/release-state') return json(await getSchedulerState(env, true), { headers: { 'Cache-Control': 'no-store' } });
      if (url.pathname === '/api/release-history') {
        const id = url.searchParams.get('id')?.trim() ?? '';
        if (!id) return error('id is required');
        const response = await coordinator(env).fetch(`https://fxga-coordinator.internal/scheduler/release?id=${encodeURIComponent(id)}`);
        return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders } });
      }
      if (url.pathname === '/api/fred/catalog') return json(getFredCatalog(), { headers: { 'Cache-Control': 'public, max-age=3600' } });
      if (url.pathname === '/api/fred') {
        if (env.COLLECTOR_MODE === 'external-webhook') return error('Direct FRED collection is disabled in external collector mode; use the persisted macro baseline', 409);
        return cached(request, env, async () => {
          const raw = url.searchParams.get('series');
          const requested = raw ? raw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean) : undefined;
          const category = url.searchParams.get('category') || undefined;
          const query = url.searchParams.get('q') || undefined;
          const limit = Number(url.searchParams.get('limit') || 12);
          const selected = resolveFredSeries({ requested, category, query, limit });
          const series = await getFredSeries(env, selected.map((item) => item.id));
          return json({ series, selection: { category: category ?? null, query: query ?? null, count: series.length, importantOnly: true } });
        }, 300);
      }
      if (url.pathname === '/api/acquisition/catalog') {
        const statusResponse = await coordinator(env).fetch('https://fxga-coordinator.internal/status');
        const status = statusResponse.ok ? await statusResponse.json() : null;
        return json({ methods: ACQUISITION_METHODS, sources: ACQUISITION_SOURCES, status,
          limits: { externalSubrequestsPerInvocation: env.COLLECTOR_MODE === 'external-webhook' ? 0 : 45, simultaneousOutgoingConnections: 6,
            collectorMaxConcurrentConnections: env.COLLECTOR_MODE === 'external-webhook' ? 0 : 5,
            browserSoftBudgetSecondsPerUtcDay: env.COLLECTOR_MODE === 'external-webhook' ? 0 : Math.min(Number(env.BROWSER_SOFT_BUDGET_SECONDS || 480), 480),
            browserConcurrentJobsInFxga: env.COLLECTOR_MODE === 'external-webhook' ? 0 : 1, minBrowserLaunchGapSeconds: 22 },
          policy: { publicPagesOnly: true, robotsAware: true, bypassLogin: false, bypassCaptcha: false, bypassPaywall: false, botEvasion: false },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/acquire') {
        if (env.COLLECTOR_MODE === 'external-webhook') return error('Direct Cloudflare acquisition is disabled in external collector mode', 409);
        const sourceId = url.searchParams.get('source')?.trim() ?? '';
        const source = getAcquisitionSource(sourceId);
        if (!source) return error('Unknown or missing acquisition source', 404);
        const upstream = await coordinator(env).fetch(`https://fxga-coordinator.internal/acquire?source=${encodeURIComponent(sourceId)}`);
        const headers = new Headers(upstream.headers);
        for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
        return new Response(upstream.body, { status: upstream.status, headers });
      }
      if (url.pathname === '/api/calendar') {
        const scheduler = await getSchedulerState(env, true);
        const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 31);
        const importance = Math.min(Math.max(Number(url.searchParams.get('importance') || 1), 1), 3);
        const cutoff = Date.now() + days * 86_400_000;
        const rawEvents = [...(scheduler.active ?? []), ...(scheduler.upcoming ?? []), ...(scheduler.recent ?? [])]
          .map((item: any) => item.event).filter((event: any) => Number(event.importance ?? 1) >= importance && Date.parse(event.date) <= cutoff)
          .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date));
        const seen = new Set<string>();
        const events = analyzeCalendar(rawEvents.filter((event: CalendarEvent) => { if (seen.has(event.id)) return false; seen.add(event.id); return true; }));
        return json({ events, cached: true, mode: scheduler.mode ?? 'scraped-calendar-consensus', calendarSources: scheduler.calendarSources ?? ['Myfxbook', 'FXStreet', 'CNBC'],
          calendarSyncedAt: scheduler.calendarSyncedAt ?? null,
          analytics: { fxstreetDeviation: true, normalizedSurprise: true, standardizedSurprise: true, beatMissInlineProbabilities: true, revisionDelta: true, releaseScore: true },
        }, { headers: { 'Cache-Control': 'public, max-age=30' } });
      }
      if (url.pathname === '/api/news') return cached(request, env, async () => json({ items: await getOfficialNews(url.searchParams.get('source') || undefined) }), 300);
      return error('API route not found', 404);
    } catch (caught) { return error(caught instanceof Error ? caught.message : 'Unexpected collector error', 502); }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.COLLECTOR_MODE === 'external-webhook') return;
    ctx.waitUntil(coordinator(env).fetch('https://fxga-coordinator.internal/scheduler/sync').then(async (response) => {
      if (!response.ok) throw new Error(`Scheduled scraped-calendar sync returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }));
  },
};
