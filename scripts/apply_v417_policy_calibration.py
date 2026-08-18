from pathlib import Path


def replace_once(path,old,new):
    p=Path(path);text=p.read_text()
    if new in text:return False
    if old not in text:raise SystemExit(f'Anchor missing in {path}: {old[:150]!r}')
    p.write_text(text.replace(old,new,1));return True

# Attach calibration summary to research without using it as a directional vote.
path='cloud-run-collector/src/super-economist.js'
replace_once(path,"export function buildSuperEconomist({observations=[],events=[],news=[],familyReliability={},marketData=null,decisionMemory=null,eventStudies=null}={}){", "export function buildSuperEconomist({observations=[],events=[],news=[],familyReliability={},marketData=null,decisionMemory=null,eventStudies=null,policyCalibration=null}={}){")
replace_once(path,"const researchPre={...researchPreBase,eventReactionResearch,policyPathResearch,decisionQualityAttribution};", "const researchPre={...researchPreBase,eventReactionResearch,policyPathResearch,decisionQualityAttribution,policyCalibration};")
replace_once(path,"const research={...researchBase,eventReactionResearch,policyPathResearch,decisionQualityAttribution};", "const research={...researchBase,eventReactionResearch,policyPathResearch,decisionQualityAttribution,policyCalibration};")
replace_once(path,"'model-implied-policy-path','release-sequence'", "'model-implied-policy-path','frozen-policy-probability-audit','release-sequence'")

# Runtime freezes probabilities before meetings, then scores only realized policy outcomes.
path='cloud-run-collector/src/super-runtime.js'
replace_once(path,"import { evaluateDecisionMemory, readDecisionMemorySummary, recordDecisionMemory } from './decision-memory.js';\n", "import { evaluateDecisionMemory, readDecisionMemorySummary, recordDecisionMemory } from './decision-memory.js';\nimport { freezePolicyForecasts, scorePolicyForecasts, readPolicyCalibrationSummary } from './policy-calibration.js';\n")
old="""  let memorySummary=null,memoryEvaluation={evaluatedHorizons:0,completed:0,expired:0};
  try{const evaluated=await evaluateDecisionMemory({limit:60});memorySummary=evaluated.summary;memoryEvaluation={evaluatedHorizons:evaluated.evaluatedHorizons,completed:evaluated.completed,expired:evaluated.expired};}catch(error){console.warn('Decision memory evaluation deferred:',String(error?.message||error).slice(0,220));memorySummary=await readDecisionMemorySummary().catch(()=>null);}
  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary,eventStudies:eventStudyPayload});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary,eventStudies:eventStudyPayload});const frozen=await freeze(engine,events);
  let memoryRecord={recorded:0,skipped:0,total:0};try{memoryRecord=await recordDecisionMemory(engine,marketData);}catch(error){console.warn('Decision memory recording deferred:',String(error?.message||error).slice(0,220));}
  let payload={...engine,news:news.items||[],newsSourceHealth:news.sourceHealth||{},fredCatalog:buildFredCatalog(universe?.payload),globalMacro:group(observations,macro?.payload?.generatedAt),audit:{frozenThisRun:frozen,scoredThisRun:scored,decisionMemory:{...memoryEvaluation,...memoryRecord}}};payload={...payload,operationalHealth:operationalHealth({calendar,macro,news,intelligence:payload})};
"""
new="""  let memorySummary=null,memoryEvaluation={evaluatedHorizons:0,completed:0,expired:0};
  try{const evaluated=await evaluateDecisionMemory({limit:60});memorySummary=evaluated.summary;memoryEvaluation={evaluatedHorizons:evaluated.evaluatedHorizons,completed:evaluated.completed,expired:evaluated.expired};}catch(error){console.warn('Decision memory evaluation deferred:',String(error?.message||error).slice(0,220));memorySummary=await readDecisionMemorySummary().catch(()=>null);}
  let policyCalibration=null,policyEvaluation={scored:0};
  try{const evaluated=await scorePolicyForecasts(events);policyCalibration=evaluated.summary;policyEvaluation={scored:evaluated.scored};}catch(error){console.warn('Policy calibration evaluation deferred:',String(error?.message||error).slice(0,220));policyCalibration=await readPolicyCalibrationSummary().catch(()=>null);}
  let engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary,eventStudies:eventStudyPayload,policyCalibration});const scored=await scoreFrozen(events,skills);if(scored)engine=buildSuperEconomist({observations,events,news:news.items||[],familyReliability:skills,marketData,decisionMemory:memorySummary,eventStudies:eventStudyPayload,policyCalibration});const frozen=await freeze(engine,events);
  let policyFreeze={frozen:0,skipped:0};try{policyFreeze=await freezePolicyForecasts(engine?.research?.policyPathResearch,events);}catch(error){console.warn('Policy forecast freeze deferred:',String(error?.message||error).slice(0,220));}
  let memoryRecord={recorded:0,skipped:0,total:0};try{memoryRecord=await recordDecisionMemory(engine,marketData);}catch(error){console.warn('Decision memory recording deferred:',String(error?.message||error).slice(0,220));}
  let payload={...engine,news:news.items||[],newsSourceHealth:news.sourceHealth||{},fredCatalog:buildFredCatalog(universe?.payload),globalMacro:group(observations,macro?.payload?.generatedAt),audit:{frozenThisRun:frozen,scoredThisRun:scored,decisionMemory:{...memoryEvaluation,...memoryRecord},policyCalibration:{...policyEvaluation,...policyFreeze}}};payload={...payload,operationalHealth:operationalHealth({calendar,macro,news,intelligence:payload})};
"""
replace_once(path,old,new)

# Collector syntax coverage.
path='cloud-run-collector/package.json'
replace_once(path,"node --check src/policy-path-research.js && node --check src/decision-quality-attribution.js", "node --check src/policy-path-research.js && node --check src/policy-calibration.js && node --check src/decision-quality-attribution.js")

# Research workspace scorecard.
path='src/components/ResearchView.tsx'
replace_once(path,"import { DecisionAttributionPanel, type DecisionQualityAttribution } from './DecisionAttributionPanel';\n", "import { DecisionAttributionPanel, type DecisionQualityAttribution } from './DecisionAttributionPanel';\nimport { PolicyCalibrationPanel, type PolicyCalibrationResearch } from './PolicyCalibrationPanel';\n")
replace_once(path,"  decisionQualityAttribution?:DecisionQualityAttribution;\n", "  decisionQualityAttribution?:DecisionQualityAttribution;\n  policyCalibration?:PolicyCalibrationResearch|null;\n")
replace_once(path,"    <PolicyEventResearchPanel eventReaction={data.eventReactionResearch} policyPath={data.policyPathResearch}/>\n", "    <PolicyEventResearchPanel eventReaction={data.eventReactionResearch} policyPath={data.policyPathResearch}/>\n    <PolicyCalibrationPanel data={data.policyCalibration}/>\n")

print('v4.17 policy calibration integration applied')
