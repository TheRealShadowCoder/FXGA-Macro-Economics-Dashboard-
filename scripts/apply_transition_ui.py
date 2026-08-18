from pathlib import Path


def replace_once(text,old,new,label):
    c=text.count(old)
    if c!=1: raise SystemExit(f'{label}: expected 1 anchor, found {c}')
    return text.replace(old,new,1)

path=Path('src/components/ResearchView.tsx')
text=path.read_text(encoding='utf-8')
text=replace_once(text,"import { DecisionMemoryPanel } from './DecisionMemoryPanel';\n","import { DecisionMemoryPanel } from './DecisionMemoryPanel';\nimport { TransitionResearchPanel } from './TransitionResearchPanel';\n",'transition import')
text=replace_once(text,
"type ReleaseProfile={currency:string;family:string;count:number;bullishRate:number;bearishRate:number;meanAbsSurprise:number;meanWeightedSurprise:number};\n",
"type ReleaseProfile={currency:string;family:string;count:number;bullishRate:number;bearishRate:number;meanAbsSurprise:number;meanWeightedSurprise:number};\ntype ReleasePersistence={currency:string;family:string;count:number;streak:number;recentMean:number;priorMean:number;acceleration:number;consistency:number;status:string};\ntype TurningFamily={economy:string;family:string;series:number;risk:number;status:string;reversals:number;averageAcceleration:number;breadth:number;direction:string;topSeries:Array<{seriesId:string;title:string;turningPointScore:number;slopeReversal:boolean}>};\ntype TurningPoints={economies:Array<{economy:string;risk:number;highFamilies:number;watchFamilies:number;direction:string;families:TurningFamily[]}>;rows:TurningFamily[];highRisk:number;watch:number};\ntype CatalystSequence={windowHours:number;currencies:Array<{currency:string;events:number;highImpact:number;clusters:number;nearestGapMinutes:number|null;densityScore:number;status:string;next:Array<{event:string;date:string;importance:number;category:string}>}>;totalUpcoming:number;denseCurrencies:number};\n",
'transition types')
text=replace_once(text,
"  releaseAnalytics:{completed:number;profiles:ReleaseProfile[]};\n",
"  releaseAnalytics:{completed:number;profiles:ReleaseProfile[];persistence?:ReleasePersistence[]};\n  turningPoints?:TurningPoints;\n  catalystSequence?:CatalystSequence;\n",
'transition payload')
text=replace_once(text,
"    <DecisionMemoryPanel data={data.decisionMemory}/>\n    <AdaptiveResearchPanel sources={data.sourceReliability} forecasts={data.forecasts}/>\n",
"    <DecisionMemoryPanel data={data.decisionMemory}/>\n    <AdaptiveResearchPanel sources={data.sourceReliability} forecasts={data.forecasts}/>\n    <TransitionResearchPanel turningPoints={data.turningPoints} catalystSequence={data.catalystSequence} persistence={data.releaseAnalytics.persistence}/>\n",
'transition panel placement')
path.write_text(text,encoding='utf-8')
print('Transition research UI integration applied.')
