import crypto from 'node:crypto';
import http from 'node:http';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const BOT_SECRET_NAME = process.env.TELEGRAM_BOT_TOKEN_SECRET || 'fxga-telegram-bot-token';
const ADMIN_KEY = process.env.FXGA_AGENT_ADMIN_KEY || '';
const secretManager = new SecretManagerServiceClient();
const botSecret = `projects/${PROJECT_ID}/secrets/${BOT_SECRET_NAME}`;
const requestWindows = new Map();

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function authorized(req) {
  const provided = Array.isArray(req.headers['x-fxga-agent-admin-key'])
    ? req.headers['x-fxga-agent-admin-key'][0]
    : req.headers['x-fxga-agent-admin-key'];
  return ADMIN_KEY.length >= 16 && sameSecret(provided, ADMIN_KEY);
}

function rateLimited(req) {
  const key = String(req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 20;
}

async function readJson(req, maxBytes = 8192) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}

async function latestBotToken() {
  if (!PROJECT_ID) throw new Error('GCP_PROJECT_ID is not configured');
  try {
    const [version] = await secretManager.accessSecretVersion({ name: `${botSecret}/versions/latest` });
    return Buffer.from(version.payload?.data || '').toString('utf8').trim();
  } catch (error) {
    const code = Number(error?.code);
    if (code === 5 || /NOT_FOUND|no enabled versions/i.test(String(error?.message || ''))) return '';
    throw error;
  }
}

function validBotTokenFormat(token) {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token);
}

async function testTelegramBot(token) {
  if (!validBotTokenFormat(token)) return { ok: false, error: 'Token format is invalid.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !payload?.result) {
      return { ok: false, error: 'Telegram rejected the bot token.' };
    }
    return {
      ok: true,
      bot: {
        id: String(payload.result.id ?? ''),
        username: String(payload.result.username ?? ''),
        firstName: String(payload.result.first_name ?? ''),
        canJoinGroups: Boolean(payload.result.can_join_groups),
        canReadAllGroupMessages: Boolean(payload.result.can_read_all_group_messages),
        supportsInlineQueries: Boolean(payload.result.supports_inline_queries)
      }
    };
  } catch {
    return { ok: false, error: 'Telegram Bot API could not be reached.' };
  } finally {
    clearTimeout(timer);
  }
}

