import { Firestore, FieldValue, Timestamp } from "@google-cloud/firestore";
import bigInt from "big-integer";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";

const VERSION = "1.0.0";
const db = new Firestore();

const config = Object.freeze({
  apiId: requiredInt("TELEGRAM_API_ID"),
  apiHash: required("TELEGRAM_API_HASH"),
  session: required("TELEGRAM_SESSION"),
  channel: required("TELEGRAM_CHANNEL"),
  dailyTargetMin: boundedInt("DAILY_TARGET_MIN", 20, 1, 50),
  dailyTargetMax: boundedInt("DAILY_TARGET_MAX", 50, 1, 50),
  attemptDelayMs: boundedInt("ATTEMPT_DELAY_MS", 5000, 1000, 60000),
  unknownRetries: boundedInt("UNKNOWN_ERROR_RETRIES", 2, 0, 3),
  unknownRetryDelayMs: boundedInt("UNKNOWN_RETRY_DELAY_MS", 5000, 1000, 60000),
  transientRetryHours: boundedInt("TRANSIENT_RETRY_HOURS", 24, 1, 168),
  queueCollection: process.env.FIRESTORE_QUEUE_COLLECTION || "telegram_member_queue",
  stateCollection: process.env.FIRESTORE_STATE_COLLECTION || "agent_state",
  stateDocument: process.env.FIRESTORE_STATE_DOCUMENT || "telegram-member-agent",
  lockMinutes: boundedInt("LOCK_MINUTES", 55, 5, 55),
  scanPageSize: boundedInt("SCAN_PAGE_SIZE", 200, 50, 500),
  dryRun: /^true$/i.test(process.env.DRY_RUN || "false")
});

if (config.dailyTargetMin > config.dailyTargetMax) {
  throw new Error("DAILY_TARGET_MIN must be <= DAILY_TARGET_MAX");
}

const stateRef = db.collection(config.stateCollection).doc(config.stateDocument);
const queue = db.collection(config.queueCollection);

const PERMANENT_SKIPS = new Map([
  ["USER_PRIVACY_RESTRICTED", "privacy_restricted"],
  ["USER_NOT_MUTUAL_CONTACT", "requires_mutual_contact"],
  ["INPUT_USER_DEACTIVATED", "deactivated"],
  ["USER_DEACTIVATED", "deactivated"],
  ["USER_ID_INVALID", "invalid_user"],
  ["USER_CHANNELS_TOO_MUCH", "user_channel_limit"],
  ["USER_BLOCKED", "blocked"],
  ["USER_KICKED", "kicked"],
  ["USER_BANNED_IN_CHANNEL", "banned"],
  ["USER_BOT", "bot_account"],
  ["CHAT_MEMBER_ADD_FAILED", "add_not_allowed"]
]);

const FATAL_CHANNEL_ERRORS = new Set([
  "CHAT_ADMIN_REQUIRED",
  "CHAT_WRITE_FORBIDDEN",
  "CHANNEL_PRIVATE",
  "CHANNEL_INVALID",
  "CHANNEL_PUBLIC_GROUP_NA"
]);

const runId = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
const summary = {
  version: VERSION,
  runId,
  startedAt: new Date().toISOString(),
  targetMin: config.dailyTargetMin,
  targetMax: config.dailyTargetMax,
  dryRun: config.dryRun,
  added: 0,
  alreadyMember: 0,
  skipped: 0,
  deferred: 0,
  attempted: 0,
  scanned: 0,
  stoppedByRateLimit: false,
  minimumGoalReached: false,
  errors: {}
};

let lockHeld = false;
let client;
let inputChannel;

