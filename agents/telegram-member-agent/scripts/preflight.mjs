import { Firestore } from '@google-cloud/firestore';
import bigInt from 'big-integer';
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

const VERSION = '2.0.0';
const startedAt = Date.now();
let stage = 'configuration';
let client;

const queueCollection = process.env.FIRESTORE_QUEUE_COLLECTION || 'telegram_member_queue';
const stateCollection = process.env.FIRESTORE_STATE_COLLECTION || 'agent_state';
const stateDocument = process.env.FIRESTORE_STATE_DOCUMENT || 'telegram-member-agent';

try {
  log('preflight_start', {
    version: VERSION,
    queueCollection,
    stateCollection,
    stateDocument,
    credentialPresence: {
      apiId: configured('TELEGRAM_API_ID'),
      apiHash: configured('TELEGRAM_API_HASH'),
      session: configured('TELEGRAM_SESSION'),
      channel: configured('TELEGRAM_CHANNEL')
    }
  });

  const apiId = Number(required('TELEGRAM_API_ID'));
  const apiHash = required('TELEGRAM_API_HASH');
  const session = required('TELEGRAM_SESSION');
  const channel = required('TELEGRAM_CHANNEL');
  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    throw codedError('TELEGRAM_API_ID_INVALID', 'TELEGRAM_API_ID must be a positive integer');
  }
  log('preflight_check_pass', { check: 'configuration', secretsExposed: false });

  stage = 'firestore';
  log('preflight_check_start', { check: stage });
  const db = new Firestore();
  const queueRef = db.collection(queueCollection);
  const stateRef = db.collection(stateCollection).doc(stateDocument);

  const [queueProbe, stateSnap] = await Promise.all([
    queueRef.orderBy('sequence', 'asc').limit(1).get(),
    stateRef.get()
  ]);
  const state = stateSnap.exists ? stateSnap.data() : {};

  let liveQueueCount = null;
  try {
    const countSnap = await queueRef.count().get();
    liveQueueCount = Number(countSnap.data().count || 0);
  } catch (error) {
    log('preflight_warning', {
      check: 'firestore_queue_count',
      code: normalizeCode(error),
      message: safeMessage(error)
    });
  }

  log('preflight_check_pass', {
    check: stage,
    stateExists: stateSnap.exists,
    queueHasRecords: !queueProbe.empty,
    queueRecordCount: liveQueueCount,
    recordedQueueCount: Number(state.queueRecordCount || 0) || null,
    nextSequence: Number(state.nextSequence || 1) || 1,
    blockedUntilConfigured: Boolean(state.blockedUntil),
    runningFlag: Boolean(state.running)
  });

  if (queueProbe.empty) {
    throw codedError('TELEGRAM_MEMBER_QUEUE_EMPTY', 'No records are available in the Telegram member queue');
  }

  const candidateDoc = queueProbe.docs[0];
  const candidate = candidateDoc.data();
  log('preflight_candidate_selected', {
    sequence: Number(candidate.sequence || 0) || null,
    hasUsername: Boolean(candidate.username),
    hasUserId: Boolean(candidate.userId),
    hasAccessHash: candidate.accessHash !== undefined && candidate.accessHash !== null && candidate.accessHash !== '',
    status: candidate.status || 'pending'
  });

  stage = 'telegram_connect';
  log('preflight_check_start', { check: stage });
  client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  log('preflight_check_pass', { check: stage, connected: true });

  stage = 'telegram_authorization';
  log('preflight_check_start', { check: stage });
  if (!(await client.checkAuthorization())) {
    throw codedError('TELEGRAM_SESSION_NOT_AUTHORIZED', 'The configured Telegram StringSession is not authorized');
  }
  log('preflight_check_pass', { check: stage, sessionAuthorized: true });

  stage = 'telegram_channel_resolution';
  log('preflight_check_start', { check: stage });
  const peer = await client.getInputEntity(channel);
  const isInputPeerChannel = peer instanceof Api.InputPeerChannel;
  const isInputChannel = peer instanceof Api.InputChannel;
  if (!isInputPeerChannel && !isInputChannel) {
    throw codedError('TELEGRAM_CHANNEL_NOT_CHANNEL_OR_SUPERGROUP', 'The target did not resolve to a channel or supergroup');
  }
  const inputChannel = isInputPeerChannel
    ? new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash })
    : peer;
  log('preflight_check_pass', {
    check: stage,
    channelResolved: true,
    peerType: peer?.className || peer?.constructor?.name || 'channel'
  });

  stage = 'telegram_channel_permissions';
  log('preflight_check_start', { check: stage });
  const entity = await client.getEntity(channel);
  const adminRights = entity?.adminRights ?? entity?.admin_rights ?? null;
  const isCreator = Boolean(entity?.creator);
  const canInviteUsers = isCreator || Boolean(adminRights?.inviteUsers ?? adminRights?.invite_users);
  log('preflight_permission_snapshot', {
    creator: isCreator,
    hasAdminRights: Boolean(adminRights),
    canInviteUsers
  });
  if (!canInviteUsers) {
    throw codedError(
      'TELEGRAM_SESSION_ACCOUNT_CANNOT_INVITE_USERS',
      'The authenticated Telegram user does not have permission to add members to the target'
    );
  }
  log('preflight_check_pass', { check: stage, canInviteUsers: true });

  stage = 'telegram_candidate_resolution';
  log('preflight_check_start', { check: stage });
  const inputUser = await resolveInputUser(client, candidate);
  log('preflight_check_pass', {
    check: stage,
    candidateResolved: true,
    resolutionType: inputUser?.className || inputUser?.constructor?.name || 'InputUser'
  });

  stage = 'telegram_candidate_membership_probe';
  log('preflight_check_start', { check: stage });
  let candidateMembership = 'unknown';
  try {
    await client.invoke(new Api.channels.GetParticipant({
      channel: inputChannel,
      participant: inputUser
    }));
    candidateMembership = 'already_member';
  } catch (error) {
    const code = normalizeCode(error);
    if (code === 'USER_NOT_PARTICIPANT') {
      candidateMembership = 'not_member';
    } else {
      log('preflight_warning', {
        check: stage,
        code,
        message: safeMessage(error)
      });
    }
  }
  log('preflight_check_pass', {
    check: stage,
    candidateMembership,
    mutationPerformed: false
  });

  stage = 'complete';
  log('preflight_passed', {
    ok: true,
    version: VERSION,
    queueReady: true,
    queueRecordCount: liveQueueCount ?? (Number(state.queueRecordCount || 0) || null),
    sessionAuthorized: true,
    channelResolved: true,
    canInviteUsers: true,
    candidateResolved: true,
    candidateMembership,
    directAddOnly: true,
    mutationPerformed: false,
    elapsedMs: Date.now() - startedAt
  });
} catch (error) {
  logError('preflight_failed', {
    ok: false,
    version: VERSION,
    stage,
    errorCode: normalizeCode(error),
    errorName: error?.name || 'Error',
    message: safeMessage(error),
    secretsExposed: false,
    mutationPerformed: false,
    elapsedMs: Date.now() - startedAt
  });
  process.exitCode = 1;
} finally {
  if (client) {
    try {
      await client.disconnect();
      log('preflight_disconnect', { disconnected: true });
    } catch (error) {
      log('preflight_warning', {
        check: 'telegram_disconnect',
        code: normalizeCode(error),
        message: safeMessage(error)
      });
    }
  }
  log('preflight_finished', {
    stage,
    ok: process.exitCode !== 1,
    elapsedMs: Date.now() - startedAt
  });
}

