import fs from 'node:fs';

function patch(path,before,after,label){let s=fs.readFileSync(path,'utf8');const n=s.split(before).length-1;if(n!==1)throw new Error(`${label}: expected one match, found ${n}`);s=s.replace(before,after);fs.writeFileSync(path,s);}

// Private collector: expose authenticated on-demand resolver and cached dynamic list.
patch('cloud-run-collector/src/launcher-v2.js',
"import { Firestore } from '@google-cloud/firestore';",
"import { Firestore } from '@google-cloud/firestore';\nimport { resolveEconomyOnDemand, listDynamicEconomies } from './economy-on-demand.js';",
'collector economy resolver import');
patch('cloud-run-collector/src/launcher-v2.js',
"    if(req.method==='GET'&&url.pathname==='/state')return sendJson(res,200,await mergedState());",
"    if(req.method==='GET'&&url.pathname==='/state')return sendJson(res,200,await mergedState());\n    if(req.method==='GET'&&url.pathname==='/dynamic-economies')return sendJson(res,200,{economies:await listDynamicEconomies(200)});\n    if(req.method==='GET'&&url.pathname==='/economy-resolve'){const country=String(url.searchParams.get('country')||'').trim();if(country.length<2||country.length>80)return sendJson(res,400,{error:'country must be between 2 and 80 characters'});return sendJson(res,200,await resolveEconomyOnDemand(country));}",
'collector economy resolver routes');

// Public Google API optimizer: dynamic baseline, cached dynamic economies and secure private collector proxy.
patch('google-cloud-app/optimize-server.js',
"const backtestCollection=\"const eventBacktests=db.collection('fxga_event_backtest_profiles');\";",
"const backtestCollection=\"const eventBacktests=db.collection('fxga_event_backtest_profiles');\";\nconst dynamicEconomyCollection=\"const dynamicEconomies=db.collection('fxga_dynamic_economies');\";",
'optimizer dynamic collection variable');
patch('google-cloud-app/optimize-server.js',
"  source=source.replace(patternCollection,`${patternCollection}\\n${backtestCollection}`);\n}",
"  source=source.replace(patternCollection,`${patternCollection}\\n${backtestCollection}`);\n}\nif (!source.includes(dynamicEconomyCollection)) {\n  if (!source.includes(patternCollection)) throw new Error('FXGA API optimizer could not find event pattern collection declaration for dynamic economies');\n  source=source.replace(patternCollection,`${patternCollection}\\n${dynamicEconomyCollection}`);\n}\nconst oldEconomies=\"const TARGET_ECONOMIES=['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN'];\";\nconst expandedEconomies=\"const TARGET_ECONOMIES=['USA','EUROPE','UK','SOUTH_AFRICA','JAPAN','CANADA','AUSTRALIA','NEW_ZEALAND','SWITZERLAND','CHINA','INDIA','BRAZIL','MEXICO','SOUTH_KOREA','INDONESIA','SAUDI_ARABIA','TURKEY','ARGENTINA','SINGAPORE','NORWAY','SWEDEN'];\";\nif(source.includes(oldEconomies))source=source.replace(oldEconomies,expandedEconomies);\nconst apiMarker='async function api(req,res,url){';\nif(!source.includes('async function fxgaPrivateCollectorToken')){\n  if(!source.includes(apiMarker))throw new Error('FXGA API optimizer could not find api function marker');\n  const helper=\`const FXGA_COLLECTOR_URL=String(process.env.FXGA_COLLECTOR_URL||'').replace(/\\/$/,'');\\nasync function fxgaPrivateCollectorToken(audience){const endpoint='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+encodeURIComponent(audience)+'&format=full';const response=await fetch(endpoint,{headers:{'Metadata-Flavor':'Google'}});if(!response.ok)throw new Error('Unable to obtain Google service identity token');return response.text();}\\n\`;\n  source=source.replace(apiMarker,helper+apiMarker);\n}",
'optimizer public/private economy bridge');

