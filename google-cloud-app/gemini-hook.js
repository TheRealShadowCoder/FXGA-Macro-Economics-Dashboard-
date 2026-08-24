import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-3.7-flash').trim();
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite').trim();
const PUBLIC_ORIGIN = String(process.env.FXGA_PUBLIC_ORIGIN || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/, '');
const API_URL = 'https://generativelanguage.googleapis.com/v1/interactions';
const MAX_BODY_BYTES = 32_000;
const db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
const state = db.collection('fxga_collector_state');
const chunks = db.collection('fxga_collector_state_chunks');
const signals = db.collection('fxga_tradingview_signals');
const cache = db.collection('fxga_gemini_cache');

// Do not impose an FXGA requests-per-hour/day ceiling. Google Gemini's active
// project/model quota is the source of truth. We conserve quota through Firestore
// result caching and same-instance in-flight request coalescing instead.
const inFlight = new Map();
const quotaTelemetry = {
  lastProvider429At: null,
  lastRetryAfterSeconds: null,
};

const MODE_CONFIG = {
  'smc-signal': { ttlMs: 60 * 60_000, label: 'SMC setup explanation' },
  'market-brief': { ttlMs: 5 * 60_000, label: 'cross-asset market brief' },
  'macro-brief': { ttlMs: 30 * 60_000, label: 'macro evidence brief' },
  'economic-context': { ttlMs: 30 * 60_000, label: 'economic context explanation' },
  'event-research': { ttlMs: 60 * 60_000, label: 'event-study research explanation' },
  'action-report': { ttlMs: 10 * 60_000, label: 'action-report explanation' },
};

function cors(origin = '') {
  const allowed = !origin || origin === PUBLIC_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : PUBLIC_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Cache-Control, Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
}

function sendJson(req, res, status, payload, cacheControl = 'no-store') {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...cors(String(req.headers.origin || '')),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': cacheControl,
  });
  res.end(body);
}

async function readJson(req) {
  const chunksIn = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Gemini request exceeds 32 KB'), { statusCode: 413 });
    chunksIn.push(chunk);
  }
  if (!chunksIn.length) return {};
  try { return JSON.parse(Buffer.concat(chunksIn).toString('utf8')); }
  catch { throw Object.assign(new Error('Gemini request must be valid JSON'), { statusCode: 400 }); }
}

function sha(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function chunkDocId(name, generation, index) {
  return `${name}__${generation}__${String(index).padStart(4, '0')}`;
}

async function readState(name) {
  const snap = await state.doc(name).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data?.chunked) return data;
  const generation = String(data.generation || '');
  const count = Number(data.chunkCount || 0);
  if (!generation || !Number.isInteger(count) || count < 1 || count > 512) return data;
  const parts = [];
  for (let i = 0; i < count; i += 8) {
    const indexes = Array.from({ length: Math.min(8, count - i) }, (_, offset) => i + offset);
    const snaps = await Promise.all(indexes.map(index => chunks.doc(chunkDocId(name, generation, index)).get()));
    for (let j = 0; j < snaps.length; j += 1) {
      const encoded = snaps[j].data()?.data;
      if (!snaps[j].exists || typeof encoded !== 'string') return data;
      parts[indexes[j]] = Buffer.from(encoded, 'base64');
    }
  }
  try { return { ...data, payload: JSON.parse(Buffer.concat(parts).toString('utf8')) }; }
  catch { return data; }
}

function limited(value, max = 60) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function safeSignal(signal) {
  if (!signal || typeof signal !== 'object') return null;
  return {
    id: signal.id || null,
    stream: signal.stream || null,
    symbol: signal.brokerSymbol || signal.symbol || null,
    canonicalSymbol: signal.symbol || null,
    brokerCompany: signal.brokerCompany || null,
    brokerServer: signal.brokerServer || null,
    side: signal.side || null,
    status: signal.status || null,
    lastEvent: signal.lastEvent || null,
    methodId: signal.methodId || null,
    methodCode: signal.methodCode || null,
    methodFamily: signal.methodFamily || null,
    methodScore: signal.methodScore || signal.score || null,
    archetypeId: signal.archetypeId || signal.setupArchetypeId || null,
    archetypeName: signal.archetypeName || signal.setupArchetypeName || null,
    exactMatches: signal.exactMatches || null,
    signalTime: signal.signalTime || null,
    tradePlan: signal.tradePlan || null,
    riskReward: signal.riskReward || null,
    timeframeHierarchy: signal.timeframeHierarchy || null,
    smcEvidenceAtSignal: signal.smcEvidenceAtSignal || null,
    currentMarketEvidence: signal.currentMarketEvidence || null,
    dealingRange: signal.dealingRange || null,
    pdArray: signal.pdArray || null,
    invalidation: signal.invalidation || null,
    intelligence: signal.intelligence || null,
  };
}

