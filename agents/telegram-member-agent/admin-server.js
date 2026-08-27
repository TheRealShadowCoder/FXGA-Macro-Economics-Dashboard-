import http from 'node:http';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const REGION = process.env.GCP_REGION || 'us-central1';
const JOB_NAME = process.env.TELEGRAM_AGENT_JOB || 'fxga-telegram-member-agent';
const AUTH_SERVICE_URL = String(process.env.AUTH_SERVICE_URL || 'https://fxga-trading-academy.few-nose.workers.dev').replace(/\/$/, '');
const BOT_SECRET_NAME = process.env.TELEGRAM_BOT_TOKEN_SECRET || 'fxga-telegram-bot-token';
const QUEUE_COLLECTION = process.env.FIRESTORE_QUEUE_COLLECTION || 'telegram_member_queue';
const STATE_COLLECTION = process.env.FIRESTORE_STATE_COLLECTION || 'agent_state';
const STATE_DOCUMENT = process.env.FIRESTORE_STATE_DOCUMENT || 'telegram-member-agent';
const db = new Firestore({ projectId: PROJECT_ID || undefined, ignoreUndefinedProperties: true });
const secretManager = new SecretManagerServiceClient();
const botSecret = `projects/${PROJECT_ID}/secrets/${BOT_SECRET_NAME}`;
const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT);
const queue = db.collection(QUEUE_COLLECTION);
const requestWindows = new Map();

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function rateLimited(req) {
  const key = String(req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 30;
}

async function readJson(req, maxBytes = 8192) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}

function bearer(req) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function requireSuperAdmin(req) {
  const token = bearer(req);
  if (token.length < 32) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/introspect-admin-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.valid !== true || payload?.member?.role !== 'super_admin') return null;
    return payload.member;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function latestBotToken() {
  if (!PROJECT_ID) throw new Error('GCP_PROJECT_ID is not configured');
  try {
    const [version] = await secretManager.accessSecretVersion({ name: `${botSecret}/versions/latest` });
    return Buffer.from(version.payload?.data || '').toString('utf8').trim();
  } catch (error) {
    const code = Number(error?.code);
    if (code === 5 || /NOT_FOUND|no enabled versions/i.test(String(error?.message || ''))) return '';
    throw error;
  }
}

function validBotTokenFormat(token) {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token);
}

async function testTelegramBot(token) {
  if (!validBotTokenFormat(token)) return { ok: false, error: 'Token format is invalid.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !payload?.result) return { ok: false, error: 'Telegram rejected the bot token.' };
    return {
      ok: true,
      bot: {
        id: String(payload.result.id ?? ''),
        username: String(payload.result.username ?? ''),
        firstName: String(payload.result.first_name ?? ''),
        canJoinGroups: Boolean(payload.result.can_join_groups),
        canReadAllGroupMessages: Boolean(payload.result.can_read_all_group_messages),
        supportsInlineQueries: Boolean(payload.result.supports_inline_queries)
      }
    };
  } catch {
    return { ok: false, error: 'Telegram Bot API could not be reached.' };
  } finally {
    clearTimeout(timer);
  }
}

async function saveBotToken(token) {
  await secretManager.addSecretVersion({ parent: botSecret, payload: { data: Buffer.from(token, 'utf8') } });
}

function iso(value) {
  try {
    if (value?.toDate) return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
  } catch {}
  return null;
}