try {
  lockHeld = await acquireLock();
  if (!lockHeld) {
    console.log(JSON.stringify({ event: "agent_already_running", runId }));
    process.exitCode = 0;
  } else {
    const state = await getState();
    if (state.blockedUntil && state.blockedUntil.toDate() > new Date()) {
      summary.stoppedByRateLimit = true;
      summary.blockedUntil = state.blockedUntil.toDate().toISOString();
      console.log(JSON.stringify({ event: "rate_limit_window_active", ...summary }));
    } else {
      client = new TelegramClient(
        new StringSession(config.session),
        config.apiId,
        config.apiHash,
        { connectionRetries: 5 }
      );
      await client.connect();

      if (!(await client.checkAuthorization())) {
        throw new Error("TELEGRAM_SESSION is not authorized. Generate a fresh StringSession before deploying.");
      }

      inputChannel = await resolveInputChannel(config.channel);
      await processDueRetries();
      if (!summary.stoppedByRateLimit && summary.added < config.dailyTargetMax) {
        await processFreshQueue(state.nextSequence || 1);
      }
    }
  }
} catch (error) {
  const normalized = normalizeError(error);
  summary.fatalError = normalized.code;
  summary.fatalMessage = safeMessage(error);
  console.error(JSON.stringify({ event: "agent_fatal", runId, error: normalized.code, message: summary.fatalMessage }));
  process.exitCode = 1;
} finally {
  summary.minimumGoalReached = summary.added >= config.dailyTargetMin;
  summary.finishedAt = new Date().toISOString();

  if (client) {
    try { await client.disconnect(); } catch { /* best effort */ }
  }
  if (lockHeld) {
    try { await releaseLock(); } catch (error) {
      console.error(JSON.stringify({ event: "lock_release_failed", message: safeMessage(error) }));
    }
  }
  console.log(JSON.stringify({ event: "agent_summary", ...summary }));
}

async function processDueRetries() {
  const now = Timestamp.now();
  const snap = await queue
    .where("nextRetryAt", "<=", now)
    .orderBy("nextRetryAt", "asc")
    .limit(config.dailyTargetMax)
    .get();

  for (const doc of snap.docs) {
    if (summary.added >= config.dailyTargetMax || summary.stoppedByRateLimit) break;
    const data = doc.data();
    if (data.status !== "retry_wait") continue;
    await processMember(doc, data, { advanceCursor: false, source: "retry" });
  }
}

async function processFreshQueue(startSequence) {
  let cursor = Number(startSequence) || 1;

  while (summary.added < config.dailyTargetMax && !summary.stoppedByRateLimit) {
    const snap = await queue
      .where("sequence", ">=", cursor)
      .orderBy("sequence", "asc")
      .limit(config.scanPageSize)
      .get();

    if (snap.empty) break;

    for (const doc of snap.docs) {
      if (summary.added >= config.dailyTargetMax || summary.stoppedByRateLimit) break;
      const data = doc.data();
      const sequence = Number(data.sequence);
      if (!Number.isFinite(sequence)) continue;

      cursor = sequence + 1;
      summary.scanned += 1;

      if (data.status && !["pending", "retry_wait"].includes(data.status)) {
        await persistCursor(cursor, doc.id);
        continue;
      }
      if (data.status === "retry_wait") {
        await persistCursor(cursor, doc.id);
        continue;
      }

      await processMember(doc, data, { advanceCursor: true, nextSequence: cursor, source: "queue" });
    }

    const last = snap.docs.at(-1)?.data();
    if (!last || snap.size < config.scanPageSize) break;
    cursor = Math.max(cursor, Number(last.sequence) + 1);
  }
}

