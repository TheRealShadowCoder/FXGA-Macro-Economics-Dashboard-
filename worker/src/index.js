import { FXGA_STRATEGY_PROMPTS } from '../../google-cloud-app/fxga-strategy-prompt-pack.js';

const MODES = ['smc-signal','market-brief','macro-brief','economic-context','event-research','action-report'];
const DEFAULT_MODEL = 'gemini-3.7-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1/interactions';
const CACHE_TTL_SECONDS = 300;

const STATE_ROUTES = new Map([
  ['/api/research','research'],
  ['/api/scenarios','scenarios'],
  ['/api/release-analytics','release-analytics'],
  ['/api/super-economist','super-economist'],
  ['/api/decision-intelligence','intelligence'],
  ['/api/data-quality','data-quality'],
  ['/api/market-prices','market'],
  ['/api/technical','technical'],
  ['/api/calendar-history','calendar-history'],
  ['/api/calendar','calendar'],
  ['/api/event-studies','event-studies'],
  ['/api/signals','signals'],
]);

const CORE_PROMPTS = [
  {id:'market-brief',label:'Market brief',category:'analysis',evidenceDomains:['market','technical','signals'],realtime:true},
  {id:'macro-brief',label:'Macro brief',category:'macro',evidenceDomains:['macro','calendar','market','intelligence'],realtime:true},
  {id:'economic-context',label:'Economic context',category:'macro',evidenceDomains:['macro','calendar','intelligence'],realtime:true},
  {id:'event-research',label:'Event research',category:'event',evidenceDomains:['calendar','event-studies','macro','market'],realtime:true},
  {id:'smc-signal',label:'SMC signal review',category:'smc',evidenceDomains:['market','technical','signals'],realtime:true},
  {id:'action-report',label:'Action report',category:'analysis',evidenceDomains:['market','technical','macro','calendar','signals'],realtime:true},
];

const PROMPTS = [
  ...CORE_PROMPTS,
  ...FXGA_STRATEGY_PROMPTS.map((prompt) => ({
    id: prompt.id,
    label: prompt.label,
    category: prompt.category,
    evidenceDomains: prompt.states || [],
    realtime: true,
    sharedContract: prompt.shared || null,
  })),
];

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...headers,
  },
});

const sse = (frames) => new Response(frames.map(({event,data}) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
  status: 200,
  headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'access-control-allow-origin': '*',
  },
});

const now = () => new Date().toISOString();

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2,'0')).join('');
}

async function parseBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function readState(env, name) {
  const row = await env.DB.prepare('SELECT payload, updated_at FROM state_snapshots WHERE name = ?').bind(name).first();
  if (!row) return null;
  try { return { value: JSON.parse(row.payload), updatedAt: row.updated_at }; }
  catch { return { value: row.payload, updatedAt: row.updated_at }; }
}

async function writeState(env, name, value) {
  const payload = JSON.stringify(value ?? null);
  await env.DB.prepare(`
    INSERT INTO state_snapshots(name,payload,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP
  `).bind(name, payload).run();
}

