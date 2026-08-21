// FXGA production boundary: Google Cloud owns acquisition, computation, state and serving.
// This wrapper runs before the collector modules are imported so legacy webhook code cannot
// reach Cloudflare even if an old environment variable is accidentally restored later.
const platformFetch = globalThis.fetch.bind(globalThis);
const BLOCKED_HOSTS = [/\.workers\.dev$/i, /(^|\.)cloudflare\.com$/i, /(^|\.)cloudflareworkers\.com$/i];

function requestUrl(input) {
  try {
    if (typeof input === 'string' || input instanceof URL) return new URL(String(input));
    if (input && typeof input.url === 'string') return new URL(input.url);
  } catch {}
  return null;
}

globalThis.fetch = async (input, init) => {
  const url = requestUrl(input);
  if (url && BLOCKED_HOSTS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error(`FXGA Google Cloud production boundary blocked direct Cloudflare egress to ${url.hostname}`);
  }
  return platformFetch(input, init);
};

// Remove legacy webhook variables before super-runtime/server-v2 are evaluated.
delete process.env.CLOUDFLARE_WEBHOOK_URL;
delete process.env.COLLECTOR_WEBHOOK_SECRET;
process.env.FXGA_ARCHITECTURE = 'google-cloud-only';

// Repair non-transient macro gaps against FRED before the runtime reads the persisted
// universe. The repair is coverage-first: missing economy/category lanes are searched,
// validated against numeric FRED observations, and persisted as canonical descriptors.
// Startup remains bounded so a slow FRED response can never prevent Cloud Run readiness.
try {
  const { repairFredCoverage } = await import('./fred-coverage-resolver.js');
  const repairPromise = repairFredCoverage({ reason:'cloud-run-revision-startup' });
  const repairResult = await Promise.race([
    repairPromise,
    new Promise((resolve) => setTimeout(() => resolve({ deferred:true, reason:'startup-budget-exhausted' }), 55_000)),
  ]);
  console.log('FRED startup coverage result', JSON.stringify(repairResult));
  if (repairResult?.deferred) repairPromise.then((result)=>console.log('FRED deferred coverage result',JSON.stringify(result))).catch((error)=>console.warn('FRED deferred coverage repair failed',String(error?.message||error).slice(0,300)));
} catch (error) {
  console.warn('FRED startup coverage repair skipped', String(error?.message||error).slice(0,300));
}

await import('./launcher-v2.js');