async function processMember(doc, member, context) {
  summary.attempted += 1;

  if (!member.userId && !member.username) {
    summary.skipped += 1;
    return writeOutcome(doc, member, "invalid_user", "MISSING_USER_REFERENCE", context);
  }

  if (config.dryRun) {
    console.log(JSON.stringify({ event: "dry_run_candidate", id: doc.id, sequence: member.sequence, username: member.username || null }));
    if (context.advanceCursor) await persistCursor(context.nextSequence, doc.id);
    return;
  }

  let lastError;
  for (let attempt = 0; attempt <= config.unknownRetries; attempt += 1) {
    try {
      const inputUser = await resolveInputUser(member);
      await client.invoke(new Api.channels.InviteToChannel({
        channel: inputChannel,
        users: [inputUser]
      }));

      summary.added += 1;
      await writeOutcome(doc, member, "added", null, context, { addedAt: FieldValue.serverTimestamp() });
      console.log(JSON.stringify({ event: "member_added", id: doc.id, sequence: member.sequence, username: member.username || null }));
      await delay(config.attemptDelayMs);
      return;
    } catch (error) {
      lastError = error;
      const normalized = normalizeError(error);
      bumpError(normalized.code);

      if (normalized.code === "USER_ALREADY_PARTICIPANT") {
        summary.alreadyMember += 1;
        await writeOutcome(doc, member, "already_member", normalized.code, context);
        return;
      }

      if (PERMANENT_SKIPS.has(normalized.code)) {
        summary.skipped += 1;
        await writeOutcome(doc, member, PERMANENT_SKIPS.get(normalized.code), normalized.code, context);
        return;
      }

      if (FATAL_CHANNEL_ERRORS.has(normalized.code)) {
        await stateRef.set({ lastError: normalized.code, lastErrorAt: FieldValue.serverTimestamp() }, { merge: true });
        throw error;
      }

      if (normalized.rateLimited) {
        summary.stoppedByRateLimit = true;
        summary.deferred += 1;
        const blockedUntil = new Date(Date.now() + normalized.waitSeconds * 1000);
        summary.blockedUntil = blockedUntil.toISOString();
        await stateRef.set({
          blockedUntil: Timestamp.fromDate(blockedUntil),
          lastError: normalized.code,
          lastErrorAt: FieldValue.serverTimestamp()
        }, { merge: true });
        await deferMember(doc, member, normalized.code, blockedUntil, context);
        return;
      }

      if (attempt < config.unknownRetries) {
        await delay(config.unknownRetryDelayMs);
        continue;
      }
    }
  }

  const normalized = normalizeError(lastError);
  const retryAt = new Date(Date.now() + config.transientRetryHours * 3600 * 1000);
  summary.deferred += 1;
  await deferMember(doc, member, normalized.code, retryAt, context);
}

async function resolveInputChannel(reference) {
  const peer = await client.getInputEntity(reference);
  if (peer instanceof Api.InputPeerChannel) {
    return new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash });
  }
  if (peer instanceof Api.InputChannel) return peer;
  throw new Error("TELEGRAM_CHANNEL must resolve to a Telegram channel or supergroup.");
}

async function resolveInputUser(member) {
  if (member.username) {
    try {
      const peer = await client.getInputEntity(member.username.startsWith("@") ? member.username : `@${member.username}`);
      if (peer instanceof Api.InputPeerUser) {
        return new Api.InputUser({ userId: peer.userId, accessHash: peer.accessHash });
      }
      if (peer instanceof Api.InputUser) return peer;
    } catch (error) {
      const code = normalizeError(error).code;
      if (!member.userId || !member.accessHash || !["USERNAME_NOT_OCCUPIED", "USERNAME_INVALID", "USER_ID_INVALID", "UNKNOWN"].includes(code)) {
        throw error;
      }
    }
  }

  if (!member.userId || member.accessHash === undefined || member.accessHash === null || member.accessHash === "") {
    throw rpcLikeError("USER_ID_INVALID", "No usable username or userId/accessHash pair is available.");
  }

  return new Api.InputUser({
    userId: bigInt(String(member.userId)),
    accessHash: bigInt(String(member.accessHash))
  });
}

