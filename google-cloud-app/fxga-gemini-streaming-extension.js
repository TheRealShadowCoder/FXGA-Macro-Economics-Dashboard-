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
const RATE_LIMIT_COOLDOWN_MS = 20_000;
const QUOTA_COOLDOWN_MS = 15 * 60_000;

const db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
const state = db.collection('fxga_collector_state');
const chunks = db.collection('fxga_collector_state_chunks');
const signals = db.collection('fxga_tradingview_signals');
const liveSignals = db.collection('fxga_tradingview_live');
const cache = db.collection('fxga_gemini_cache');
const providerState = state.doc('gemini-provider-state');
const modelCooldownUntil = new Map();

const CORE_RULES = [
  'You are the FXGA evidence intelligence layer.',
  'Use only supplied structured evidence. Never invent prices, signals, probabilities, performance statistics, events, backtests, or certainty.',
  'Stored FXGA engines and persisted Google Cloud evidence are the source of truth.',
  'Forecasts are scenarios with invalidation, not guarantees. A statistical edge may be claimed only when measured validation evidence supports it.',
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

function compactState(name, doc) {
  const payload = doc?.payload ?? doc ?? null;
  if (!payload) return null;
  if (name === 'market') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, assets: list(payload.assets, 24) };
  if (name === 'technical') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, counts: payload.counts || null, assets: objectEntries(payload.assets, 24) };
  if (name === 'macro') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, coverageQuality: payload.coverageQuality || null, observations: list(payload.observations, 36) };
  if (name === 'calendar') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, sourceHealth: payload.sourceHealth || null, events: list(payload.events, 24) };
  if (name === 'event-studies') return { generatedAt: payload.generatedAt || doc?.updatedAt || null, summary: payload.summary || null, priceUniverse: list(payload.priceUniverse, 18), preNewsWindows: list(payload.preNewsWindows, 10), horizons: list(payload.horizons, 10), patternResearch: payload.patternResearch || null, backtestResearch: payload.backtestResearch || null };
  if (name === 'intelligence') return {
    generatedAt: payload.generatedAt || doc?.updatedAt || null,
    decisionGovernance: payload.decisionGovernance || null,
    macroAnalysis: payload.macroAnalysis || null,
    economyAnalysis: payload.economyAnalysis || null,
    sessionSignals: payload.sessionSignals || null,
    research: payload.research ? {
      scenarios: list(payload.research.scenarios, 10),
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
    tradePlan: row.tradePlan || null,
    riskReward: row.riskReward || null,
    lifecycle: row.lifecycle || null,
    timeframeHierarchy: row.timeframeHierarchy || null,
    currentMarketEvidence: row.currentMarketEvidence || null,
    invalidation: row.invalidation || null,
    updatedAt: row.updatedAt || null,
  };
}

async function recentSignals(signalId = '') {
  if (signalId) {
    const snap = await signals.doc(signalId).get();
    return snap.exists ? [safeSignal({ id: snap.id, ...snap.data() })] : [];
  }
  const snap = await signals.limit(40).get();
  return snap.docs.map(doc => safeSignal({ id: doc.id, ...doc.data() })).filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt || b.signalTime || 0) - Date.parse(a.updatedAt || a.signalTime || 0)).slice(0, 20);
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
  if (wanted.has('signal-metrics')) jobs.signalMetrics = liveSignals.doc('metrics').get().then(snap => snap.exists ? snap.data() : null);
  if (wanted.has('meta')) jobs.meta = stateMeta();
  const entries = await Promise.all(Object.entries(jobs).map(async ([key, promise]) => [key, await promise]));
  const context = {};
  for (const [key, value] of entries) context[key] = ['signals', 'signalMetrics', 'meta'].includes(key) ? value : compactState(key, value);
  context.program = {
    name: 'FX Global Avengers Trading Academy Macro Intelligence Dashboard',
    architecture: 'Cloudflare static frontend -> Google Cloud Run -> Firestore -> Gemini',
    models: modelOrder(),
    prompt: descriptor.id,
    quotaPolicy: 'provider managed; no FXGA hourly or daily cap',
  };
  context.evidencePolicy = 'Null or missing evidence must remain missing and must not be synthesized.';
  return context;
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