async function contextFor(mode, body) {
  if (mode === 'smc-signal') {
    const signalId = String(body.signalId || '').trim();
    if (!signalId) throw Object.assign(new Error('signalId is required for smc-signal mode'), { statusCode: 400 });
    const snap = await signals.doc(signalId).get();
    if (!snap.exists) throw Object.assign(new Error('Stored SMC signal was not found'), { statusCode: 404 });
    return { signal: safeSignal({ id: snap.id, ...snap.data() }) };
  }

  if (mode === 'market-brief') {
    const [market, technical] = await Promise.all([readState('market'), readState('technical')]);
    return {
      market: { generatedAt: market?.payload?.generatedAt || market?.updatedAt || null, assets: limited(market?.payload?.assets, 50) },
      technical: { generatedAt: technical?.payload?.generatedAt || technical?.updatedAt || null, counts: technical?.payload?.counts || null, assets: technical?.payload?.assets || null },
    };
  }

  if (mode === 'macro-brief' || mode === 'economic-context') {
    const [macro, intelligence] = await Promise.all([readState('macro'), readState('intelligence')]);
    const observations = limited(macro?.payload?.observations, 80).map(row => ({
      seriesId: row?.seriesId, title: row?.title, value: row?.value, previous: row?.previous, change: row?.change,
      date: row?.date, units: row?.units, frequency: row?.frequency, economy: row?.economy, economies: row?.economies,
      categories: row?.categories, source: row?.source, lastUpdated: row?.lastUpdated,
    }));
    return {
      generatedAt: macro?.payload?.generatedAt || macro?.updatedAt || null,
      coverageQuality: macro?.payload?.coverageQuality || null,
      observations,
      economyAnalysis: mode === 'economic-context' ? intelligence?.payload?.economyAnalysis || null : null,
      decisionGovernance: intelligence?.payload?.decisionGovernance || null,
    };
  }

  if (mode === 'event-research') {
    const research = await readState('event-studies');
    return {
      generatedAt: research?.payload?.generatedAt || research?.updatedAt || null,
      summary: research?.payload?.summary || null,
      priceUniverse: research?.payload?.priceUniverse || [],
      preNewsWindows: research?.payload?.preNewsWindows || [],
      horizons: research?.payload?.horizons || [],
      patternResearch: research?.payload?.patternResearch || null,
      backtestResearch: research?.payload?.backtestResearch || null,
    };
  }

  if (mode === 'action-report') {
    const [intelligence, market, technical, calendar] = await Promise.all([
      readState('intelligence'), readState('market'), readState('technical'), readState('calendar'),
    ]);
    return {
      intelligence: intelligence?.payload ? {
        generatedAt: intelligence.payload.generatedAt || null,
        decisionGovernance: intelligence.payload.decisionGovernance || null,
        macroAnalysis: intelligence.payload.macroAnalysis || null,
        economyAnalysis: intelligence.payload.economyAnalysis || null,
        sessionSignals: intelligence.payload.sessionSignals || null,
      } : null,
      market: limited(market?.payload?.assets, 40),
      technical: { counts: technical?.payload?.counts || null, assets: technical?.payload?.assets || null },
      upcomingEvents: limited(calendar?.payload?.events, 30),
    };
  }

  throw Object.assign(new Error(`Unsupported Gemini mode: ${mode}`), { statusCode: 400 });
}

function systemInstruction(mode) {
  return [
    'You are the FXGA evidence-explanation layer.',
    'Use only the supplied structured evidence. Do not invent missing prices, events, indicators, correlations, probabilities, trades, or backtest results.',
    'The deterministic FXGA SMC2000 engine and stored research remain the source of truth. You may explain evidence but must not reverse, create, promote, or fabricate a BUY/SELL signal.',
    'Do not claim profitability, certainty, institutional validation, or statistical edge unless the supplied evidence explicitly proves it.',
    'Distinguish source facts from interpretation. Flag stale, missing, conflicting, or weak evidence plainly.',
    'Keep the output concise but decision-useful. Use headings and short bullets where useful.',
    `Current task mode: ${mode}.`,
  ].join('\n');
}

