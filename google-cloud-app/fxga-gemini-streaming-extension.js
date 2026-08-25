import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { classifyFxgaError } from './fxga-error-catalog.js';
import { loadPrompt, selectPrompt } from './fxga-prompt-library.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite').trim();
const GEMINI_RESERVE_MODEL = String(process.env.GEMINI_RESERVE_MODEL || 'gemini-3.7-flash').trim();
const PUBLIC_ORIGIN = String(process.env.FXGA_PUBLIC_ORIGIN || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/, '');
const API_STREAM_URL = 'https://generativelanguage.googleapis.com/v1/interactions?alt=sse';
const MAX_BODY_BYTES = 12_000;
const CACHE_TTL_MS = 10 * 60_000;
const PROMPT_CHAR_BUDGET = 30_000;
const PROVIDER_START_GAP_MS = 1_500;
const DEFAULT_RATE_RETRY_SECONDS = 12;
const MAX_INLINE_RATE_RETRY_SECONDS = 55;
const RATE_LIMIT_COOLDOWN_MS = 20_000;
const QUOTA_COOLDOWN_MS = 15 * 60_000;
const MAX_OUTPUT_TOKENS = 550;

const db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
const state = db.collection('fxga_collector_state');
const chunks = db.collection('fxga_collector_state_chunks');
const signals = db.collection('fxga_tradingview_signals');
const liveSignals = db.collection('fxga_tradingview_live');
const cache = db.collection('fxga_gemini_cache');
const providerState = state.doc('gemini-provider-state');
const modelCooldownUntil = new Map();
const inFlightByCacheId = new Map();
let providerStartGate = Promise.resolve();
let lastProviderStartAt = 0;

const CORE_RULES = [
  'You are the FXGA evidence intelligence layer.',
  'Use only supplied structured evidence. Never invent prices, signals, probabilities, performance statistics, events, backtests, or certainty.',
  'Stored FXGA engines and persisted Google Cloud evidence are the source of truth.',
  'Forecasts are scenarios with invalidation, not guarantees. A statistical edge may be claimed only when measured validation evidence supports it.',
  'Respect WAIT, WATCH and PREPARE states. A cancelled, expired, synthetic or test signal is not an executable trade.',
  'Prefer a concise decision-useful answer over repeating raw JSON or dumping the evidence payload.',
  'Explain conclusions clearly without exposing hidden chain-of-thought or private reasoning traces.',
  'Never expose credentials, keys, tokens, or authentication material.',
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

function startSse(req, res) {
  res.writeHead(200, {
    ...cors(String(req.headers.origin || '')),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

function sendEvent(res, event, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function sendKeepalive(res, label = 'waiting') {
  if (res.writableEnded || res.destroyed) return;
  res.write(`: fxga-${label}-${Date.now()}\n\n`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];
const objectEntries = (value, max) => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).slice(0, max)) : value;
const modelOrder = () => [...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_RESERVE_MODEL].filter(Boolean))];

async function readBody(req) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('FXGA chatbot request is too large'), { statusCode: 413, code: 'payload_too_large' });
    parts.push(chunk);
  }
  if (!parts.length) return {};
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('FXGA chatbot request must be valid JSON'), { statusCode: 400, code: 'invalid_request' }); }
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

function compactValue(value, depth = 0, limits = {}) {
  const maxDepth = limits.maxDepth ?? 5;
  const maxArray = limits.maxArray ?? 10;
  const maxKeys = limits.maxKeys ?? 20;
  const maxString = limits.maxString ?? 700;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `[${value.length} items omitted]`;
    return '[nested object omitted]';
  }
  if (Array.isArray(value)) return value.slice(0, maxArray).map(item => compactValue(item, depth + 1, limits));
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, maxKeys);
    return Object.fromEntries(entries.map(([key, item]) => [key, compactValue(item, depth + 1, limits)]));
  }
  return String(value);
}

