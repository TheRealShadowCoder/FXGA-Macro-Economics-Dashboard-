import { ACQUISITION_METHODS, ACQUISITION_SOURCES, getAcquisitionSource } from './acquisition/registry';
import { ANALYSIS_SERIES, buildMacroAnalysis } from './analysis/macro';
import { FxgaCoordinator } from './coordinator';
import { getEconomicCalendar } from './providers/calendar';
import { DEFAULT_DASHBOARD_SERIES, getFredCatalog, getFredInternalSeries, getFredSeries, resolveFredSeries } from './providers/fred';
import { getOfficialNews } from './providers/rss';
import { sourceRegistry } from './sources';
import type { Env } from './types';

export { FxgaCoordinator };

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

function error(message: string, status = 400) {
  return json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

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

function coordinator(env: Env) {
  return env.FXGA_COORDINATOR.getByName('global');
}

async function dashboard(env: Env) {
  const errors: Array<{ provider: string; message: string }> = [];

  // Collector groups are intentionally serialized. Individual FRED/RSS providers
  // use <=5 concurrent upstream connections, leaving one connection of headroom
  // below Cloudflare Free's six simultaneous outgoing-connection ceiling.
  let macro: Awaited<ReturnType<typeof getFredSeries>> = [];
  let calendar: Awaited<ReturnType<typeof getEconomicCalendar>> = [];
  let news: Awaited<ReturnType<typeof getOfficialNews>> = [];

  try {
    macro = await getFredSeries(env, [...DEFAULT_DASHBOARD_SERIES]);
  } catch (caught) {
    errors.push({ provider: 'FRED', message: caught instanceof Error ? caught.message : 'Collector failed' });
  }

  try {
    calendar = await getEconomicCalendar(env, 7, 1);
  } catch (caught) {
    errors.push({ provider: 'Trading Economics', message: caught instanceof Error ? caught.message : 'Collector failed' });
  }

  try {
    news = await getOfficialNews();
  } catch (caught) {
    errors.push({ provider: 'Official RSS', message: caught instanceof Error ? caught.message : 'Collector failed' });
  }

  return {
    generatedAt: new Date().toISOString(),
    macro,
    calendar,
    news,
    sources: sourceRegistry(env),
    errors,
  };
}

async function macroAnalysis(env: Env) {
  // Dedicated internal path is capped at 40 series and still batches at five
  // concurrent FRED connections. The public /api/fred endpoint remains capped at 16.
  const observations = await getFredInternalSeries(env, [...ANALYSIS_SERIES]);
  return buildMacroAnalysis(observations);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 404 });

    if (url.pathname === '/api/live') {
      if (request.method !== 'GET') return error('Method not allowed', 405);
      const upstream = new Request('https://fxga-coordinator.internal/ws', request);
      return coordinator(env).fetch(upstream);
    }

    if (request.method !== 'GET') return error('Method not allowed', 405);

    try {
      if (url.pathname === '/api/health') {
        const statusResponse = await coordinator(env).fetch('https://fxga-coordinator.internal/status');
        const acquisition = statusResponse.ok ? await statusResponse.json() : null;
        return json({
          ok: true,
          app: env.APP_NAME || 'FXGA Macro Intelligence',
          timestamp: new Date().toISOString(),
          configured: {
            fred: Boolean(env.FRED_API_KEY),
            tradingEconomics: Boolean(env.TRADING_ECONOMICS_API_KEY),
            browserRun: Boolean(env.BROWSER),
            durableCoordinator: Boolean(env.FXGA_COORDINATOR),
          },
          fredUniverse: getFredCatalog().total,
          acquisition,
          safety: {
            workerSubrequestCeiling: 45,
            platformSubrequestLimitFree: 50,
            collectorMaxConcurrentConnections: 5,
            platformOutgoingConnectionLimit: 6,
            browserSoftBudgetSecondsPerUtcDay: Math.min(Number(env.BROWSER_SOFT_BUDGET_SECONDS || 480), 480),
            browserSessionReuse: false,
            websocketMode: 'Durable Object Hibernation',
          },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (url.pathname === '/api/sources') {
        return json({ sources: sourceRegistry(env) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
      }

      if (url.pathname === '/api/dashboard') {
        return cached(request, env, async () => json(await dashboard(env)), 300);
      }

      if (url.pathname === '/api/analysis') {
        return cached(request, env, async () => json(await macroAnalysis(env)), 600);
      }

      if (url.pathname === '/api/fred/catalog') {
        return json(getFredCatalog(), { headers: { 'Cache-Control': 'public, max-age=3600' } });
      }

      if (url.pathname === '/api/fred') {
        return cached(request, env, async () => {
          const raw = url.searchParams.get('series');
          const requested = raw ? raw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean) : undefined;
          const category = url.searchParams.get('category') || undefined;
          const query = url.searchParams.get('q') || undefined;
          const limit = Number(url.searchParams.get('limit') || 12);
          const selected = resolveFredSeries({ requested, category, query, limit });
          const series = await getFredSeries(env, selected.map((item) => item.id));
          return json({
            series,
            selection: {
              category: category ?? null,
              query: query ?? null,
              count: series.length,
            },
          });
        }, 300);
      }

      if (url.pathname === '/api/acquisition/catalog') {
        const statusResponse = await coordinator(env).fetch('https://fxga-coordinator.internal/status');
        const status = statusResponse.ok ? await statusResponse.json() : null;
        return json({
          methods: ACQUISITION_METHODS,
          sources: ACQUISITION_SOURCES,
          status,
          limits: {
            externalSubrequestsPerInvocation: 45,
            simultaneousOutgoingConnections: 6,
            collectorMaxConcurrentConnections: 5,
            browserSoftBudgetSecondsPerUtcDay: Math.min(Number(env.BROWSER_SOFT_BUDGET_SECONDS || 480), 480),
            browserConcurrentJobsInFxga: 1,
            minBrowserLaunchGapSeconds: 22,
          },
          policy: {
            publicPagesOnly: true,
            robotsAware: true,
            bypassLogin: false,
            bypassCaptcha: false,
            bypassPaywall: false,
            botEvasion: false,
          },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (url.pathname === '/api/acquire') {
        const sourceId = url.searchParams.get('source')?.trim() ?? '';
        const source = getAcquisitionSource(sourceId);
        if (!source) return error('Unknown or missing acquisition source', 404);
        const upstream = await coordinator(env).fetch(`https://fxga-coordinator.internal/acquire?source=${encodeURIComponent(sourceId)}`);
        const headers = new Headers(upstream.headers);
        for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
        return new Response(upstream.body, { status: upstream.status, headers });
      }

      if (url.pathname === '/api/calendar') {
        return cached(request, env, async () => {
          const days = Number(url.searchParams.get('days') || 7);
          const importance = Number(url.searchParams.get('importance') || 1);
          return json({ events: await getEconomicCalendar(env, days, importance) });
        }, 120);
      }

      if (url.pathname === '/api/news') {
        return cached(request, env, async () => {
          const source = url.searchParams.get('source') || undefined;
          return json({ items: await getOfficialNews(source) });
        }, 300);
      }

      return error('API route not found', 404);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unexpected collector error';
      return error(message, 502);
    }
  },
};
