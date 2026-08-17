import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const targets=[
  'src/App.tsx',
  'src/components/AnalysisView.tsx',
  'src/components/MarketsView.tsx',
  'src/components/SignalsView.tsx',
  'src/components/ResearchView.tsx',
  'src/components/AcquisitionView.tsx',
  'src/components/DecisionIntelligence.tsx',
  'src/components/DecisionDesk.tsx',
  'src/components/EconomyAnalysisView.tsx',
  'src/components/ReleaseImpactView.tsx',
  'src/components/TechnicalStructureView.tsx',
];
const forbidden=[
  ['Google Cloud',/Google Cloud/i],
  ['Cloudflare',/Cloudflare/i],
  ['9705',/\b9705\b/],
  ['Super Economist',/Super Economist/i],
  ['AI generated',/AI[- ]generated/i],
  ['Artificial Intelligence',/Artificial Intelligence/i],
  ['LLM',/\bLLM\b/],
  ['developer placeholder',/lorem ipsum|todo placeholder|coming soon/i],
];
const failures=[];
for(const relative of targets){
  const file=path.join(root,relative);
  if(!fs.existsSync(file))continue;
  const text=fs.readFileSync(file,'utf8');
  for(const [label,pattern] of forbidden){
    if(pattern.test(text))failures.push(`${relative}: public copy contains ${label}`);
  }
}
if(failures.length){
  console.error('Public presentation quality gate failed:\n'+failures.map(x=>` - ${x}`).join('\n'));
  process.exit(1);
}
console.log(`Public presentation quality gate passed across ${targets.length} user-facing modules.`);
