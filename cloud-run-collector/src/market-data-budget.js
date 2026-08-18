import { Firestore } from '@google-cloud/firestore';

const db = new Firestore({ ignoreUndefinedProperties:true });
const budgets = db.collection('fxga_market_data_budgets');

const MB = 1024 * 1024;

export const FREE_TIER_POLICIES = Object.freeze({
  alpha_vantage: Object.freeze({
    label:'Alpha Vantage',
    credentialEnv:'ALPHA_VANTAGE_API_KEY',
    role:'scarce FX cross-check and slow reference feed',
    documented:{ day:25 },
    enforced:{ day:18 },
    reserveNote:'Keeps 7 calls/day unused as an emergency reserve.',
  }),
  twelve_data: Object.freeze({
    label:'Twelve Data',
    credentialEnv:'TWELVE_DATA_API_KEY',
    role:'primary free-tier FX quote cross-check',
    documented:{ minute:8, day:800 },
    enforced:{ minute:6, day:600 },
    reserveNote:'Leaves 25% of minute and daily credits unused.',
  }),
  finnhub: Object.freeze({
    label:'Finnhub',
    credentialEnv:'FINNHUB_API_KEY',
    role:'US risk-proxy quote validation and market context',
    documented:{ second:30, minute:60 },
    enforced:{ second:10, minute:45 },
    reserveNote:'Conservative envelope below both documented second and minute limits.',
  }),
  marketstack: Object.freeze({
    label:'Marketstack',
    credentialEnv:'MARKETSTACK_API_KEY',
    role:'scarce end-of-day equity validation',
    documented:{ month:100 },
    enforced:{ month:70 },
    reserveNote:'30 monthly calls are deliberately never scheduled.',
  }),
  fmp: Object.freeze({
    label:'Financial Modeling Prep',
    credentialEnv:'FMP_API_KEY',
    role:'batched cross-asset quotes and reference data',
    documented:{ day:250, rolling30dBytes:500 * MB },
    enforced:{ day:160, rolling30dBytes:300 * MB },
    reserveNote:'Request count and trailing-30-day bandwidth are both hard-gated.',
  }),
  nasdaq_data_link: Object.freeze({
    label:'Nasdaq Data Link',
    credentialEnv:'NASDAQ_DATA_LINK_API_KEY',
    role:'high-capacity historical and table research, activated per dataset',
    documented:{ second:30, tenMinute:2000, day:50000, concurrency:1 },
    enforced:{ second:10, minute:100, day:10000, concurrency:1 },
    reserveNote:'The local envelope is intentionally far below Nasdaq authenticated-table limits.',
  }),
  bybit_public: Object.freeze({
    label:'Bybit public market data',
    credentialEnv:null,
    role:'high-frequency public derivatives and L2 microstructure',
    documented:{ fiveSecond:600 },
    enforced:{ second:20 },
    reserveNote:'100 requests/5s maximum at the FXGA governor, far below the public 600/5s IP ceiling.',
  }),
  deribit_public: Object.freeze({
    label:'Deribit public market data',
    credentialEnv:null,
    role:'public derivatives, volatility and options-market context',
    documented:{ publicIp:'dynamic', authenticatedNonMatchingPerSecond:20 },
    enforced:{ second:2 },
    reserveNote:'Public unauthenticated traffic is held to only 2 requests/s because the public IP allowance is dynamic.',
  }),
});

function utcKey(kind, now = new Date()) {
  const iso = now.toISOString();
  if (kind === 'second') return iso.slice(0,19);
  if (kind === 'minute') return iso.slice(0,16);
  if (kind === 'day') return iso.slice(0,10);
  if (kind === 'month') return iso.slice(0,7);
  return iso;
}

function normalizeBuckets(data = {}, now = new Date()) {
  const current = data.buckets && typeof data.buckets === 'object' ? data.buckets : {};
  const output = {};
  for (const kind of ['second','minute','day','month']) {
    const key = utcKey(kind, now);
    const previous = current[kind];
    output[kind] = previous?.key === key ? { key, used:Number(previous.used || 0) } : { key, used:0 };
  }
  return output;
}

function pruneDailyBytes(dailyBytes = {}, now = Date.now()) {
  const cutoff = now - 31 * 86_400_000;
  const output = {};
  for (const [day, bytes] of Object.entries(dailyBytes || {})) {
    const time = Date.parse(`${day}T00:00:00Z`);
    if (Number.isFinite(time) && time >= cutoff) output[day] = Math.max(0, Number(bytes || 0));
  }
  return output;
}