function markCooldown(model, retryAfter, message = '') {
  const quotaLike = /daily|quota exceeded|resource exhausted.*quota|per day/i.test(message);
  const hinted = Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 0;
  const base = quotaLike ? QUOTA_COOLDOWN_MS : (hinted || RATE_LIMIT_COOLDOWN_MS);
  const duration = Math.min(quotaLike ? 60 * 60_000 : 2 * 60_000, Math.max(5_000, base));
  modelCooldownUntil.set(model, Date.now() + duration);
  return Math.ceil(duration / 1000);
}

async function readProviderBackoff() {
  try {
    const snap = await providerState.get();
    if (!snap.exists) return 0;
    const until = Date.parse(String(snap.data()?.backoffUntil || ''));
    return Number.isFinite(until) && until > Date.now() ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 0;
  } catch { return 0; }
}

async function setProviderBackoff(seconds, reason) {
  const safeSeconds = Math.max(5, Math.min(15 * 60, Number(seconds || 20)));
  try {
    await providerState.set({
      backoffUntil: new Date(Date.now() + safeSeconds * 1000).toISOString(),
      reason: String(reason || 'Gemini provider throttling'),
      updatedAt: new Date().toISOString(),
      source: 'fxga-streaming-gateway',
    }, { merge: true });
  } catch { /* provider throttling must not make Firestore telemetry fatal */ }
  return safeSeconds;
}

function composePrompt(taskPrompt, question, context) {
  return `${CORE_RULES}\n\nTASK-SPECIFIC INSTRUCTIONS\n${taskPrompt}\n\nUSER QUESTION\n${question}\n\nSTRUCTURED FXGA EVIDENCE\n${JSON.stringify(context)}`;
}

function printable(value, max = 900) {
  if (value == null) return 'not available';
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch { return String(value); }
}

function rowSummary(row, keys) {
  if (!row || typeof row !== 'object') return printable(row, 360);
  const pairs = [];
  for (const key of keys) if (row[key] != null && row[key] !== '') pairs.push(`${key}=${printable(row[key], 180)}`);
  return pairs.length ? pairs.join(' · ') : printable(row, 360);
}

function localEvidenceAnswer(descriptor, question, context, reason) {
  const lines = [
    'FXGA LOCAL EVIDENCE FALLBACK',
    '',
    `Gemini is temporarily unavailable (${reason}). FXGA is answering from the program’s stored deterministic evidence so the dashboard remains usable. This is not a Gemini-generated response.`,
    '',
    `Task: ${descriptor.label}`,
    `Question: ${question}`,
    '',
    'Evidence status:',
  ];
  const domains = descriptor.states || [];
  for (const domain of domains) {
    const key = domain === 'signal-metrics' ? 'signalMetrics' : domain;
    const value = context[key];
    const count = Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : value == null ? 0 : 1;
    lines.push(`- ${domain}: ${value == null ? 'missing' : `available (${count} item/section${count === 1 ? '' : 's'})`}`);
  }

  const signalRows = Array.isArray(context.signals) ? context.signals.filter(Boolean).slice(0, 6) : [];
  lines.push('', 'Current stored trade/setup evidence:');
  if (!signalRows.length) {
    lines.push('- No stored signal record is available for this task. FXGA will not invent an entry, stop loss or take-profit level.');
  } else {
    for (const signal of signalRows) {
      const core = [signal.symbol || signal.canonicalSymbol || 'unknown symbol', signal.timeframe || 'TF n/a', signal.side || 'side n/a', signal.status || signal.lastEvent || 'status n/a'].join(' · ');
      lines.push(`- ${core}${signal.methodScore != null ? ` · score=${signal.methodScore}` : ''}`);
      if (signal.tradePlan) lines.push(`  Stored trade plan: ${printable(signal.tradePlan, 700)}`);
      if (signal.invalidation) lines.push(`  Invalidation: ${printable(signal.invalidation, 420)}`);
      if (signal.riskReward) lines.push(`  Risk/reward evidence: ${printable(signal.riskReward, 320)}`);
    }
  }

  if (context.market?.assets?.length) {
    lines.push('', 'Market evidence snapshot:');
    for (const row of context.market.assets.slice(0, 6)) lines.push(`- ${rowSummary(row, ['symbol','name','price','last','close','changePct','changePercent','direction','trend','updatedAt'])}`);
  }
  if (context.technical?.assets) {
    lines.push('', 'Technical evidence snapshot:');
    for (const [symbol, row] of Object.entries(context.technical.assets).slice(0, 6)) lines.push(`- ${symbol}: ${rowSummary(row, ['trend','direction','bias','signal','score','timeframe','updatedAt'])}`);
  }
  if (context.macro?.observations?.length) {
    lines.push('', 'Macro evidence snapshot:');
    for (const row of context.macro.observations.slice(0, 6)) lines.push(`- ${rowSummary(row, ['country','seriesId','indicator','name','value','unit','date','change','updatedAt'])}`);
  }
  if (context.calendar?.events?.length) {
    lines.push('', 'Upcoming/stored event evidence:');
    for (const row of context.calendar.events.slice(0, 6)) lines.push(`- ${rowSummary(row, ['time','date','country','currency','event','title','impact','actual','forecast','previous'])}`);
  }
  if (context['event-studies']) {
    lines.push('', 'Event-study evidence:', `- ${printable(context['event-studies'].summary || context['event-studies'], 1000)}`);
  }
  if (context.intelligence?.research) {
    lines.push('', 'Research/validation evidence:', `- ${printable(context.intelligence.research, 1000)}`);
  }
  if (context.signalMetrics) {
    lines.push('', 'Signal performance metrics:', `- ${printable(context.signalMetrics, 900)}`);
  }

  const executionTask = /scalp|day|long-term|session|entry|stop|take-profit|trade-management/.test(descriptor.id);
  if (executionTask) {
    lines.push('', 'Execution rule:', '- Only stored trade-plan levels above are actionable evidence. Missing entry/SL/TP values remain missing. No level is guaranteed, and any forecast must retain its invalidation condition.');
  }
  lines.push('', 'Provider recovery:', '- FXGA has temporarily cooled the Gemini route across Cloud Run instances. When Google capacity returns, the same question automatically goes back to Gemini; there is no fixed FXGA hourly/daily cap.');
  return lines.join('\n');
}

