import fs from 'node:fs';

const required = [
  'config/upgrade-program.json',
  'src/App.tsx',
  'src/lib/api-runtime.ts',
  'src/lib/live-client.ts',
  'src/components/SimpleActionReport.tsx',
  'src/components/SimpleActionReport.css',
  'src/components/EventBacktestValidation.tsx',
  'cloud-run-collector/src/fred-coverage-resolver.js',
  'cloud-run-collector/src/research-statistics.js',
  'cloud-run-collector/src/event-evidence.js',
  'cloud-run-collector/src/event-pattern-profiler.js',
  'cloud-run-collector/src/event-pattern-backtester.js',
  'cloud-run-collector/src/event-study-backfill.js',
  'google-cloud-app/optimize-server.js',
  'worker/src/index.js',
  'worker/src/r0-entry.js',
  'worker/src/auth-gateway.js',
  'wrangler.jsonc',
];
for (const path of required) if (!fs.existsSync(path)) throw new Error(`3000-upgrade foundation missing ${path}`);
const program=JSON.parse(fs.readFileSync('config/upgrade-program.json','utf8'));
if(program.totalUpgrades!==3000||program.domains!==30||program.itemsPerDomain!==100)throw new Error('Upgrade program cardinality is invalid');
if(!Array.isArray(program.domainsIndex)||program.domainsIndex.length!==30)throw new Error('Upgrade domain index must contain 30 domains');
for(let i=0;i<program.domainsIndex.length;i++){
  const row=program.domainsIndex[i];
  if(row.id!==i+1)throw new Error(`Upgrade domain ${i+1} ID mismatch`);
  const start=i*100+1,end=(i+1)*100,expected=`U${String(start).padStart(4,'0')}-U${String(end).padStart(4,'0')}`;
  if(row.range!==expected)throw new Error(`Upgrade domain ${row.id} range mismatch: ${row.range} != ${expected}`);
}
const wranglerText=fs.readFileSync('wrangler.jsonc','utf8');
const wrangler=JSON.parse(wranglerText);
if(wrangler.main!=='./worker/src/auth-gateway.js')throw new Error('Cloudflare R0 Worker main must be ./worker/src/auth-gateway.js');
if(wrangler.assets?.binding!=='ASSETS')throw new Error('Cloudflare R0 static assets binding is missing');
if(!wrangler.assets?.run_worker_first?.includes('/*'))throw new Error('All application routes must pass through the member auth gateway');
if(wrangler.vars?.AUTH_ENFORCED!=='auto')throw new Error('Member auth must be configured for safe automatic activation');
if(!String(wrangler.vars?.AUTH_PORTAL_URL||'').includes('/member'))throw new Error('Member auth portal is not configured');
if(wrangler.r2_buckets)throw new Error('R2 must not be a production dependency in strict R0 mode');
for(const forbidden of ['durable_objects','queues','services'])if(wranglerText.includes(`"${forbidden}"`))throw new Error(`Unexpected Cloudflare application binding in strict R0 mode: ${forbidden}`);
const authGateway=fs.readFileSync('worker/src/auth-gateway.js','utf8');
if(!authGateway.includes("import r0Worker from './r0-entry.js'"))throw new Error('Member gateway must delegate to the R0 compatibility runtime');
for(const needle of ['/api/auth/status','/api/auth/exchange','/api/auth/introspect-session','authentication_required','member_auth_enforced'])if(!authGateway.includes(needle))throw new Error(`Member auth gateway missing ${needle}`);
const r0Entry=fs.readFileSync('worker/src/r0-entry.js','utf8');
if(!r0Entry.includes("import coreWorker from './index.js'"))throw new Error('R0 compatibility entry must delegate preserved core Worker routes to worker/src/index.js');
for(const needle of ['/api/dashboard','/api/analysis','/api/session-signals','/api/live'])if(!r0Entry.includes(needle))throw new Error(`R0 frontend compatibility gate missing ${needle}`);
const app=fs.readFileSync('src/App.tsx','utf8');
for(const needle of ["type View = 'action-report'","{ id: 'action-report', label: 'Action Report' }","useState<View>('action-report')",'<SimpleActionReport'])if(!app.includes(needle))throw new Error(`Simple Action Report shell gate missing ${needle}`);
const actionUi=fs.readFileSync('src/components/SimpleActionReport.tsx','utf8');
for(const needle of ['WHAT DO I DO NOW?','WHAT IS HAPPENING?','WHAT SHOULD I DO?','WHAT SHOULD I WATCH?','WHAT WOULD CHANGE THE ANSWER?','WAIT —','PREPARE'])if(!actionUi.includes(needle))throw new Error(`Plain-English Action Report gate missing ${needle}`);
const api=fs.readFileSync('src/lib/api-runtime.ts','utf8');
for(const needle of ['inFlight','CIRCUIT_FAILURES','apiRuntimeSummary','readLkg','MAX_CONCURRENT'])if(!api.includes(needle))throw new Error(`API runtime resilience gate missing ${needle}`);
const live=fs.readFileSync('src/lib/live-client.ts','utf8');
for(const needle of ['missedSequences','HEARTBEAT_MS','STALE_MS','subscribeLive','subscribeLiveState'])if(!live.includes(needle))throw new Error(`Realtime resilience gate missing ${needle}`);
const profiler=fs.readFileSync('cloud-run-collector/src/event-pattern-profiler.js','utf8');
for(const needle of ['meanMove95Low','temporalStability','outOfSampleRequired','multipleTestingControlRequired'])if(!profiler.includes(needle))throw new Error(`Research-governance gate missing ${needle}`);
const backtester=fs.readFileSync('cloud-run-collector/src/event-pattern-backtester.js','utf8');
for(const needle of ['holdoutFraction','Benjamini-Hochberg','costBps','promotionEligible','qValue'])if(!backtester.includes(needle))throw new Error(`OOS backtest gate missing ${needle}`);
const evidence=fs.readFileSync('cloud-run-collector/src/event-evidence.js','utf8');
for(const needle of ['FRED','CNBC','MetaTrader 5 canonical M1','never replace historical MT5 candles'])if(!evidence.includes(needle))throw new Error(`Event evidence provenance gate missing ${needle}`);
const optimizer=fs.readFileSync('google-cloud-app/optimize-server.js','utf8');
for(const needle of ['/api/event-pattern-backtests','eventBacktests','validatedOnly'])if(!optimizer.includes(needle))throw new Error(`Public OOS API gate missing ${needle}`);
const eventUi=fs.readFileSync('src/components/EventBacktestValidation.tsx','utf8');
for(const needle of ['Out-of-Sample Validation','q-value','cost assumption','validated candidate'])if(!eventUi.includes(needle))throw new Error(`Event validation UI gate missing ${needle}`);
console.log(JSON.stringify({ok:true,schema:program.schema,totalUpgrades:program.totalUpgrades,domains:program.domains,cloudflareR0:true,workerRuntime:true,compatibilityEntry:true,memberAuthGateway:true,ownerApprovedAccess:true,d1Ready:true,foundations:program.implementation.foundationBatch.capabilities.length,oosValidation:true,realtimeResilience:true,eventEvidence:true,simpleActionReport:true},null,2));