function compactState(name, doc) {
  const payload = doc?.payload ?? doc ?? null;
  if (!payload) return null;
  if (name === 'market') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, assets: compactValue(list(payload.assets, 16), 0, { maxArray: 16, maxKeys: 14, maxString: 300 }) };
  if (name === 'technical') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, counts: compactValue(payload.counts, 0, { maxKeys: 16, maxString: 240 }), assets: compactValue(objectEntries(payload.assets, 16), 0, { maxKeys: 16, maxArray: 8, maxString: 300 }) };
  if (name === 'macro') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, coverageQuality: compactValue(payload.coverageQuality, 0, { maxKeys: 12, maxString: 300 }), observations: compactValue(list(payload.observations, 18), 0, { maxArray: 18, maxKeys: 16, maxString: 280 }) };
  if (name === 'calendar') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, sourceHealth: compactValue(payload.sourceHealth, 0, { maxKeys: 12, maxString: 280 }), events: compactValue(list(payload.events, 12), 0, { maxArray: 12, maxKeys: 16, maxString: 280 }) };
  if (name === 'event-studies') return {
    generatedAt: payload.generatedAt || doc?.updatedAt || null,
    summary: compactValue(payload.summary, 0, { maxDepth: 3, maxArray: 8, maxKeys: 14, maxString: 500 }),
    horizons: compactValue(list(payload.horizons, 8), 0, { maxArray: 8, maxKeys: 12, maxString: 240 }),
    preNewsWindows: compactValue(list(payload.preNewsWindows, 5), 0, { maxArray: 5, maxKeys: 12, maxString: 240 }),
    patternResearch: compactValue(payload.patternResearch, 0, { maxDepth: 3, maxArray: 5, maxKeys: 10, maxString: 350 }),
    backtestResearch: compactValue(payload.backtestResearch, 0, { maxDepth: 3, maxArray: 5, maxKeys: 10, maxString: 350 }),
  };
  if (name === 'intelligence') return {
    generatedAt: payload.generatedAt || doc?.updatedAt || null,
    decisionGovernance: compactValue(payload.decisionGovernance, 0, { maxDepth: 4, maxArray: 8, maxKeys: 16, maxString: 450 }),
    macroAnalysis: compactValue(payload.macroAnalysis, 0, { maxDepth: 4, maxArray: 8, maxKeys: 16, maxString: 450 }),
    economyAnalysis: compactValue(payload.economyAnalysis, 0, { maxDepth: 4, maxArray: 8, maxKeys: 16, maxString: 450 }),
    sessionSignals: compactValue(payload.sessionSignals, 0, { maxDepth: 4, maxArray: 8, maxKeys: 16, maxString: 400 }),
    research: payload.research ? {
      scenarios: compactValue(list(payload.research.scenarios, 4), 0, { maxDepth: 4, maxArray: 6, maxKeys: 14, maxString: 350 }),
      performance: compactValue(payload.research.performance || payload.research.strategyPerformance || null, 0, { maxDepth: 3, maxArray: 6, maxKeys: 14, maxString: 350 }),
      validation: compactValue(payload.research.validation, 0, { maxDepth: 3, maxArray: 6, maxKeys: 14, maxString: 350 }),
      edgeResearch: compactValue(payload.research.edgeResearch, 0, { maxDepth: 3, maxArray: 6, maxKeys: 14, maxString: 350 }),
    } : null,
  };
  return compactValue(payload, 0, { maxDepth: 4, maxArray: 10, maxKeys: 20, maxString: 500 });
}

function isSyntheticSignal(row) {
  if (!row || typeof row !== 'object') return false;
  const symbol = String(row.brokerSymbol || row.symbol || '').toUpperCase();
  const orderType = String(row.tradePlan?.orderType || row.orderType || '').toUpperCase();
  const reason = String(row.invalidation?.current_event_reason_code || row.currentEventReasonCode || '').toLowerCase();
  return symbol.startsWith('FXGA_TEST_') || orderType === 'TEST_ONLY' || reason === 'manual_pipeline_verification';
}

function safeSignal(row) {
  if (!row || typeof row !== 'object' || isSyntheticSignal(row)) return null;
  return {
    id: row.id || null,
    symbol: row.brokerSymbol || row.symbol || null,
    canonicalSymbol: row.symbol || null,
    timeframe: row.timeframe || null,
    side: row.side || null,
    status: row.status || null,
    lastEvent: row.lastEvent || null,
    signalTime: row.signalTime || null,
    methodCode: row.methodCode || null,
    methodFamily: row.methodFamily || null,
    methodScore: row.methodScore || row.score || null,
    tradePlan: compactValue(row.tradePlan, 0, { maxDepth: 3, maxArray: 6, maxKeys: 14, maxString: 300 }),
    riskReward: compactValue(row.riskReward, 0, { maxDepth: 3, maxArray: 6, maxKeys: 12, maxString: 260 }),
    lifecycle: compactValue(row.lifecycle, 0, { maxDepth: 3, maxArray: 6, maxKeys: 12, maxString: 260 }),
    timeframeHierarchy: compactValue(row.timeframeHierarchy, 0, { maxDepth: 3, maxArray: 6, maxKeys: 12, maxString: 260 }),
    currentMarketEvidence: compactValue(row.currentMarketEvidence, 0, { maxDepth: 3, maxArray: 6, maxKeys: 12, maxString: 260 }),
    invalidation: compactValue(row.invalidation, 0, { maxDepth: 3, maxArray: 6, maxKeys: 12, maxString: 300 }),
    updatedAt: row.updatedAt || null,
  };
}

