import { spawn } from 'node:child_process';
import { Firestore } from '@google-cloud/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const VERSION = '1.0.0';
const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const STATE_COLLECTION = process.env.FIRESTORE_STATE_COLLECTION || 'agent_state';
const STATE_DOCUMENT = process.env.FIRESTORE_STATE_DOCUMENT || 'telegram-member-agent';
const TIME_ZONE = process.env.TIME_ZONE || 'Africa/Johannesburg';
const DIAGNOSTIC_SECRET = String(process.env.TEST_DIAGNOSTIC_SECRET || '').trim();
const MAX_ATTEMPTS = boundedInt(process.env.TEST_MAX_ATTEMPTS, 20, 1, 50);

const db = new Firestore({ projectId: PROJECT_ID || undefined, ignoreUndefinedProperties: true });
const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT);
const secrets = new SecretManagerServiceClient();
const startedAt = Date.now();

let finalDiagnostic;

try {
  if (!PROJECT_ID) throw taggedError('PROJECT_ID_MISSING', 'Google Cloud project ID is not configured');
  if (!DIAGNOSTIC_SECRET) throw taggedError('TEST_DIAGNOSTIC_SECRET_MISSING', 'Test diagnostic secret is not configured');

  const beforeSnap = await stateRef.get();
  const beforeState = beforeSnap.exists ? beforeSnap.data() : {};
  const today = calendarDayKey();
  const dailyAddedBefore = beforeState.dailyDate === today ? safeCount(beforeState.dailyAdded) : 0;

  if (dailyAddedBefore >= 50) {
    throw taggedError('DAILY_LIMIT_ALREADY_REACHED', 'The existing daily count is already at the configured platform ceiling');
  }

  const target = dailyAddedBefore + 1;
  const childEnv = {
    ...process.env,
    DAILY_TARGET_MIN: String(target),
    DAILY_TARGET_MAX: String(target),
    MAX_ATTEMPTS_PER_RUN: String(MAX_ATTEMPTS),
    DRY_RUN: 'false',
    LOCK_MINUTES: '15'
  };

  const child = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => appendBounded(stdout, chunk));
  child.stderr.on('data', chunk => appendBounded(stderr, chunk));

  const childExitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(Number.isInteger(code) ? code : 1));
  });

  const parsed = parseWorkerOutput(stdout.join(''), stderr.join(''));
  const afterSnap = await stateRef.get();
  const afterState = afterSnap.exists ? afterSnap.data() : {};
  const dailyAddedAfter = afterState.dailyDate === today ? safeCount(afterState.dailyAdded) : 0;
  const addedDelta = Math.max(0, dailyAddedAfter - dailyAddedBefore);
  const workerSummary = parsed.summary || {};

  const ok = childExitCode === 0 && addedDelta === 1 && safeCount(workerSummary.added) === 1;
  finalDiagnostic = {
    ok,
    version: VERSION,
    stage: ok ? 'complete' : 'worker',
    childExitCode,
    mutationPerformed: addedDelta > 0,
    addedDelta,
    dailyAddedBefore,
    dailyAddedAfter,
    attempted: safeCount(workerSummary.attempted),
    alreadyMember: safeCount(workerSummary.alreadyMember),
    skipped: safeCount(workerSummary.skipped),
    deferred: safeCount(workerSummary.deferred),
    stoppedByRateLimit: Boolean(workerSummary.stoppedByRateLimit),
    stoppedByAttemptLimit: Boolean(workerSummary.stoppedByAttemptLimit),
    fatalError: safeCode(workerSummary.fatalError),
    errors: safeErrorMap(workerSummary.errors),
    eventSequence: parsed.events.slice(-40),
    testTargetDailyCount: target,
    maxAttempts: MAX_ATTEMPTS,
    directAddOnly: true,
    secretsExposed: false,
    memberIdentityExposed: false,
    elapsedMs: Date.now() - startedAt,
    timestamp: new Date().toISOString()
  };

  await persistDiagnostic(finalDiagnostic);
  console.log(JSON.stringify({ event: 'controlled_test_result', ...finalDiagnostic }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  finalDiagnostic = {
    ok: false,
    version: VERSION,
    stage: 'setup',
    errorCode: safeCode(error?.code || error?.message) || 'CONTROLLED_TEST_SETUP_FAILED',
    message: safeMessage(error),
    mutationPerformed: false,
    directAddOnly: true,
    secretsExposed: false,
    memberIdentityExposed: false,
    elapsedMs: Date.now() - startedAt,
    timestamp: new Date().toISOString()
  };
  try { await persistDiagnostic(finalDiagnostic); } catch {}
  console.error(JSON.stringify({ event: 'controlled_test_error', ...finalDiagnostic }));
  process.exitCode = 1;
}

async function persistDiagnostic(payload) {
  if (!PROJECT_ID || !DIAGNOSTIC_SECRET) return;
  const parent = `projects/${PROJECT_ID}/secrets/${DIAGNOSTIC_SECRET}`;
  await secrets.addSecretVersion({
    parent,
    payload: { data: Buffer.from(JSON.stringify(payload), 'utf8') }
  });
}

function parseWorkerOutput(stdout, stderr) {
  const events = [];
  let summary = null;
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const value = JSON.parse(trimmed);
      const event = safeCode(value?.event);
      if (event) events.push(event);
      if (event === 'agent_summary') summary = value;
    } catch {}
  }
  return { events, summary };
}

function appendBounded(target, chunk) {
  const text = String(chunk || '');
  const current = target.reduce((sum, value) => sum + value.length, 0);
  if (current >= 1_000_000) return;
  target.push(text.slice(0, Math.max(0, 1_000_000 - current)));
}

function calendarDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function safeCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function safeCode(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/[A-Z][A-Z0-9_]{1,79}/);
  return match ? match[0] : null;
}

function safeMessage(error) {
  const raw = String(error?.message || 'Controlled Telegram test failed');
  return raw.replace(/[A-Za-z0-9_=-]{24,}/g, '[REDACTED]').slice(0, 220);
}

function safeErrorMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  for (const [key, count] of Object.entries(value)) {
    const code = safeCode(key);
    if (code) clean[code] = safeCount(count);
  }
  return clean;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function taggedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
