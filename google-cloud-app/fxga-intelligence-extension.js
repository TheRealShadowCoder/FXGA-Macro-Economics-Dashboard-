import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { classifyFxgaError, publicErrorCatalog } from './fxga-error-catalog.js';
import { loadPrompt, publicPromptRegistry, selectPrompt, promptDescriptor } from './fxga-prompt-library.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-3.7-flash').trim();
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite').trim();
const PUBLIC_ORIGIN = String(process.env.FXGA_PUBLIC_ORIGIN || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/, '');
const API_URL = 'https://generativelanguage.googleapis.com/v1/interactions';
const MAX_CHAT_BYTES = 12_000;
const LIVE_REPORT_TTL_MS = 3 * 60_000;
const CHAT_TTL_MS = 10 * 60_000;

const db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
const state = db.collection('fxga_collector_state');
const chunks = db.collection('fxga_collector_state_chunks');
const signals = db.collection('fxga_tradingview_signals');
const liveSignals = db.collection('fxga_tradingview_live');
const cache = db.collection('fxga_gemini_cache');
const inFlight = new Map();

const CORE_RULES = [
  'You are the FXGA evidence intelligence layer.',
  'Use only the structured evidence supplied in this request. Never invent prices, events, indicators, samples, win rates, expectancy, probabilities, trades, backtest results, correlations, or data that is not present.',
  'The deterministic FXGA engines and persisted Google Cloud evidence are the source of truth. You explain and forecast scenarios from evidence; you do not fabricate or reverse a stored BUY/SELL signal.',
  'A statistical edge may be described only when the supplied evidence contains enough measured performance and validation evidence to support it. Otherwise say that the edge is unproven, preliminary, or not measurable from the available sample.',
  'Separate facts, interpretation, forecast scenarios, invalidation conditions, missing evidence, and confidence limitations.',
  'Explain technical concepts in plain language after the advanced analysis so a non-specialist can understand the conclusion.',
  'Never expose secrets, API keys, credentials, internal tokens, or hidden authentication material.',
].join('\n');

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
  res.writeHead(status, { ...cors(String(req.headers.origin || '')), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(body.length), 'Cache-Control': cacheControl });
  res.end(body);
}

function sendFriendlyError(req, res, error, fallbackStatus = 500) {
  const friendly = classifyFxgaError(error, fallbackStatus);
  const status = Number(friendly.technical.httpStatus || fallbackStatus || 500);
  return sendJson(req, res, status >= 400 && status <= 599 ? status : 500, { error: friendly.title, friendlyError: friendly });
}

async function readBody(req) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_CHAT_BYTES) throw Object.assign(new Error('FXGA chatbot request is too large'), { statusCode: 413, code: 'payload_too_large' });
    parts.push(chunk);
  }
  if (!parts.length) return {};
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('FXGA chatbot request must be valid JSON'), { statusCode: 400, code: 'invalid_request' }); }
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
      if (!snaps[j].exists || typeof snaps[j].data()?.data !== 'string') return data;
      parts[indexes[j]] = Buffer.from(snaps[j].data().data, 'base64');
    }
  }
  try { return { ...data, payload: JSON.parse(Buffer.concat(parts).toString('utf8')) }; }
  catch { return data; }
}

function list(value, max) { return Array.isArray(value) ? value.slice(0, max) : []; }
function objectEntries(value, max) { return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).slice(0, max)) : value; }

function compactState(name, doc) {
  const payload = doc?.payload ?? doc ?? null;
  if (!payload) return null;
  if (name === 'market') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, source: payload.source || null, assets: list(payload.assets, 60) };
  if (name === 'technical') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, methodology: payload.methodology || null, counts: payload.counts || null, assets: objectEntries(payload.assets, 60) };
  if (name === 'macro') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, coverageQuality: payload.coverageQuality || null, failureDiagnostics: payload.failureDiagnostics || null, observations: list(payload.observations, 140) };
  if (name === 'calendar') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, sourceHealth: payload.sourceHealth || null, events: list(payload.events, 100) };
  if (name === 'event-studies') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, summary: payload.summary || null, source: payload.source || null, priceUniverse: list(payload.priceUniverse, 60), preNewsWindows: list(payload.preNewsWindows, 30), horizons: list(payload.horizons, 30), patternResearch: payload.patternResearch || null, backtestResearch: payload.backtestResearch || null };
  if (name === 'intelligence') return {
    generatedAt: payload.generatedAt || doc?.updatedAt || null,
    decisionGovernance: payload.decisionGovernance || null,
    decisionMemory: payload.decisionMemory || null,
    macroAnalysis: payload.macroAnalysis || null,
    economyAnalysis: payload.economyAnalysis || null,
    sessionSignals: payload.sessionSignals || null,
    research: payload.research ? {
      generatedAt: payload.research.generatedAt || null,
      scenarios: list(payload.research.scenarios, 30),
      releaseAnalytics: payload.research.releaseAnalytics || null,
      qualityCalibrationEvidence: payload.research.qualityCalibrationEvidence || null,
      performance: payload.research.performance || payload.research.strategyPerformance || null,
      validation: payload.research.validation || null,
      edgeResearch: payload.research.edgeResearch || null,
    } : null,
  };
  return payload;
}

