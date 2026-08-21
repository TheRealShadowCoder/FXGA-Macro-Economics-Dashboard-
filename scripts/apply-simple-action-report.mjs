import fs from 'node:fs';

const path='src/App.tsx';
let source=fs.readFileSync(path,'utf8');

function replaceOne(before,after,label){
  const count=source.split(before).length-1;
  if(count!==1)throw new Error(`${label}: expected exactly one match, found ${count}`);
  source=source.replace(before,after);
}

replaceOne(
  "import { SourceNetworkView } from './components/SourceNetworkView';",
  "import { SourceNetworkView } from './components/SourceNetworkView';\nimport { SimpleActionReport } from './components/SimpleActionReport';",
  'SimpleActionReport import',
);

replaceOne(
  "type View = 'overview' | 'markets' | 'analysis' | 'research' | 'signals' | 'tradingview' | 'calendar' | 'indicators' | 'universe' | 'acquisition' | 'news' | 'sources';",
  "type View = 'action-report' | 'overview' | 'markets' | 'analysis' | 'research' | 'signals' | 'tradingview' | 'calendar' | 'indicators' | 'universe' | 'acquisition' | 'news' | 'sources';",
  'View union',
);

replaceOne(
  "const NAV: Array<{ id: View; label: string }> = [\n  { id: 'overview', label: 'Macro Dashboard' },",
  "const NAV: Array<{ id: View; label: string }> = [\n  { id: 'action-report', label: 'Action Report' },\n  { id: 'overview', label: 'Macro Dashboard' },",
  'Action Report navigation',
);

replaceOne(
  "const [view, setView] = useState<View>('overview');",
  "const [view, setView] = useState<View>('action-report');",
  'Default Action Report view',
);

replaceOne(
  "if (view !== 'analysis' || analysis || analysisLoading) return;",
  "if ((view !== 'analysis' && view !== 'action-report') || analysis || analysisLoading) return;",
  'Action Report macro analysis loading',
);

replaceOne(
  "if (view !== 'signals' || signals || signalsLoading) return;",
  "if ((view !== 'signals' && view !== 'action-report') || signals || signalsLoading) return;",
  'Action Report session signal loading',
);

replaceOne(
  "  const refreshCurrent = () => {\n    if (view === 'analysis') { setAnalysisLoading(false); setAnalysis(null); }",
  "  const refreshCurrent = () => {\n    if (view === 'action-report') { setAnalysisLoading(false); setSignalsLoading(false); setAnalysis(null); setSignals(null); void load(); }\n    else if (view === 'analysis') { setAnalysisLoading(false); setAnalysis(null); }",
  'Action Report refresh',
);

replaceOne(
  "        {loading && !data ? <div className=\"loading-panel\">Connecting to macro sources…</div> : null}\n\n        {data && view === 'overview' && (",
  "        {loading && !data ? <div className=\"loading-panel\">Connecting to macro sources…</div> : null}\n\n        {data && view === 'action-report' && <SimpleActionReport dashboard={data} analysis={analysis} signals={signals} loading={analysisLoading || signalsLoading} error={analysisError || signalsError} />}\n\n        {data && view === 'overview' && (",
  'Action Report render',
);

fs.writeFileSync(path,source);
console.log('Simple Action Report integrated into App.tsx');