async function writeOutcome(doc, member, status, errorCode, context, extras = {}) {
  const patch = {
    status,
    attempts: Number(member.attempts || 0) + 1,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastErrorCode: errorCode || FieldValue.delete(),
    nextRetryAt: FieldValue.delete(),
    ...extras
  };
  const batch = db.batch();
  batch.set(doc.ref, patch, { merge: true });
  if (context.advanceCursor) {
    batch.set(stateRef, {
      nextSequence: context.nextSequence,
      lastProcessedId: doc.id,
      lastProgressAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
}

async function deferMember(doc, member, errorCode, retryAt, context) {
  const batch = db.batch();
  batch.set(doc.ref, {
    status: "retry_wait",
    attempts: Number(member.attempts || 0) + 1,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastErrorCode: errorCode,
    nextRetryAt: Timestamp.fromDate(retryAt)
  }, { merge: true });
  if (context.advanceCursor) {
    batch.set(stateRef, {
      nextSequence: context.nextSequence,
      lastProcessedId: doc.id,
      lastProgressAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
}

async function persistCursor(nextSequence, memberId) {
  await stateRef.set({
    nextSequence,
    lastProcessedId: memberId,
    lastProgressAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function acquireLock() {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + config.lockMinutes * 60 * 1000);

  return db.runTransaction(async tx => {
    const snap = await tx.get(stateRef);
    const state = snap.exists ? snap.data() : {};
    const existingLock = state.lockUntil?.toDate?.();
    if (state.running === true && existingLock && existingLock > now) return false;

    tx.set(stateRef, {
      version: VERSION,
      running: true,
      runId,
      lockUntil: Timestamp.fromDate(lockUntil),
      startedAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete()
    }, { merge: true });
    return true;
  });
}

async function releaseLock() {
  await stateRef.set({
    running: false,
    lockUntil: FieldValue.delete(),
    finishedAt: FieldValue.serverTimestamp(),
    lastRunSummary: summary
  }, { merge: true });
}

async function getState() {
  const snap = await stateRef.get();
  return snap.exists ? snap.data() : {};
}

function normalizeError(error) {
  const raw = String(error?.errorMessage || error?.message || error?.constructor?.name || "UNKNOWN").toUpperCase();
  const explicit = [
    "USER_ALREADY_PARTICIPANT", "USER_PRIVACY_RESTRICTED", "USER_NOT_MUTUAL_CONTACT",
    "INPUT_USER_DEACTIVATED", "USER_DEACTIVATED", "USER_ID_INVALID", "USER_CHANNELS_TOO_MUCH",
    "USER_BLOCKED", "USER_KICKED", "USER_BANNED_IN_CHANNEL", "USER_BOT", "CHAT_MEMBER_ADD_FAILED",
    "CHAT_ADMIN_REQUIRED", "CHAT_WRITE_FORBIDDEN", "CHANNEL_PRIVATE", "CHANNEL_INVALID",
    "CHANNEL_PUBLIC_GROUP_NA", "PEER_FLOOD", "FLOOD_WAIT", "USERNAME_NOT_OCCUPIED", "USERNAME_INVALID"
  ].find(code => raw.includes(code));

  let code = explicit || (raw.match(/\b[A-Z][A-Z0-9_]{3,}\b/)?.[0] || "UNKNOWN");
  let waitSeconds = Number(error?.seconds || error?.waitSeconds || 0);
  const waitMatch = raw.match(/FLOOD_WAIT[_\s-]?(\d+)/);
  if (!waitSeconds && waitMatch) waitSeconds = Number(waitMatch[1]);

  const rateLimited = code === "FLOOD_WAIT" || code === "PEER_FLOOD" || raw.includes("FLOOD_WAIT");
  if (rateLimited && (!Number.isFinite(waitSeconds) || waitSeconds <= 0)) {
    waitSeconds = code === "PEER_FLOOD" ? 86400 : 3600;
  }
  if (raw.includes("FLOOD_WAIT")) code = "FLOOD_WAIT";
  return { code, rateLimited, waitSeconds };
}

function bumpError(code) {
  summary.errors[code] = (summary.errors[code] || 0) + 1;
}

function rpcLikeError(code, message) {
  const error = new Error(message);
  error.errorMessage = code;
  return error;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredInt(name) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function boundedInt(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function safeMessage(error) {
  return String(error?.message || error || "Unknown error").slice(0, 500);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
