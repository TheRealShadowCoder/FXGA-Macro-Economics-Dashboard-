import { getEconomicCalendar } from './providers/calendar';
import { CORE_SERIES, getFredSeries } from './providers/fred';
import { getOfficialNews } from './providers/rss';
import { sourceRegistry } from './sources';
import type { Env } from './types';

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

async function cached(request: Request, env: Env, handler: () => Promise<Response>): Promise<Response> {
  if (request.method !== 'GET') return handler();
  const ttl = Math.min(Math.max(Number(env.CACHE_TTL_SECONDS || 300), 30), 3600);
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

async function dashboard(env: Env) {
  const [macroResult, calendarResult, newsResult] = await Promise.allSettled([
    getFredSeries(env),
    getEconomicCalendar(env, 7, 1),
    getOfficialNews(),
  ]);

  const errors: Array<{ provider: string; message: string }> = [];
  if (macroResult.status === 'rejected') errors.push({ provider: 'FRED', message: macroResult.reason instanceof Error ? macroResult.reason.message : 'Collector failed' });
  if (calendarResult.status === 'rejected') errors.push({ provider: 'Trading Economics', message: calendarResult.reason instanceof Error ? calendarResult.reason.message : 'Collector failed' });
  if (newsResult.status === 'rejected') errors.push({ provider: 'Official RSS', message: newsResult.reason instanceof Error ? newsResult.reason.message : 'Collector failed' });

  return {
    generatedAt: new Date().toISOString(),
    macro: macroResult.status === 'fulfilled' ? macroResult.value : [],
    calendar: calendarResult.status === 'fulfilled' ? calendarResult.value : [],
    news: newsResult.status === 'fulfilled' ? newsResult.value : [],
    sources: sourceRegistry(env),
    errors,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 404 });
    if (request.method !== 'GET') return error('Method not allowed', 405);

    try {
      if (url.pathname === '/api/health') {
        return json({
          ok: true,
          app: env.APP_NAME || 'FXGA Macro Intelligence',
          timestamp: new Date().toISOString(),
          configured: {
            fred: Boolean(env.FRED_API_KEY),
            tradingEconomics: Boolean(env.TRADING_ECONOMICS_API_KEY),
          },
        }, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (url.pathname === '/api/sources') {
        return json({ sources: sourceRegistry(env) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
      }

      if (url.pathname === '/api/dashboard') {
        return cached(request, env, async () => json(await dashboard(env)));
      }

      if (url.pathname === '/api/fred') {
        return cached(request, env, async () => {
          const raw = url.searchParams.get('series');
          const requested = raw ? raw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean) : undefined;
          if (requested?.some((id) => !CORE_SERIES.some((series) => series.id === id))) {
            return error('One or more FRED series are not in the server allowlist');
          }
          return json({ series: await getFredSeries(env, requested) });
        });
      }

      if (url.pathname === '/api/calendar') {
        return cached(request, env, async () => {
          const days = Number(url.searchParams.get('days') || 7);
          const importance = Number(url.searchParams.get('importance') || 1);
          return json({ events: await getEconomicCalendar(env, days, importance) });
        });
      }

      if (url.pathname === '/api/news') {
        return cached(request, env, async () => {
          const source = url.searchParams.get('source') || undefined;
          return json({ items: await getOfficialNews(source) });
        });
      }

      return error('API route not found', 404);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unexpected collector error';
      return error(message, 502);
    }
  },
};