async function saveBotToken(token) {
  await secretManager.addSecretVersion({
    parent: botSecret,
    payload: { data: Buffer.from(token, 'utf8') }
  });
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FXGA Agents · Telegram Settings</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#07090d;color:#f5f7fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#182033 0,#0a0d14 42%,#05070a 100%);padding:32px}.shell{max-width:860px;margin:auto}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}.eyebrow{letter-spacing:.14em;text-transform:uppercase;color:#aeb8ca;font-size:12px}h1{font-size:clamp(30px,5vw,50px);line-height:1;margin:8px 0 10px}.sub{color:#aeb8ca;max-width:680px}.card{background:rgba(15,19,28,.92);border:1px solid #252d3d;border-radius:18px;padding:22px;box-shadow:0 28px 80px rgba(0,0,0,.35);margin:14px 0}.row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.badge{border:1px solid #344056;border-radius:999px;padding:7px 10px;font-size:12px;color:#c7d1e4}.ok{color:#86efac}.bad{color:#fca5a5}.muted{color:#99a5ba}label{display:block;font-size:13px;color:#b7c1d4;margin:16px 0 7px}input{width:100%;background:#090c12;border:1px solid #30394b;color:#fff;border-radius:11px;padding:13px 14px;outline:none}input:focus{border-color:#7c8fb5}button{border:0;border-radius:11px;padding:12px 16px;font-weight:700;cursor:pointer;background:#f4f7fb;color:#090b0f}button.secondary{background:#1a2130;color:#e7edf8;border:1px solid #30394b}button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.notice{font-size:13px;line-height:1.55;color:#b8c2d5}.status{min-height:24px;margin-top:12px;font-size:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.metric{background:#0b0f17;border:1px solid #242c3b;border-radius:12px;padding:14px}.metric small{display:block;color:#8490a4;margin-bottom:6px}.metric strong{word-break:break-word}@media(max-width:680px){body{padding:18px}.top,.row{display:block}.grid{grid-template-columns:1fr}.badge{display:inline-block;margin-top:12px}}
</style>
</head>
<body><main class="shell">
<div class="top"><div><div class="eyebrow">FX Global Avengers Trading Academy</div><h1>Agents Settings</h1><div class="sub">Telegram Member Agent · secure bot credential control</div></div><span class="badge">Direct-add worker isolated</span></div>
<section class="card"><div class="row"><div><h2>Telegram Bot API</h2><p class="notice">The bot token is stored only in Google Secret Manager. It is never returned to this page. The direct member-add worker does not use this token and cannot fall back to sending invitations or DMs.</p></div><span id="stateBadge" class="badge">Not checked</span></div>
<label for="adminKey">Agent admin key</label><input id="adminKey" type="password" autocomplete="current-password" placeholder="Enter FXGA agent admin key">
<div class="actions"><button class="secondary" id="check">Check bot status</button></div>
<div id="metrics" class="grid" style="margin-top:16px;display:none"><div class="metric"><small>Bot</small><strong id="botName">—</strong></div><div class="metric"><small>Username</small><strong id="botUser">—</strong></div><div class="metric"><small>Bot ID</small><strong id="botId">—</strong></div></div>
</section>
<section class="card"><h2>Replace bot token</h2><p class="notice">Paste a replacement token, then choose <b>Test & save</b>. Telegram's <code>getMe</code> endpoint is checked first; invalid tokens are not saved.</p><label for="token">New Telegram bot token</label><input id="token" type="password" autocomplete="new-password" placeholder="BotFather token"><div class="actions"><button id="save">Test & save</button><button class="secondary" id="clear">Clear field</button></div><div id="status" class="status muted"></div></section>
</main><script>
const $=id=>document.getElementById(id);const headers=()=>({'Content-Type':'application/json','X-FXGA-Agent-Admin-Key':$('adminKey').value});
function show(data){$('stateBadge').textContent=data.configured?(data.valid?'Configured · valid':'Configured · invalid'):'Not configured';$('stateBadge').className='badge '+(data.valid?'ok':data.configured?'bad':'');if(data.bot){$('metrics').style.display='grid';$('botName').textContent=data.bot.firstName||'—';$('botUser').textContent=data.bot.username?'@'+data.bot.username:'—';$('botId').textContent=data.bot.id||'—'}else $('metrics').style.display='none'}
async function call(path,opts={}){const r=await fetch(path,{...opts,headers:{...headers(),...(opts.headers||{})},cache:'no-store'});const data=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
$('check').onclick=async()=>{try{$('status').textContent='Checking…';const data=await call('/api/status');show(data);$('status').textContent=data.valid?'Bot token is working.':'Status checked.'}catch(e){$('status').textContent=e.message}}
$('save').onclick=async()=>{const token=$('token').value.trim();if(!token){$('status').textContent='Enter a bot token first.';return}try{$('save').disabled=true;$('status').textContent='Testing with Telegram…';const data=await call('/api/settings/bot-token',{method:'POST',body:JSON.stringify({token})});$('token').value='';show(data);$('status').textContent='Token verified and stored as the latest Secret Manager version.'}catch(e){$('status').textContent=e.message}finally{$('save').disabled=false}}
$('clear').onclick=()=>{$('token').value='';$('status').textContent=''};
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page(), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'fxga-telegram-member-agent-admin', adminConfigured: ADMIN_KEY.length >= 16, tokenSecret: BOT_SECRET_NAME });
    }
    if (rateLimited(req)) return send(res, 429, { error: 'Too many settings requests. Try again shortly.' });
    if (!ADMIN_KEY || ADMIN_KEY.length < 16) return send(res, 503, { error: 'Agent admin authentication is not configured.' });
    if (!authorized(req)) return send(res, 401, { error: 'Invalid agent admin key.' });

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const token = await latestBotToken();
      if (!token) return send(res, 200, { configured: false, valid: false, bot: null });
      const test = await testTelegramBot(token);
      return send(res, 200, { configured: true, valid: test.ok, bot: test.ok ? test.bot : null });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/bot-token') {
      const body = await readJson(req);
      const token = String(body?.token || '').trim();
      if (!validBotTokenFormat(token)) return send(res, 400, { error: 'Telegram bot token format is invalid.' });
      const test = await testTelegramBot(token);
      if (!test.ok) return send(res, 400, { error: test.error });
      await saveBotToken(token);
      return send(res, 200, { configured: true, valid: true, bot: test.bot });
    }

    return send(res, 404, { error: 'Not found.' });
  } catch (error) {
    const code = String(error?.message || '');
    if (code === 'REQUEST_TOO_LARGE') return send(res, 413, { error: 'Request body is too large.' });
    if (code === 'INVALID_JSON') return send(res, 400, { error: 'Request body must be valid JSON.' });
    console.error(JSON.stringify({ event: 'agent_admin_error', message: 'Administrative request failed without logging credential material.' }));
    return send(res, 500, { error: 'Agent settings operation failed.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'agent_admin_ready', port: PORT, botSecret: BOT_SECRET_NAME, adminConfigured: ADMIN_KEY.length >= 16 }));
});
