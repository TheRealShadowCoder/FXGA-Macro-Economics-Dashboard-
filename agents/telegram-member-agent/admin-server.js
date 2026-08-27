import http from 'node:http';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const REGION = process.env.GCP_REGION || 'us-central1';
const JOB_NAME = process.env.TELEGRAM_AGENT_JOB || 'fxga-telegram-member-agent';
const AUTH_SERVICE_URL = String(process.env.AUTH_SERVICE_URL || 'https://fxga-trading-academy.few-nose.workers.dev').replace(/\/$/, '');
const QUEUE_COLLECTION = process.env.FIRESTORE_QUEUE_COLLECTION || 'telegram_member_queue';
const STATE_COLLECTION = process.env.FIRESTORE_STATE_COLLECTION || 'agent_state';
const STATE_DOCUMENT = process.env.FIRESTORE_STATE_DOCUMENT || 'telegram-member-agent';
const NOT_CONFIGURED = '__FXGA_NOT_CONFIGURED__';
const SECRET_NAMES = Object.freeze({
  botToken: process.env.TELEGRAM_BOT_TOKEN_SECRET || 'fxga-telegram-bot-token',
  apiId: process.env.TELEGRAM_API_ID_SECRET || 'fxga-telegram-api-id',
  apiHash: process.env.TELEGRAM_API_HASH_SECRET || 'fxga-telegram-api-hash',
  session: process.env.TELEGRAM_SESSION_SECRET || 'fxga-telegram-session',
  channel: process.env.TELEGRAM_CHANNEL_SECRET || 'fxga-telegram-channel'
});
const db = new Firestore({ projectId: PROJECT_ID || undefined, ignoreUndefinedProperties: true });
const secretManager = new SecretManagerServiceClient();
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
  return current.count > 40;
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

function secretPath(name) {
  return `projects/${PROJECT_ID}/secrets/${name}`;
}

async function readSecret(name) {
  if (!PROJECT_ID) throw new Error('GCP_PROJECT_ID is not configured');
  try {
    const [version] = await secretManager.accessSecretVersion({ name: `${secretPath(name)}/versions/latest` });
    const value = Buffer.from(version.payload?.data || '').toString('utf8').trim();
    return value === NOT_CONFIGURED ? '' : value;
  } catch (error) {
    const code = Number(error?.code);
    if (code === 5 || /NOT_FOUND|no enabled versions/i.test(String(error?.message || ''))) return '';
    throw error;
  }
}

