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

await import('./launcher-v2.js');