async function agentStatus() {
  const [stateSnap, queueProbe, countSnap, token] = await Promise.all([
    stateRef.get(),
    queue.limit(1).get(),
    queue.count().get(),
    latestBotToken()
  ]);
  const state = stateSnap.exists ? stateSnap.data() : {};
  const tokenTest = token ? await testTelegramBot(token) : { ok: false };
  const queueTotal = Number(countSnap.data().count || state.queueRecordCount || 0);
  const blockedUntil = iso(state.blockedUntil);
  const blocked = blockedUntil ? Date.parse(blockedUntil) > Date.now() : false;
  return {
    directAddOnly: true,
    bot: {
      configured: Boolean(token),
      valid: Boolean(tokenTest.ok),
      identity: tokenTest.ok ? tokenTest.bot : null
    },
    queue: {
      ready: !queueProbe.empty,
      total: queueTotal,
      importedAt: iso(state.queueImportedAt),
      nextSequence: Number(state.nextSequence || 1)
    },
    worker: {
      running: state.running === true,
      runId: state.runId || null,
      dailyDate: state.dailyDate || null,
      dailyAdded: Number(state.dailyAdded || 0),
      blocked,
      blockedUntil,
      lastError: state.lastError || null,
      startedAt: iso(state.startedAt),
      finishedAt: iso(state.finishedAt),
      lastRunSummary: state.lastRunSummary || null
    },
    schedule: {
      job: JOB_NAME,
      timezone: 'Africa/Johannesburg',
      dailyTime: '08:00'
    }
  };
}

async function accessToken() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`metadata_token_http_${response.status}`);
    const payload = await response.json();
    if (!payload?.access_token) throw new Error('metadata_access_token_missing');
    return payload.access_token;
  } finally {
    clearTimeout(timer);
  }
}

async function executeAgent(member) {
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() : {};
  if (state.running === true && (!state.lockUntil?.toDate || state.lockUntil.toDate() > new Date())) {
    return { ok: false, status: 409, error: 'The Telegram Member Agent is already running.' };
  }
  const blockedUntil = state.blockedUntil?.toDate?.();
  if (blockedUntil && blockedUntil > new Date()) {
    return { ok: false, status: 409, error: `Telegram rate-limit protection is active until ${blockedUntil.toISOString()}.` };
  }
  const probe = await queue.limit(1).get();
  if (probe.empty) return { ok: false, status: 409, error: 'The Telegram member queue is empty. Import the roster before starting operations.' };

  const oauth = await accessToken();
  const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(PROJECT_ID)}/locations/${encodeURIComponent(REGION)}/jobs/${encodeURIComponent(JOB_NAME)}:run`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status, error: payload?.error?.message || 'Cloud Run rejected the job execution request.' };
  await stateRef.set({
    manualRunRequestedAt: FieldValue.serverTimestamp(),
    manualRunRequestedBy: String(member?.email || 'super_admin').slice(0, 250),
    manualRunOperation: payload.name || null
  }, { merge: true });
  return { ok: true, operation: payload.name || null };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'fxga-telegram-member-agent-admin', authMode: 'fxga-super-admin-session', job: JOB_NAME });
    }
    if (rateLimited(req)) return send(res, 429, { error: 'Too many administrative requests. Try again shortly.' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });

    const member = await requireSuperAdmin(req);
    if (!member) return send(res, 403, { error: 'FXGA super-admin authentication is required.' });

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, await agentStatus());
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/bot-token') {
      const body = await readJson(req);
      const token = String(body?.token || '').trim();
      if (!validBotTokenFormat(token)) return send(res, 400, { error: 'Telegram bot token format is invalid.' });
      const test = await testTelegramBot(token);
      if (!test.ok) return send(res, 400, { error: test.error });
      await saveBotToken(token);
      await stateRef.set({ botSettingsUpdatedAt: FieldValue.serverTimestamp(), botSettingsUpdatedBy: String(member.email || '').slice(0, 250) }, { merge: true });
      return send(res, 200, { configured: true, valid: true, bot: test.bot });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const result = await executeAgent(member);
      return send(res, result.ok ? 202 : result.status, result.ok ? result : { error: result.error });
    }

    return send(res, 404, { error: 'Not found.' });
  } catch (error) {
    const code = String(error?.message || '');
    if (code === 'REQUEST_TOO_LARGE') return send(res, 413, { error: 'Request body is too large.' });
    if (code === 'INVALID_JSON') return send(res, 400, { error: 'Request body must be valid JSON.' });
    console.error(JSON.stringify({ event: 'agent_admin_error', message: String(error?.message || 'administrative request failed').slice(0, 240) }));
    return send(res, 500, { error: 'Agent administrative operation failed.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'agent_admin_ready', port: PORT, authMode: 'fxga-super-admin-session', job: JOB_NAME }));
});
