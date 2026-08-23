import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
const EXPECTED_TOKEN_SHA256 = String(process.env.FXGA_MT5_TOKEN_SHA256 || '').trim().toLowerCase();
const PUBLIC_ORIGIN = String(process.env.FXGA_PUBLIC_ORIGIN || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/$/, '');
const SCANNER_STREAM = 'fxga_smc2000_mt5_multi_asset';
const UNIVERSE_SCHEMA = 'fxga.mt5.scanner-universe.v1';
const MAX_UNIVERSE_SYMBOLS = 5000;
const MAX_BODY_BYTES = 2_000_000;
const db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
const universeRef = db.collection('fxga_mt5_scanner_state').doc('broker_universe');
const signals = db.collection('fxga_tradingview_signals');

const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const clean = (value, max = 256) => String(value ?? '').slice(0, max);
const finite = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };

function cors() {
  return {
    'Access-Control-Allow-Origin': PUBLIC_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Cache-Control, Content-Type, X-FXGA-MT5-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function sendJson(res, status, payload, cacheControl = 'no-store') {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    ...cors(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function authorized(req) {
  if (!/^[a-f0-9]{64}$/.test(EXPECTED_TOKEN_SHA256)) return false;
  const supplied = String(req.headers['x-fxga-mt5-token'] || '');
  if (!supplied) return false;
  const got = Buffer.from(sha(supplied), 'hex');
  const expected = Buffer.from(EXPECTED_TOKEN_SHA256, 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Scanner universe payload exceeds 2 MB'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) throw Object.assign(new Error('Scanner universe payload is empty'), { statusCode: 400 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Scanner universe payload must be valid JSON'), { statusCode: 400 }); }
}

function normalizeSymbol(row) {
  return {
    symbol: clean(row?.symbol, 128),
    description: clean(row?.description, 256),
    path: clean(row?.path, 256),
    baseCurrency: clean(row?.base_currency, 32),
    profitCurrency: clean(row?.profit_currency, 32),
    marginCurrency: clean(row?.margin_currency, 32),
    tradeMode: finite(row?.trade_mode),
    digits: finite(row?.digits),
    status: clean(row?.status, 64),
    lastScanMs: finite(row?.last_scan_ms),
    scans: finite(row?.scans) ?? 0,
    published: finite(row?.published) ?? 0,
  };
}

async function ingestUniverse(req, res) {
  if (!authorized(req)) return sendJson(res, 403, { error: 'MT5 scanner universe token rejected' });
  let payload;
  try { payload = await readJson(req); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: error.message }); }
  if (String(payload?.schema || '') !== UNIVERSE_SCHEMA) return sendJson(res, 422, { error: `Unsupported schema; expected ${UNIVERSE_SCHEMA}` });
  if (String(payload?.source || '') !== 'MetaTrader5') return sendJson(res, 422, { error: 'source must be MetaTrader5' });
  if (String(payload?.engine || '') !== 'FXGA_SMC2000') return sendJson(res, 422, { error: 'engine must be FXGA_SMC2000' });
  const rawSymbols = Array.isArray(payload?.symbols) ? payload.symbols : [];
  const normalized = rawSymbols.slice(0, MAX_UNIVERSE_SYMBOLS).map(normalizeSymbol).filter(row => row.symbol);
  const unique = [...new Map(normalized.map(row => [row.symbol, row])).values()];
  const now = new Date().toISOString();
  const document = {
    schema: UNIVERSE_SCHEMA,
    source: 'MetaTrader5',
    engine: 'FXGA_SMC2000',
    stream: clean(payload?.stream || SCANNER_STREAM, 96),
    brokerCompany: clean(payload?.broker?.company, 160),
    brokerServer: clean(payload?.broker?.server, 160),
    generatedAtMs: finite(payload?.generated_at_ms),
    receivedAt: now,
    terminalTotal: finite(payload?.total_symbols) ?? unique.length,
    scanUniverseTotal: finite(payload?.scan_symbols) ?? unique.length,
    symbolCount: unique.length,
    truncated: rawSymbols.length > MAX_UNIVERSE_SYMBOLS,
    symbols: unique,
  };
  await universeRef.set(document, { merge: false });
  return sendJson(res, 200, { ok: true, receivedAt: now, symbolCount: unique.length, terminalTotal: document.terminalTotal, scanUniverseTotal: document.scanUniverseTotal });
}

async function readUniverse(res) {
  const snap = await universeRef.get();
  if (!snap.exists) return sendJson(res, 200, { schema: UNIVERSE_SCHEMA, source: 'MetaTrader5', engine: 'FXGA_SMC2000', stream: SCANNER_STREAM, symbolCount: 0, terminalTotal: 0, scanUniverseTotal: 0, symbols: [], status: 'WAITING_FOR_MT5_UNIVERSE_SNAPSHOT' }, 'no-store');
  return sendJson(res, 200, snap.data(), 'no-store');
}

async function readScannerSignals(url, res) {
  const snap = await signals.where('stream', '==', SCANNER_STREAM).get();
  let rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const symbol = clean(url.searchParams.get('symbol'), 128).toUpperCase();
  const side = clean(url.searchParams.get('side'), 16).toUpperCase();
  const status = clean(url.searchParams.get('status'), 64).toUpperCase();
  if (symbol) rows = rows.filter(row => String(row.brokerSymbol || row.symbol || '').toUpperCase() === symbol || String(row.symbol || '').toUpperCase() === symbol);
  if (side) rows = rows.filter(row => String(row.side || '').toUpperCase() === side);
  if (status) rows = rows.filter(row => String(row.status || row.lastEvent || '').toUpperCase() === status);
  rows.sort((a, b) => Date.parse(b.updatedAt || b.signalTime || 0) - Date.parse(a.updatedAt || a.signalTime || 0));
  const requestedLimit = Number(url.searchParams.get('limit') || 0);
  const completeCount = rows.length;
  if (Number.isFinite(requestedLimit) && requestedLimit > 0) rows = rows.slice(0, Math.max(1, Math.trunc(requestedLimit)));
  return sendJson(res, 200, {
    generatedAt: new Date().toISOString(),
    stream: SCANNER_STREAM,
    count: rows.length,
    totalMatched: completeCount,
    complete: requestedLimit <= 0 || rows.length === completeCount,
    signals: rows,
  }, 'no-store');
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const serverOptions = typeof options === 'function' ? undefined : options;
  const wrapped = async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); }
    catch { return listener(req, res); }
    if (url.pathname === '/api/mt5/scanner-universe' || url.pathname === '/api/mt5/scanner-signals') {
      try {
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors(), 'Content-Length': '0' }); return res.end(); }
        if (url.pathname === '/api/mt5/scanner-universe') {
          if (req.method === 'POST') return await ingestUniverse(req, res);
          if (req.method === 'GET') return await readUniverse(res);
          return sendJson(res, 405, { error: 'Scanner universe supports GET and authenticated POST' });
        }
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Scanner signals require GET' });
        return await readScannerSignals(url, res);
      } catch (error) {
        console.error('FXGA scanner hook error', error);
        return sendJson(res, 500, { error: 'MT5 scanner endpoint failed' });
      }
    }
    return listener(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log('FXGA broker scanner universe hook loaded');