const oldFast=`if(url.pathname==='/api/analysis'||url.pathname==='/api/economy-analysis'||url.pathname==='/api/release-impact'){
  const intel=(await readState('intelligence'))?.payload;
  if(!intel)return apiError(res,503,'Intelligence snapshot is not initialized');
  if(url.pathname==='/api/analysis')return intel.macroAnalysis?sendJson(res,200,intel.macroAnalysis,'public, max-age=5'):apiError(res,503,'Analysis snapshot is not initialized');
  if(url.pathname==='/api/economy-analysis')return intel.economyAnalysis?sendJson(res,200,intel.economyAnalysis,'public, max-age=5'):apiError(res,503,'Economy analysis is not initialized');
  return intel.releaseImpact?sendJson(res,200,intel.releaseImpact,'public, max-age=5'):apiError(res,503,'Release impact is not initialized');
}`;
const newFast=`if(url.pathname==='/api/analysis'||url.pathname==='/api/economy-analysis'||url.pathname==='/api/release-impact'){
  const intel=(await readState('intelligence'))?.payload;
  if(!intel)return apiError(res,503,'Intelligence snapshot is not initialized');
  if(url.pathname==='/api/analysis')return intel.macroAnalysis?sendJson(res,200,intel.macroAnalysis,'public, max-age=5'):apiError(res,503,'Analysis snapshot is not initialized');
  if(url.pathname==='/api/economy-analysis'){
    if(!intel.economyAnalysis)return apiError(res,503,'Economy analysis is not initialized');
    const snap=await dynamicEconomies.limit(200).get(),dynamic=snap.docs.map(doc=>doc.data()?.state).filter(Boolean),merged=new Map();
    for(const economy of [...(Array.isArray(intel.economyAnalysis.economies)?intel.economyAnalysis.economies:[]),...dynamic])if(economy?.id)merged.set(String(economy.id),economy);
    return sendJson(res,200,{...intel.economyAnalysis,economies:[...merged.values()],dynamicEconomies:dynamic.length},'public, max-age=5');
  }
  return intel.releaseImpact?sendJson(res,200,intel.releaseImpact,'public, max-age=5'):apiError(res,503,'Release impact is not initialized');
}
if(url.pathname==='/api/economy-resolve'){
  const country=String(url.searchParams.get('country')||'').trim();
  if(country.length<2||country.length>80||!/^[\\p{L} .,'()&-]+$/u.test(country))return apiError(res,400,'Provide a valid country or economy name');
  if(!FXGA_COLLECTOR_URL)return apiError(res,503,'Private economy resolver is not configured');
  const token=await fxgaPrivateCollectorToken(FXGA_COLLECTOR_URL),response=await fetch(FXGA_COLLECTOR_URL+'/economy-resolve?country='+encodeURIComponent(country),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}}),text=await response.text();
  if(!response.ok)return send(res,response.status,text,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  return send(res,200,text,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
}`;
patch('google-cloud-app/optimize-server.js',oldFast,newFast,'optimizer economy fast routes');

// Resolve private collector URL during public API deploy.
patch('.github/workflows/deploy-google-cloud-app.yml',
"          echo 'Using existing Cloud Run / Artifact Registry / Firestore project resources.'",
"          COLLECTOR_URL=$(gcloud run services describe fxga-macro-collector --region \"$GCP_REGION\" --platform managed --format='value(status.url)')\n          test -n \"$COLLECTOR_URL\" || { echo '::error::Private collector URL is unavailable'; exit 1; }\n          echo \"COLLECTOR_URL=$COLLECTOR_URL\" >> \"$GITHUB_ENV\"\n          echo \"Private economy resolver: $COLLECTOR_URL\"\n          echo 'Using existing Cloud Run / Artifact Registry / Firestore project resources.'",
'app deploy collector URL');
patch('.github/workflows/deploy-google-cloud-app.yml',
"            --set-env-vars \"GCP_PROJECT_ID=$GCP_PROJECT_ID,FXGA_ARCHITECTURE=google-cloud-processing-cloudflare-static-hosting\"",
"            --set-env-vars \"GCP_PROJECT_ID=$GCP_PROJECT_ID,FXGA_ARCHITECTURE=google-cloud-processing-cloudflare-static-hosting,FXGA_COLLECTOR_URL=$COLLECTOR_URL\"",
'app deploy resolver env');

// Frontend API helper.
patch('src/lib/api.ts',
"import type { EconomyAnalysisPayload, GlobalMacroPayload } from './economy-types';",
"import type { EconomyAnalysisPayload, EconomyMacroState, GlobalMacroPayload } from './economy-types';",
'frontend economy resolver type import');
patch('src/lib/api.ts',
"export async function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> { return apiFetch('/api/economy-analysis', { cache: 'no-store' }); }",
"export async function fetchEconomyAnalysis(): Promise<EconomyAnalysisPayload> { return apiFetch('/api/economy-analysis', { cache: 'no-store' }); }\nexport async function resolveEconomyReport(country: string): Promise<EconomyMacroState> { return apiFetch(`/api/economy-resolve?country=${encodeURIComponent(country)}`, { cache: 'no-store' }); }",
'frontend resolver API');