async function writeSecret(name, value) {
  await secretManager.addSecretVersion({ parent: secretPath(name), payload: { data: Buffer.from(String(value), 'utf8') } });
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
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal
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

async function directCredentials() {
  const [apiId, apiHash, session, channel] = await Promise.all([
    readSecret(SECRET_NAMES.apiId), readSecret(SECRET_NAMES.apiHash), readSecret(SECRET_NAMES.session), readSecret(SECRET_NAMES.channel)
  ]);
  return { apiId, apiHash, session, channel };
}

function credentialFlags(credentials) {
  const flags = {
    apiId: Boolean(credentials.apiId),
    apiHash: Boolean(credentials.apiHash),
    session: Boolean(credentials.session),
    channel: Boolean(credentials.channel)
  };
  return { ...flags, ready: Object.values(flags).every(Boolean) };
}

function validateCredentialShape(credentials) {
  if (credentials.apiId) {
    const id = Number(credentials.apiId);
    if (!Number.isSafeInteger(id) || id <= 0) return 'Telegram API ID must be a positive integer.';
  }
  if (credentials.apiHash && !/^[A-Za-z0-9_-]{16,128}$/.test(credentials.apiHash)) return 'Telegram API hash format is invalid.';
  if (credentials.session && credentials.session.length < 20) return 'Telegram user session is too short.';
  if (credentials.channel && credentials.channel.length < 2) return 'Telegram channel reference is invalid.';
  return null;
}

async function testDirectCredentials(credentials) {
  const shapeError = validateCredentialShape(credentials);
  if (shapeError) return { ok: false, error: shapeError };
  if (!credentialFlags(credentials).ready) return { ok: false, error: 'All four MTProto credentials are required before validation.' };
  const client = new TelegramClient(new StringSession(credentials.session), Number(credentials.apiId), credentials.apiHash, { connectionRetries: 3 });
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) return { ok: false, error: 'Telegram user session is not authorized.' };
    const peer = await client.getInputEntity(credentials.channel);
    const validChannel = peer instanceof Api.InputPeerChannel || peer instanceof Api.InputChannel;
    if (!validChannel) return { ok: false, error: 'Target must resolve to a Telegram channel or supergroup.' };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Telegram MTProto validation failed: ${String(error?.errorMessage || error?.message || 'unknown error').slice(0, 180)}` };
  } finally {
    try { await client.disconnect(); } catch {}
  }
}

async function saveDirectCredentialPatch(body, member) {
  const current = await directCredentials();
  const supplied = {
    apiId: String(body?.apiId || '').trim(),
    apiHash: String(body?.apiHash || '').trim(),
    session: String(body?.session || '').trim(),
    channel: String(body?.channel || '').trim()
  };
  if (!Object.values(supplied).some(Boolean)) return { ok: false, status: 400, error: 'Enter at least one MTProto credential to update.' };
  const candidate = Object.fromEntries(Object.keys(current).map(key => [key, supplied[key] || current[key]]));
  const shapeError = validateCredentialShape(candidate);
  if (shapeError) return { ok: false, status: 400, error: shapeError };
  const flags = credentialFlags(candidate);
  if (flags.ready) {
    const test = await testDirectCredentials(candidate);
    if (!test.ok) return { ok: false, status: 400, error: test.error };
  }
  const writes = [];
  if (supplied.apiId) writes.push(writeSecret(SECRET_NAMES.apiId, supplied.apiId));
  if (supplied.apiHash) writes.push(writeSecret(SECRET_NAMES.apiHash, supplied.apiHash));
  if (supplied.session) writes.push(writeSecret(SECRET_NAMES.session, supplied.session));
  if (supplied.channel) writes.push(writeSecret(SECRET_NAMES.channel, supplied.channel));
  await Promise.all(writes);
  await stateRef.set({
    directCredentialsUpdatedAt: FieldValue.serverTimestamp(),
    directCredentialsUpdatedBy: String(member?.email || '').slice(0, 250),
    directCredentialsReady: flags.ready
  }, { merge: true });
  return { ok: true, credentials: flags, validated: flags.ready };
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
  const [stateSnap, queueProbe, countSnap, token, credentials] = await Promise.all([
    stateRef.get(), queue.limit(1).get(), queue.count().get(), readSecret(SECRET_NAMES.botToken), directCredentials()
  ]);
  const state = stateSnap.exists ? stateSnap.data() : {};
  const tokenTest = token ? await testTelegramBot(token) : { ok: false };
  const queueTotal = Number(countSnap.data().count || state.queueRecordCount || 0);
  const blockedUntil = iso(state.blockedUntil);
  const blocked = blockedUntil ? Date.parse(blockedUntil) > Date.now() : false;
  return {
    directAddOnly: true,
    credentials: credentialFlags(credentials),
    bot: { configured: Boolean(token), valid: Boolean(tokenTest.ok), identity: tokenTest.ok ? tokenTest.bot : null },
    queue: {
      ready: !queueProbe.empty,
      total: queueTotal,
      importedAt: iso(state.queueImportedAt),
      nextSequence: Number(state.nextSequence || 1),
      duplicatesIgnored: Number(state.queueDuplicateRowsIgnored || 0),
      invalidRowsIgnored: Number(state.queueInvalidRowsIgnored || 0)
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
    schedule: { job: JOB_NAME, timezone: 'Africa/Johannesburg', dailyTime: '08:00' }
  };
}

async function importRoster(csv, sourceFile, member) {
  const text = String(csv || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return { ok: false, status: 400, error: 'Roster CSV is empty.' };
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, status: 400, error: 'CSV contains no member records.' };
  const header = rows[0].map(value => String(value).trim().toLowerCase());
  const requiredHeaders = ['username', 'user id', 'access hash', 'name', 'group', 'group id'];
  for (const name of requiredHeaders) if (!header.includes(name)) return { ok: false, status: 400, error: `Missing CSV column: ${name}` };
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  const seenKeys = new Set();
  let imported = 0, duplicates = 0, skipped = 0, batch = db.batch(), batchCount = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.every(value => !clean(value))) continue;
    const userId = clean(row[idx['user id']]);
    const username = clean(row[idx.username]).replace(/^@/, '');
    if (!userId && !username) { skipped += 1; continue; }
    const identityKey = userId ? `u:${userId}` : `n:${username.toLowerCase()}`;
    if (seenKeys.has(identityKey)) { duplicates += 1; continue; }
    seenKeys.add(identityKey);
    const sequence = imported + 1;
    const docId = userId ? `u_${userId}` : `n_${username.toLowerCase()}`;
    batch.set(queue.doc(docId), {
      sequence,
      username: username || null,
      userId: userId || null,
      accessHash: clean(row[idx['access hash']]) || null,
      name: clean(row[idx.name]) || null,
      sourceGroup: clean(row[idx.group]) || null,
      sourceGroupId: clean(row[idx['group id']]) || null,
      lastImportedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    imported += 1;
    batchCount += 1;
    if (batchCount >= 400) { await batch.commit(); batch = db.batch(); batchCount = 0; }
  }
  if (batchCount) await batch.commit();
  await stateRef.set({
    nextSequence: 1,
    running: false,
    blockedUntil: FieldValue.delete(),
    queueImportedAt: FieldValue.serverTimestamp(),
    queueRecordCount: imported,
    queueDuplicateRowsIgnored: duplicates,
    queueInvalidRowsIgnored: skipped,
    queueSourceFile: String(sourceFile || 'admin-upload.csv').slice(0, 220),
    queueImportedBy: String(member?.email || '').slice(0, 250)
  }, { merge: true });
  return { ok: true, imported, duplicates, skipped };
}

function clean(value) { return String(value ?? '').trim(); }
function parseCsv(input) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

async function accessToken() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' }, signal: controller.signal
    });
    if (!response.ok) throw new Error(`metadata_token_http_${response.status}`);
    const payload = await response.json();
    if (!payload?.access_token) throw new Error('metadata_access_token_missing');
    return payload.access_token;
  } finally { clearTimeout(timer); }
}

async function executeAgent(member) {
  const credentials = await directCredentials();
  const flags = credentialFlags(credentials);
  if (!flags.ready) return { ok: false, status: 409, error: 'Configure all four Telegram MTProto credentials before starting operations.' };
  const credentialTest = await testDirectCredentials(credentials);
  if (!credentialTest.ok) return { ok: false, status: 409, error: credentialTest.error };
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() : {};
  if (state.running === true && (!state.lockUntil?.toDate || state.lockUntil.toDate() > new Date())) return { ok: false, status: 409, error: 'The Telegram Member Agent is already running.' };
  const blockedUntil = state.blockedUntil?.toDate?.();
  if (blockedUntil && blockedUntil > new Date()) return { ok: false, status: 409, error: `Telegram rate-limit protection is active until ${blockedUntil.toISOString()}.` };
  const probe = await queue.limit(1).get();
  if (probe.empty) return { ok: false, status: 409, error: 'The Telegram member queue is empty. Import the roster before starting operations.' };
  const oauth = await accessToken();
  const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(PROJECT_ID)}/locations/${encodeURIComponent(REGION)}/jobs/${encodeURIComponent(JOB_NAME)}:run`;
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}'
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
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'fxga-telegram-member-agent-admin', authMode: 'fxga-super-admin-session', job: JOB_NAME });
    if (rateLimited(req)) return send(res, 429, { error: 'Too many administrative requests. Try again shortly.' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
    const member = await requireSuperAdmin(req);
    if (!member) return send(res, 403, { error: 'FXGA super-admin authentication is required.' });

    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await agentStatus());

    if (req.method === 'POST' && url.pathname === '/api/settings/bot-token') {
      const body = await readJson(req);
      const token = String(body?.token || '').trim();
      if (!validBotTokenFormat(token)) return send(res, 400, { error: 'Telegram bot token format is invalid.' });
      const test = await testTelegramBot(token);
      if (!test.ok) return send(res, 400, { error: test.error });
      await writeSecret(SECRET_NAMES.botToken, token);
      await stateRef.set({ botSettingsUpdatedAt: FieldValue.serverTimestamp(), botSettingsUpdatedBy: String(member.email || '').slice(0, 250) }, { merge: true });
      return send(res, 200, { configured: true, valid: true, bot: test.bot });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/direct-add') {
      const result = await saveDirectCredentialPatch(await readJson(req, 64_000), member);
      return send(res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
    }

    if (req.method === 'POST' && url.pathname === '/api/roster') {
      const body = await readJson(req, 2_500_000);
      const result = await importRoster(body?.csv, body?.sourceFile, member);
      return send(res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
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