function rolling30dBytes(dailyBytes = {}, now = Date.now()) {
  const cutoff = now - 30 * 86_400_000;
  let total = 0;
  for (const [day, bytes] of Object.entries(dailyBytes || {})) {
    const time = Date.parse(`${day}T00:00:00Z`);
    if (Number.isFinite(time) && time >= cutoff) total += Math.max(0, Number(bytes || 0));
  }
  return total;
}

function configured(policy) {
  return !policy.credentialEnv || Boolean(String(process.env[policy.credentialEnv] || '').trim());
}

function publicPolicy(policy) {
  return {
    label:policy.label,
    role:policy.role,
    credentialEnv:policy.credentialEnv,
    configured:configured(policy),
    documented:policy.documented,
    enforced:policy.enforced,
    reserveNote:policy.reserveNote,
  };
}

export function freeTierPolicySummary() {
  return Object.fromEntries(Object.entries(FREE_TIER_POLICIES).map(([id,policy]) => [id, publicPolicy(policy)]));
}

async function reserve(provider, { cost=1, taskKey='', ttlMs=0 } = {}) {
  const policy = FREE_TIER_POLICIES[provider];
  if (!policy) return { ok:false, reason:'unknown-provider' };
  if (!configured(policy)) return { ok:false, reason:'credential-not-configured' };
  const amount = Math.max(1, Number(cost || 1));
  const now = new Date();
  const ref = budgets.doc(provider);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const tasks = data?.tasks && typeof data.tasks === 'object' ? { ...data.tasks } : {};
    if (taskKey && ttlMs > 0) {
      const last = Date.parse(tasks[taskKey]?.lastSuccessAt || '');
      if (Number.isFinite(last) && now.getTime() - last < ttlMs) {
        return { ok:false, reason:'fresh-cache', nextEligibleAt:new Date(last + ttlMs).toISOString() };
      }
    }
    const buckets = normalizeBuckets(data, now);
    for (const kind of ['second','minute','day','month']) {
      const cap = Number(policy.enforced?.[kind]);
      if (Number.isFinite(cap) && buckets[kind].used + amount > cap) {
        return { ok:false, reason:`${kind}-budget-exhausted`, cap, used:buckets[kind].used, requested:amount };
      }
    }
    const dailyBytes = pruneDailyBytes(data?.dailyBytes || {}, now.getTime());
    const bandwidthCap = Number(policy.enforced?.rolling30dBytes);
    const rollingBytes = rolling30dBytes(dailyBytes, now.getTime());
    if (Number.isFinite(bandwidthCap) && rollingBytes >= bandwidthCap) {
      return { ok:false, reason:'rolling-30d-bandwidth-budget-exhausted', capBytes:bandwidthCap, usedBytes:rollingBytes };
    }
    for (const kind of ['second','minute','day','month']) {
      if (Number.isFinite(Number(policy.enforced?.[kind]))) buckets[kind].used += amount;
    }
    const next = {
      provider,
      label:policy.label,
      policyVersion:1,
      updatedAt:now.toISOString(),
      buckets,
      dailyBytes,
      callsReserved:Number(data?.callsReserved || 0) + amount,
      successes:Number(data?.successes || 0),
      failures:Number(data?.failures || 0),
      rateLimited:Number(data?.rateLimited || 0),
      lastAttemptAt:now.toISOString(),
      lastSuccessAt:data?.lastSuccessAt || null,
      lastFailureAt:data?.lastFailureAt || null,
      lastStatus:data?.lastStatus || null,
      lastError:data?.lastError || null,
      cooldownUntil:data?.cooldownUntil || null,
      tasks,
    };
    const cooldownUntil = Date.parse(next.cooldownUntil || '');
    if (Number.isFinite(cooldownUntil) && cooldownUntil > now.getTime()) {
      return { ok:false, reason:'provider-cooldown', cooldownUntil:next.cooldownUntil };
    }
    tx.set(ref, next, { merge:false });
    return { ok:true, provider, cost:amount, rolling30dBytes:rollingBytes };
  });
}