async function recentSignals(signalId = '') {
  if (signalId) {
    const snap = await signals.doc(signalId).get();
    return snap.exists ? [safeSignal({ id: snap.id, ...snap.data() })].filter(Boolean) : [];
  }
  const snap = await signals.limit(50).get();
  return snap.docs
    .map(doc => safeSignal({ id: doc.id, ...doc.data() }))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt || b.signalTime || 0) - Date.parse(a.updatedAt || a.signalTime || 0))
    .slice(0, 8);
}

async function stateMeta() {
  const names = ['calendar', 'macro', 'intelligence', 'market', 'technical', 'event-studies'];
  const snaps = await Promise.all(names.map(name => state.doc(name).get()));
  return Object.fromEntries(snaps.map((snap, index) => [names[index], { exists: snap.exists, updatedAt: snap.data()?.updatedAt || null }]));
}

async function buildContext(descriptor, body) {
  const wanted = new Set(descriptor.states || []);
  const jobs = {};
  for (const name of ['intelligence', 'market', 'technical', 'macro', 'calendar', 'event-studies']) if (wanted.has(name)) jobs[name] = readState(name);
  if (wanted.has('signals')) jobs.signals = recentSignals(String(body.signalId || ''));
  if (wanted.has('signal-metrics')) jobs.signalMetrics = liveSignals.doc('metrics').get().then(snap => snap.exists ? compactValue(snap.data(), 0, { maxDepth: 3, maxArray: 8, maxKeys: 16, maxString: 300 }) : null);
  if (wanted.has('meta')) jobs.meta = stateMeta();
  const entries = await Promise.all(Object.entries(jobs).map(async ([key, promise]) => [key, await promise]));
  const context = {};
  for (const [key, value] of entries) context[key] = ['signals', 'signalMetrics', 'meta'].includes(key) ? value : compactState(key, value);

  if (descriptor.id === 'live-intelligence-report') {
    if (context.signals) context.signals = context.signals.slice(0, 5);
    if (context['event-studies']) {
      context['event-studies'] = {
        generatedAt: context['event-studies'].generatedAt || null,
        summary: context['event-studies'].summary || null,
        horizons: list(context['event-studies'].horizons, 5),
      };
    }
    delete context.meta;
  }

  context.program = {
    name: 'FX Global Avengers Trading Academy Macro Intelligence Dashboard',
    architecture: 'Cloudflare static frontend -> Google Cloud Run -> Firestore -> Gemini',
    models: modelOrder(),
    prompt: descriptor.id,
    quotaPolicy: 'provider managed; no FXGA hourly or daily cap',
    requestPolicy: 'semantic cache + prompt compaction + paced provider starts + bounded 429 retry',
  };
  context.evidencePolicy = 'Null or missing evidence must remain missing and must not be synthesized.';
  return context;
}

function hashableContext(value) {
  if (Array.isArray(value)) return value.map(hashableContext);
  if (!value || typeof value !== 'object') return value;
  const omitted = /^(generatedAt|updatedAt|lastUpdated|fetchedAt|collectedAt|retrievedAt)$/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !omitted.test(key))
    .map(([key, item]) => [key, hashableContext(item)]));
}

function fitContext(context, maxChars) {
  let candidate = context;
  let serialized = JSON.stringify(candidate);
  if (serialized.length <= maxChars) return { context: candidate, serialized, reduced: false };

  candidate = compactValue(context, 0, { maxDepth: 4, maxArray: 6, maxKeys: 14, maxString: 260 });
  serialized = JSON.stringify(candidate);
  if (serialized.length <= maxChars) return { context: candidate, serialized, reduced: true };

  candidate = {
    intelligence: compactValue(context.intelligence, 0, { maxDepth: 3, maxArray: 4, maxKeys: 10, maxString: 220 }),
    market: context.market ? { generatedAt: context.market.generatedAt || null, assets: list(context.market.assets, 8) } : null,
    technical: context.technical ? { counts: context.technical.counts || null, assets: objectEntries(context.technical.assets, 8) } : null,
    macro: context.macro ? { coverageQuality: context.macro.coverageQuality || null, observations: list(context.macro.observations, 10) } : null,
    calendar: context.calendar ? { events: list(context.calendar.events, 8) } : null,
    signals: list(context.signals, 5),
    signalMetrics: compactValue(context.signalMetrics, 0, { maxDepth: 2, maxArray: 5, maxKeys: 10, maxString: 180 }),
    program: context.program,
    evidencePolicy: context.evidencePolicy,
    promptCompaction: 'Evidence was deterministically reduced to remain within the FXGA provider token budget.',
  };
  serialized = JSON.stringify(candidate);
  if (serialized.length > maxChars) serialized = serialized.slice(0, Math.max(1_000, maxChars - 120)) + '\n[FXGA evidence text truncated after deterministic compaction]';
  return { context: candidate, serialized, reduced: true };
}

