import { Firestore } from '@google-cloud/firestore';
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

const apiId = Number(required('TELEGRAM_API_ID'));
const apiHash = required('TELEGRAM_API_HASH');
const session = required('TELEGRAM_SESSION');
const channel = required('TELEGRAM_CHANNEL');
if (!Number.isSafeInteger(apiId) || apiId <= 0) throw new Error('TELEGRAM_API_ID must be a positive integer');

const queueCollection = process.env.FIRESTORE_QUEUE_COLLECTION || 'telegram_member_queue';
const stateCollection = process.env.FIRESTORE_STATE_COLLECTION || 'agent_state';
const stateDocument = process.env.FIRESTORE_STATE_DOCUMENT || 'telegram-member-agent';
const db = new Firestore();
const [queueProbe, stateSnap] = await Promise.all([
  db.collection(queueCollection).limit(1).get(),
  db.collection(stateCollection).doc(stateDocument).get()
]);
if (queueProbe.empty) throw new Error('TELEGRAM_MEMBER_QUEUE_EMPTY');
const state = stateSnap.exists ? stateSnap.data() : {};

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
try {
  await client.connect();
  if (!(await client.checkAuthorization())) throw new Error('TELEGRAM_SESSION_NOT_AUTHORIZED');
  const peer = await client.getInputEntity(channel);
  const isChannel = peer instanceof Api.InputPeerChannel || peer instanceof Api.InputChannel;
  if (!isChannel) throw new Error('TELEGRAM_CHANNEL_NOT_CHANNEL_OR_SUPERGROUP');
  console.log(JSON.stringify({
    ok: true,
    queueReady: true,
    queueRecordCount: Number(state.queueRecordCount || 0) || null,
    sessionAuthorized: true,
    channelResolved: true,
    directAddOnly: true
  }));
} finally {
  try { await client.disconnect(); } catch {}
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}
