import fs from 'node:fs';

const requiredPrompts = [
  'program-chat.md','strategy-performance.md','edge-research.md','trade-setup.md','chart-forecast.md',
  'technical-analysis.md','macro-analysis.md','economic-event.md','event-study.md','signal-lifecycle.md',
  'risk-management.md','cross-asset.md','data-quality.md','system-health.md','error-explainer.md',
  'scenario-forecast.md','live-intelligence-report.md',
];

const requireFile = file => {
  if (!fs.existsSync(file)) throw new Error(`Missing FXGA intelligence file: ${file}`);
  return fs.readFileSync(file, 'utf8');
};

for (const name of requiredPrompts) {
  const text = requireFile(`google-cloud-app/prompts/${name}`);
  if (text.trim().length < 120) throw new Error(`Prompt is unexpectedly small: ${name}`);
}

const library = requireFile('google-cloud-app/fxga-prompt-library.js');
for (const name of requiredPrompts) if (!library.includes(`'${name}'`)) throw new Error(`Prompt library does not register ${name}`);
if (!library.includes("'program-chat'")) throw new Error('Program chatbot prompt is not registered');
if (!library.includes("'meta'")) throw new Error('Program chatbot/system prompts do not receive runtime metadata');

const extension = requireFile('google-cloud-app/fxga-intelligence-extension.js');
for (const route of ['/api/gemini/chat','/api/gemini/live-report','/api/gemini/prompts','/api/gemini/intelligence-health','/api/errors/catalog']) {
  if (!extension.includes(route)) throw new Error(`Intelligence extension is missing ${route}`);
}
if (!extension.includes('providerQuotaManaged: true')) throw new Error('Provider-managed Gemini quota contract is missing');
if (/GEMINI_REQUESTS_PER_HOUR|MAX_REQUESTS_PER_HOUR/.test(extension)) throw new Error('Artificial Gemini hourly cap detected in intelligence extension');

const errorCatalog = requireFile('google-cloud-app/fxga-error-catalog.js');
for (const code of ['invalid_request','authentication','permission_denied','model_not_found','rate_limit_exceeded','quota_exceeded','service_unavailable','deadline_exceeded','network_error','firestore_unavailable']) {
  if (!errorCatalog.includes(`${code}:`)) throw new Error(`Friendly error catalog is missing ${code}`);
}

const liveHtml = requireFile('public/fxga-intelligence-live.html');
if (!liveHtml.includes('__FXGA_GOOGLE_CLOUD_API_BASE__')) throw new Error('Live HTML is missing its Cloud Run build placeholder');
if (!liveHtml.includes('/api/gemini/live-report') || !liveHtml.includes('/api/gemini/chat')) throw new Error('Live HTML is not connected to the intelligence API');
if (/AIza[A-Za-z0-9_-]{20,}|x-goog-api-key/i.test(liveHtml)) throw new Error('A Google API credential pattern or API-key header appeared in the public live HTML');

const dockerfile = requireFile('google-cloud-app/Dockerfile');
if (!dockerfile.includes('COPY google-cloud-app/prompts ./prompts')) throw new Error('Cloud Run image does not copy the prompt library');
if (!dockerfile.includes('--import", "./fxga-intelligence-extension.js')) throw new Error('Cloud Run image does not load the intelligence extension');

console.log(`FXGA intelligence architecture verified: ${requiredPrompts.length} advanced prompts, live journal, chatbot, friendly errors, provider-managed Gemini quota.`);
