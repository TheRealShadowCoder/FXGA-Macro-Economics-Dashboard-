import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore, FieldValue } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const SECRET_NAME = process.env.GEMINI_SECRET_NAME || 'gemini-api-key';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DAILY_LIMIT = Math.max(1, Math.min(500, Number(process.env.GEMINI_DAILY_GENERATION_LIMIT || 100)));
const PUBLIC_ORIGIN = String(process.env.FXGA_PUBLIC_ORIGIN || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/, '');
const MAX_BODY_BYTES = 16_384;
const CACHE_SCHEMA = 'fxga.gemini.smc-explanation.v1';
const db = new Firestore({ projectId: PROJECT_ID || undefined, ignoreUndefinedProperties: true });
const signals = db.collection('fxga_tradingview_signals');
const explanations = db.collection('fxga_gemini_explanations');
const usage = db.collection('fxga_ai_usage');
const perIp = new Map();
let secretCache = { value: '', expiresAt: 0 };

const clean = (value, max = 512) => String(value ?? '').slice(0, max);
const finite = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return forwarded[0] || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
}

function rateAllowed(req) {
  const ip = requestIp(req);
  const minute = Math.floor(Date.now() / 60_000);
  const current = perIp.get(ip);
  if (!current || current.minute !== minute) { perIp.set(ip, { minute, count: 1 }); return true; }
  current.count += 1;
  return current.count <= 12;
}

function cors(origin) {
  const allowed = !origin || origin === PUBLIC_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : PUBLIC_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Cache-Control, Content-Type',
    'Access-Control-Max-Age': '86400',
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
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Gemini request body is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Gemini request body must be valid JSON'), { statusCode: 400 }); }
}

async function metadataAccessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Google metadata token unavailable (${response.status})`);
  const payload = await response.json();
  if (!payload?.access_token) throw new Error('Google metadata token response did not contain an access token');
  return payload.access_token;
}

async function geminiApiKey() {
  if (process.env.GEMINI_API_KEY) return String(process.env.GEMINI_API_KEY).trim();
  if (secretCache.value && Date.now() < secretCache.expiresAt) return secretCache.value;
  if (!PROJECT_ID) throw new Error('Google Cloud project id is unavailable');
  const token = await metadataAccessToken();
  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/secrets/${encodeURIComponent(SECRET_NAME)}/versions/latest:access`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini Secret Manager access failed (${response.status}): ${text.slice(0, 180)}`);
  }
  const payload = await response.json();
  const encoded = payload?.payload?.data;
  if (!encoded) throw new Error('Gemini Secret Manager payload is empty');
  const value = Buffer.from(encoded, 'base64').toString('utf8').trim();
  if (!value) throw new Error('Gemini API key secret is empty');
  secretCache = { value, expiresAt: Date.now() + 10 * 60_000 };
  return value;
}

function safeSignal(signal) {
  const hierarchy = signal?.timeframeHierarchy || {};
  const method = {
    id: finite(signal?.methodId),
    code: clean(signal?.methodCode, 96),
    family: clean(signal?.methodFamily, 128),
    score: finite(signal?.methodScore),
    exactMatches: finite(signal?.exactMatches),
  };
  return {
    id: clean(signal?.id, 96),
    symbol: clean(signal?.brokerSymbol || signal?.symbol, 128),
    canonicalSymbol: clean(signal?.symbol, 128),
    brokerCompany: clean(signal?.brokerCompany, 160),
    brokerServer: clean(signal?.brokerServer, 160),
    side: clean(signal?.side, 16),
    status: clean(signal?.status, 64),
    lastEvent: clean(signal?.lastEvent, 64),
    signalTime: clean(signal?.signalTime, 64),
    method,
    archetype: {
      id: finite(signal?.archetypeId),
      code: clean(signal?.archetypeCode, 64),
      name: clean(signal?.archetypeName, 180),
    },
    tradePlan: signal?.tradePlan || null,
    riskReward: signal?.riskReward || null,
    timeframeHierarchy: hierarchy,
    dealingRange: signal?.dealingRange || null,
    pdArray: signal?.pdArray || null,
    invalidation: signal?.invalidation || null,
    smcEvidenceAtSignal: signal?.smcEvidenceAtSignal || null,
    currentMarketEvidence: signal?.currentMarketEvidence || null,
    deterministicIntelligence: signal?.intelligence || null,
  };
}

function promptFor(signal) {
  return `You are the read-only FXGA SMC2000 explanation layer. Explain only the supplied deterministic MetaTrader/SMC evidence. Never invent missing prices, indicators, confirmations, probabilities, win rates or profitability. Never reverse the source BUY/SELL direction. If evidence conflicts, state the conflict. Distinguish source facts from interpretation. Do not give a guarantee or claim a trade will make money.\n\nReturn concise professional markdown using exactly these headings:\n## Setup\n## Why it exists\n## Timeframe alignment\n## Entry and invalidation\n## Targets and risk geometry\n## Conflicting evidence\n## What would strengthen or weaken it\n## Bottom line\n\nSignal JSON:\n${JSON.stringify(signal)}`;
}

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
}

