from pathlib import Path
import json


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected 1 anchor, found {count}')
    return text.replace(old,new,1)

# Wire research modules into the main research engine.
path=Path('cloud-run-collector/src/super-economist.js')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"import { buildDecisionIntelligenceCore, governDecisionMatrix } from './decision-intelligence-core.js';\n",
"import { buildDecisionIntelligenceCore, governDecisionMatrix } from './decision-intelligence-core.js';\nimport { buildEventReactionResearch } from './event-reaction-research.js';\nimport { buildPolicyPathResearch } from './policy-path-research.js';\n",
'new research imports')
text=replace_once(text,
"export function buildSuperEconomist({observations=[],events=[],news=[],familyReliability={},marketData=null,decisionMemory=null}={}){",
"export function buildSuperEconomist({observations=[],events=[],news=[],familyReliability={},marketData=null,decisionMemory=null,eventStudies=null}={}){",
'buildSuperEconomist signature')
text=replace_once(text,
"  const eventForecasts=events.filter(e=>Date.parse(e.date)>=Date.now()-6*3600000).slice(0,180).map(e=>eventForecast(e,economies.find(x=>x.id===eventEconomy(e))));\n",
"  const eventForecasts=events.filter(e=>Date.parse(e.date)>=Date.now()-6*3600000).slice(0,180).map(e=>eventForecast(e,economies.find(x=>x.id===eventEconomy(e))));\n  const eventReactionResearch=buildEventReactionResearch(eventStudies);\n  const policyPathResearch=buildPolicyPathResearch(economyAnalysis,events);\n",
'research construction')
text=replace_once(text,
"  const research=researchBase;\n",
"  const research={...researchBase,eventReactionResearch,policyPathResearch};\n",
'research output integration')
text=replace_once(text,
"'historical-decision-calibration','release-sequence'",
"'historical-decision-calibration','realized-event-reaction-research','model-implied-policy-path','release-sequence'",
'pipeline research labels')
path.write_text(text,encoding='utf-8')

# Feed persisted event-study state into every intelligence refresh/rebuild.
path=Path('cloud-run-collector/src/super-runtime.js')
text=path.read_text(encoding='utf-8')
text=replace_once(text,
"  const [calendar,macro,universe,market]=await Promise.all([get('calendar'),get('macro'),get('fred-universe'),get('market')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],marketData=market?.payload?.assets||[],news=await ensureNews(forceNews),skills=await reliability();",
"  const [calendar,macro,universe,market,eventStudyState]=await Promise.all([get('calendar'),get('macro'),get('fred-universe'),get('market'),get('event-studies')]),events=calendar?.payload?.events||[],observations=macro?.payload?.observations||[],marketData=market?.payload?.assets||[],eventStudyPayload=eventStudyState?.payload||null,news=await ensureNews(forceNews),skills=await reliability();",
'event study state read')
text=replace_once(text,
"  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary});const frozen=await freeze(engine,events);",
"  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary,eventStudies:eventStudyPayload});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary,eventStudies:eventStudyPayload});const frozen=await freeze(engine,events);",
'event study engine input')
path.write_text(text,encoding='utf-8')

# Keep syntax validation aware of the new modules.
path=Path('cloud-run-collector/package.json')
pkg=json.loads(path.read_text(encoding='utf-8'))
check=pkg['scripts']['check']
needle='node --check src/event-study-backfill.js'
insert='node --check src/event-study-backfill.js && node --check src/event-reaction-research.js && node --check src/policy-path-research.js'
if 'src/event-reaction-research.js' not in check:
    if needle not in check: raise SystemExit('package check anchor missing')
    pkg['scripts']['check']=check.replace(needle,insert,1)
path.write_text(json.dumps(pkg,indent=2)+'\n',encoding='utf-8')
print('Event reaction and policy path research integrated into production intelligence refresh.')
