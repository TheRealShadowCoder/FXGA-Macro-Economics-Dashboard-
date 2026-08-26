import { collectFreeTierMarketData } from '../cloud-run-collector/src/free-market-data-v2.js';

const apiBase = String(process.env.FXGA_API_BASE || 'https://fxga-macro-intelligence-dashboard.caramel-snapper.workers.dev').replace(/\/+$/, '');
const token = String(process.env.FXGA_INGEST_TOKEN || process.env.FXGA_MT5_REPORT_SECRET || '').trim();

if (!token) {
  throw new Error('FXGA_INGEST_TOKEN or FXGA_MT5_REPORT_SECRET is required for the R0 collector. Add one under repository Actions secrets.');
}

async function writeState(name, payload) {
  const response = await fetch(`${apiBase}/api/internal/state/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'fxga-r0-github-actions-collector/1.0',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || data?.ok !== true) {
    throw new Error(`D1 state write failed for ${name}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data;
}

const startedAt = new Date().toISOString();
const snapshot = await collectFreeTierMarketData();
const completedAt = new Date().toISOString();

const market = {
  ...snapshot,
  collector: 'github-actions-r0',
  startedAt,
  completedAt,
};

const technical = {
  schema: 'fxga.r0.technical-market-context.v1',
  generatedAt: snapshot?.generatedAt || completedAt,
  canonicalFx: snapshot?.canonicalFx || [],
  slowFxCrossChecks: snapshot?.slowFxCrossChecks || [],
  contextAssets: snapshot?.contextAssets || [],
  microstructureAssets: snapshot?.microstructureAssets || [],
  publicMicrostructurePolicies: snapshot?.publicMicrostructurePolicies || {},
  sourceCount: Object.keys(snapshot?.sources || {}).length,
  collector: 'github-actions-r0',
};

const dataQuality = {
  schema: 'fxga.r0.data-quality.v1',
  generatedAt: snapshot?.generatedAt || completedAt,
  architecture: snapshot?.architecture || 'delegated-free-tier-market-data-router-v2',
  policy: snapshot?.policy || null,
  counts: snapshot?.counts || {},
  budget: snapshot?.budget || {},
  sources: snapshot?.sources || {},
  durationMs: snapshot?.durationMs ?? null,
  collector: 'github-actions-r0',
};

await Promise.all([
  writeState('market', market),
  writeState('technical', technical),
  writeState('data-quality', dataQuality),
]);

console.log(JSON.stringify({
  ok: true,
  architecture: 'github-actions-to-cloudflare-d1',
  generatedAt: snapshot?.generatedAt || completedAt,
  counts: snapshot?.counts || {},
  healthySources: Object.entries(snapshot?.sources || {}).filter(([, value]) => value?.ok).map(([name]) => name),
  statesWritten: ['market', 'technical', 'data-quality'],
}, null, 2));