async function reserveDailyGeneration() {
  const day = new Date().toISOString().slice(0, 10);
  const ref = usage.doc(`gemini_${day}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.generationCount || 0);
    if (count >= DAILY_LIMIT) return { allowed: false, day, count };
    tx.set(ref, { provider: 'google-gemini', day, generationCount: FieldValue.increment(1), dailyLimit: DAILY_LIMIT, updatedAt: new Date().toISOString() }, { merge: true });
    return { allowed: true, day, count: count + 1 };
  });
}

async function generateExplanation(signal) {
  const key = await geminiApiKey();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptFor(signal) }] }],
      generationConfig: { temperature: 0.15, topP: 0.9, maxOutputTokens: 1000 },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 240)}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Gemini returned invalid JSON'); }
  const explanation = extractText(payload);
  if (!explanation) throw new Error('Gemini returned no explanation text');
  return { explanation, usageMetadata: payload?.usageMetadata || null };
}

async function health(req, res) {
  let configured = false;
  let secretStatus = 'unverified';
  try {
    await geminiApiKey();
    configured = true;
    secretStatus = 'available';
  } catch (error) {
    secretStatus = /404|not found/i.test(String(error?.message || '')) ? 'secret-not-found' : 'unavailable';
  }
  return sendJson(req, res, 200, {
    ok: true,
    provider: 'Google Gemini Developer API',
    configured,
    secretStatus,
    model: MODEL,
    dailyGenerationLimit: DAILY_LIMIT,
    arbitraryPublicPrompts: false,
    role: 'read-only explanation layer; deterministic FXGA signals remain authoritative',
  });
}

async function explainSmc(req, res) {
  if (!rateAllowed(req)) return sendJson(req, res, 429, { error: 'Gemini explanation rate limit exceeded' });
  let body;
  try { body = await readJson(req); }
  catch (error) { return sendJson(req, res, error.statusCode || 400, { error: error.message }); }
  const signalId = clean(body?.signalId, 96).trim();
  if (!signalId || !/^[A-Za-z0-9_-]{8,96}$/.test(signalId)) return sendJson(req, res, 400, { error: 'A valid stored signalId is required' });

  const snap = await signals.doc(signalId).get();
  if (!snap.exists) return sendJson(req, res, 404, { error: 'Stored SMC signal was not found' });
  const stored = { id: snap.id, ...snap.data() };
  if (String(stored.engine || '').toUpperCase() !== 'FXGA_SMC2000') return sendJson(req, res, 422, { error: 'Gemini explanations are restricted to FXGA_SMC2000 signals' });

  const signal = safeSignal(stored);
  const version = hash(JSON.stringify({ id: signal.id, updatedAt: stored.updatedAt || '', status: signal.status, lastEvent: signal.lastEvent, evidence: signal.currentMarketEvidence })).slice(0, 32);
  const cacheId = hash(`${signalId}:${version}`).slice(0, 48);
  const cacheRef = explanations.doc(cacheId);
  const cached = await cacheRef.get();
  if (cached.exists) return sendJson(req, res, 200, { ...cached.data(), cached: true }, 'private, max-age=60');

  const reservation = await reserveDailyGeneration();
  if (!reservation.allowed) return sendJson(req, res, 429, { error: 'FXGA Gemini daily free-tier protection limit reached', dailyLimit: DAILY_LIMIT, resets: `${reservation.day}T23:59:59Z` });

  try {
    const result = await generateExplanation(signal);
    const document = {
      schema: CACHE_SCHEMA,
      provider: 'Google Gemini Developer API',
      model: MODEL,
      signalId,
      signalVersion: version,
      symbol: signal.symbol,
      side: signal.side,
      generatedAt: new Date().toISOString(),
      explanation: result.explanation,
      usageMetadata: result.usageMetadata,
      policy: 'Gemini explains persisted FXGA evidence only. It does not generate, reverse, execute or guarantee a trading signal.',
    };
    await cacheRef.set(document, { merge: false });
    return sendJson(req, res, 200, { ...document, cached: false });
  } catch (error) {
    console.error('FXGA Gemini explanation error:', String(error?.message || error).replace(/[A-Za-z0-9_-]{25,}/g, '[redacted]'));
    return sendJson(req, res, 502, { error: 'Gemini explanation is temporarily unavailable' });
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
    if (url.pathname === '/api/gemini/health' || url.pathname === '/api/gemini/explain-smc') {
      try {
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' }); return res.end(); }
        if (url.pathname === '/api/gemini/health') {
          if (req.method !== 'GET') return sendJson(req, res, 405, { error: 'Gemini health requires GET' });
          return await health(req, res);
        }
        if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'SMC explanation requires POST' });
        return await explainSmc(req, res);
      } catch (error) {
        console.error('FXGA Gemini hook error:', String(error?.message || error).replace(/[A-Za-z0-9_-]{25,}/g, '[redacted]'));
        return sendJson(req, res, 500, { error: 'FXGA Gemini endpoint failed' });
      }
    }
    return listener(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log(`FXGA Gemini hook loaded; model=${MODEL}; secret=${SECRET_NAME}; dailyLimit=${DAILY_LIMIT}`);