function safeSignal(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id || null, symbol: row.symbol || null, timeframe: row.timeframe || null, side: row.side || null,
    signalTime: row.signalTime || null, status: row.status || null, lastEvent: row.lastEvent || null,
    methodId: row.methodId || null, methodCode: row.methodCode || null, methodFamily: row.methodFamily || null,
    methodScore: row.methodScore || null, exactMatches: row.exactMatches || null,
    tradePlan: row.tradePlan || null, riskReward: row.riskReward || null, lifecycle: row.lifecycle || null,
    timeframeHierarchy: row.timeframeHierarchy || null, smcEvidenceAtSignal: row.smcEvidenceAtSignal || null,
    currentMarketEvidence: row.currentMarketEvidence || null, invalidation: row.invalidation || null,
    intelligence: row.intelligence || null, updatedAt: row.updatedAt || null,
  };
}

async function recentSignals(signalId = '') {
  if (signalId) {
    const snap = await signals.doc(signalId).get();
    return snap.exists ? [safeSignal({ id: snap.id, ...snap.data() })] : [];
  }
  const snap = await signals.limit(100).get();
  return snap.docs.map(doc => safeSignal({ id: doc.id, ...doc.data() })).filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt || b.signalTime || 0) - Date.parse(a.updatedAt || a.signalTime || 0)).slice(0, 80);
}

async function stateMeta() {
  const names = ['calendar','macro','intelligence','market','technical','event-studies'];
  const snaps = await Promise.all(names.map(name => state.doc(name).get()));
  return Object.fromEntries(snaps.map((snap, index) => {
    const value = snap.exists ? snap.data() : null;
    return [names[index], { exists: snap.exists, updatedAt: value?.updatedAt || null, chunked: Boolean(value?.chunked), byteLength: value?.byteLength || null }];
  }));
}

async function buildContext(descriptor, body = {}) {
  const wanted = new Set(descriptor.states || []);
  const jobs = {};
  for (const name of ['intelligence','market','technical','macro','calendar','event-studies']) if (wanted.has(name)) jobs[name] = readState(name);
  if (wanted.has('signals')) jobs.signals = recentSignals(String(body.signalId || ''));
  if (wanted.has('signal-metrics')) jobs.signalMetrics = liveSignals.doc('metrics').get().then(snap => snap.exists ? snap.data() : null);
  if (wanted.has('meta')) jobs.meta = stateMeta();
  const entries = await Promise.all(Object.entries(jobs).map(async ([key, promise]) => [key, await promise]));
  const raw = Object.fromEntries(entries);
  const context = {};
  for (const [key, value] of Object.entries(raw)) {
    context[key] = ['signals','signalMetrics','meta'].includes(key) ? value : compactState(key, value);
  }
  context.program = {
    name: 'FX Global Avengers Trading Academy Macro Intelligence Dashboard',
    architecture: 'Cloudflare static frontend -> Google Cloud Run processing -> Firestore evidence/state -> Google Gemini explanation layer',
    primaryModel: GEMINI_MODEL,
    fallbackModel: GEMINI_FALLBACK_MODEL,
    promptRouting: 'task-aware Markdown prompt library',
    quotaPolicy: 'Google provider/project/model quota only; no FXGA hourly or daily Gemini cap',
    chatbot: true,
    liveIntelligenceJournal: true,
    friendlyErrorTranslation: true,
  };
  context.generatedAt = new Date().toISOString();
  context.evidencePolicy = 'Missing evidence is represented as missing/null and must never be synthesized.';
  return context;
}

