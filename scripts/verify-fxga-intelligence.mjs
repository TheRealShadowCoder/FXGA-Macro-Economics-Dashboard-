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
if (!extension.includes('fallbackOnPrimaryQuota')) throw new Error('Primary-model quota does not expose fallback behavior');
if (!extension.includes("cachePolicy: 'evidence-hash-driven")) throw new Error('Evidence-driven live-report cache contract is missing');
if (/GEMINI_REQUESTS_PER_HOUR|MAX_REQUESTS_PER_HOUR/.test(extension)) throw new Error('Artificial Gemini hourly cap detected in intelligence extension');
if (extension.includes('context.generatedAt = new Date().toISOString()')) throw new Error('Request time must not invalidate the evidence cache hash');

const errorCatalog = requireFile('google-cloud-app/fxga-error-catalog.js');
const requiredErrors = [
  'invalid_request','failed_precondition','out_of_range','parameter_unknown','authentication','permission_denied','not_found','model_not_found','already_exists','aborted','rate_limit_exceeded','quota_exceeded','cancelled','api_error','unimplemented','service_unavailable','deadline_exceeded',
  'safety','recitation','language','prohibited_content','spii','blocklist','image_safety','image_prohibited_content','image_recitation','image_other','content_blocked',
  'malformed_function_call','malformed_tool_call','unexpected_tool_call','no_image','too_many_tool_calls','missing_thought_signature',
  'network_error','firestore_permission_denied','firestore_resource_exhausted','firestore_unavailable',
];
for (const code of requiredErrors) if (!errorCatalog.includes(`${code}:`)) throw new Error(`Friendly error catalog is missing ${code}`);

const liveHtml = requireFile('public/fxga-intelligence-live.html');
if (!liveHtml.includes('__FXGA_GOOGLE_CLOUD_API_BASE__')) throw new Error('Live HTML is missing its Cloud Run build placeholder');
if (!liveHtml.includes('/api/gemini/live-report') || !liveHtml.includes('/api/gemini/chat')) throw new Error('Live HTML is not connected to the intelligence API');
if (/AIza[A-Za-z0-9_-]{20,}/.test(liveHtml)) throw new Error('A Google credential pattern appeared in the public live HTML');

const errorGuide = requireFile('public/fxga-error-guide.html');
if (!errorGuide.includes('__FXGA_GOOGLE_CLOUD_API_BASE__') || !errorGuide.includes('/api/errors/catalog')) throw new Error('Public error guide is not connected to the friendly error catalog');
if (/AIza[A-Za-z0-9_-]{20,}/.test(errorGuide)) throw new Error('A Google credential pattern appeared in the public error guide');

const dockerfile = requireFile('google-cloud-app/Dockerfile');
if (!dockerfile.includes('COPY google-cloud-app/prompts ./prompts')) throw new Error('Cloud Run image does not copy the prompt library');
if (!dockerfile.includes('--import", "./fxga-intelligence-extension.js')) throw new Error('Cloud Run image does not load the intelligence extension');

console.log(`FXGA intelligence architecture verified: ${requiredPrompts.length} advanced prompts, ${requiredErrors.length} friendly error classes, live journal, chatbot, searchable error guide, evidence-driven cache, provider-managed quota.`);