function promptFor(mode, context) {
  const task = {
    'smc-signal': 'Explain this stored SMC setup: direction, H4/M15/M1 alignment, S01-S50 archetype/method, evidence, entry geometry, invalidation, targets, conflicts, lifecycle status, and what would make the setup stronger or weaker. Never create a new signal.',
    'market-brief': 'Produce a cross-asset market brief from the supplied current market and technical evidence. Highlight alignment, divergences, stale/missing data, and what deserves attention now.',
    'macro-brief': 'Produce a macro evidence brief. Separate growth, inflation, labour, policy/rates, financial conditions, and cross-economy implications. Respect data freshness and coverage.',
    'economic-context': 'Explain the economic regime and major economy differences using only the supplied macro/economy evidence. Identify firm growth, slowdown, disinflation, sticky inflation, or stagflation-like combinations only when supported.',
    'event-research': 'Explain the current event-study research maturity, sample coverage, horizons, OOS/backtest status, and what is or is not statistically validated. Do not infer profitability from descriptive studies.',
    'action-report': 'Explain the current FXGA action-report evidence. Separate macro, technical, event-risk and market context. Respect WAIT states and do not manufacture trade instructions.',
  }[mode];
  return `${systemInstruction(mode)}\n\nTASK\n${task}\n\nSTRUCTURED EVIDENCE\n${JSON.stringify(context)}`;
}

function textFromInteraction(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i]?.type !== 'model_output') continue;
    const content = Array.isArray(steps[i].content) ? steps[i].content : [];
    const text = content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n').trim();
    if (text) return text;
  }
  return '';
}

function retryAfterSeconds(response) {
  const raw = String(response.headers.get('retry-after') || '').trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return null;
}

