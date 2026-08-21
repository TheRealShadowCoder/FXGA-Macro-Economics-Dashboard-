import fs from 'node:fs';

const required = [
  'config/upgrade-program.json',
  'src/lib/api-runtime.ts',
  'cloud-run-collector/src/fred-coverage-resolver.js',
  'cloud-run-collector/src/research-statistics.js',
  'cloud-run-collector/src/event-evidence.js',
  'cloud-run-collector/src/event-pattern-profiler.js',
  'cloud-run-collector/src/event-study-backfill.js',
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
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
if(/"main"\s*:/.test(wrangler))throw new Error('Cloudflare must remain static-only: wrangler main is forbidden');
for(const forbidden of ['kv_namespaces','r2_buckets','d1_databases','durable_objects','queues','services'])if(wrangler.includes(`"${forbidden}"`))throw new Error(`Cloudflare application binding forbidden: ${forbidden}`);
const api=fs.readFileSync('src/lib/api-runtime.ts','utf8');
for(const needle of ['inFlight','CIRCUIT_FAILURES','apiRuntimeSummary','readLkg','MAX_CONCURRENT'])if(!api.includes(needle))throw new Error(`API runtime resilience gate missing ${needle}`);
const profiler=fs.readFileSync('cloud-run-collector/src/event-pattern-profiler.js','utf8');
for(const needle of ['meanMove95Low','temporalStability','outOfSampleRequired','multipleTestingControlRequired'])if(!profiler.includes(needle))throw new Error(`Research-governance gate missing ${needle}`);
const evidence=fs.readFileSync('cloud-run-collector/src/event-evidence.js','utf8');
for(const needle of ['FRED','CNBC','MetaTrader 5 canonical M1','never replace historical MT5 candles'])if(!evidence.includes(needle))throw new Error(`Event evidence provenance gate missing ${needle}`);
console.log(JSON.stringify({ok:true,schema:program.schema,totalUpgrades:program.totalUpgrades,domains:program.domains,staticCloudflare:true,foundations:program.implementation.foundationBatch.capabilities.length},null,2));
