import http from 'node:http';
import crypto from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.FXGA_GEMINI_FILE_CONTEXT || 'true'));
const MIN_PROMPT_CHARS = Math.max(2_000, Number(process.env.FXGA_GEMINI_FILE_MIN_CHARS || 8_000));
const FILE_MIME_TYPE = 'text/csv';
const FILE_EXTENSION = 'csv';
const FILE_FORMAT_VERSION = 'fxga-context-csv-v1';
const FILE_UPLOAD_START_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const FILE_METADATA_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const FILE_SAFETY_MARGIN_MS = 20 * 60_000;
const ASSUMED_FILE_LIFETIME_MS = 46 * 60 * 60_000;
const FILE_READY_POLL_MS = Math.max(250, Number(process.env.FXGA_GEMINI_FILE_READY_POLL_MS || 1_000));
const FILE_READY_TIMEOUT_MS = Math.max(5_000, Number(process.env.FXGA_GEMINI_FILE_READY_TIMEOUT_MS || 30_000));
const INTERACTIONS_URL_RE = /^https:\/\/generativelanguage\.googleapis\.com\/v1(?:beta)?\/interactions(?:\?|$)/i;
const STATUS_PATH = '/api/gemini/file-context-status';

const db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
const fileRefs = db.collection('fxga_gemini_file_context');
const telemetryDoc = db.collection('fxga_collector_state').doc('gemini-file-context-transport');
const memoryRefs = new Map();
const inFlightUploads = new Map();
const originalFetch = globalThis.fetch.bind(globalThis);

const metrics = {
  transformed: 0,
  uploaded: 0,
  reusedMemory: 0,
  reusedFirestore: 0,
  inlineFallbacks: 0,
  uploadFailures: 0,
  invalidFileRetries: 0,
  readinessPolls: 0,
  readinessFailures: 0,
  lastMode: 'not-used-yet',
  lastAt: null,
  lastModel: null,
  lastFileBytes: null,
  lastFileHashPrefix: null,
  lastFileState: null,
  lastReuseSource: null,
  lastError: null,
};

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const nowIso = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const contextHash = fileText => sha(`${FILE_FORMAT_VERSION}\n${fileText}`);

function toCsvDocument(fileText) {
  const escaped = String(fileText).replaceAll('"', '""');
  return `context\n"${escaped}"\n`;
}

function safeExpiry(ref = {}) {
  const explicit = Date.parse(String(ref.expirationTime || ''));
  if (Number.isFinite(explicit)) return explicit;
  const created = Date.parse(String(ref.createdAt || ref.createTime || ''));
  return Number.isFinite(created) ? created + ASSUMED_FILE_LIFETIME_MS : 0;
}

function usableRef(ref) {
  return Boolean(
    ref?.uri
    && ref?.name
    && ref?.mimeType === FILE_MIME_TYPE
    && ref?.formatVersion === FILE_FORMAT_VERSION
    && String(ref?.fileState || '').toUpperCase() === 'ACTIVE'
    && safeExpiry(ref) > Date.now() + FILE_SAFETY_MARGIN_MS
  );
}

function publicMetrics(extra = {}) {
  return {
    schema: 'fxga.gemini.file-context.status.v2',
    enabled: ENABLED,
    transport: 'Gemini Files API CSV document -> Interactions API',
    mimeType: FILE_MIME_TYPE,
    formatVersion: FILE_FORMAT_VERSION,
    minimumPromptChars: MIN_PROMPT_CHARS,
    readinessPollMs: FILE_READY_POLL_MS,
    readinessTimeoutMs: FILE_READY_TIMEOUT_MS,
    fileRetention: 'provider-temporary; ACTIVE-state and expiry-aware reuse',
    ...metrics,
    ...extra,
  };
}

async function writeTelemetry(extra = {}) {
  const payload = publicMetrics(extra);
  try {
    await telemetryDoc.set({
      ...payload,
      updatedAt: nowIso(),
      source: 'gemini-file-context.js',
    }, { merge: true });
  } catch {
    // Transport telemetry must never break model inference.
  }
}

