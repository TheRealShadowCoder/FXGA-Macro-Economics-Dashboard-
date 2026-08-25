import http from 'node:http';

const PUBLIC_ORIGIN = String(process.env.FXGA_PUBLIC_ORIGIN || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 32_000;
const INTERNAL_TIMEOUT_MS = 95_000;
const LIVE_REPORT_REFRESH_SECONDS = Math.max(180, Number(process.env.FXGA_GEMINI_LIVE_REPORT_REFRESH_SECONDS || 300));

const MODE_TASK = {
  'smc-signal': 'trade-setup',
  'market-brief': 'cross-asset',
  'macro-brief': 'macro-analysis',
  'economic-context': 'macro-analysis',
  'event-research': 'event-study',
  'action-report': 'live-intelligence-report',
};

const MODE_QUESTION = {
  'smc-signal': 'Explain this stored FXGA SMC setup using only its persisted evidence. Cover alignment, lifecycle, invalidation, targets and conflicts without creating a new signal.',
  'market-brief': 'Produce the current FXGA cross-asset market brief from stored market and technical evidence. Highlight alignment, divergences, stale data and what deserves attention now.',
  'macro-brief': 'Produce the current FXGA macro evidence brief. Separate growth, inflation, labour, policy rates and financial conditions using only stored evidence.',
  'economic-context': 'Explain the current FXGA economic regime and cross-economy differences using only stored macro and intelligence evidence.',
  'event-research': 'Explain the current FXGA event-study research maturity, sample coverage, horizons, OOS status and what is or is not statistically validated.',
  'action-report': 'Produce the current FXGA action report from stored intelligence, market, technical and event-risk evidence. Respect WAIT, WATCH and PREPARE states.',
};

const LIVE_REPORT_QUESTION = 'Produce the continuously updating FXGA intelligence report from current stored intelligence, market, technical, macro, calendar, event-study and signal evidence. Respect WAIT, WATCH and PREPARE states. Do not manufacture a trade.';

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

function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...cors(String(req.headers.origin || '')),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Gemini request exceeds 32 KB'), { statusCode: 413 });
    parts.push(chunk);
  }
  if (!parts.length) return {};
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('Gemini request must be valid JSON'), { statusCode: 400 }); }
}

function parseSse(raw) {
  const statuses = [];
  let answer = '';
  let result = null;
  let friendlyError = null;
  for (const frame of String(raw || '').split(/\r?\n\r?\n/)) {
    if (!frame.trim()) continue;
    const lines = frame.split(/\r?\n/);
    const event = String(lines.find(line => line.startsWith('event:'))?.slice(6) || '').trim();
    const dataText = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!dataText) continue;
    let data;
    try { data = JSON.parse(dataText); } catch { continue; }
    if (event === 'status') statuses.push(data);
    if (event === 'delta' && typeof data?.text === 'string') answer += data.text;
    if (event === 'done' && data?.result) result = data.result;
    if (event === 'error') friendlyError = data?.friendlyError || data || { message: 'Streaming gateway returned an error' };
  }
  if (!answer.trim() && result?.answer) answer = String(result.answer);
  return { statuses, answer: answer.trim(), result, friendlyError };
}