async function streamDocument(res, document, { phase = 'cache', message = 'Using stored evidence-grounded answer', cached = true, stale = false } = {}) {
  sendEvent(res, 'status', { phase, message, model: document.model || null });
  sendEvent(res, 'status', { phase: 'typing', message: `${document.model || 'FXGA'} is streaming the answer`, model: document.model || null });
  const text = String(document.answer || '');
  const chunkSize = Math.max(16, Math.ceil(text.length / 90));
  for (let index = 0; index < text.length; index += chunkSize) {
    sendEvent(res, 'delta', { text: text.slice(index, index + chunkSize), model: document.model || null, cached });
    await sleep(8);
  }
  sendEvent(res, 'done', { result: { ...document, cached, stale } });
}

async function streamLocalFallback(res, descriptor, question, context, contextHash, reason, retryAfterSeconds = 0) {
  const answer = localEvidenceAnswer(descriptor, question, context, reason);
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
    retryAfterSeconds,
    policy: 'Deterministic FXGA evidence fallback. No Gemini inference was used. Missing trade levels and unsupported edge claims are never invented.',
  };
  await streamDocument(res, document, {
    phase: 'fallback',
    message: retryAfterSeconds > 0 ? `Gemini is throttled for about ${retryAfterSeconds}s; FXGA local evidence fallback is answering now` : 'Gemini is unavailable; FXGA local evidence fallback is answering now',
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
      if (stepType === 'thought') sendEvent(res, 'status', { phase: 'thinking', message: `${model} is processing the FXGA evidence`, model });
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    sendEvent(res, 'status', { phase: 'model', message: `Trying ${model}`, model });
    const response = await fetch(API_STREAM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY, Accept: 'text/event-stream' },
      body: JSON.stringify({ model, input: prompt, stream: true, store: false, generation_config: { max_output_tokens: 650 } }),
    });
    if (!response.ok) {
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
      const message = String(payload?.error?.message || payload?.message || `Gemini ${model} returned HTTP ${response.status}`);
      throw Object.assign(new Error(message), { statusCode: response.status, code: String(payload?.error?.status || '').toLowerCase(), retryAfterSeconds: retryAfterSeconds(response), model });
    }
    return await parseGoogleStream(response, res, model);
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Gemini request deadline exceeded'), { statusCode: 504, code: 'deadline_exceeded', model });
    throw error;
  } finally { clearTimeout(timer); }
}

