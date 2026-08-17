const MAX_SKEW_MS = 5 * 60_000;

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

export async function verifyCollectorWebhook(request: Request, secret: string) {
  const timestamp = request.headers.get('X-FXGA-Timestamp')?.trim() ?? '';
  const requestId = request.headers.get('X-FXGA-Request-Id')?.trim() ?? '';
  const signature = request.headers.get('X-FXGA-Signature')?.trim() ?? '';
  const timestampMs = Number(timestamp);
  if (!timestamp || !requestId || !signature.startsWith('sha256=')) throw new Error('Missing collector authentication headers');
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_SKEW_MS) throw new Error('Collector webhook timestamp is stale');
  if (!/^[0-9a-f-]{16,80}$/i.test(requestId)) throw new Error('Invalid collector request ID');

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 2_000_000) throw new Error('Invalid collector payload size');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${requestId}.${rawBody}`));
  const expected = `sha256=${hex(digest)}`;
  if (!constantTimeEqual(expected, signature.toLowerCase())) throw new Error('Invalid collector webhook signature');

  let payload: Record<string, any>;
  try { payload = JSON.parse(rawBody) as Record<string, any>; }
  catch { throw new Error('Collector webhook body is not valid JSON'); }
  if (payload.version !== 1 || typeof payload.type !== 'string' || !payload.payload) throw new Error('Unsupported collector payload schema');
  return { rawBody, payload, requestId, timestampMs };
}
