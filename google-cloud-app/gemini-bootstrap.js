const PROJECT_ID = String(process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '').trim();
const SECRET_NAME = String(process.env.GEMINI_SECRET_NAME || 'gemini-api-key').trim();
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

async function timedFetch(url, init = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function loadFromSecretManager() {
  if (!PROJECT_ID || !SECRET_NAME) return { key: '', source: 'unconfigured', reason: 'project-or-secret-name-missing' };

  const tokenResponse = await timedFetch(METADATA_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google', Accept: 'application/json' },
  });
  if (!tokenResponse.ok) return { key: '', source: 'unconfigured', reason: `metadata-token-http-${tokenResponse.status}` };
  const tokenPayload = await tokenResponse.json();
  const accessToken = String(tokenPayload?.access_token || '').trim();
  if (!accessToken) return { key: '', source: 'unconfigured', reason: 'metadata-token-empty' };

  const secretUrl = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/secrets/${encodeURIComponent(SECRET_NAME)}/versions/latest:access`;
  const secretResponse = await timedFetch(secretUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!secretResponse.ok) return { key: '', source: 'unconfigured', reason: `secret-manager-http-${secretResponse.status}` };
  const secretPayload = await secretResponse.json();
  const encoded = String(secretPayload?.payload?.data || '').trim();
  if (!encoded) return { key: '', source: 'unconfigured', reason: 'secret-version-empty' };

  const key = Buffer.from(encoded, 'base64').toString('utf8').trim();
  return key ? { key, source: 'google-secret-manager', reason: null } : { key: '', source: 'unconfigured', reason: 'decoded-secret-empty' };
}

const existing = String(process.env.GEMINI_API_KEY || '').trim();
let status = { configured: Boolean(existing), source: existing ? 'cloud-run-secret-env' : 'unconfigured', reason: null };

if (!existing) {
  try {
    const resolved = await loadFromSecretManager();
    if (resolved.key) process.env.GEMINI_API_KEY = resolved.key;
    status = { configured: Boolean(resolved.key), source: resolved.source, reason: resolved.reason };
  } catch (error) {
    status = {
      configured: false,
      source: 'unconfigured',
      reason: error?.name === 'AbortError' ? 'secret-resolution-timeout' : 'secret-resolution-failed',
    };
  }
}

process.env.FXGA_GEMINI_CREDENTIAL_SOURCE = status.source;
process.env.FXGA_GEMINI_CREDENTIAL_STATUS = status.configured ? 'configured' : 'unconfigured';
if (status.reason) process.env.FXGA_GEMINI_CREDENTIAL_REASON = status.reason;

console.log('FXGA Gemini credential bootstrap', {
  configured: status.configured,
  source: status.source,
  reason: status.reason,
  secretName: SECRET_NAME,
  secretValueLogged: false,
});
