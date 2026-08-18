from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1: raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old,new,1)

path=Path('src/components/ResearchView.tsx')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"import { useEffect, useMemo, useState } from 'react';\n",
"import { useEffect, useMemo, useState, type ComponentProps } from 'react';\n",
'component props import')
text=replace_once(text,
"import { TransitionResearchPanel } from './TransitionResearchPanel';\n",
"import { TransitionResearchPanel } from './TransitionResearchPanel';\nimport { PolicyEventResearchPanel } from './PolicyEventResearchPanel';\n",
'policy event panel import')
text=replace_once(text,
"type Regime={economy:string;family:string;score:number;state:string;transitionProbability:number;sampleSize:number};\n",
"type Regime={economy:string;family:string;score:number;state:string;transitionProbability:number;sampleSize:number};\ntype PolicyEventPanelProps=ComponentProps<typeof PolicyEventResearchPanel>;\n",
'policy event prop types')
text=replace_once(text,
"  catalystSequence?:CatalystSequence;\n",
"  catalystSequence?:CatalystSequence;\n  eventReactionResearch?:PolicyEventPanelProps['eventReaction'];\n  policyPathResearch?:PolicyEventPanelProps['policyPath'];\n",
'policy event research payload')
text=replace_once(text,
"    <TransitionResearchPanel turningPoints={data.turningPoints} catalystSequence={data.catalystSequence} persistence={data.releaseAnalytics.persistence}/>\n",
"    <TransitionResearchPanel turningPoints={data.turningPoints} catalystSequence={data.catalystSequence} persistence={data.releaseAnalytics.persistence}/>\n    <PolicyEventResearchPanel eventReaction={data.eventReactionResearch} policyPath={data.policyPathResearch}/>\n",
'policy event panel placement')
path.write_text(text,encoding='utf-8')
print('Policy and event reaction research UI integrated.')