function splitFxgaPrompt(prompt) {
  const questionMarker = '\n\nUSER QUESTION\n';
  const evidenceMarker = '\n\nSTRUCTURED FXGA EVIDENCE\n';
  const qIndex = prompt.indexOf(questionMarker);
  const eIndex = prompt.indexOf(evidenceMarker);

  if (qIndex < 0 || eIndex < 0 || eIndex <= qIndex) {
    return {
      fileText: prompt,
      instruction: 'Read the attached FXGA CSV context package completely and follow its instructions. Produce the requested evidence-grounded answer. Do not invent missing evidence.',
      extractedQuestion: false,
    };
  }

  const prefix = prompt.slice(0, qIndex).trimEnd();
  const question = prompt.slice(qIndex + questionMarker.length, eIndex).trim();
  const evidence = prompt.slice(eIndex + evidenceMarker.length);
  const fileText = `${prefix}\n\nSTRUCTURED FXGA EVIDENCE\n${evidence}`;
  const instruction = [
    'Read the attached FXGA CSV context package completely.',
    'The CSV has one context field whose quoted value contains the full FXGA instructions and structured evidence.',
    'Apply every FXGA rule and task-specific instruction contained in that context.',
    'Answer only from the attached evidence; missing evidence must remain missing.',
    `USER QUESTION: ${question}`,
  ].join('\n');
  return { fileText, instruction, extractedQuestion: true };
}

async function readStoredRef(hash) {
  const inMemory = memoryRefs.get(hash);
  if (usableRef(inMemory)) {
    metrics.reusedMemory += 1;
    return { ...inMemory, reuseSource: 'memory' };
  }
  if (inMemory) memoryRefs.delete(hash);

  try {
    const snap = await fileRefs.doc(hash).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!usableRef(data)) return null;
    memoryRefs.set(hash, data);
    metrics.reusedFirestore += 1;
    return { ...data, reuseSource: 'firestore' };
  } catch {
    return null;
  }
}

async function persistRef(hash, ref) {
  memoryRefs.set(hash, ref);
  try {
    await fileRefs.doc(hash).set({
      ...ref,
      hash,
      updatedAt: nowIso(),
      source: 'Gemini Files API',
    }, { merge: false });
  } catch {
    // A Firestore write failure only disables cross-instance reuse; the uploaded file still works.
  }
}

async function invalidateRef(hash) {
  memoryRefs.delete(hash);
  try { await fileRefs.doc(hash).delete(); } catch { }
}

