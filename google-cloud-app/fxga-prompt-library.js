import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptDir = path.join(__dirname, 'prompts');
const promptCache = new Map();

export const FXGA_PROMPTS = [
  { id: 'program-chat', file: 'program-chat.md', label: 'Program chatbot', keywords: ['anything','program','dashboard','explain','question','what is','why','how'], states: ['intelligence','market','technical','macro','calendar','event-studies','signals','signal-metrics'] },
  { id: 'strategy-performance', file: 'strategy-performance.md', label: 'Strategy performance', keywords: ['performance','win rate','profit','loss','expectancy','drawdown','returns','strategy'], states: ['intelligence','event-studies','signals','signal-metrics'] },
  { id: 'edge-research', file: 'edge-research.md', label: 'Edge research', keywords: ['edge','advantage','expectancy','robust','oos','out of sample','monte carlo','bootstrap'], states: ['intelligence','event-studies','macro','technical','signals','signal-metrics'] },
  { id: 'trade-setup', file: 'trade-setup.md', label: 'Trade setup', keywords: ['trade setup','entry','stop loss','take profit','tp1','tp2','tp3','signal','buy','sell'], states: ['market','technical','calendar','signals','signal-metrics'] },
  { id: 'chart-forecast', file: 'chart-forecast.md', label: 'Chart forecast', keywords: ['forecast','projection','chart','price target','scenario','trajectory','where price'], states: ['market','technical','calendar','intelligence','signals'] },
  { id: 'technical-analysis', file: 'technical-analysis.md', label: 'Technical analysis', keywords: ['technical','structure','trend','support','resistance','momentum','timeframe'], states: ['market','technical','signals'] },
  { id: 'macro-analysis', file: 'macro-analysis.md', label: 'Macro analysis', keywords: ['macro','inflation','growth','labour','employment','rates','fed','ecb','boe','sarb','boj'], states: ['macro','intelligence','calendar','market'] },
  { id: 'economic-event', file: 'economic-event.md', label: 'Economic event', keywords: ['event','release','cpi','nfp','fomc','calendar','news','surprise','consensus'], states: ['calendar','event-studies','macro','market','intelligence'] },
  { id: 'event-study', file: 'event-study.md', label: 'Event study', keywords: ['event study','backtest','sample','historical reaction','pre news','post news'], states: ['event-studies','intelligence','market'] },
  { id: 'signal-lifecycle', file: 'signal-lifecycle.md', label: 'Signal lifecycle', keywords: ['invalidated','filled','expired','missed','tp1 hit','tp2 hit','tp3 hit','lifecycle'], states: ['signals','signal-metrics','market','technical'] },
  { id: 'risk-management', file: 'risk-management.md', label: 'Risk management', keywords: ['risk','stop','rr','risk reward','position size','invalidation'], states: ['signals','signal-metrics','market','technical','calendar'] },
  { id: 'cross-asset', file: 'cross-asset.md', label: 'Cross-asset analysis', keywords: ['cross asset','dxy','yield','gold','oil','bitcoin','spx','nasdaq','correlation','divergence'], states: ['market','technical','macro','intelligence'] },
  { id: 'data-quality', file: 'data-quality.md', label: 'Data quality', keywords: ['data quality','stale','missing data','coverage','source','freshness','api data'], states: ['macro','market','technical','calendar','intelligence'] },
  { id: 'system-health', file: 'system-health.md', label: 'System health', keywords: ['health','cloud run','firestore','gemini','service','system','architecture','status'], states: ['meta','signal-metrics'] },
  { id: 'error-explainer', file: 'error-explainer.md', label: 'Error explainer', keywords: ['error','failed','429','403','401','500','503','timeout','quota'], states: ['meta'] },
  { id: 'scenario-forecast', file: 'scenario-forecast.md', label: 'Scenario forecast', keywords: ['scenario','bull case','bear case','base case','probability','what if'], states: ['intelligence','market','technical','macro','calendar','signals'] },
  { id: 'live-intelligence-report', file: 'live-intelligence-report.md', label: 'Live intelligence report', keywords: [], states: ['intelligence','market','technical','macro','calendar','event-studies','signals','signal-metrics','meta'] },
];

export function promptDescriptor(id) {
  return FXGA_PROMPTS.find(item => item.id === id) || FXGA_PROMPTS[0];
}

export function selectPrompt(question = '', requestedId = '') {
  if (requestedId && FXGA_PROMPTS.some(item => item.id === requestedId)) return promptDescriptor(requestedId);
  const text = String(question).toLowerCase();
  let best = FXGA_PROMPTS[0], score = 0;
  for (const item of FXGA_PROMPTS) {
    if (item.id === 'live-intelligence-report') continue;
    const next = item.keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? Math.max(1, keyword.split(' ').length) : 0), 0);
    if (next > score) { best = item; score = next; }
  }
  return best;
}

export async function loadPrompt(id) {
  const descriptor = promptDescriptor(id);
  if (promptCache.has(descriptor.id)) return promptCache.get(descriptor.id);
  const text = await readFile(path.join(promptDir, descriptor.file), 'utf8');
  promptCache.set(descriptor.id, text.trim());
  return promptCache.get(descriptor.id);
}

export function publicPromptRegistry() {
  return FXGA_PROMPTS.map(({ id, label, states }) => ({ id, label, evidenceDomains: states }));
}