// Economic Context: allow a typed country to be built on demand.
patch('src/components/EconomicContextReport.tsx',
"import { fetchEconomyAnalysis } from '../lib/api';",
"import { fetchEconomyAnalysis, resolveEconomyReport } from '../lib/api';",
'report resolver import');
patch('src/components/EconomicContextReport.tsx',
"  const[search,setSearch]=useState('');",
"  const[search,setSearch]=useState('');\n  const[resolving,setResolving]=useState(false);\n  const[resolveError,setResolveError]=useState('');",
'report resolver state');
patch('src/components/EconomicContextReport.tsx',
"  const state=selected==='ALL'?null:economies.find(e=>e.id===selected)??null;",
"  const state=selected==='ALL'?null:economies.find(e=>e.id===selected)??null;\n  const exactSearch=search.trim()?economies.find(e=>`${e.label} ${e.id} ${e.currency}`.toLowerCase().includes(search.trim().toLowerCase())):null;\n  const buildEconomy=async()=>{const country=search.trim();if(!country)return;if(exactSearch){setSelected(exactSearch.id);return;}setResolving(true);setResolveError('');try{const resolved=await resolveEconomyReport(country);setData(prev=>prev?{...prev,economies:[...prev.economies.filter(e=>e.id!==resolved.id),resolved]}:{generatedAt:new Date().toISOString(),methodology:'FRED on-demand economy resolver',minimumCoverageNote:'On-demand country report',collectorMode:'google-cloud-private-fred-resolver',observationCount:resolved.observationCount,economies:[resolved]});setSelected(resolved.id);}catch(err){setResolveError(err instanceof Error?err.message:'Unable to build economy report');}finally{setResolving(false);}};",
'report build economy function');
patch('src/components/EconomicContextReport.tsx',
"      <div className=\"economy-selector-controls\"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder=\"Search economy, currency or central bank…\"/><select value={selected} onChange={e=>setSelected(e.target.value)}><option value=\"ALL\">All Economies</option>{filtered.map(e=><option value={e.id} key={e.id}>{e.label} · {e.currency}</option>)}</select></div>",
"      <div className=\"economy-selector-controls\"><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void buildEconomy();}} placeholder=\"Type any economy or country…\"/><select value={selected} onChange={e=>setSelected(e.target.value)}><option value=\"ALL\">All Economies</option>{filtered.map(e=><option value={e.id} key={e.id}>{e.label} · {e.currency}</option>)}</select><button type=\"button\" disabled={!search.trim()||resolving} onClick={()=>void buildEconomy()}>{resolving?'Building from FRED…':exactSearch?'Open selected economy':'Build report from FRED'}</button></div>",
'report selector resolver button');
patch('src/components/EconomicContextReport.tsx',
"    {(error||economyError)?<div className=\"economic-context-note warn\">Some intelligence is temporarily unavailable: {economyError||error}. The report will only use data that is currently verified.</div>:null}",
"    {(error||economyError)?<div className=\"economic-context-note warn\">Some intelligence is temporarily unavailable: {economyError||error}. The report will only use data that is currently verified.</div>:null}\n    {resolveError?<div className=\"economic-context-note warn\">Could not build that economy yet: {resolveError}</div>:null}",
'report resolver error');

// Style the new action button.
patch('src/components/EconomicContextGlobal.css',
".economy-selector-controls input:focus,.economy-selector-controls select:focus{border-color:rgba(180,156,105,.35)}",
".economy-selector-controls input:focus,.economy-selector-controls select:focus{border-color:rgba(180,156,105,.35)}.economy-selector-controls button{grid-column:1/-1;border:1px solid rgba(180,156,105,.24);border-radius:7px;background:rgba(180,156,105,.08);color:#c9b88e;padding:9px;font-size:7px;cursor:pointer}.economy-selector-controls button:hover:not(:disabled){background:rgba(180,156,105,.13)}.economy-selector-controls button:disabled{opacity:.45;cursor:default}",
'report resolver button style');

console.log('Integrated secure any-economy FRED resolver across collector, Google API and Economic Context UI.');
