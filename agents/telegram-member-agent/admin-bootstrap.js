import http from 'node:http';

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const INTERNAL_PORT = PUBLIC_PORT + 1;
const requestLimit = 2_700_000;
let coreReady = false;
let coreError = '';
let bootStartedAt = new Date().toISOString();

process.env.PORT = String(INTERNAL_PORT);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > requestLimit) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    return json(res, coreReady ? 200 : 503, {
      ok: coreReady,
      service: 'fxga-telegram-member-agent-admin',
      authMode: 'fxga-super-admin-session',
      coreReady,
      bootStartedAt,
      error: coreError || null
    });
  }

  if (!coreReady) {
    return json(res, 503, {
      error: coreError ? 'agent_admin_core_failed' : 'agent_admin_core_starting',
      message: coreError || 'Telegram Agent controller is starting.'
    });
  }

  try {
    const body = await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null || key.toLowerCase() === 'host' || key.toLowerCase() === 'content-length') continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    const response = await fetch(`http://127.0.0.1:${INTERNAL_PORT}${req.url || '/'}`, {
      method: req.method,
      headers,
      body,
      redirect: 'manual'
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const outHeaders = Object.fromEntries(response.headers.entries());
    outHeaders['content-length'] = String(bytes.length);
    res.writeHead(response.status, outHeaders);
    res.end(bytes);
  } catch (error) {
    if (String(error?.message || '') === 'REQUEST_TOO_LARGE') return json(res, 413, { error: 'Request body is too large.' });
    return json(res, 502, { error: 'agent_admin_proxy_failed' });
  }
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'agent_admin_bootstrap_ready', publicPort: PUBLIC_PORT, internalPort: INTERNAL_PORT }));
  import('./admin-server.js')
    .then(() => {
      coreReady = true;
      console.log(JSON.stringify({ event: 'agent_admin_core_loaded', internalPort: INTERNAL_PORT }));
    })
    .catch(error => {
      coreError = String(error?.stack || error?.message || error).slice(0, 2000);
      console.error(JSON.stringify({ event: 'agent_admin_core_failed', message: coreError }));
    });
});
