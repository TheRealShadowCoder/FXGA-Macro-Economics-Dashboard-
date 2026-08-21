import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourcePath='scripts/apply-any-economy-resolver.mjs';
let source=fs.readFileSync(sourcePath,'utf8');
const oldBlock=`patch('src/lib/api.ts',
"export async function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> { return apiFetch('/api/economy-analysis', { cache: 'no-store' }); }",
"export async function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> { return apiFetch('/api/economy-analysis', { cache: 'no-store' }); }\\nexport async function resolveEconomyReport(country: string): Promise<EconomyMacroState> { return apiFetch(\`/api/economy-resolve?country=\${encodeURIComponent(country)}\`, { cache: 'no-store' }); }",
'frontend resolver API');`;
const newBlock=`patch('src/lib/api.ts',
"export function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> {\\n  return apiGetJson<EconomyAnalysisPayload>('/api/economy-analysis');\\n}",
"export function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> {\\n  return apiGetJson<EconomyAnalysisPayload>('/api/economy-analysis');\\n}\\n\\nexport function resolveEconomyReport(country: string): Promise<EconomyMacroState> {\\n  return apiGetJson<EconomyMacroState>(\`/api/economy-resolve?country=\${encodeURIComponent(country)}\`, 'critical');\\n}",
'frontend resolver API');`;
if(!source.includes(oldBlock))throw new Error('Could not adapt original resolver integration API block');
source=source.replace(oldBlock,newBlock);
const unsafeHelper=".replace(/\\\\/$/,'')";
if(!source.includes(unsafeHelper))throw new Error('Could not find collector URL regex helper to simplify');
source=source.replace(unsafeHelper,'.trim()');
const runtime='scripts/.apply-any-economy-resolver-runtime.mjs';
fs.writeFileSync(runtime,source);
try{await import(pathToFileURL(process.cwd()+'/'+runtime).href+'?v='+Date.now());}finally{fs.rmSync(runtime,{force:true});}