function interactionText(payload) {
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
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

async function invokeOnce(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({ model, input: prompt, store: false, generation_config: { max_output_tokens: 1800 } }),
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 1000) }; }
    if (!response.ok) {
      const providerCode = String(payload?.error?.code || payload?.error?.type || payload?.code || '').toLowerCase();
      const providerMessage = String(payload?.error?.message || payload?.message || `Gemini ${model} returned HTTP ${response.status}`);
      const error = Object.assign(new Error(providerMessage), { statusCode: response.status, providerCode, retryAfterSeconds: retryAfterSeconds(response) });
      throw error;
    }
    const answer = interactionText(payload);
    if (!answer) throw Object.assign(new Error('Gemini returned no usable text output'), { statusCode: 502, code: 'bad_gateway' });
    return { model, answer, usage: payload?.usage || null, interactionId: payload?.id || null };
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Gemini request deadline exceeded'), { statusCode: 504, code: 'deadline_exceeded' });
    throw error;
  } finally { clearTimeout(timer); }
}

async function invokeWithRetry(model, prompt) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await invokeOnce(model, prompt); }
    catch (error) {
      last = error;
      const code = String(error.providerCode || error.code || '').toLowerCase();
      const status = Number(error.statusCode || 500);
      const transient = [408, 429, 500, 502, 503, 504].includes(status) && code !== 'quota_exceeded';
      if (!transient || attempt === 2) throw error;
      const base = Number(error.retryAfterSeconds) || (1.2 * (2 ** attempt));
      const jitter = Math.random() * 0.4;
      await new Promise(resolve => setTimeout(resolve, Math.min(8000, (base + jitter) * 1000)));
    }
  }
  throw last;
}

