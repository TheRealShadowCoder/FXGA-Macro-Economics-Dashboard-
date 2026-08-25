type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const side = (value: unknown): 'BUY' | 'SELL' | 'WAIT' => {
  const normalized = String(value || '').toUpperCase();
  return normalized === 'BUY' || normalized === 'SELL' ? normalized : 'WAIT';
};

const DEFAULT_INTELLIGENCE = {
  score: 0,
  grade: 'UNRATED',
  suggestedSignal: 'WAIT' as const,
  sourceSignal: 'WAIT' as const,
  action: 'OBSERVE',
  label: 'Stored signal · evidence compatibility mode',
  explanation: 'This signal predates part of the current FXGA intelligence contract. Available source evidence is shown without inventing missing fields.',
  components: {} as Record<string, number>,
  policy: 'Uses persisted source evidence only. Missing legacy fields are represented as unavailable rather than fabricated.',
};

function numericComponents(value: unknown): Record<string, number> {
  const source = asRecord(value);
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) output[key] = parsed;
  }
  return output;
}

function normalizeSignal(value: unknown): JsonRecord | null {
  const raw = asRecord(value);
  const id = asString(raw.id).trim();
  const symbol = asString(raw.symbol).trim();
  if (!id || !symbol) return null;

  const rawPlan = asRecord(raw.tradePlan);
  const rawRisk = asRecord(raw.riskReward);
  const rawLifecycle = asRecord(raw.lifecycle);
  const rawIntelligence = asRecord(raw.intelligence);
  const sourceSide = side(raw.side);
  const suggested = side(rawIntelligence.suggestedSignal);
  const intelligenceScore = Math.max(0, Math.min(100, asNumber(rawIntelligence.score, 0)));

  return {
    ...raw,
    id,
    symbol,
    timeframe: asString(raw.timeframe, '—'),
    side: sourceSide,
    status: asString(raw.status, 'UNKNOWN'),
    updatedAt: asString(raw.updatedAt, asString(raw.signalTime, new Date(0).toISOString())),
    lastEvent: asString(raw.lastEvent, 'UNKNOWN'),
    tradePlan: {
      side: side(rawPlan.side ?? sourceSide),
      tradeMode: asString(rawPlan.tradeMode) || null,
      orderType: asString(rawPlan.orderType) || null,
      filled: rawPlan.filled === true,
      entry: nullableNumber(rawPlan.entry),
      stopLoss: nullableNumber(rawPlan.stopLoss),
      tp1: nullableNumber(rawPlan.tp1),
      tp2: nullableNumber(rawPlan.tp2),
      tp3: nullableNumber(rawPlan.tp3),
      primaryTargetType: asString(rawPlan.primaryTargetType) || null,
    },
    riskReward: {
      ...rawRisk,
      riskPriceDistance: nullableNumber(rawRisk.riskPriceDistance),
      rrTp1: nullableNumber(rawRisk.rrTp1),
      rrTp2: nullableNumber(rawRisk.rrTp2),
      rrTp3: nullableNumber(rawRisk.rrTp3),
    },
    lifecycle: {
      ...rawLifecycle,
      barsSinceSignal: nullableNumber(rawLifecycle.barsSinceSignal),
      entryFilled: rawLifecycle.entryFilled === true,
      tp1Hit: rawLifecycle.tp1Hit === true,
      tp2Hit: rawLifecycle.tp2Hit === true,
      finalTargetHit: rawLifecycle.finalTargetHit === true,
    },
    intelligence: {
      ...DEFAULT_INTELLIGENCE,
      ...rawIntelligence,
      score: intelligenceScore,
      grade: asString(rawIntelligence.grade, DEFAULT_INTELLIGENCE.grade),
      suggestedSignal: suggested,
      sourceSignal: side(rawIntelligence.sourceSignal ?? sourceSide),
      action: asString(rawIntelligence.action, DEFAULT_INTELLIGENCE.action),
      label: asString(rawIntelligence.label, DEFAULT_INTELLIGENCE.label),
      explanation: asString(rawIntelligence.explanation, DEFAULT_INTELLIGENCE.explanation),
      components: numericComponents(rawIntelligence.components),
      policy: asString(rawIntelligence.policy, DEFAULT_INTELLIGENCE.policy),
    },
  };
}

function normalizePayload(value: unknown): unknown {
  const payload = asRecord(value);
  if (Array.isArray(payload.signals)) {
    const signals = payload.signals.map(normalizeSignal).filter((row): row is JsonRecord => row !== null);
    return { ...payload, count: signals.length, signals };
  }
  if (payload.signal) {
    const signal = normalizeSignal(payload.signal);
    const events = Array.isArray(payload.events) ? payload.events : [];
    return signal ? { ...payload, signal, events } : { ...payload, signal: null, events };
  }
  return value;
}

function isSignalContractPath(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(raw, window.location.origin).pathname;
    return /^\/api\/tradingview\/signals(?:\/live|\/[a-f0-9]{40})?$/.test(pathname);
  } catch {
    return false;
  }
}

const previousFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await previousFetch(input, init);
  if (!response.ok || !isSignalContractPath(input)) return response;

  try {
    const parsed = await response.clone().json();
    const normalized = normalizePayload(parsed);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('x-fxga-contract-guard', 'live-signal-v1');
    return new Response(JSON.stringify(normalized), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
};
