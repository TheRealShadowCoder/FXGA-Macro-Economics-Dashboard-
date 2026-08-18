from pathlib import Path


def replace_once(text,old,new,label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)

path=Path('src/components/ResearchView.tsx')
text=path.read_text(encoding='utf-8')
if "import { AdvancedGovernancePanel } from './AdvancedGovernancePanel';" not in text:
    text=replace_once(text,"import { DecisionCorePanel, type DecisionCorePayload } from './DecisionCorePanel';\n","import { DecisionCorePanel, type DecisionCorePayload } from './DecisionCorePanel';\nimport { AdvancedGovernancePanel } from './AdvancedGovernancePanel';\n",'advanced governance import')
if '<AdvancedGovernancePanel data={data.decisionCore}/>' not in text:
    text=replace_once(text,"    <DecisionCorePanel data={data.decisionCore}/>\n","    <DecisionCorePanel data={data.decisionCore}/>\n    <AdvancedGovernancePanel data={data.decisionCore}/>\n",'advanced governance placement')
path.write_text(text,encoding='utf-8')
print('Advanced governance UI integrated.')