async function invokeModel(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({ model, input: prompt, store: false, generation_config: { max_output_tokens: 1400 } }),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 2000) }; }
    if (!response.ok) {
      const error = new Error(`Gemini ${model} returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.retryAfterSeconds = retryAfterSeconds(response);
      if (response.status === 429) {
        quotaTelemetry.lastProvider429At = new Date().toISOString();
        quotaTelemetry.lastRetryAfterSeconds = error.retryAfterSeconds;
      }
      throw error;
    }
    const output = textFromInteraction(payload);
    if (!output) throw Object.assign(new Error(`Gemini ${model} returned no text output`), { statusCode: 502 });
    return { model, output, usage: payload?.usage || null, interactionId: payload?.id || null };
  } finally { clearTimeout(timer); }
}

async function invokeGemini(prompt) {
  try { return await invokeModel(GEMINI_MODEL, prompt); }
  catch (error) {
    if (![404, 429, 500, 502, 503, 504].includes(Number(error.statusCode)) || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw error;
    return invokeModel(GEMINI_FALLBACK_MODEL, prompt);
  }
}

async function createAnalysisDocument(mode, body, contextHash, cacheId, prompt) {
  const result = await invokeGemini(prompt);
  const document = {
    schema: 'fxga.gemini.analysis.v1',
    mode,
    label: MODE_CONFIG[mode].label,
    model: result.model,
    output: result.output,
    contextHash,
    signalId: mode === 'smc-signal' ? String(body.signalId || '') : null,
    usage: result.usage,
    interactionId: result.interactionId,
    createdAt: new Date().toISOString(),
    quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
    policy: 'Gemini is an explanatory layer over deterministic FXGA evidence. It does not create trading signals or guarantee outcomes.',
  };
  await cache.doc(cacheId).set(document, { merge: false });
  return document;
}

async function analyze(req, res) {
  if (!GEMINI_API_KEY) return sendJson(req, res, 503, { error: 'Gemini is not configured on this Cloud Run service', configured: false });

  let body;
  try { body = await readJson(req); }
  catch (error) { return sendJson(req, res, error.statusCode || 400, { error: error.message }); }

  const mode = String(body.mode || '').trim().toLowerCase();
  if (!MODE_CONFIG[mode]) return sendJson(req, res, 400, { error: `mode must be one of: ${Object.keys(MODE_CONFIG).join(', ')}` });

  let context;
  try { context = await contextFor(mode, body); }
  catch (error) { return sendJson(req, res, error.statusCode || 500, { error: error.message }); }

  const contextHash = sha(context);
  const cacheId = sha(`${mode}:${String(body.signalId || '')}:${contextHash}`).slice(0, 48);
  const cachedSnap = await cache.doc(cacheId).get();
  if (cachedSnap.exists) {
    const cached = cachedSnap.data();
    const age = Date.now() - Date.parse(cached.createdAt || 0);
    if (Number.isFinite(age) && age >= 0 && age < MODE_CONFIG[mode].ttlMs) {
      return sendJson(req, res, 200, { ...cached, cached: true, coalesced: false }, 'private, max-age=30');
    }
  }

  const prompt = promptFor(mode, context);
  let task = inFlight.get(cacheId);
  const coalesced = Boolean(task);
  if (!task) {
    task = createAnalysisDocument(mode, body, contextHash, cacheId, prompt);
    inFlight.set(cacheId, task);
    task.then(() => inFlight.delete(cacheId), () => inFlight.delete(cacheId));
  }

  try {
    const document = await task;
    return sendJson(req, res, 200, { ...document, cached: false, coalesced });
  } catch (error) {
    console.error('FXGA Gemini request failed', { mode, statusCode: error.statusCode || null, message: String(error.message || error).replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]') });
    const status = [401, 403, 429].includes(Number(error.statusCode)) ? Number(error.statusCode) : 502;
    return sendJson(req, res, status, {
      error: status === 401 || status === 403
        ? 'Gemini authentication is not accepted. Rotate or verify the Secret Manager key.'
        : status === 429
          ? 'Google Gemini has reached an active project/model quota. FXGA is not imposing an additional hourly or daily cap.'
          : 'Gemini analysis is temporarily unavailable.',
      model: GEMINI_MODEL,
      fallbackModel: GEMINI_FALLBACK_MODEL,
      quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
      retryAfterSeconds: error.retryAfterSeconds ?? null,
    });
  }
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const serverOptions = typeof options === 'function' ? undefined : options;
  const wrapped = async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); }
    catch { return listener(req, res); }

    if (url.pathname === '/api/gemini/health' || url.pathname === '/api/gemini/analyze' || url.pathname === '/api/gemini/explain-smc') {
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' }); return res.end(); }
      if (url.pathname === '/api/gemini/health') {
        if (req.method !== 'GET') return sendJson(req, res, 405, { error: 'Gemini health requires GET' });
        return sendJson(req, res, 200, {
          ok: true,
          configured: Boolean(GEMINI_API_KEY),
          provider: 'Google Gemini API',
          api: 'Interactions v1',
          model: GEMINI_MODEL,
          fallbackModel: GEMINI_FALLBACK_MODEL,
          modes: Object.keys(MODE_CONFIG),
          keyExposedToBrowser: false,
          quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
          applicationHourlyCap: null,
          applicationDailyCap: null,
          firestoreCaching: true,
          duplicateRequestCoalescing: true,
          inFlightRequests: inFlight.size,
          lastProvider429At: quotaTelemetry.lastProvider429At,
          lastRetryAfterSeconds: quotaTelemetry.lastRetryAfterSeconds,
          timestamp: new Date().toISOString(),
        });
      }
      if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'Gemini analysis requires POST' });
      if (url.pathname === '/api/gemini/explain-smc') {
        let body;
        try { body = await readJson(req); }
        catch (error) { return sendJson(req, res, error.statusCode || 400, { error: error.message }); }
        const rebuilt = JSON.stringify({ mode: 'smc-signal', signalId: body.signalId });
        const originalAsyncIterator = req[Symbol.asyncIterator];
        req[Symbol.asyncIterator] = async function* () { yield Buffer.from(rebuilt); };
        try { return await analyze(req, res); }
        finally { req[Symbol.asyncIterator] = originalAsyncIterator; }
      }
      return analyze(req, res);
    }
    return listener(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log('FXGA Gemini intelligence gateway loaded', {
  configured: Boolean(GEMINI_API_KEY),
  model: GEMINI_MODEL,
  fallbackModel: GEMINI_FALLBACK_MODEL,
  quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
});
