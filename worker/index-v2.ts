import base, { FxgaCoordinator } from './index';
import type { Env, MacroObservation } from './types';

export { FxgaCoordinator };

const TARGET_ECONOMIES = ['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN'];

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function groupedNativeFallback(observations: MacroObservation[]) {
  const economies: Record<string, MacroObservation[]> = Object.fromEntries(TARGET_ECONOMIES.map((economy) => [economy, []]));
  const global: MacroObservation[] = [];
  for (const observation of observations) {
    const tags = Array.isArray(observation.economies) && observation.economies.length
      ? observation.economies.map(String)
      : [String(observation.economy ?? 'GLOBAL')];
    let assigned = false;
    for (const economy of TARGET_ECONOMIES) {
      if (tags.includes(economy)) { economies[economy].push(observation); assigned = true; }
    }
    if (!assigned || tags.includes('GLOBAL')) global.push(observation);
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: 'cloudflare-native-curated',
    targetEconomies: TARGET_ECONOMIES,
    totalObservations: observations.length,
    counts: Object.fromEntries(TARGET_ECONOMIES.map((economy) => [economy, economies[economy].length])),
    economies,
    global,
  };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/global-macro') {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: securityHeaders() });
      const coordinator = env.FXGA_COORDINATOR.getByName('global-calendar-v3');
      if (env.COLLECTOR_MODE === 'external-webhook') {
        const upstream = await coordinator.fetch('https://fxga-coordinator.internal/collector/global-macro');
        const headers = new Headers(upstream.headers);
        headers.set('Cache-Control', 'public, max-age=60');
        for (const [key,value] of Object.entries(securityHeaders())) headers.set(key,value);
        return new Response(upstream.body, { status: upstream.status, headers });
      }
      const schedulerResponse = await coordinator.fetch('https://fxga-coordinator.internal/scheduler/state?bootstrap=1');
      if (!schedulerResponse.ok) return Response.json({ error: 'Global macro state unavailable' }, { status: 503, headers: securityHeaders() });
      const scheduler = await schedulerResponse.json() as Record<string, any>;
      const observations = Array.isArray(scheduler?.baseline?.observations) ? scheduler.baseline.observations as MacroObservation[] : [];
      return Response.json(groupedNativeFallback(observations), { headers: { ...securityHeaders(), 'Cache-Control': 'public, max-age=60' } });
    }
    return base.fetch(request, env);
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return base.scheduled(controller, env, ctx);
  },
};