async function fetchFileMetadata(name, apiKey) {
  const fileName = String(name || '').replace(/^\/+/, '');
  if (!fileName) throw new Error('Gemini Files API file name is missing');

  const response = await originalFetch(`${FILE_METADATA_BASE_URL}/${fileName}`, {
    method: 'GET',
    headers: { 'x-goog-api-key': apiKey },
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!response.ok) {
    throw Object.assign(new Error(`Gemini Files API metadata failed (${response.status}) ${raw.slice(0, 300)}`), { statusCode: response.status });
  }
  return payload.file || payload;
}

async function waitForActiveFile(file, apiKey) {
  const name = String(file?.name || '').trim();
  if (!name) throw new Error('Gemini Files API returned no file name for readiness verification');

  let current = file;
  const deadline = Date.now() + FILE_READY_TIMEOUT_MS;
  while (true) {
    const state = String(current?.state || '').toUpperCase();
    if (state === 'ACTIVE') return current;
    if (state === 'FAILED') {
      metrics.readinessFailures += 1;
      const reason = current?.error?.message || current?.error?.status || 'provider processing failed';
      throw new Error(`Gemini Files API file processing failed: ${reason}`);
    }
    if (Date.now() >= deadline) {
      metrics.readinessFailures += 1;
      throw new Error(`Gemini Files API file readiness timed out after ${FILE_READY_TIMEOUT_MS}ms; state=${state || 'unknown'}`);
    }

    metrics.readinessPolls += 1;
    await sleep(FILE_READY_POLL_MS);
    current = await fetchFileMetadata(name, apiKey);
  }
}

async function uploadCsvFile(fileText, hash, apiKey) {
  const csvText = toCsvDocument(fileText);
  const bytes = Buffer.from(csvText, 'utf8');
  const displayName = `fxga-context-${hash.slice(0, 16)}.${FILE_EXTENSION}`;

  const start = await originalFetch(FILE_UPLOAD_START_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': FILE_MIME_TYPE,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });

  if (!start.ok) {
    const text = await start.text().catch(() => '');
    throw Object.assign(new Error(`Gemini Files API upload start failed (${start.status}) ${text.slice(0, 300)}`), { statusCode: start.status });
  }

  const uploadUrl = String(start.headers.get('x-goog-upload-url') || '').trim();
  if (!uploadUrl) throw new Error('Gemini Files API did not return an upload URL');

  const finish = await originalFetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'Content-Type': FILE_MIME_TYPE,
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });

  const raw = await finish.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!finish.ok) throw Object.assign(new Error(`Gemini Files API upload finalize failed (${finish.status}) ${raw.slice(0, 300)}`), { statusCode: finish.status });

  const uploadedFile = payload.file || payload;
  const name = String(uploadedFile.name || '').trim();
  if (!name) throw new Error('Gemini Files API returned no usable file name');

  const activeFile = await waitForActiveFile(uploadedFile, apiKey);
  const uri = String(activeFile.uri || uploadedFile.uri || '').trim();
  if (!uri) throw new Error('Gemini Files API ACTIVE file returned no usable URI');

  const ref = {
    uri,
    name: String(activeFile.name || name),
    mimeType: String(activeFile.mimeType || activeFile.mime_type || uploadedFile.mimeType || uploadedFile.mime_type || FILE_MIME_TYPE),
    sizeBytes: Number(activeFile.sizeBytes || uploadedFile.sizeBytes || bytes.length),
    sourceTextBytes: Buffer.byteLength(fileText, 'utf8'),
    createdAt: String(activeFile.createTime || uploadedFile.createTime || nowIso()),
    expirationTime: String(activeFile.expirationTime || uploadedFile.expirationTime || new Date(Date.now() + ASSUMED_FILE_LIFETIME_MS).toISOString()),
    displayName: String(activeFile.displayName || uploadedFile.displayName || displayName),
    fileState: String(activeFile.state || 'ACTIVE').toUpperCase(),
    formatVersion: FILE_FORMAT_VERSION,
  };

  if (!usableRef(ref)) throw new Error('Gemini Files API produced a file reference that is not safe for reuse');
  metrics.uploaded += 1;
  await persistRef(hash, ref);
  return { ...ref, reuseSource: 'new-upload' };
}