async function callStreamingGateway(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/gemini/chat-stream`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw Object.assign(new Error(`Internal Gemini stream returned HTTP ${response.status}`), { statusCode: response.status });
    return parseSse(text);
  } finally {
    clearTimeout(timer);
  }
}

function normalizedResult(streamed) {
  const result = streamed?.result || {};
  const fallback = String(result.model || '').startsWith('fxga-local-') || Boolean(result.degraded && !result.interactionId);
  const retryAfterSeconds = Number(result.retryAfterSeconds || streamed?.friendlyError?.retryAfterSeconds || 0) || null;
  return { result, fallback, retryAfterSeconds };
}

async function resilientLegacyAnalyze(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' });
    return res.end();
  }
  if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'Gemini analysis requires POST' });

  let body;
  try { body = await readJson(req); }
  catch (error) { return sendJson(req, res, Number(error.statusCode || 400), { error: error.message }); }

  const mode = pathname === '/api/gemini/explain-smc' ? 'smc-signal' : String(body.mode || '').trim().toLowerCase();
  if (!MODE_TASK[mode]) return sendJson(req, res, 400, { error: `mode must be one of: ${Object.keys(MODE_TASK).join(', ')}` });
  if (mode === 'smc-signal' && !String(body.signalId || '').trim()) return sendJson(req, res, 400, { error: 'signalId is required for smc-signal mode' });

  const streamPayload = {
    question: MODE_QUESTION[mode],
    task: MODE_TASK[mode],
    signalId: String(body.signalId || '').trim() || undefined,
  };

  let streamed;
  try {
    streamed = await callStreamingGateway(streamPayload);
  } catch (error) {
    console.error('FXGA legacy Gemini compatibility gateway failed', { mode, message: String(error.message || error) });
    return sendJson(req, res, 502, {
      error: 'FXGA Gemini compatibility gateway is temporarily unavailable.',
      mode,
      quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
    });
  }

  if (!streamed.answer) {
    const message = String(streamed.friendlyError?.message || streamed.friendlyError?.title || 'FXGA intelligence returned no usable answer');
    return sendJson(req, res, 502, { error: message, mode, quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap' });
  }

  const { result, fallback, retryAfterSeconds } = normalizedResult(streamed);
  return sendJson(req, res, 200, {
    schema: 'fxga.gemini.analysis.v1',
    mode,
    label: result.label || mode,
    model: result.model || null,
    output: streamed.answer,
    answer: streamed.answer,
    usage: result.usage || null,
    interactionId: result.interactionId || null,
    createdAt: result.createdAt || new Date().toISOString(),
    cached: Boolean(result.cached),
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    source: fallback ? 'fxga-evidence-fallback' : 'gemini',
    providerThrottled: fallback && retryAfterSeconds != null,
    retryAfterSeconds,
    quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
    compatibilityRoute: 'streaming-gateway',
    progressPhases: streamed.statuses.map(item => item?.phase).filter(Boolean),
    policy: result.policy || 'Evidence-grounded explanation only. Unsupported performance and certainty claims are prohibited.',
  });
}

async function resilientChat(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' });
    return res.end();
  }
  if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'Gemini chat requires POST' });
  let body;
  try { body = await readJson(req); }
  catch (error) { return sendJson(req, res, Number(error.statusCode || 400), { error: error.message }); }
  const question = String(body.question || '').trim();
  if (!question) return sendJson(req, res, 400, { error: 'A question is required' });

  let streamed;
  try {
    streamed = await callStreamingGateway({
      question,
      ...(String(body.task || '').trim() ? { task: String(body.task).trim() } : {}),
      ...(String(body.signalId || '').trim() ? { signalId: String(body.signalId).trim() } : {}),
    });
  } catch (error) {
    return sendJson(req, res, 502, { error: 'FXGA Gemini streaming gateway is temporarily unavailable.', compatibilityRoute: 'streaming-gateway' });
  }
  if (!streamed.answer) {
    const message = String(streamed.friendlyError?.title || streamed.friendlyError?.message || 'FXGA intelligence returned no usable answer');
    return sendJson(req, res, 502, { error: message, compatibilityRoute: 'streaming-gateway' });
  }
  const { result, fallback, retryAfterSeconds } = normalizedResult(streamed);
  return sendJson(req, res, 200, {
    schema: 'fxga.gemini.chat.v2',
    task: result.task || body.task || 'auto',
    label: result.label || 'FXGA intelligence',
    question,
    answer: streamed.answer,
    model: result.model || null,
    usage: result.usage || null,
    interactionId: result.interactionId || null,
    evidenceDomains: result.evidenceDomains || [],
    contextHash: result.contextHash || null,
    createdAt: result.createdAt || new Date().toISOString(),
    cached: Boolean(result.cached),
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    source: fallback ? 'fxga-evidence-fallback' : 'gemini',
    providerThrottled: fallback && retryAfterSeconds != null,
    retryAfterSeconds,
    compatibilityRoute: 'streaming-gateway',
    policy: result.policy || 'Evidence-grounded analysis only.',
  });
}

async function resilientLiveReport(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors(String(req.headers.origin || '')), 'Content-Length': '0' });
    return res.end();
  }
  if (req.method !== 'GET') return sendJson(req, res, 405, { error: 'Live intelligence report requires GET' });

  let streamed;
  try {
    streamed = await callStreamingGateway({ question: LIVE_REPORT_QUESTION, task: 'live-intelligence-report' });
  } catch (error) {
    console.error('FXGA resilient live report gateway failed', { message: String(error.message || error).slice(0, 300) });
    return sendJson(req, res, 502, {
      error: 'FXGA live intelligence gateway is temporarily unavailable.',
      compatibilityRoute: 'streaming-gateway',
      refreshAfterSeconds: LIVE_REPORT_REFRESH_SECONDS,
    });
  }
  if (!streamed.answer) {
    const message = String(streamed.friendlyError?.title || streamed.friendlyError?.message || 'FXGA live intelligence returned no usable answer');
    return sendJson(req, res, 502, { error: message, compatibilityRoute: 'streaming-gateway', refreshAfterSeconds: LIVE_REPORT_REFRESH_SECONDS });
  }

  const { result, fallback, retryAfterSeconds } = normalizedResult(streamed);
  const refreshAfterSeconds = Math.max(
    LIVE_REPORT_REFRESH_SECONDS,
    retryAfterSeconds ? retryAfterSeconds + 15 : 0,
  );
  return sendJson(req, res, 200, {
    schema: 'fxga.gemini.live-report.v2',
    report: streamed.answer,
    answer: streamed.answer,
    model: result.model || null,
    usage: result.usage || null,
    interactionId: result.interactionId || null,
    contextHash: result.contextHash || null,
    evidenceDomains: result.evidenceDomains || [],
    createdAt: result.createdAt || new Date().toISOString(),
    refreshAfterSeconds,
    cached: Boolean(result.cached),
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    source: fallback ? 'fxga-evidence-fallback' : 'gemini',
    providerThrottled: fallback && retryAfterSeconds != null,
    retryAfterSeconds,
    compatibilityRoute: 'streaming-gateway',
    quotaPolicy: 'provider-managed-no-artificial-hourly-or-daily-cap',
    policy: result.policy || 'This report uses persisted FXGA evidence. Forecasts are conditional scenarios; unmeasured edge claims are prohibited.',
  });
}

// This module MUST load before gemini-hook.js and fxga-intelligence-extension.js.
// Its server wrapper therefore sits outside the legacy JSON intelligence routes at
// request time and prevents provider HTTP 429 from leaking to the browser. The
// old JSON routes remain available internally for compatibility, but public chat,
// live-report, analyze and explain-smc requests all use the hardened stream path.
const originalCreateServer = http.createServer.bind(http);
http.createServer = function fxgaLegacyResilienceCreateServer(options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const serverOptions = typeof options === 'function' ? undefined : options;
  const wrapped = async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); }
    catch { return listener(req, res); }
    if (url.pathname === '/api/gemini/analyze' || url.pathname === '/api/gemini/explain-smc') {
      return resilientLegacyAnalyze(req, res, url.pathname);
    }
    if (url.pathname === '/api/gemini/chat') return resilientChat(req, res);
    if (url.pathname === '/api/gemini/live-report') return resilientLiveReport(req, res);
    return listener(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log('FXGA legacy Gemini resilience shield loaded', {
  routes: ['/api/gemini/analyze', '/api/gemini/explain-smc', '/api/gemini/chat', '/api/gemini/live-report'],
  upstream: '/api/gemini/chat-stream',
  liveReportRefreshSeconds: LIVE_REPORT_REFRESH_SECONDS,
  provider429Leaks: false,
});
