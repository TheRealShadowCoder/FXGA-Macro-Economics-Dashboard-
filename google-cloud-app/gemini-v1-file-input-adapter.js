// Stable Gemini Interactions API v1 expects multimodal/file content arrays to be
// carried by a user_input step. The v1beta API accepts the raw content array shown
// in many Files API examples. Keep the rest of FXGA on stable v1 while normalizing
// only file-backed requests before they reach Google.

const STABLE_INTERACTIONS_RE = /^https:\/\/generativelanguage\.googleapis\.com\/v1\/interactions(?:\?|$)/i;
const CONTENT_TYPES = new Set(['text', 'document', 'image', 'audio', 'video']);
const originalFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

function needsStableContentWrapper(body) {
  if (!Array.isArray(body?.input) || body.input.length === 0) return false;
  if (!body.input.some(item => item?.type === 'document')) return false;
  return body.input.every(item => item && CONTENT_TYPES.has(String(item.type || '')));
}

async function stableV1FileAdapter(input, init = undefined) {
  const url = requestUrl(input);
  if (!STABLE_INTERACTIONS_RE.test(url) || !init || String(init.method || 'GET').toUpperCase() !== 'POST') {
    return originalFetch(input, init);
  }

  let body;
  try { body = JSON.parse(String(init.body || '')); }
  catch { return originalFetch(input, init); }

  if (!needsStableContentWrapper(body)) return originalFetch(input, init);

  const wrapped = {
    ...body,
    input: [{
      type: 'user_input',
      content: body.input,
    }],
  };

  return originalFetch(input, { ...init, body: JSON.stringify(wrapped) });
}

globalThis.fetch = stableV1FileAdapter;

console.log('FXGA Gemini stable-v1 file input adapter loaded', {
  scope: 'v1/interactions file-backed content arrays only',
  schema: 'user_input.content',
});
