import base, { FxgaCoordinator } from './index';
import { buildEconomyAnalysis, type EconomyMacroState } from './analysis/economies';
import { buildSessionSignals } from './analysis/sessions';
import type { CalendarEvent, Env, MacroObservation } from './types';

export { FxgaCoordinator };

const TARGET_ECONOMIES = ['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN'];

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function coordinator(env: Env) {
  return env.FXGA_COORDINATOR.getByName('global-calendar-v3');
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

async function schedulerPayload(env: Env) {
  const response = await coordinator(env).fetch('https://fxga-coordinator.internal/scheduler/state?bootstrap=1');
  if (!response.ok) throw new Error(`Scheduler state returned ${response.status}`);
  return await response.json() as Record<string, any>;
}

function schedulerEvents(scheduler: Record<string, any>) {
  const runtimes = [...(scheduler.active ?? []), ...(scheduler.upcoming ?? []), ...(scheduler.recent ?? [])];
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const runtime of runtimes) {
    const event = runtime?.event as CalendarEvent | undefined;
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return events;
}

async function globalMacroPayload(env: Env) {
  const durable = coordinator(env);
  if (env.COLLECTOR_MODE === 'external-webhook') {
    const upstream = await durable.fetch('https://fxga-coordinator.internal/collector/global-macro');
    if (!upstream.ok) throw new Error(`External global macro state returned ${upstream.status}`);
    return await upstream.json() as Record<string, any>;
  }
  const scheduler = await schedulerPayload(env);
  const observations = Array.isArray(scheduler?.baseline?.observations) ? scheduler.baseline.observations as MacroObservation[] : [];
  return groupedNativeFallback(observations);
}

function flattenEconomyObservations(payload: Record<string, any>) {
  const byId = new Map<string, MacroObservation>();
  for (const economy of TARGET_ECONOMIES) {
    const observations = Array.isArray(payload?.economies?.[economy]) ? payload.economies[economy] as MacroObservation[] : [];
    for (const observation of observations) {
      const existing = byId.get(observation.seriesId);
      if (!existing) byId.set(observation.seriesId, observation);
      else {
        const tags = new Set([...(existing.economies ?? []), ...(observation.economies ?? []), economy]);
        byId.set(observation.seriesId, { ...existing, economies: [...tags] });
      }
    }
  }
  const global = Array.isArray(payload?.global) ? payload.global as MacroObservation[] : [];
  for (const observation of global) if (!byId.has(observation.seriesId)) byId.set(observation.seriesId, observation);
  return [...byId.values()];
}

function economyQuality(state: EconomyMacroState) {
  const dimensionsCovered = state.dimensions.filter((dimension) => dimension.coverage > 0).length;
  const eligible = state.observationCount >= 3 && dimensionsCovered >= 2 && state.confidence >= 35;
  return { eligible, dimensionsCovered, quality: eligible ? 'structural' as const : 'provisional' as const };
}

function economyPolicyScore(state: EconomyMacroState) {
  const value = (id: string) => state.dimensions.find((dimension) => dimension.id === id)?.score ?? 0;
  const raw = value('inflation') * 0.38 + value('labour') * 0.18 + value('growth') * 0.12 + value('policy') * 0.32;
  return Math.round(Math.max(-100, Math.min(100, raw)));
}

function displayCurrencyStates(states: EconomyMacroState[]) {
  return states
    .map((state) => {
      const quality = economyQuality(state);
      return {
        currency: state.currency,
        economy: state.label,
        centralBank: state.centralBank,
        regime: state.regime,
        policyStance: state.policyStance,
        policyScore: economyPolicyScore(state),
        score: state.currencyScore,
        confidence: state.confidence,
        observationCount: state.observationCount,
        dimensionsCovered: quality.dimensionsCovered,
        quality: quality.quality,
      };
    })
    .sort((a, b) => {
      if (a.quality !== b.quality) return a.quality === 'structural' ? -1 : 1;
      return b.score - a.score;
    })
    .map((state, index) => ({ ...state, rank: index + 1 }));
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/global-macro') {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: securityHeaders() });
      try {
        return Response.json(await globalMacroPayload(env), { headers: { ...securityHeaders(), 'Cache-Control': 'public, max-age=60' } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Global macro state unavailable' }, { status: 503, headers: securityHeaders() });
      }
    }

    if (url.pathname === '/api/economy-analysis') {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: securityHeaders() });
      try {
        const globalMacro = await globalMacroPayload(env);
        const observations = flattenEconomyObservations(globalMacro);
        const analysis = buildEconomyAnalysis(observations);
        return Response.json({ ...analysis, collectorMode: globalMacro.mode, observationCount: observations.length }, {
          headers: { ...securityHeaders(), 'Cache-Control': 'public, max-age=60' },
        });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Economy analysis unavailable' }, { status: 503, headers: securityHeaders() });
      }
    }

    if (url.pathname === '/api/session-signals') {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: securityHeaders() });
      try {
        const [scheduler, globalMacro] = await Promise.all([schedulerPayload(env), globalMacroPayload(env)]);
        if (!scheduler?.baseline?.analysis) throw new Error('Macro baseline is not initialized');
        const observations = flattenEconomyObservations(globalMacro);
        const economyAnalysis = buildEconomyAnalysis(observations);
        const eligibleEconomies = economyAnalysis.economies.filter((state) => economyQuality(state).eligible);
        const provisionalEconomies = economyAnalysis.economies.filter((state) => !economyQuality(state).eligible);
        const intelligence = buildSessionSignals(scheduler.baseline.analysis, schedulerEvents(scheduler), new Date(), eligibleEconomies);
        return Response.json({
          ...intelligence,
          currencyStates: displayCurrencyStates(economyAnalysis.economies),
          collectorMode: globalMacro.mode,
          economyObservationCount: observations.length,
          dataQuality: {
            minimumStructuralObservations: 3,
            minimumCoveredDimensions: 2,
            structuralEconomies: eligibleEconomies.map((state) => state.id),
            provisionalEconomies: provisionalEconomies.map((state) => state.id),
          },
        }, {
          headers: { ...securityHeaders(), 'Cache-Control': 'public, max-age=30' },
        });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Session intelligence unavailable' }, { status: 503, headers: securityHeaders() });
      }
    }

    return base.fetch(request, env);
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return base.scheduled(controller, env, ctx);
  },
};