async function invokeWithFailover(prompt, res) {
  const attempted = [];
  let last = null;
  let shortestCooldown = Infinity;
  for (const model of modelOrder()) {
    const cooling = cooldownSeconds(model);
    if (cooling > 0) {
      shortestCooldown = Math.min(shortestCooldown, cooling);
      sendEvent(res, 'status', { phase: 'cooldown', message: `${model} is cooling down for about ${cooling}s`, model, retryAfterSeconds: cooling });
      continue;
    }
    attempted.push(model);
    try { return await invokeStreamingModel(model, prompt, res); }
    catch (error) {
      last = error;
      const status = Number(error.statusCode || 500);
      if (status === 429) {
        const cooldown = markCooldown(model, error.retryAfterSeconds, error.message);
        shortestCooldown = Math.min(shortestCooldown, cooldown);
        sendEvent(res, 'status', { phase: 'failover', message: `${model} is rate-limited; trying the next route`, model, retryAfterSeconds: cooldown });
        continue;
      }
      if ([404, 408, 500, 502, 503, 504].includes(status)) {
        sendEvent(res, 'status', { phase: 'failover', message: `${model} is temporarily unavailable; trying the next route`, model });
        continue;
      }
      throw error;
    }
  }
  if (last) {
    last.modelsTried = attempted;
    if (Number.isFinite(shortestCooldown)) last.retryAfterSeconds = Math.max(1, shortestCooldown);
    throw last;
  }
  throw Object.assign(new Error('All configured Gemini models are temporarily cooling down'), { statusCode: 429, code: 'rate_limit_exceeded', retryAfterSeconds: Number.isFinite(shortestCooldown) ? shortestCooldown : 20, modelsTried: [] });
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
    const contextHash = sha(context);
    const cacheId = sha(`stream-chat:${descriptor.id}:${question}:${contextHash}`).slice(0, 56);
    const cachedSnap = await cache.doc(cacheId).get();
    const existing = cachedSnap.exists ? cachedSnap.data() : null;
    if (existing) {
      const age = Date.now() - Date.parse(existing.createdAt || 0);
      if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
        await streamDocument(res, existing, { phase: 'cache', message: 'Matching Gemini answer found in Firestore cache', cached: true, stale: false });
        return res.end();
      }
    }

    const providerBackoff = await readProviderBackoff();
    if (!GEMINI_API_KEY) {
      await streamLocalFallback(res, descriptor, question, context, contextHash, 'Gemini credential is unavailable');
      return res.end();
    }
    if (providerBackoff > 0) {
      await streamLocalFallback(res, descriptor, question, context, contextHash, 'Google Gemini project/model capacity is temporarily cooling down', providerBackoff);
      return res.end();
    }

    sendEvent(res, 'status', { phase: 'routing', message: `Routing through ${modelOrder().length} Gemini model routes`, task: descriptor.id });
    let model;
    try {
      model = await invokeWithFailover(composePrompt(taskPrompt, question, context), res);
    } catch (error) {
      const status = Number(error.statusCode || 500);
      if (existing && [429, 500, 502, 503, 504].includes(status)) {
        await streamDocument(res, { ...existing, degraded: true, degradedReason: 'Gemini provider temporarily unavailable.' }, { phase: 'stale-cache', message: 'Gemini is busy; using the last matching verified answer', cached: true, stale: true });
        return res.end();
      }
      if ([429, 404, 408, 500, 502, 503, 504].includes(status)) {
        const retry = status === 429 ? await setProviderBackoff(error.retryAfterSeconds || 20, error.message) : 0;
        await streamLocalFallback(res, descriptor, question, context, contextHash, error.message || 'Gemini provider is temporarily unavailable', retry);
        return res.end();
      }
      throw error;
    }

    const document = {
      schema: 'fxga.gemini.chat.v1',
      task: descriptor.id,
      label: descriptor.label,
      question,
      answer: model.answer,
      model: model.model,
      usage: model.usage,
      interactionId: model.interactionId,
      evidenceDomains: descriptor.states,
      contextHash,
      createdAt: new Date().toISOString(),
      policy: 'Evidence-grounded explanation and scenario analysis only. Performance and edge claims require measured validation evidence.',
    };
    await cache.doc(cacheId).set(document, { merge: false });
    sendEvent(res, 'done', { result: { ...document, cached: false, stale: false } });
    return res.end();
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
  projectWideAdaptiveBackoff: true,
  localEvidenceFallback: true,
  realSseTyping: true,
});