async function recordResult(provider, { ok, status=null, bytes=0, error='', taskKey='' } = {}) {
  const policy = FREE_TIER_POLICIES[provider];
  if (!policy) return;
  const now = new Date();
  const ref = budgets.doc(provider);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const dailyBytes = pruneDailyBytes(data?.dailyBytes || {}, now.getTime());
    const day = utcKey('day', now);
    dailyBytes[day] = Number(dailyBytes[day] || 0) + Math.max(0, Number(bytes || 0));
    const tasks = data?.tasks && typeof data.tasks === 'object' ? { ...data.tasks } : {};
    if (taskKey) {
      tasks[taskKey] = {
        ...(tasks[taskKey] || {}),
        lastAttemptAt:now.toISOString(),
        ...(ok ? { lastSuccessAt:now.toISOString() } : { lastFailureAt:now.toISOString() }),
      };
    }
    const wasRateLimited = Number(status) === 429 || /rate.?limit|too many|10028|10006/i.test(String(error || ''));
    const cooldownMs = wasRateLimited ? 15 * 60_000 : 0;
    tx.set(ref, {
      ...data,
      provider,
      label:policy.label,
      updatedAt:now.toISOString(),
      dailyBytes,
      tasks,
      successes:Number(data?.successes || 0) + (ok ? 1 : 0),
      failures:Number(data?.failures || 0) + (ok ? 0 : 1),
      rateLimited:Number(data?.rateLimited || 0) + (wasRateLimited ? 1 : 0),
      lastStatus:status,
      lastError:ok ? null : String(error || `HTTP ${status || 'error'}`).slice(0,240),
      lastSuccessAt:ok ? now.toISOString() : (data?.lastSuccessAt || null),
      lastFailureAt:ok ? (data?.lastFailureAt || null) : now.toISOString(),
      cooldownUntil:cooldownMs ? new Date(now.getTime() + cooldownMs).toISOString() : (data?.cooldownUntil || null),
    }, { merge:false });
  });
}

export async function budgetedJson(provider, url, {
  cost=1,
  taskKey='',
  ttlMs=0,
  timeoutMs=8000,
  maxResponseBytes=2 * MB,
  headers={},
} = {}) {
  const admission = await reserve(provider, { cost, taskKey, ttlMs });
  if (!admission.ok) return { ok:false, skipped:true, provider, reason:admission.reason, admission };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, {
      headers:{ Accept:'application/json', 'User-Agent':'FXGA-Free-Tier-Market-Router/1.0', ...headers },
      signal:controller.signal,
      redirect:'follow',
    });
    const announced = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(announced) && announced > maxResponseBytes) {
      await recordResult(provider, { ok:false, status:response.status, bytes:0, error:'response-too-large', taskKey });
      return { ok:false, provider, status:response.status, error:'response-too-large' };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxResponseBytes) {
      await recordResult(provider, { ok:false, status:response.status, bytes:bytes.length, error:'response-too-large', taskKey });
      return { ok:false, provider, status:response.status, error:'response-too-large' };
    }
    const text = bytes.toString('utf8');
    if (!response.ok) {
      await recordResult(provider, { ok:false, status:response.status, bytes:bytes.length, error:text.slice(0,240), taskKey });
      return { ok:false, provider, status:response.status, error:text.slice(0,240) };
    }
    let data;
    try { data = JSON.parse(text); }
    catch (error) {
      await recordResult(provider, { ok:false, status:response.status, bytes:bytes.length, error:'invalid-json', taskKey });
      return { ok:false, provider, status:response.status, error:'invalid-json' };
    }
    await recordResult(provider, { ok:true, status:response.status, bytes:bytes.length, taskKey });
    return { ok:true, provider, status:response.status, bytes:bytes.length, data };
  } catch (error) {
    const message = String(error?.message || error).slice(0,240);
    await recordResult(provider, { ok:false, status:null, bytes:0, error:message, taskKey }).catch(()=>{});
    return { ok:false, provider, error:message };
  } finally {
    clearTimeout(timer);
  }
}

export async function freeTierBudgetStatus() {
  const result = {};
  for (const [provider, policy] of Object.entries(FREE_TIER_POLICIES)) {
    const snap = await budgets.doc(provider).get();
    const data = snap.exists ? snap.data() : {};
    const buckets = normalizeBuckets(data, new Date());
    const dailyBytes = pruneDailyBytes(data?.dailyBytes || {});
    const used30d = rolling30dBytes(dailyBytes);
    result[provider] = {
      ...publicPolicy(policy),
      usage:{
        second:buckets.second.used,
        minute:buckets.minute.used,
        day:buckets.day.used,
        month:buckets.month.used,
        rolling30dBytes:used30d,
      },
      lastSuccessAt:data?.lastSuccessAt || null,
      lastFailureAt:data?.lastFailureAt || null,
      lastStatus:data?.lastStatus ?? null,
      cooldownUntil:data?.cooldownUntil || null,
      rateLimited:Number(data?.rateLimited || 0),
    };
  }
  return { generatedAt:new Date().toISOString(), policy:'hard local budgets below provider free-tier ceilings', providers:result };
}
