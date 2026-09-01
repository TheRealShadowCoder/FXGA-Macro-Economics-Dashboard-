import r0Worker from './r0-entry.js';
import { clientFingerprint, clientLegacyFingerprint, guardRequest, hardenResponse, securityFailure } from './security.js';

const PROGRAM_COOKIE = 'fxga_program_session';
const STATUS_CACHE_MS = 30_000;
let statusCache = { expiresAt: 0, value: null };

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
});

function cookieMap(request) {
  const out = {};
  for (const part of String(request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function portalUrl(env, suffix = '/member') {
  const base = String(env.AUTH_PORTAL_URL || 'https://fxga-trading-academy.few-nose.workers.dev/member');
  if (suffix === '/member') return base;
  const origin = new URL(base).origin;
  return `${origin}${suffix}`;
}

function authServiceBase(env) {
  const configured = String(env.AUTH_SERVICE_URL || 'https://fxga-trading-academy.few-nose.workers.dev').replace(/\/$/, '');
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('auth_service_must_use_https');
  return url;
}

function serviceUrl(env, path) {
  const base = authServiceBase(env);
  return new URL(path, `${base.origin}/`).toString();
}

async function authFetch(env, path, payload) {
  const base = authServiceBase(env);
  const response = await fetch(serviceUrl(env, path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'user-agent': 'FXGA-Macro-Auth-Gateway/3.0',
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const finalUrl = new URL(response.url || serviceUrl(env, path));
  if (finalUrl.protocol !== 'https:' || finalUrl.origin !== base.origin) throw new Error('auth_service_redirect_rejected');
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function persistedEnforcement(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM runtime_meta WHERE key='member_auth_enforced' LIMIT 1").first();
    return String(row?.value || '') === '1';
  } catch {
    return false;
  }
}

async function latchEnforcement(env) {
  try {
    await env.DB.prepare(`
      INSERT INTO runtime_meta(key,value,updated_at)
      VALUES('member_auth_enforced','1',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value='1',updated_at=CURRENT_TIMESTAMP
    `).run();
  } catch {}
}

async function resolveAuthStatus(env) {
  const mode = String(env.AUTH_ENFORCED || 'auto').toLowerCase();
  if (mode === 'true') return { enforced: true, googleConfigured: true, serviceReachable: true, mode };
  if (mode === 'false') return { enforced: false, googleConfigured: null, serviceReachable: true, mode };
  if (statusCache.value && Date.now() < statusCache.expiresAt) return statusCache.value;

  let value;
  try {
    const base = authServiceBase(env);
    const response = await fetch(serviceUrl(env, '/api/auth/config'), {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      redirect: 'follow',
    });
    const finalUrl = new URL(response.url || serviceUrl(env, '/api/auth/config'));
    if (finalUrl.protocol !== 'https:' || finalUrl.origin !== base.origin) throw new Error('auth_config_redirect_rejected');
    if (!response.ok) throw new Error('auth_config_unavailable');
    const config = await response.json();
    const googleConfigured = config?.googleConfigured === true;
    const latched = await persistedEnforcement(env);
    const enforced = googleConfigured || latched;
    if (googleConfigured && !latched) await latchEnforcement(env);
    value = { enforced, googleConfigured, serviceReachable: true, mode };
  } catch {
    // Security invariant: an auth-service outage must never turn a private program public.
    value = { enforced: true, googleConfigured: null, serviceReachable: false, mode };
  }
  statusCache = { expiresAt: Date.now() + STATUS_CACHE_MS, value };
  return value;
}

function isStaticAsset(path) {
  if (path.endsWith('.map')) return false;
  if (path.startsWith('/assets/')) return true;
  if (path === '/favicon.ico' || path === '/favicon.svg' || path === '/robots.txt' || path === '/manifest.webmanifest') return true;
  return /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)$/i.test(path);
}

function isPublicOperationalApi(path) {
  return path === '/api/health'
    || path === '/api/gemini/health'
    || path === '/api/gemini/intelligence-health'
    || path.startsWith('/api/internal/state/')
    || path === '/api/mt5/batch';
}

async function validateProgramSession(request, env) {
  const raw = cookieMap(request)[PROGRAM_COOKIE];
  if (!raw) return null;
  try {
    const fingerprint = await clientFingerprint(request);
    const legacyFingerprint = await clientLegacyFingerprint(request);
    const { response, body } = await authFetch(env, '/api/auth/introspect-session', {
      token: raw,
      clientFingerprint: fingerprint,
      legacyFingerprint,
    });
    if (!response.ok || body?.valid !== true || !body?.member) return null;
    return { token: raw, member: body.member, expiresAt: body.expiresAt || null };
  } catch {
    return null;
  }
}

function loginRedirect(env, reason = '') {
  const target = new URL(portalUrl(env));
  if (reason) target.searchParams.set('reason', reason);
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function exchange(request, env) {
  const url = new URL(request.url);
  const transferToken = String(url.searchParams.get('token') || '');
  if (transferToken.length < 32) return loginRedirect(env, 'invalid-transfer');

  try {
    const fingerprint = await clientFingerprint(request);
    const legacyFingerprint = await clientLegacyFingerprint(request);
    const { response, body } = await authFetch(env, '/api/auth/introspect-transfer', {
      token: transferToken,
      clientFingerprint: fingerprint,
      legacyFingerprint,
    });
    if (!response.ok || body?.valid !== true || !body?.sessionToken) return loginRedirect(env, 'transfer-denied');
    return new Response(null, {
      status: 302,
      headers: {
        location: '/?fxga_session=ready',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'set-cookie': `${PROGRAM_COOKIE}=${encodeURIComponent(body.sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400; Priority=High`,
      },
    });
  } catch {
    return loginRedirect(env, 'auth-service-unavailable');
  }
}

async function logout(request, env) {
  const raw = cookieMap(request)[PROGRAM_COOKIE];
  if (raw) {
    try { await authFetch(env, '/api/auth/revoke-program', { token: raw }); } catch {}
  }
  const headers = {
    'set-cookie': `${PROGRAM_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Priority=High`,
    'cache-control': 'no-store',
  };
  if (request.method === 'GET') {
    headers.location = portalUrl(env);
    return new Response(null, { status: 302, headers });
  }
  return json({ ok: true, loginUrl: portalUrl(env) }, 200, headers);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const blocked = await guardRequest(request, env);
      if (blocked) return hardenResponse(blocked, request);

      if (path === '/api/auth/status' && request.method === 'GET') {
        const status = await resolveAuthStatus(env);
        return hardenResponse(json({
          architecture: 'cloudflare-r0',
          accessModel: 'owner-approved-google-email-allowlist',
          loginUrl: portalUrl(env),
          handoffVersion: 'stable-fingerprint-v2',
          ...status,
        }), request);
      }

      if (path === '/api/auth/exchange' && request.method === 'GET') return hardenResponse(await exchange(request, env), request);
      if (path === '/api/auth/logout' && (request.method === 'GET' || request.method === 'POST')) return hardenResponse(await logout(request, env), request);

      if (path === '/api/auth/session' && request.method === 'GET') {
        const status = await resolveAuthStatus(env);
        if (!status.enforced) return hardenResponse(json({ authenticated: false, enforcementPending: true, ...status }), request);
        const session = await validateProgramSession(request, env);
        return hardenResponse(session
          ? json({ authenticated: true, member: session.member, expiresAt: session.expiresAt })
          : json({ authenticated: false, loginUrl: portalUrl(env) }, 401), request);
      }

      if (isPublicOperationalApi(path) || isStaticAsset(path)) return hardenResponse(await r0Worker.fetch(request, env, ctx), request);

      const status = await resolveAuthStatus(env);
      if (!status.enforced) return hardenResponse(await r0Worker.fetch(request, env, ctx), request);

      const session = await validateProgramSession(request, env);
      if (session) return hardenResponse(await r0Worker.fetch(request, env, ctx), request);

      if (path.startsWith('/api/')) {
        return hardenResponse(json({
          error: 'authentication_required',
          message: 'This FXGA program is available only to owner-authorized members.',
          loginUrl: portalUrl(env),
        }, 401), request);
      }
      return hardenResponse(loginRedirect(env, 'authentication-required'), request);
    } catch {
      return securityFailure(env, request, path);
    }
  },
};
