from pathlib import Path

path=Path('worker/collector-webhook.ts')
text=path.read_text(encoding='utf-8')
old="""const MAX_SKEW_MS = 5 * 60_000;
"""
new="""const MAX_SKEW_MS = 5 * 60_000;
const MAX_INTELLIGENCE_ENVELOPE_BYTES = 8 * 1024 * 1024;
const MAX_STANDARD_ENVELOPE_BYTES = 2 * 1024 * 1024;
"""
if old not in text: raise SystemExit('constant anchor missing')
text=text.replace(old,new,1)
old="""  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 2_000_000) throw new Error('Invalid collector payload size');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
"""
new="""  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_INTELLIGENCE_ENVELOPE_BYTES) throw new Error('Invalid collector payload size');
  const rawBody = await request.text();
  const rawBytes = new TextEncoder().encode(rawBody).byteLength;
  if (!rawBody || rawBytes > MAX_INTELLIGENCE_ENVELOPE_BYTES) throw new Error('Invalid collector payload size');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
"""
if old not in text: raise SystemExit('body limit anchor missing')
text=text.replace(old,new,1)
old="""  if (payload.version !== 1 || typeof payload.type !== 'string' || !payload.payload) throw new Error('Unsupported collector payload schema');
  return { rawBody, payload, requestId, timestampMs };
"""
new="""  if (payload.version !== 1 || typeof payload.type !== 'string' || !payload.payload) throw new Error('Unsupported collector payload schema');
  if (payload.type !== 'intelligence-snapshot' && rawBytes > MAX_STANDARD_ENVELOPE_BYTES) throw new Error('Invalid collector payload size');
  return { rawBody, payload, requestId, timestampMs };
"""
if old not in text: raise SystemExit('schema anchor missing')
text=text.replace(old,new,1)
path.write_text(text,encoding='utf-8')
print('Signed webhook payload policy upgraded for chunked intelligence snapshots.')
