import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const checks=[];
const run=(name,command,args=[],options={})=>{
  const started=Date.now();
  const result=spawnSync(command,args,{encoding:'utf8',stdio:'pipe',...options});
  const passed=result.status===0;
  checks.push({name,passed,durationMs:Date.now()-started,status:result.status,stdout:String(result.stdout||'').slice(-5000),stderr:String(result.stderr||'').slice(-5000)});
  return result;
};

run('root-npm-install','npm',['install','--no-audit','--no-fund']);
const build=run('frontend-typescript-vite-build','npm',['run','build'],{env:{...process.env,VITE_GOOGLE_CLOUD_API_BASE:'https://fxga-audit-backend.invalid'}});

if(build.status===0){
  const files=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())walk(path);else files.push(path);}};
  walk('dist');
  const text=files.filter(file=>/\.(?:js|html|json|css)$/.test(file)).map(file=>fs.readFileSync(file,'utf8')).join('\n');
  const required=[
    ['backend-binding','https://fxga-audit-backend.invalid'],
    ['cross-asset-board','Cross Asset Board'],
    ['mt5-fusion-tab','MT5 Data + SMC Fusion'],
    ['event-study','Event Study & Backtesting'],
    ['event-price-research','Price action before and after every economic release'],
    ['live-signal-intelligence','Live Signal Intelligence'],
    ['macro-data-library','Macro Data Library'],
    ['data-operations','Data Operations'],
  ];
  for(const [name,needle] of required){
    const passed=text.includes(needle);
    checks.push({name:`frontend-gate-${name}`,passed,durationMs:0,status:passed?0:1,stdout:passed?`found: ${needle}`:'',stderr:passed?'':`missing compiled string: ${needle}`});
  }
}

run('google-app-npm-install','npm',['install','--no-audit','--no-fund'],{cwd:'google-cloud-app'});
run('google-app-source-syntax','node',['--check','server.js'],{cwd:'google-cloud-app'});
run('google-app-optimizer-syntax','node',['--check','optimize-server.js'],{cwd:'google-cloud-app'});
run('google-app-optimizer-execution','node',['optimize-server.js'],{cwd:'google-cloud-app'});
run('google-app-optimized-server-syntax','node',['--check','server.js'],{cwd:'google-cloud-app'});

run('mt5-npm-install','npm',['install','--no-audit','--no-fund'],{cwd:'google-cloud-mt5-ingress'});
run('mt5-range-patch-syntax','node',['--check','fix-price-cache-range.js'],{cwd:'google-cloud-mt5-ingress'});
run('mt5-range-patch-execution','node',['fix-price-cache-range.js'],{cwd:'google-cloud-mt5-ingress'});
run('mt5-patched-cache-syntax','node',['--check','price-cache.js'],{cwd:'google-cloud-mt5-ingress'});
run('mt5-server-syntax','node',['--check','server.js'],{cwd:'google-cloud-mt5-ingress'});

const passed=checks.every(check=>check.passed);
const report={schema:'fxga.deploy-gate-audit.v1',passed,generatedAt:new Date().toISOString(),summary:{passed:checks.filter(check=>check.passed).length,failed:checks.filter(check=>!check.passed).length,total:checks.length},checks};
fs.mkdirSync('runtime',{recursive:true});
fs.writeFileSync('runtime/deploy-gate-audit.json',JSON.stringify(report,null,2)+'\n');
console.table(checks.map(check=>({check:check.name,status:check.passed?'PASS':'FAIL',ms:check.durationMs,exit:check.status,error:check.stderr?.split('\n').slice(-2).join(' ')})));
if(!passed)process.exitCode=1;
