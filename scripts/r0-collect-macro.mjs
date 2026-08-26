import { FRED_BASE_IDS } from '../cloud-run-collector/src/global-fred.js';

const apiBase = String(process.env.FXGA_API_BASE || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/+$/, '');
const token = String(process.env.FXGA_INGEST_TOKEN || process.env.FXGA_MT5_REPORT_SECRET || '').trim();
const fredKey = String(process.env.FRED_API_KEY || '').trim();

if (!token) throw new Error('FXGA_INGEST_TOKEN or FXGA_MT5_REPORT_SECRET is required under repository Actions secrets.');
if (!fredKey) throw new Error('FRED_API_KEY is required under repository Actions secrets for the free macro collector.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finite = (value) => {
  if (value == null || value === '' || value === '.') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

async function fetchFredSeries(seriesId) {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', fredKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '3');

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'fxga-r0-macro-collector/1.0' } });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`FRED HTTP ${response.status}`);
        await sleep(400 * (2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error(`FRED ${seriesId} HTTP ${response.status}`);
      const payload = await response.json();
      const observations = (Array.isArray(payload?.observations) ? payload.observations : [])
        .map((row) => ({ date: row?.date || null, value: finite(row?.value), realtimeStart: row?.realtime_start || null, realtimeEnd: row?.realtime_end || null }))
        .filter((row) => row.value != null);
      const latest = observations[0] || null;
      const previous = observations[1] || null;
      return {
        seriesId,
        ok: Boolean(latest),
        latest,
        previous,
        change: latest && previous ? latest.value - previous.value : null,
        changePercent: latest && previous && Math.abs(previous.value) > 1e-12 ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100 : null,
        source: 'Federal Reserve Bank of St. Louis FRED',
        sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(300 * (2 ** attempt));
    }
  }
  return { seriesId, ok: false, error: String(lastError?.message || lastError || 'unknown FRED error').slice(0, 240) };
}

async function pooled(items, concurrency, task) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      output[index] = await task(items[index]);
      await sleep(40);
    }
  });
  await Promise.all(workers);
  return output;
}

async function writeState(name, payload) {
  const response = await fetch(`${apiBase}/api/internal/state/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'fxga-r0-github-actions-macro/1.0' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data?.ok !== true) throw new Error(`D1 state write failed: HTTP ${response.status} ${JSON.stringify(data).slice(0, 800)}`);
  return data;
}

const generatedAt = new Date().toISOString();
const uniqueSeries = [...new Set(FRED_BASE_IDS)];
const results = await pooled(uniqueSeries, 6, fetchFredSeries);
const healthy = results.filter((row) => row?.ok);
const failed = results.filter((row) => !row?.ok);

const macro = {
  schema: 'fxga.r0.macro-fred.v1',
  generatedAt,
  provider: 'FRED',
  source: 'Federal Reserve Bank of St. Louis',
  requested: uniqueSeries.length,
  healthy: healthy.length,
  failed: failed.length,
  coverageRatio: uniqueSeries.length ? healthy.length / uniqueSeries.length : 0,
  series: Object.fromEntries(results.map((row) => [row.seriesId, row])),
  failures: failed.map((row) => ({ seriesId: row.seriesId, error: row.error || 'no usable observation' })),
  collector: 'github-actions-r0',
};

await writeState('macro', macro);

console.log(JSON.stringify({
  ok: true,
  architecture: 'github-actions-fred-to-cloudflare-d1',
  generatedAt,
  requested: uniqueSeries.length,
  healthy: healthy.length,
  failed: failed.length,
  coverageRatio: macro.coverageRatio,
}, null, 2));
