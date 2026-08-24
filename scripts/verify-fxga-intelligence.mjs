import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const requireFile = file => {
  if (!fs.existsSync(file)) throw new Error(`Missing FXGA intelligence file: ${file}`);
  return fs.readFileSync(file, 'utf8');
};

const promptDir = 'google-cloud-app/prompts';
const taskPromptFiles = fs.readdirSync(promptDir).filter(name => name.endsWith('.md') && !name.startsWith('_')).sort();
if (taskPromptFiles.length !== 100) throw new Error(`Expected exactly 100 FXGA task prompts, found ${taskPromptFiles.length}`);

const { FXGA_PROMPTS } = await import(pathToFileURL(`${process.cwd()}/google-cloud-app/fxga-prompt-library.js`).href);
if (!Array.isArray(FXGA_PROMPTS) || FXGA_PROMPTS.length !== 100) throw new Error(`Prompt registry must expose exactly 100 prompts; found ${FXGA_PROMPTS?.length ?? 0}`);

const ids = new Set(), files = new Set();
for (const prompt of FXGA_PROMPTS) {
  if (!prompt?.id || ids.has(prompt.id)) throw new Error(`Duplicate or missing prompt id: ${prompt?.id}`);
  if (!prompt?.file || files.has(prompt.file)) throw new Error(`Duplicate or missing prompt file: ${prompt?.file}`);
  ids.add(prompt.id); files.add(prompt.file);
  const text = requireFile(`${promptDir}/${prompt.file}`);
  if (text.trim().length < 220) throw new Error(`Prompt is unexpectedly small: ${prompt.file}`);
}
for (const file of taskPromptFiles) if (!files.has(file)) throw new Error(`Prompt file is not registered: ${file}`);

const strategyTemplate = requireFile(`${promptDir}/_strategy-execution-template.md`);
const strategyTemplateLower = strategyTemplate.toLowerCase();
for (const phrase of [
  'never call any target guaranteed or assured',
  'never recommend increasing position size solely because confidence is high',
  'wait_for_entry, active, protect, partial, exit, invalidated, expired, or completed',
]) if (!strategyTemplateLower.includes(phrase)) throw new Error(`Strategy execution guardrail missing: ${phrase}`);

const requiredStrategyPrompts = [
  'scalp-overview','scalp-buy-entry','scalp-stop-loss','scalp-take-profit','scalp-trade-management-live','scalp-aggressive-risk',
  'day-trading-overview','day-buy-entry','day-stop-loss','day-take-profit','day-trade-management-live',
  'long-term-overview','long-term-buy-entry','long-term-stop-loss','long-term-take-profit','long-term-trade-management-live','long-term-thesis-invalidation',
  'session-overview','asia-session','london-session','new-york-session','session-buy-entry','session-stop-loss','session-take-profit','session-trade-management-live','session-target-zones',
  'elliott-wave','pitchfork-elliott','bollinger-band','order-block','fair-value-gap','vwap','news-event','multi-strategy-ensemble',
];
for (const id of requiredStrategyPrompts) if (!ids.has(id)) throw new Error(`Required strategy prompt missing: ${id}`);

const realtimePrompts = FXGA_PROMPTS.filter(prompt => prompt.id.endsWith('trade-management-live'));
if (realtimePrompts.length !== 4) throw new Error(`Expected four real-time trade-management prompts, found ${realtimePrompts.length}`);
for (const prompt of realtimePrompts) {
  if (!prompt.states?.includes('signals') || !prompt.states?.includes('signal-metrics') || !prompt.states?.includes('market')) throw new Error(`Live trade-management prompt lacks live evidence domains: ${prompt.id}`);
}

const library = requireFile('google-cloud-app/fxga-prompt-library.js');
const strategyPack = requireFile('google-cloud-app/fxga-strategy-prompt-pack.js');
if (!strategyPack.includes("shared: 'strategy-execution'")) throw new Error('Strategy prompts do not load the shared execution contract');
if (!library.includes("id.includes('trade-management-live')")) throw new Error('Prompt registry does not expose live-management metadata');
if (!library.includes("'program-chat'") || !library.includes("'meta'")) throw new Error('Program chatbot/system prompts do not receive runtime metadata');

const extension = requireFile('google-cloud-app/fxga-intelligence-extension.js');
for (const route of ['/api/gemini/chat','/api/gemini/live-report','/api/gemini/prompts','/api/gemini/intelligence-health','/api/errors/catalog']) if (!extension.includes(route)) throw new Error(`Intelligence extension is missing ${route}`);
if (!extension.includes('providerQuotaManaged: true')) throw new Error('Provider-managed Gemini quota contract is missing');
if (!extension.includes('fallbackOnPrimaryQuota')) throw new Error('Primary-model quota does not expose fallback behavior');
if (!extension.includes("cachePolicy: 'evidence-hash-driven")) throw new Error('Evidence-driven live-report cache contract is missing');
if (/GEMINI_REQUESTS_PER_HOUR|MAX_REQUESTS_PER_HOUR/.test(extension)) throw new Error('Artificial Gemini hourly cap detected in intelligence extension');
if (extension.includes('context.generatedAt = new Date().toISOString()')) throw new Error('Request time must not invalidate the evidence cache hash');

const client = requireFile('src/lib/gemini-client.ts');
if (!/category\?\s*:\s*string/.test(client) || !/realtime\?\s*:\s*boolean/.test(client)) throw new Error('Frontend prompt registry does not expose category/realtime metadata');
const dock = requireFile('src/components/GeminiIntelligenceDock.tsx');
if (!dock.includes('LIVE_TRADE_REFRESH_MS') || !dock.includes("endsWith('trade-management-live')")) throw new Error('In-app real-time trade-management refresh is missing');

const errorCatalog = requireFile('google-cloud-app/fxga-error-catalog.js');
const requiredErrors = ['invalid_request','failed_precondition','out_of_range','parameter_unknown','authentication','permission_denied','not_found','model_not_found','already_exists','aborted','rate_limit_exceeded','quota_exceeded','cancelled','api_error','unimplemented','service_unavailable','deadline_exceeded','safety','recitation','language','prohibited_content','spii','blocklist','image_safety','image_prohibited_content','image_recitation','image_other','content_blocked','malformed_function_call','malformed_tool_call','unexpected_tool_call','no_image','too_many_tool_calls','missing_thought_signature','network_error','firestore_permission_denied','firestore_resource_exhausted','firestore_unavailable'];
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

const categories = FXGA_PROMPTS.reduce((acc, prompt) => ((acc[prompt.category || 'uncategorized'] = (acc[prompt.category || 'uncategorized'] || 0) + 1), acc), {});
console.log(`FXGA intelligence architecture verified: 100 advanced prompts, 4 real-time trade managers, ${requiredErrors.length} friendly error classes.`);
console.log('Prompt categories:', categories);