async function contextFor(env, domains = []) {
  const names = [...new Set(domains.filter(Boolean))].slice(0, 10);
  if (!names.length) return { evidence: {}, stamp: '' };
  const placeholders = names.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT name,payload,updated_at FROM state_snapshots WHERE name IN (${placeholders})`).bind(...names).all();
  const evidence = {};
  const stamps = [];
  for (const row of result.results || []) {
    try { evidence[row.name] = JSON.parse(row.payload); } catch { evidence[row.name] = row.payload; }
    stamps.push(`${row.name}:${row.updated_at}`);
  }
  return { evidence, stamp: stamps.sort().join('|') };
}

function promptById(id) {
  return PROMPTS.find((item) => item.id === id) || CORE_PROMPTS[0];
}

function compactEvidence(evidence) {
  const text = JSON.stringify(evidence);
  return text.length > 18000 ? `${text.slice(0,18000)}…[truncated]` : text;
}

function systemInstruction() {
  return [
    'You are the FXGA market intelligence assistant.',
    'Use only evidence supplied in the request or generally established market-analysis principles.',
    'Never fabricate live prices, economic releases, positions, signals, fills, certainty, or source observations.',
    'If current evidence is absent or stale, say so clearly and separate verified facts from analytical interpretation.',
    'For trading analysis, discuss scenarios, invalidation, risk and uncertainty; do not present speculation as guaranteed outcomes.',
    'Prefer concise, auditable reasoning and explicitly identify the evidence domains used.',
  ].join(' ');
}

function buildProviderInput({question, task, label, evidence}) {
  return `${systemInstruction()}\n\nTASK: ${task}\nLABEL: ${label}\nQUESTION: ${question}\n\nFXGA EVIDENCE JSON:\n${compactEvidence(evidence)}`;
}

function extractGeminiText(payload) {
  const outputs = Array.isArray(payload?.steps)
    ? payload.steps.filter((step) => step?.type === 'model_output')
    : [];
  const chunks = [];
  for (const output of outputs) {
    if (typeof output?.text === 'string') chunks.push(output.text);
    if (Array.isArray(output?.content)) {
      for (const part of output.content) {
        if (typeof part?.text === 'string') chunks.push(part.text);
      }
    }
  }
  if (chunks.length) return chunks.join('\n').trim();
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  if (typeof payload?.text === 'string') return payload.text.trim();
  return '';
}

async function callGemini(env, input) {
  if (!env.GEMINI_API_KEY) {
    const error = new Error('Gemini API key is not configured');
    error.status = 503;
    throw error;
  }
  const models = [...new Set([env.GEMINI_MODEL || DEFAULT_MODEL, env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL].filter(Boolean))];
  const retryable = new Set([404,429,500,502,503,504]);
  const tried = [];
  let lastError = null;
  for (const model of models) {
    tried.push(model);
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
      body: JSON.stringify({model,input,store:false,generation_config:{max_output_tokens:1400}}),
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {error:{message:text}}; }
    if (response.ok) {
      const output = extractGeminiText(payload);
      if (output) return { model, output, tried };
      lastError = new Error('Gemini returned no model output');
      lastError.status = 502;
      continue;
    }
    lastError = new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
    lastError.status = response.status;
    if (!retryable.has(response.status)) break;
  }
  lastError = lastError || new Error('Gemini request failed');
  lastError.modelsTried = tried;
  throw lastError;
}

async function getCached(env, cacheKey) {
  const row = await env.DB.prepare(`
    SELECT payload, created_at FROM gemini_cache
    WHERE cache_key = ? AND created_at >= datetime('now', ?)
  `).bind(cacheKey, `-${CACHE_TTL_SECONDS} seconds`).first();
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

async function putCached(env, cacheKey, value) {
  await env.DB.prepare(`
    INSERT INTO gemini_cache(cache_key,payload,created_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, created_at=CURRENT_TIMESTAMP
  `).bind(cacheKey, JSON.stringify(value)).run();
}

async function buildChat(env, body) {
  const question = String(body?.question || '').trim();
  if (!question) {
    const error = new Error('question is required');
    error.status = 400;
    throw error;
  }
  const selected = promptById(String(body?.task || 'market-brief'));
  const task = selected.id;
  const label = selected.label;
  const domains = selected.evidenceDomains || [];
  const { evidence, stamp } = await contextFor(env, domains);
  const contextHash = await sha256(`${task}|${stamp}|${JSON.stringify(evidence)}`);
  const cacheKey = await sha256(`${task}|${question}|${contextHash}`);
  const cached = await getCached(env, cacheKey);
  if (cached) return {...cached,cached:true};
  const provider = await callGemini(env, buildProviderInput({question,task,label,evidence}));
  const result = {
    schema:'fxga.gemini.chat.v1',
    task,
    label,
    question,
    answer:provider.output,
    model:provider.model,
    evidenceDomains:domains.filter((name) => Object.prototype.hasOwnProperty.call(evidence,name)),
    contextHash,
    createdAt:now(),
    cached:false,
    policy:'evidence-only; no fabricated live state',
  };
  await putCached(env, cacheKey, result);
  return result;
}

async function buildAnalysis(env, body) {
  const mode = MODES.includes(body?.mode) ? body.mode : 'market-brief';
  const selected = promptById(mode);
  const question = mode === 'smc-signal'
    ? `Review the currently stored FXGA SMC/market evidence${body?.signalId ? ` for signal ${String(body.signalId)}` : ''}. State whether evidence is sufficient, the scenario, invalidation and uncertainty.`
    : `Produce the FXGA ${selected.label} using the available evidence. Distinguish observed state from inference and state what evidence is missing.`;
  const chat = await buildChat(env,{question,task:mode,signalId:body?.signalId});
  return {
    schema:'fxga.gemini.analysis.v1',mode,label:selected.label,model:chat.model,output:chat.answer,
    contextHash:chat.contextHash,signalId:body?.signalId || null,createdAt:chat.createdAt,cached:chat.cached,
    policy:chat.policy,
  };
}

function friendlyError(error) {
  const status = Number(error?.status || 500);
  const code = status === 429 ? 'AI_QUOTA_LIMIT' : status === 503 ? 'AI_NOT_CONFIGURED' : status >= 500 ? 'AI_PROVIDER_UNAVAILABLE' : 'BAD_REQUEST';
  return {
    code,
    title: code === 'AI_QUOTA_LIMIT' ? 'AI free quota reached' : code === 'AI_NOT_CONFIGURED' ? 'AI is not configured' : status >= 500 ? 'AI temporarily unavailable' : 'Request could not be processed',
    message: String(error?.message || 'Request failed'),
    retryable: status === 429 || status >= 500,
    technical:{httpStatus:status},
  };
}

function authorized(request, env) {
  const expected = String(env.FXGA_INGEST_TOKEN || env.FXGA_MT5_REPORT_SECRET || '').trim();
  if (!expected) return false;
  const bearer = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i,'').trim();
  const webhook = String(request.headers.get('x-fxga-webhook-secret') || '').trim();
  return bearer === expected || webhook === expected;
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type,authorization,x-fxga-webhook-secret'}});

  if (path === '/api/health' && request.method === 'GET') {
    return json({
      ok:true,
      architecture:'cloudflare-r0',
      compute:'Cloudflare Workers Free',
      database:'Cloudflare D1 Free',
      staticHosting:'Cloudflare Workers Static Assets',
      ai:{provider:'Google Gemini Developer API',configured:Boolean(env.GEMINI_API_KEY),model:env.GEMINI_MODEL || DEFAULT_MODEL,fallbackModel:env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL},
      googleCloudRuntime:false,
      timestamp:now(),
    });
  }

  if (path === '/api/gemini/health' && request.method === 'GET') {
    return json({ok:true,configured:Boolean(env.GEMINI_API_KEY),provider:'Google Gemini Developer API',api:'Interactions v1',model:env.GEMINI_MODEL || DEFAULT_MODEL,fallbackModel:env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,modes:MODES,keyExposedToBrowser:false,quotaPolicy:'Provider free-tier quota; no paid FXGA infrastructure fallback',applicationHourlyCap:null,applicationDailyCap:null,timestamp:now()});
  }

  if (path === '/api/gemini/intelligence-health' && request.method === 'GET') {
    return json({ok:true,configured:Boolean(env.GEMINI_API_KEY),model:env.GEMINI_MODEL || DEFAULT_MODEL,fallbackModel:env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,promptCount:PROMPTS.length,promptRouting:'Cloudflare Worker + D1 evidence context',liveReport:true,chatbot:true,applicationHourlyCap:null,applicationDailyCap:null,providerQuotaManaged:true,endpoints:['/api/gemini/chat','/api/gemini/chat-stream','/api/gemini/live-report','/api/gemini/analyze','/api/gemini/prompts'],timestamp:now()});
  }

  if (path === '/api/gemini/prompts' && request.method === 'GET') {
    return json({schema:'fxga.prompt-registry.v1',prompts:PROMPTS,automaticRouting:true,timestamp:now()});
  }

  if (path === '/api/errors/catalog' && request.method === 'GET') {
    return json({schema:'fxga.error-catalog.v1',errors:{AI_NOT_CONFIGURED:friendlyError({status:503,message:'Gemini API key is not configured'}),AI_QUOTA_LIMIT:friendlyError({status:429,message:'Gemini free quota is currently exhausted'}),AI_PROVIDER_UNAVAILABLE:friendlyError({status:503,message:'Gemini provider is temporarily unavailable'})},timestamp:now()});
  }

  if (path === '/api/gemini/chat' && request.method === 'POST') {
    try { return json(await buildChat(env,await parseBody(request))); }
    catch (error) { const status=Number(error?.status||500); return json({error:friendlyError(error)},status); }
  }

  if (path === '/api/gemini/chat-stream' && request.method === 'POST') {
    try {
      const body = await parseBody(request);
      const result = await buildChat(env,body);
      return sse([
        {event:'status',data:{phase:'complete',message:result.cached?'Loaded verified cached AI result.':'Gemini analysis completed.',model:result.model,task:result.task}},
        {event:'delta',data:{text:result.answer,model:result.model,cached:result.cached}},
        {event:'done',data:{result}},
      ]);
    } catch (error) {
      return sse([{event:'error',data:{friendlyError:friendlyError(error),modelsTried:error?.modelsTried || []}}]);
    }
  }

  if (path === '/api/gemini/analyze' && request.method === 'POST') {
    try { return json(await buildAnalysis(env,await parseBody(request))); }
    catch (error) { const status=Number(error?.status||500); return json({error:friendlyError(error)},status); }
  }

  if (path === '/api/gemini/explain-smc' && request.method === 'POST') {
    try { const body=await parseBody(request); return json(await buildAnalysis(env,{...body,mode:'smc-signal'})); }
    catch (error) { const status=Number(error?.status||500); return json({error:friendlyError(error)},status); }
  }

  if (path === '/api/gemini/live-report' && request.method === 'GET') {
    try {
      const chat = await buildChat(env,{task:'action-report',question:'Create the current FXGA live action report from verified stored evidence. If evidence is missing or stale, make that the first finding.'});
      return json({schema:'fxga.gemini.live-report.v1',report:chat.answer,model:chat.model,contextHash:chat.contextHash,evidenceDomains:chat.evidenceDomains,createdAt:chat.createdAt,refreshAfterSeconds:300,cached:chat.cached,policy:chat.policy});
    } catch (error) { const status=Number(error?.status||500); return json({error:friendlyError(error)},status); }
  }

  if (STATE_ROUTES.has(path) && request.method === 'GET') {
    const name = STATE_ROUTES.get(path);
    const state = await readState(env,name);
    if (!state) return json({ok:true,available:false,state:name,data:null,source:'cloudflare-d1',updatedAt:null});
    if (state.value && typeof state.value === 'object') return json({...state.value,_r0:{source:'cloudflare-d1',updatedAt:state.updatedAt}});
    return json({ok:true,available:true,state:name,data:state.value,source:'cloudflare-d1',updatedAt:state.updatedAt});
  }

  if (path.startsWith('/api/internal/state/') && ['POST','PUT'].includes(request.method)) {
    if (!authorized(request,env)) return json({error:'unauthorized'},401);
    const name = decodeURIComponent(path.slice('/api/internal/state/'.length)).replace(/[^a-zA-Z0-9._-]/g,'').slice(0,80);
    if (!name) return json({error:'state name required'},400);
    const body = await parseBody(request);
    await writeState(env,name,body);
    return json({ok:true,state:name,updatedAt:now()});
  }

  if (path === '/api/mt5/batch' && request.method === 'POST') {
    if (!authorized(request,env)) return json({error:'unauthorized'},401);
    const body = await parseBody(request);
    const symbols = Array.isArray(body?.symbols) ? body.symbols : Array.isArray(body?.data) ? body.data : [];
    await env.DB.prepare('INSERT INTO mt5_batches(symbol_count,payload) VALUES(?,?)').bind(symbols.length,JSON.stringify(body)).run();
    await writeState(env,'market',{...body,source:'mt5-batch',receivedAt:now()});
    return json({ok:true,accepted:true,symbolCount:symbols.length,receivedAt:now()});
  }

  if (path === '/api/mt5/latest' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload,received_at,symbol_count FROM mt5_batches ORDER BY id DESC LIMIT 1').first();
    if (!row) return json({ok:true,available:false,data:null});
    let payload; try { payload=JSON.parse(row.payload); } catch { payload=row.payload; }
    return json({ok:true,available:true,data:payload,receivedAt:row.received_at,symbolCount:row.symbol_count});
  }

  return json({error:'not_found',path},404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await routeApi(request,env); }
      catch (error) { return json({error:'worker_error',message:String(error?.message || error)},500); }
    }
    return env.ASSETS.fetch(request);
  },
};