async function resolveInputUser(clientInstance, member) {
  if (!member?.userId && !member?.username) {
    throw codedError('CANDIDATE_MISSING_USER_REFERENCE', 'Queued candidate has neither username nor user ID');
  }

  if (member.username) {
    try {
      const username = member.username.startsWith('@') ? member.username : `@${member.username}`;
      const peer = await clientInstance.getInputEntity(username);
      if (peer instanceof Api.InputPeerUser) {
        return new Api.InputUser({ userId: peer.userId, accessHash: peer.accessHash });
      }
      if (peer instanceof Api.InputUser) return peer;
    } catch (error) {
      const code = normalizeCode(error);
      const mayFallback = member.userId && member.accessHash !== undefined && member.accessHash !== null && member.accessHash !== '';
      if (!mayFallback || !['USERNAME_NOT_OCCUPIED', 'USERNAME_INVALID', 'USER_ID_INVALID', 'UNKNOWN'].includes(code)) {
        throw error;
      }
      log('preflight_warning', {
        check: 'candidate_username_resolution',
        code,
        fallbackToIdAccessHash: true
      });
    }
  }

  if (!member.userId || member.accessHash === undefined || member.accessHash === null || member.accessHash === '') {
    throw codedError('CANDIDATE_USER_ID_ACCESS_HASH_MISSING', 'Queued candidate does not contain a usable userId/accessHash pair');
  }

  return new Api.InputUser({
    userId: bigInt(String(member.userId)),
    accessHash: bigInt(String(member.accessHash))
  });
}

function configured(name) {
  const value = process.env[name]?.trim();
  return Boolean(value && value !== '__FXGA_NOT_CONFIGURED__');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || value === '__FXGA_NOT_CONFIGURED__') {
    throw codedError(`${name}_MISSING`, `${name} is not configured`);
  }
  return value;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeCode(error) {
  const raw = error?.errorMessage || error?.code || error?.message || 'UNKNOWN';
  const text = String(raw).toUpperCase();
  const flood = text.match(/FLOOD_WAIT_?(\d+)?/);
  if (flood) return flood[1] ? `FLOOD_WAIT_${flood[1]}` : 'FLOOD_WAIT';
  const peerFlood = text.match(/PEER_FLOOD/);
  if (peerFlood) return 'PEER_FLOOD';
  const rpcCode = text.match(/\b[A-Z][A-Z0-9_]{2,}\b/);
  return rpcCode?.[0] || 'UNKNOWN';
}

function safeMessage(error) {
  const message = String(error?.message || error?.errorMessage || 'Unknown error');
  return message
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, '[REDACTED]')
    .replace(/\b\d{6,12}:AA[A-Za-z0-9_-]+\b/g, '[REDACTED_BOT_TOKEN]')
    .slice(0, 500);
}

function log(event, payload = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...payload
  }));
}

function logError(event, payload = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...payload
  }));
}
