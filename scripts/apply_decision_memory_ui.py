from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('src/components/ResearchView.tsx')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"import { AdaptiveResearchPanel } from './AdaptiveResearchPanel';\n",
"import { AdaptiveResearchPanel } from './AdaptiveResearchPanel';\nimport { DecisionMemoryPanel } from './DecisionMemoryPanel';\n",
'decision memory import')
text=replace_once(text,
"type SourceReliability={source:string;series:number;score:number;status:string;numericCoverage:number;freshness:number;historyDepth:number;anomalyRate:number};\n",
"type SourceReliability={source:string;series:number;score:number;status:string;numericCoverage:number;freshness:number;historyDepth:number;anomalyRate:number};\ntype DecisionMemorySummary={generatedAt:string;sampledDecisions:number;directionalRecorded:number;waitRecorded:number;pending:number;noVerifiedBaseline:number;horizons:Record<string,{count:number;correct:number;wrong:number;flat:number;hitRate:number|null;nonLossRate:number|null;averageSignedBps:number|null;brier:number|null}>;bySymbol:Record<string,{horizons:Record<string,{count:number;correct:number;wrong:number;flat:number;hitRate:number|null;nonLossRate:number|null;averageSignedBps:number|null;brier:number|null}>}>;byConfidence:Record<string,{horizons:Record<string,{count:number;correct:number;wrong:number;flat:number;hitRate:number|null;nonLossRate:number|null;averageSignedBps:number|null;brier:number|null}>}>;methodology:string};\n",
'decision memory type')
text=replace_once(text,
"  decisionCore?:DecisionCorePayload;\n",
"  decisionCore?:DecisionCorePayload;\n  decisionMemory?:DecisionMemorySummary|null;\n",
'decision memory payload')
text=replace_once(text,
"    <DecisionCorePanel data={data.decisionCore}/>\n    <AdaptiveResearchPanel sources={data.sourceReliability} forecasts={data.forecasts}/>\n",
"    <DecisionCorePanel data={data.decisionCore}/>\n    <DecisionMemoryPanel data={data.decisionMemory}/>\n    <AdaptiveResearchPanel sources={data.sourceReliability} forecasts={data.forecasts}/>\n",
'decision memory panel placement')
path.write_text(text,encoding='utf-8')
print('Decision memory UI integration applied.')
