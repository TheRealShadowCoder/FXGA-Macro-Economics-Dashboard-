const enc = new TextEncoder();
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BLOCKED_METHODS = new Set(['TRACE', 'TRACK', 'CONNECT']);
const DEFAULT_MAX_BYTES = 512 * 1024;
const INGEST_MAX_BYTES = 4 * 1024 * 1024;

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value || '')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function clientFingerprint(request) {
  const material = [
    String(request.headers.get('user-agent') || '').slice(0, 350),
    String(request.headers.get('accept-language') || '').slice(0, 120),
  ].join('|');
  return sha256Hex(material);
}

async function sourceHash(request) {
  return sha256Hex(String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown').slice(0, 120));
}

function policy(path, method) {
  if (path === '/api/auth/exchange') return { group: 'exchange', limit: 30, seconds: 60 };
  if (path === '/api/auth/session') return { group: 'session-check', limit: 240, seconds: 60 };
  if (path === '/api/gemini/chat' || path === '/api/gemini/chat-stream') return { group: 'gemini', limit: 60, seconds: 600 };
  if (path.startsWith('/api/internal/state/') || path === '/api/mt5/batch') return { group: 'ingest', limit: 900, seconds: 60 };
  if (path.startsWith('/api/') && MUTATING.has(method)) return { group: 'protected-write', limit: 300, seconds: 600 };
  return null;
}

async function record(env, request, type, path, details = null) {
  if (!env.DB) return;
  const source = await sourceHash(request).catch(() => 'unknown');
  const fp = await clientFingerprint(request).catch(() => 'unknown');
  await env.DB.prepare(`
    INSERT INTO security_events(event_type,path,method,source_hash,fingerprint_hash,details,created_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(
    String(type).slice(0, 80),
    String(path).slice(0, 260),
    String(request.method || '').slice(0, 12),
    source,
    fp,
    details ? JSON.stringify(details).slice(0, 1200) : null,
  ).run();
}

function jsonError(error, status, headers = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

async function checkRate(env, request, path, method) {
  if (!env.DB) return null;
  const p = policy(path, method);
  if (!p) return null;
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / p.seconds);
  const key = `${p.group}:${await sourceHash(request)}`;
  await env.DB.prepare(`
    INSERT INTO security_rate_limits(bucket_key,bucket,count,updated_at)
    VALUES(?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key,bucket) DO UPDATE SET count=count+1,updated_at=CURRENT_TIMESTAMP
  `).bind(key, bucket).run();
  const row = await env.DB.prepare('SELECT count FROM security_rate_limits WHERE bucket_key=? AND bucket=?').bind(key, bucket).first();
  const count = Number(row?.count || 0);
  if ((crypto.getRandomValues(new Uint8Array(1))[0] & 63) === 0) env.DB.prepare("DELETE FROM security_rate_limits WHERE updated_at < datetime('now','-2 days')").run().catch(() => undefined);
  if (count <= p.limit) return null;
  await record(env, request, 'rate_limit_block', path, { group: p.group, count }).catch(() => undefined);
  return jsonError('rate_limited', 429, { 'retry-after': String(Math.max(1, p.seconds - (now % p.seconds))) });
}

function requiresBrowserOrigin(path) {
  if (path.startsWith('/api/internal/state/') || path === '/api/mt5/batch') return false;
  if (path.startsWith('/api/auth/')) return path === '/api/auth/logout';
  return path.startsWith('/api/');
}

export async function guardRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = String(request.method || 'GET').toUpperCase();
  if (BLOCKED_METHODS.has(method)) {
    await record(env, request, 'blocked_http_method', path, { method }).catch(() => undefined);
    return jsonError('method_not_allowed', 405, { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS' });
  }
  if (url.href.length > 8192) return jsonError('request_uri_too_large', 414);
  if (path.endsWith('.map')) return jsonError('not_found', 404);
  const host = request.headers.get('host');
  if (host && host.toLowerCase() !== url.host.toLowerCase()) return jsonError('invalid_host', 400);

  if (path.startsWith('/api/') && MUTATING.has(method)) {
    const max = path.startsWith('/api/internal/state/') || path === '/api/mt5/batch' ? INGEST_MAX_BYTES : DEFAULT_MAX_BYTES;
    const length = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(length) && length > max) {
      await record(env, request, 'oversized_request', path, { length, max }).catch(() => undefined);
      return jsonError('payload_too_large', 413);
    }
    const contentType = String(request.headers.get('content-type') || '').toLowerCase();
    if (length > 0 && !contentType.includes('application/json')) return jsonError('unsupported_media_type', 415);
    if (requiresBrowserOrigin(path)) {
      const origin = request.headers.get('origin');
      if (!origin || origin !== url.origin) {
        await record(env, request, 'origin_check_failed', path).catch(() => undefined);
        return jsonError('origin_mismatch', 403);
      }
      const fetchSite = String(request.headers.get('sec-fetch-site') || 'same-origin');
      if (!['same-origin', 'none'].includes(fetchSite)) return jsonError('origin_mismatch', 403);
    }
  }
  return checkRate(env, request, path, method);
}

function csp() {
  return "default-src 'self'; script-src 'self'; connect-src 'self' wss:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests";
}

export function hardenResponse(response, request) {
  const path = new URL(request.url).pathname;
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('x-permitted-cross-domain-policies', 'none');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()');
  headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-site');
  headers.set('content-security-policy', csp());
  headers.set('x-dns-prefetch-control', 'off');
  headers.set('x-download-options', 'noopen');
  if (path.startsWith('/api/') || !/\.[a-z0-9]{2,6}$/i.test(path)) {
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('pragma', 'no-cache');
  }
  if (!headers.has('x-request-id')) headers.set('x-request-id', crypto.randomUUID());
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function securityFailure(env, request, path, category = 'gateway_exception') {
  await record(env, request, category, path).catch(() => undefined);
  return hardenResponse(jsonError('internal_security_gateway_error', 500), request);
}