async function invokeGemini(prompt) {
  try { return await invokeWithRetry(GEMINI_MODEL, prompt); }
  catch (error) {
    const status = Number(error.statusCode || 500);
    const code = String(error.providerCode || error.code || '').toLowerCase();
    const fallbackEligible = ['model_not_found','not_found','quota_exceeded'].includes(code) || [404, 429, 500, 502, 503, 504].includes(status);
    if (!fallbackEligible || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw error;
    return invokeWithRetry(GEMINI_FALLBACK_MODEL, prompt);
  }
}

function composePrompt(taskPrompt, question, context) {
  return `${CORE_RULES}\n\nTASK-SPECIFIC INSTRUCTIONS\n${taskPrompt}\n\nUSER QUESTION\n${question || 'Generate the requested FXGA intelligence report.'}\n\nSTRUCTURED FXGA EVIDENCE\n${JSON.stringify(context)}`;
}

async function cachedIntelligence(cacheId, ttlMs, work) {
  const snap = await cache.doc(cacheId).get();
  if (snap.exists) {
    const value = snap.data();
    const age = Date.now() - Date.parse(value.createdAt || 0);
    if (Number.isFinite(age) && age >= 0 && age < ttlMs) return { value, cached: true, coalesced: false };
  }
  let task = inFlight.get(cacheId);
  const coalesced = Boolean(task);
  if (!task) {
    task = work();
    inFlight.set(cacheId, task);
    task.then(() => inFlight.delete(cacheId), () => inFlight.delete(cacheId));
  }
  const value = await task;
  return { value, cached: false, coalesced };
}

async function chat(req, res) {
  if (!GEMINI_API_KEY) return sendFriendlyError(req, res, { statusCode: 503, code: 'service_unavailable', message: 'Gemini is not configured' }, 503);
  let body;
  try { body = await readBody(req); } catch (error) { return sendFriendlyError(req, res, error, error.statusCode || 400); }
  const question = String(body.question || '').trim();
  if (!question) return sendFriendlyError(req, res, { statusCode: 400, code: 'invalid_request', message: 'A question is required' }, 400);
  const descriptor = selectPrompt(question, String(body.task || '').trim());
  try {
    const [taskPrompt, context] = await Promise.all([loadPrompt(descriptor.id), buildContext(descriptor, body)]);
    const contextHash = sha(context);
    const cacheId = sha(`chat:${descriptor.id}:${question}:${contextHash}`).slice(0, 56);
    const result = await cachedIntelligence(cacheId, CHAT_TTL_MS, async () => {
      const model = await invokeGemini(composePrompt(taskPrompt, question, context));
      const document = {
        schema: 'fxga.gemini.chat.v1', task: descriptor.id, label: descriptor.label, question,
        answer: model.answer, model: model.model, usage: model.usage, interactionId: model.interactionId,
        evidenceDomains: descriptor.states, contextHash, createdAt: new Date().toISOString(),
        policy: 'Evidence-grounded explanation and scenario analysis only. Performance and edge claims require measured validation evidence.',
      };
      await cache.doc(cacheId).set(document, { merge: false });
      return document;
    });
    return sendJson(req, res, 200, { ...result.value, cached: result.cached, coalesced: result.coalesced });
  } catch (error) {
    console.error('FXGA chatbot failed', { task: descriptor.id, statusCode: error.statusCode || null, providerCode: error.providerCode || null, message: String(error.message || error).slice(0, 300) });
    return sendFriendlyError(req, res, error, error.statusCode || 502);
  }
}

async function liveReport(req, res) {
  if (!GEMINI_API_KEY) return sendFriendlyError(req, res, { statusCode: 503, code: 'service_unavailable', message: 'Gemini is not configured' }, 503);
  const descriptor = promptDescriptor('live-intelligence-report');
  try {
    const [taskPrompt, context] = await Promise.all([loadPrompt(descriptor.id), buildContext(descriptor)]);
    const contextHash = sha(context);
    const cacheId = sha(`live-report:${contextHash}`).slice(0, 56);
    const result = await cachedIntelligence(cacheId, LIVE_REPORT_TTL_MS, async () => {
      const model = await invokeGemini(composePrompt(taskPrompt, 'Produce the continuously updating FXGA intelligence report from the current stored evidence.', context));
      const document = {
        schema: 'fxga.gemini.live-report.v1', report: model.answer, model: model.model, usage: model.usage,
        interactionId: model.interactionId, contextHash, evidenceDomains: descriptor.states,
        createdAt: new Date().toISOString(), refreshAfterSeconds: 60,
        policy: 'This report updates from persisted FXGA evidence. Forecasts are scenarios, not guarantees. Statistical edge is reported only when measured evidence supports it.',
      };
      await cache.doc(cacheId).set(document, { merge: false });
      return document;
    });
    return sendJson(req, res, 200, { ...result.value, cached: result.cached, coalesced: result.coalesced }, 'no-store');
  } catch (error) {
    console.error('FXGA live intelligence report failed', { statusCode: error.statusCode || null, providerCode: error.providerCode || null, message: String(error.message || error).slice(0, 300) });
    return sendFriendlyError(req, res, error, error.statusCode || 502);
  }
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function fxgaIntelligenceCreateServer(options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const serverOptions = typeof options === 'function' ? undefined : options;
  const wrapped = async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); }
    catch { return listener(req, res); }

    const owned = new Set(['/api/gemini/chat','/api/gemini/live-report','/api/gemini/prompts','/api/gemini/intelligence-health','/api/errors/catalog']);
    if (!owned.has(url.pathname)) return listener(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' }); return res.end(); }

    if (url.pathname === '/api/gemini/chat') {
      if (req.method !== 'POST') return sendFriendlyError(req, res, { statusCode: 405, code: 'invalid_request', message: 'Chat requires POST' }, 405);
      return chat(req, res);
    }
    if (req.method !== 'GET') return sendFriendlyError(req, res, { statusCode: 405, code: 'invalid_request', message: 'This endpoint requires GET' }, 405);
    if (url.pathname === '/api/gemini/live-report') return liveReport(req, res);
    if (url.pathname === '/api/gemini/prompts') return sendJson(req, res, 200, { schema: 'fxga.prompt-registry.v1', prompts: publicPromptRegistry(), automaticRouting: true, timestamp: new Date().toISOString() }, 'public, max-age=60');
    if (url.pathname === '/api/errors/catalog') return sendJson(req, res, 200, { schema: 'fxga.error-catalog.v1', errors: publicErrorCatalog(), timestamp: new Date().toISOString() }, 'public, max-age=300');
    if (url.pathname === '/api/gemini/intelligence-health') return sendJson(req, res, 200, {
      ok: true, configured: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL, fallbackModel: GEMINI_FALLBACK_MODEL,
      promptCount: publicPromptRegistry().length, promptRouting: 'task-aware-md-library', liveReport: true, chatbot: true,
      applicationHourlyCap: null, applicationDailyCap: null, providerQuotaManaged: true,
      fallbackOnPrimaryQuota: GEMINI_FALLBACK_MODEL !== GEMINI_MODEL,
      endpoints: ['/api/gemini/chat','/api/gemini/live-report','/api/gemini/prompts','/api/errors/catalog'],
      timestamp: new Date().toISOString(),
    });
    return listener(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log('FXGA intelligence extension loaded', { model: GEMINI_MODEL, fallbackModel: GEMINI_FALLBACK_MODEL, promptCount: publicPromptRegistry().length, providerQuotaManaged: true, fallbackOnPrimaryQuota: GEMINI_FALLBACK_MODEL !== GEMINI_MODEL });