async function getOrCreateFile(fileText, apiKey) {
  const hash = contextHash(fileText);
  const existing = await readStoredRef(hash);
  if (existing) return { hash, ref: existing };

  if (inFlightUploads.has(hash)) return { hash, ref: await inFlightUploads.get(hash) };
  const promise = uploadCsvFile(fileText, hash, apiKey);
  inFlightUploads.set(hash, promise);
  try { return { hash, ref: await promise }; }
  finally { inFlightUploads.delete(hash); }
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

function isFileInputFailure(status, text) {
  if (![400, 404, 415, 422].includes(Number(status))) return false;
  return /file|document|uri|mime|media|expired|not found|invalid.*input/i.test(String(text || ''));
}

async function transformedFetch(input, init = undefined) {
  const url = requestUrl(input);
  if (!ENABLED || !INTERACTIONS_URL_RE.test(url) || !init || String(init.method || 'GET').toUpperCase() !== 'POST') {
    return originalFetch(input, init);
  }

  let body;
  try { body = JSON.parse(String(init.body || '')); }
  catch { return originalFetch(input, init); }

  if (typeof body?.input !== 'string' || body.input.length < MIN_PROMPT_CHARS) return originalFetch(input, init);

  const headers = new Headers(init.headers || {});
  const apiKey = String(headers.get('x-goog-api-key') || GEMINI_API_KEY || '').trim();
  if (!apiKey) return originalFetch(input, init);

  const originalBody = init.body;
  const { fileText, instruction, extractedQuestion } = splitFxgaPrompt(body.input);
  let hash = null;
  let ref = null;

  try {
    const file = await getOrCreateFile(fileText, apiKey);
    hash = file.hash;
    ref = file.ref;
    const replacement = {
      ...body,
      input: [
        { type: 'document', uri: ref.uri, mime_type: FILE_MIME_TYPE },
        { type: 'text', text: instruction },
      ],
    };

    metrics.transformed += 1;
    metrics.lastMode = 'file';
    metrics.lastAt = nowIso();
    metrics.lastModel = String(body.model || '');
    metrics.lastFileBytes = Buffer.byteLength(fileText, 'utf8');
    metrics.lastFileHashPrefix = hash.slice(0, 16);
    metrics.lastFileState = ref.fileState || 'ACTIVE';
    metrics.lastReuseSource = ref.reuseSource || null;
    metrics.lastError = null;
    await writeTelemetry({ extractedQuestion });

    const response = await originalFetch(input, { ...init, body: JSON.stringify(replacement) });
    if (response.ok) return response;

    if ([400, 404, 415, 422].includes(response.status)) {
      const cloneText = await response.clone().text().catch(() => '');
      if (isFileInputFailure(response.status, cloneText)) {
        metrics.invalidFileRetries += 1;
        metrics.inlineFallbacks += 1;
        metrics.lastMode = 'inline-after-file-rejection';
        metrics.lastError = `file input rejected HTTP ${response.status}: ${cloneText.slice(0, 200)}`;
        await invalidateRef(hash);
        await writeTelemetry();
        return originalFetch(input, { ...init, body: originalBody });
      }
    }
    return response;
  } catch (error) {
    metrics.uploadFailures += 1;
    metrics.inlineFallbacks += 1;
    metrics.lastMode = 'inline-after-upload-failure';
    metrics.lastAt = nowIso();
    metrics.lastModel = String(body.model || '');
    metrics.lastFileBytes = Buffer.byteLength(fileText, 'utf8');
    metrics.lastFileHashPrefix = hash ? hash.slice(0, 16) : contextHash(fileText).slice(0, 16);
    metrics.lastFileState = ref?.fileState || null;
    metrics.lastReuseSource = null;
    metrics.lastError = String(error?.message || error).slice(0, 500);
    await writeTelemetry();
    return originalFetch(input, { ...init, body: originalBody });
  }
}

globalThis.fetch = transformedFetch;

async function handleStatus(req, res) {
  let stored = null;
  try {
    const snap = await telemetryDoc.get();
    if (snap.exists) stored = snap.data();
  } catch { }
  const payload = publicMetrics(stored ? {
    persistedLastMode: stored.lastMode || null,
    persistedLastAt: stored.lastAt || stored.updatedAt || null,
    persistedLastModel: stored.lastModel || null,
    persistedLastFileBytes: stored.lastFileBytes || null,
    persistedLastFileHashPrefix: stored.lastFileHashPrefix || null,
    persistedLastFileState: stored.lastFileState || null,
    persistedLastReuseSource: stored.lastReuseSource || null,
    persistedLastError: stored.lastError || null,
  } : {});
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function fxgaFileContextCreateServer(options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const serverOptions = typeof options === 'function' ? undefined : options;
  const wrapped = async (req, res) => {
    let pathname = '';
    try { pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname; } catch { }
    if (pathname === STATUS_PATH && req.method === 'GET') return handleStatus(req, res);
    return listener(req, res);
  };
  return serverOptions === undefined ? originalCreateServer(wrapped) : originalCreateServer(serverOptions, wrapped);
};

console.log('FXGA Gemini one-file context transport loaded', {
  enabled: ENABLED,
  minimumPromptChars: MIN_PROMPT_CHARS,
  mimeType: FILE_MIME_TYPE,
  formatVersion: FILE_FORMAT_VERSION,
  readinessPollMs: FILE_READY_POLL_MS,
  readinessTimeoutMs: FILE_READY_TIMEOUT_MS,
  uploadApi: 'Gemini Files API v1beta',
  inferenceApi: 'Interactions API v1/v1beta compatible',
  crossInstanceReuse: 'Firestore metadata; ACTIVE-state and format-version guarded',
  inlineSafetyFallback: true,
  statusRoute: STATUS_PATH,
});