function composePrompt(taskPrompt, question, context) {
  const prefix = `${CORE_RULES}\n\nTASK-SPECIFIC INSTRUCTIONS\n${taskPrompt}\n\nUSER QUESTION\n${question}\n\nSTRUCTURED FXGA EVIDENCE\n`;
  const evidenceBudget = Math.max(8_000, PROMPT_CHAR_BUDGET - prefix.length);
  const fitted = fitContext(context, evidenceBudget);
  return { prompt: `${prefix}${fitted.serialized}`, reduced: fitted.reduced, chars: prefix.length + fitted.serialized.length };
}

function cooldownSeconds(model) {
  const until = Number(modelCooldownUntil.get(model) || 0);
  if (!until || until <= Date.now()) { if (until) modelCooldownUntil.delete(model); return 0; }
  return Math.max(1, Math.ceil((until - Date.now()) / 1000));
}

function retryAfterSeconds(response) {
  const raw = String(response.headers.get('retry-after') || '').trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

function isLongQuotaMessage(message = '') {
  return /daily|requests per day|rpd|per day|quota exceeded.*day/i.test(String(message));
}

function markCooldown(model, retryAfter, message = '') {
  const quotaLike = isLongQuotaMessage(message);
  const hinted = Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 0;
  const base = quotaLike ? QUOTA_COOLDOWN_MS : (hinted || RATE_LIMIT_COOLDOWN_MS);
  const duration = Math.min(quotaLike ? 60 * 60_000 : 2 * 60_000, Math.max(5_000, base));
  modelCooldownUntil.set(model, Date.now() + duration);
  return Math.ceil(duration / 1000);
}

async function recordProviderThrottle(model, error) {
  try {
    await providerState.set({
      last429At: new Date().toISOString(),
      last429Model: model || error?.model || null,
      lastRetryAfterSeconds: Number.isFinite(Number(error?.retryAfterSeconds)) ? Number(error.retryAfterSeconds) : null,
      last429Message: String(error?.message || 'Gemini provider throttling').slice(0, 600),
      backoffUntil: null,
      routingPolicy: 'telemetry-only-no-cross-instance-block',
      updatedAt: new Date().toISOString(),
      source: 'fxga-streaming-gateway',
    }, { merge: true });
  } catch { /* telemetry must never make inference fail */ }
}

async function recordProviderSuccess(model) {
  try {
    await providerState.set({
      lastSuccessAt: new Date().toISOString(),
      lastSuccessModel: model || null,
      backoffUntil: null,
      routingPolicy: 'telemetry-only-no-cross-instance-block',
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch { /* telemetry must never make inference fail */ }
}

async function paceProviderStart(res, model) {
  const previous = providerStartGate;
  let release;
  providerStartGate = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, PROVIDER_START_GAP_MS - (Date.now() - lastProviderStartAt));
    if (waitMs > 100) {
      sendEvent(res, 'status', { phase: 'queue', message: `Smoothing Gemini request burst for ${Math.ceil(waitMs / 1000)}s`, model });
      await sleep(waitMs);
    }
    lastProviderStartAt = Date.now();
  } finally {
    release();
  }
}

function thinkingLevelFor(model) {
  if (/gemini-3\.7-flash/i.test(model)) return 'low';
  if (/flash-lite/i.test(model)) return 'minimal';
  return 'low';
}

function printable(value, max = 360) {
  if (value == null) return 'not available';
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch { return String(value); }
}

function rowSummary(row, keys) {
  if (!row || typeof row !== 'object') return printable(row, 260);
  const pairs = [];
  for (const key of keys) if (row[key] != null && row[key] !== '') pairs.push(`${key}=${printable(row[key], 100)}`);
  return pairs.length ? pairs.join(' · ') : printable(row, 260);
}

function localEvidenceAnswer(descriptor, question, context, reason, retrySeconds = 0) {
  const lines = [
    'FXGA LOCAL EVIDENCE FALLBACK',
    '',
    `Gemini is temporarily rate-limited${retrySeconds > 0 ? `; the provider suggested retrying in about ${retrySeconds}s` : ''}. FXGA is showing a concise stored-evidence summary instead of dumping raw data.`,
    `Task: ${descriptor.label}`,
    `Question: ${question}`,
  ];

  const signalRows = Array.isArray(context.signals) ? context.signals.filter(Boolean).slice(0, 3) : [];
  lines.push('', 'Trade/setup status:');
  if (!signalRows.length) {
    lines.push('- No current non-test stored signal is available. Do not invent an entry, stop or target.');
  } else {
    for (const signal of signalRows) {
      const plan = signal.tradePlan || {};
      const levels = [
        plan.entry != null ? `entry ${plan.entry}` : null,
        plan.stopLoss != null ? `SL ${plan.stopLoss}` : null,
        plan.tp1 != null ? `TP1 ${plan.tp1}` : null,
        plan.tp2 != null ? `TP2 ${plan.tp2}` : null,
      ].filter(Boolean).join(' · ');
      lines.push(`- ${signal.symbol || signal.canonicalSymbol || 'unknown'} ${signal.timeframe || ''} ${signal.side || ''}: ${signal.status || signal.lastEvent || 'status n/a'}${signal.methodScore != null ? ` · score ${signal.methodScore}` : ''}${levels ? ` · ${levels}` : ''}`);
    }
  }

  if (context.market?.assets?.length) {
    lines.push('', 'Market snapshot:');
    for (const row of context.market.assets.slice(0, 4)) lines.push(`- ${rowSummary(row, ['symbol','price','last','changePct','changePercent','direction','trend'])}`);
  }
  if (context.macro?.observations?.length) {
    lines.push('', 'Macro snapshot:');
    for (const row of context.macro.observations.slice(0, 3)) lines.push(`- ${rowSummary(row, ['seriesId','indicator','value','date','change'])}`);
  }
  if (context.calendar?.events?.length) {
    lines.push('', 'Event risk:');
    for (const row of context.calendar.events.slice(0, 3)) lines.push(`- ${rowSummary(row, ['date','currency','event','title','impact','actual','forecast','previous'])}`);
  }
  if (context['event-studies']?.summary) {
    lines.push('', 'Research status:', `- ${printable(context['event-studies'].summary, 420)}`);
  }

  lines.push('', 'Recovery:', `- ${reason || 'Gemini provider capacity is temporarily constrained.'}`);
  lines.push('- FXGA will attempt Gemini again on the next request; one 429 no longer blocks all Cloud Run instances.');
  lines.push('- WAIT/WATCH/PREPARE and invalidation rules remain in force. This fallback is not a Gemini-generated answer.');
  return lines.join('\n');
}

async function streamDocument(res, document, { phase = 'cache', message = 'Using stored evidence-grounded answer', cached = true, stale = false } = {}) {
  sendEvent(res, 'status', { phase, message, model: document.model || null });
  sendEvent(res, 'status', { phase: 'typing', message: `${document.model || 'FXGA'} is streaming the answer`, model: document.model || null });
  const text = String(document.answer || '');
  const chunkSize = Math.max(20, Math.ceil(text.length / 70));
  for (let index = 0; index < text.length; index += chunkSize) {
    sendEvent(res, 'delta', { text: text.slice(index, index + chunkSize), model: document.model || null, cached });
    await sleep(6);
  }
  sendEvent(res, 'done', { result: { ...document, cached, stale } });
}

async function streamLocalFallback(res, descriptor, question, context, contextHash, reason, retryAfter = 0) {
  const answer = localEvidenceAnswer(descriptor, question, context, reason, retryAfter);
  const document = {
    schema: 'fxga.gemini.chat.v1',
    task: descriptor.id,
    label: `${descriptor.label} · provider fallback`,
    question,
    answer,
    model: 'fxga-local-evidence-fallback',
    evidenceDomains: descriptor.states,
    contextHash,
    createdAt: new Date().toISOString(),
    cached: false,
    stale: false,
    degraded: true,
    retryAfterSeconds: retryAfter || null,
    policy: 'Concise deterministic FXGA evidence fallback. No Gemini inference was used. Synthetic test signals are excluded.',
  };
  await streamDocument(res, document, {
    phase: 'fallback',
    message: retryAfter > 0 ? `Gemini is still rate-limited after retry; concise FXGA fallback is available now` : 'Gemini is unavailable; concise FXGA fallback is available now',
    cached: false,
    stale: false,
  });
}

async function parseGoogleStream(response, res, model) {
  const reader = response.body?.getReader();
  if (!reader) throw Object.assign(new Error('Gemini streaming body is unavailable'), { statusCode: 502, code: 'bad_gateway', model });
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let interactionId = null;
  let usage = null;

  const processFrame = frame => {
    const dataLines = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
    if (!dataLines.length) return;
    let payload;
    try { payload = JSON.parse(dataLines.join('\n')); } catch { return; }
    const type = String(payload.event_type || '');
    if (type === 'interaction.created') {
      interactionId = payload.interaction?.id || interactionId;
      sendEvent(res, 'status', { phase: 'connected', message: `${model} accepted the request`, model });
    } else if (type === 'step.start') {
      const stepType = String(payload.step?.type || '');
      if (stepType === 'thought') sendEvent(res, 'status', { phase: 'thinking', message: `${model} is processing the compact FXGA evidence`, model });
      if (stepType === 'model_output') sendEvent(res, 'status', { phase: 'typing', message: `${model} is generating the answer`, model });
    } else if (type === 'step.delta' && payload.delta?.type === 'text' && typeof payload.delta.text === 'string') {
      answer += payload.delta.text;
      sendEvent(res, 'delta', { text: payload.delta.text, model });
    } else if (type === 'interaction.completed') {
      interactionId = payload.interaction?.id || interactionId;
      usage = payload.interaction?.usage || usage;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const frame = buffer.slice(0, split);
      const separator = buffer.slice(split).match(/^\r?\n\r?\n/)?.[0] || '\n\n';
      buffer = buffer.slice(split + separator.length);
      processFrame(frame);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) processFrame(buffer);
  if (!answer.trim()) throw Object.assign(new Error('Gemini stream completed without usable text'), { statusCode: 502, code: 'bad_gateway', model });
  return { model, answer: answer.trim(), usage, interactionId };
}

async function invokeStreamingModel(model, prompt, res) {
  await paceProviderStart(res, model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    sendEvent(res, 'status', { phase: 'model', message: `Trying ${model}`, model });
    const response = await fetch(API_STREAM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY, Accept: 'text/event-stream' },
      body: JSON.stringify({
        model,
        input: prompt,
        stream: true,
        store: false,
        generation_config: {
          max_output_tokens: MAX_OUTPUT_TOKENS,
          thinking_level: thinkingLevelFor(model),
          thinking_summaries: 'none',
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
      const message = String(payload?.error?.message || payload?.message || `Gemini ${model} returned HTTP ${response.status}`);
      const error = Object.assign(new Error(message), {
        statusCode: response.status,
        code: String(payload?.error?.status || '').toLowerCase(),
        retryAfterSeconds: retryAfterSeconds(response),
        model,
      });
      if (response.status === 429) await recordProviderThrottle(model, error);
      throw error;
    }
    const result = await parseGoogleStream(response, res, model);
    await recordProviderSuccess(model);
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Gemini request deadline exceeded'), { statusCode: 504, code: 'deadline_exceeded', model });
    throw error;
  } finally { clearTimeout(timer); }
}

async function waitForRateWindow(res, seconds) {
  const bounded = Math.max(2, Math.min(MAX_INLINE_RATE_RETRY_SECONDS, Math.ceil(Number(seconds) || DEFAULT_RATE_RETRY_SECONDS)));
  const jitterMs = Math.floor(Math.random() * 1_500);
  sendEvent(res, 'status', { phase: 'retry-wait', message: `Gemini is busy. Waiting about ${bounded}s before one automatic retry instead of falling back immediately.`, retryAfterSeconds: bounded });
  const until = Date.now() + bounded * 1000 + jitterMs;
  while (Date.now() < until) {
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    await sleep(Math.min(5_000, Math.max(250, until - Date.now())));
    sendKeepalive(res, 'retry');
    if (remaining > 5) sendEvent(res, 'status', { phase: 'retry-wait', message: `Automatic Gemini retry in about ${Math.max(1, remaining - 5)}s`, retryAfterSeconds: Math.max(1, remaining - 5) });
  }
  return bounded;
}

async function invokeWithResilience(prompt, res) {
  const order = modelOrder();
  const attempted = [];
  const rateErrors = [];
  let last = null;

  for (const model of order.slice(0, Math.min(2, order.length))) {
    const cooling = cooldownSeconds(model);
    if (cooling > 0) {
      rateErrors.push({ model, retryAfterSeconds: cooling, message: `${model} is cooling down` });
      continue;
    }
    attempted.push(model);
    try { return await invokeStreamingModel(model, prompt, res); }
    catch (error) {
      last = error;
      const status = Number(error.statusCode || 500);
      if (status === 429) {
        const cooldown = markCooldown(model, error.retryAfterSeconds, error.message);
        rateErrors.push({ model, retryAfterSeconds: error.retryAfterSeconds || cooldown, message: error.message });
        sendEvent(res, 'status', { phase: 'failover', message: `${model} is rate-limited; checking one alternate route`, model, retryAfterSeconds: error.retryAfterSeconds || cooldown });
        continue;
      }
      if ([404, 408, 500, 502, 503, 504].includes(status)) {
        sendEvent(res, 'status', { phase: 'failover', message: `${model} is temporarily unavailable; checking an alternate route`, model });
        continue;
      }
      throw error;
    }
  }

  if (rateErrors.length) {
    const shortest = Math.min(...rateErrors.map(item => Number(item.retryAfterSeconds) > 0 ? Number(item.retryAfterSeconds) : DEFAULT_RATE_RETRY_SECONDS));
    if (!rateErrors.some(item => isLongQuotaMessage(item.message))) {
      await waitForRateWindow(res, shortest);
      const retryModel = order[0];
      if (retryModel) {
        modelCooldownUntil.delete(retryModel);
        attempted.push(`${retryModel}:retry`);
        sendEvent(res, 'status', { phase: 'retrying', message: `Retrying ${retryModel} after the rate window`, model: retryModel });
        try { return await invokeStreamingModel(retryModel, prompt, res); }
        catch (error) {
          last = error;
          if (Number(error.statusCode) === 429) markCooldown(retryModel, error.retryAfterSeconds, error.message);
          else if (![404, 408, 500, 502, 503, 504].includes(Number(error.statusCode || 500))) throw error;
        }
      }
    }
  }

  const reserve = order[2];
  if (reserve && !attempted.includes(reserve)) {
    const cooling = cooldownSeconds(reserve);
    if (cooling <= 0) {
      attempted.push(reserve);
      sendEvent(res, 'status', { phase: 'reserve', message: `Trying reserve model ${reserve}`, model: reserve });
      try { return await invokeStreamingModel(reserve, prompt, res); }
      catch (error) {
        last = error;
        if (Number(error.statusCode) === 429) markCooldown(reserve, error.retryAfterSeconds, error.message);
        else if (![404, 408, 500, 502, 503, 504].includes(Number(error.statusCode || 500))) throw error;
      }
    }
  }

  if (last) {
    last.modelsTried = attempted;
    const retryHints = rateErrors.map(item => Number(item.retryAfterSeconds)).filter(value => Number.isFinite(value) && value > 0);
    if (Number(last.statusCode) === 429 && retryHints.length) last.retryAfterSeconds = Math.min(...retryHints);
    throw last;
  }
  throw Object.assign(new Error('All configured Gemini routes are temporarily unavailable'), { statusCode: 503, code: 'service_unavailable', modelsTried: attempted });
}

async function waitForInFlight(promise, res) {
  let done = false;
  const heartbeat = (async () => {
    while (!done && !res.writableEnded && !res.destroyed) {
      await sleep(5_000);
      if (!done) sendKeepalive(res, 'coalesced');
    }
  })();
  try { return await promise; }
  finally { done = true; await heartbeat.catch(() => {}); }
}

async function handleStream(req, res) {
  startSse(req, res);
  try {
    sendEvent(res, 'status', { phase: 'preparing', message: 'Reading the question and selecting an advanced FXGA prompt' });
    const body = await readBody(req);
    const question = String(body.question || '').trim();
    if (!question) throw Object.assign(new Error('A question is required'), { statusCode: 400, code: 'invalid_request' });
    const descriptor = selectPrompt(question, String(body.task || '').trim());
    sendEvent(res, 'status', { phase: 'evidence', message: `Loading ${descriptor.label} evidence`, task: descriptor.id });
    const [taskPrompt, context] = await Promise.all([loadPrompt(descriptor.id), buildContext(descriptor, body)]);
    const contextHash = sha(hashableContext(context));
    const cacheId = sha(`stream-chat:v2:${descriptor.id}:${question}:${contextHash}`).slice(0, 56);
    const cachedSnap = await cache.doc(cacheId).get();
    const existing = cachedSnap.exists ? cachedSnap.data() : null;
    if (existing) {
      const age = Date.now() - Date.parse(existing.createdAt || 0);
      if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
        await streamDocument(res, existing, { phase: 'cache', message: 'Matching Gemini answer found in semantic Firestore cache', cached: true, stale: false });
        return res.end();
      }
    }

    const shared = inFlightByCacheId.get(cacheId);
    if (shared) {
      sendEvent(res, 'status', { phase: 'coalesced', message: 'An identical Gemini request is already running; sharing that result instead of spending another provider request' });
      try {
        const document = await waitForInFlight(shared, res);
        await streamDocument(res, document, { phase: 'coalesced', message: 'Shared Gemini result is ready', cached: true, stale: false });
        return res.end();
      } catch { }
    }

    if (!GEMINI_API_KEY) {
      await streamLocalFallback(res, descriptor, question, context, contextHash, 'Gemini credential is unavailable');
      return res.end();
    }

    const composed = composePrompt(taskPrompt, question, context);
    sendEvent(res, 'status', {
      phase: 'routing',
      message: `Routing a ${composed.chars.toLocaleString()} character evidence prompt through Gemini with paced failover`,
      task: descriptor.id,
      promptCompacted: composed.reduced,
    });

    let resolveFlight;
    let rejectFlight;
    const flight = new Promise((resolve, reject) => { resolveFlight = resolve; rejectFlight = reject; });
    flight.catch(() => {});
    inFlightByCacheId.set(cacheId, flight);

    try {
      let model;
      try {
        model = await invokeWithResilience(composed.prompt, res);
      } catch (error) {
        const status = Number(error.statusCode || 500);
        if (existing && [429, 500, 502, 503, 504].includes(status)) {
          const stale = { ...existing, degraded: true, degradedReason: 'Gemini provider temporarily unavailable after bounded retry.' };
          resolveFlight(stale);
          await streamDocument(res, stale, { phase: 'stale-cache', message: 'Gemini is still busy after retry; using the last matching verified answer', cached: true, stale: true });
          return res.end();
        }
        if ([429, 404, 408, 500, 502, 503, 504].includes(status)) {
          rejectFlight(error);
          await streamLocalFallback(res, descriptor, question, context, contextHash, error.message || 'Gemini provider is temporarily unavailable', Number(error.retryAfterSeconds || 0));
          return res.end();
        }
        rejectFlight(error);
        throw error;
      }

      const document = {
        schema: 'fxga.gemini.chat.v2',
        task: descriptor.id,
        label: descriptor.label,
        question,
        answer: model.answer,
        model: model.model,
        usage: model.usage,
        interactionId: model.interactionId,
        evidenceDomains: descriptor.states,
        contextHash,
        promptChars: composed.chars,
        promptCompacted: composed.reduced,
        createdAt: new Date().toISOString(),
        policy: 'Evidence-grounded explanation and scenario analysis only. Performance and edge claims require measured validation evidence.',
      };
      await cache.doc(cacheId).set(document, { merge: false });
      resolveFlight(document);
      sendEvent(res, 'done', { result: { ...document, cached: false, stale: false } });
      return res.end();
    } finally {
      if (inFlightByCacheId.get(cacheId) === flight) inFlightByCacheId.delete(cacheId);
    }
  } catch (error) {
    const friendly = classifyFxgaError(error, error.statusCode || 502);
    sendEvent(res, 'error', { friendlyError: friendly, modelsTried: error.modelsTried || [], model: error.model || null });
    return res.end();
  }
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function fxgaStreamingCreateServer(options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const serverOptions = typeof options === 'function' ? undefined : options;
  const wrapped = async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); }
    catch { return listener(req, res); }
    if (url.pathname !== '/api/gemini/chat-stream') return listener(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' }); return res.end(); }
    if (req.method !== 'POST') {
      startSse(req, res);
      sendEvent(res, 'error', { friendlyError: classifyFxgaError({ statusCode: 405, code: 'invalid_request', message: 'Streaming chat requires POST' }, 405) });
      return res.end();
    }
    return handleStream(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log('FXGA Gemini streaming gateway loaded', {
  models: modelOrder(),
  route: '/api/gemini/chat-stream',
  providerQuotaManaged: true,
  rateLimitStrategy: 'semantic-cache-prompt-compaction-paced-two-route-failover-bounded-retry-reserve-last',
  crossInstance429Block: false,
  syntheticSignalsExcluded: true,
  localEvidenceFallback: 'concise',
  realSseTyping: true,
});