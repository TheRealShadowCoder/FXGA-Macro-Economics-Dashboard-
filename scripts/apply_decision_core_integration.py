from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)

# Collector integration
path = Path('cloud-run-collector/src/super-economist.js')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import { buildInstitutionalResearch } from './institutional-research.js';\n",
    "import { buildInstitutionalResearch } from './institutional-research.js';\nimport { buildDecisionIntelligenceCore, governDecisionMatrix } from './decision-intelligence-core.js';\n",
    'super-economist import',
)
text = replace_once(
    text,
    "  const decision=buildDecisionMatrix({economies,events,news,now:new Date()});\n",
    "  const primaryDecision=buildDecisionMatrix({economies,events,news,now:new Date()});\n",
    'primary decision rename',
)
text = replace_once(
    text,
    "  const eventForecasts=events.filter(e=>Date.parse(e.date)>=Date.now()-6*3600000).slice(0,180).map(e=>eventForecast(e,economies.find(x=>x.id===eventEconomy(e))));\n  const special=specialEventModels(economies,decision),impact=releaseImpact(macroAnalysis,events),registry=registrySummary(context),activeFamilyCodes=new Set(economies.flatMap(e=>e.familyScores.filter(f=>f.independentWeight>0).map(f=>f.code))),topFamilies=economies.map(e=>({economy:e.id,families:e.familyScores.filter(f=>f.independentWeight>0).slice(0,30).map(compactFamily)}));\n  const research=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:decision?.currencyStates||[],opportunities:decision?.rankedOpportunities||[]});\n",
    "  const eventForecasts=events.filter(e=>Date.parse(e.date)>=Date.now()-6*3600000).slice(0,180).map(e=>eventForecast(e,economies.find(x=>x.id===eventEconomy(e))));\n  const decisionCore=buildDecisionIntelligenceCore({economies,decision:primaryDecision,observations,events,news,marketData,now:new Date()});\n  const decision=governDecisionMatrix(primaryDecision,decisionCore);\n  const special=specialEventModels(economies,decision),impact=releaseImpact(macroAnalysis,events),registry=registrySummary(context),activeFamilyCodes=new Set(economies.flatMap(e=>e.familyScores.filter(f=>f.independentWeight>0).map(f=>f.code))),topFamilies=economies.map(e=>({economy:e.id,families:e.familyScores.filter(f=>f.independentWeight>0).slice(0,30).map(compactFamily)}));\n  const researchBase=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:decision?.currencyStates||[],opportunities:decision?.rankedOpportunities||[]});\n  const research={...researchBase,decisionCore};\n",
    'decision core integration',
)
text = replace_once(
    text,
    "pipeline:['independent-family-collapse','eligible-evidence-confidence','economic-actual','central-bank-reaction','decayed-release-surprise','official-narrative','contradiction-audit','counterfactual-sensitivity','trade-probability','BUY-SELL-WAIT','frozen-audit']",
    "pipeline:['independent-family-collapse','eligible-evidence-confidence','economic-actual','central-bank-reaction','decayed-release-surprise','official-narrative','primary-decision','tempered-bayesian-update','expectation-gap','contradiction-governance','pair-differential-refinement','thesis-invalidation','BUY-SELL-WAIT','frozen-audit']",
    'pipeline upgrade',
)
text = replace_once(
    text,
    "decisionIntelligence:decision,research,intelligenceMatrix:decision.intelligenceMatrix",
    "decisionIntelligence:decision,decisionGovernance:decisionCore,research,intelligenceMatrix:decision.intelligenceMatrix",
    'decision governance output',
)
text = replace_once(
    text,
    "researchGates:{tau:.60,qMin:60,eventEdgeMin:60,waitFirstClass:true,minimumDecisionConfidence:38,dynamicThreshold:true}",
    "researchGates:{tau:.60,qMin:60,eventEdgeMin:60,waitFirstClass:true,minimumDecisionConfidence:38,dynamicThreshold:true,bayesianGovernance:true,contradictionVeto:true,primaryGovernanceAgreementRequired:true}",
    'research gates',
)
path.write_text(text, encoding='utf-8')

# Include new module in collector validation.
path = Path('cloud-run-collector/package.json')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "node --check src/intelligence-matrix.js && node --check src/super-economist.js",
    "node --check src/intelligence-matrix.js && node --check src/decision-intelligence-core.js && node --check src/super-economist.js",
    'collector check script',
)
path.write_text(text, encoding='utf-8')

# Research UI integration.
path = Path('src/components/ResearchView.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import './ResearchView.css';\n",
    "import './ResearchView.css';\nimport { DecisionCorePanel, type DecisionCorePayload } from './DecisionCorePanel';\n",
    'ResearchView import',
)
text = replace_once(
    text,
    "  operatingStandards:{slos:Array<{id:string;target:number;window:string;errorBudget:number}>;storageTiers:Record<string,{retention:string;purpose:string}>;validationState:string};\n",
    "  operatingStandards:{slos:Array<{id:string;target:number;window:string;errorBudget:number}>;storageTiers:Record<string,{retention:string;purpose:string}>;validationState:string};\n  decisionCore?:DecisionCorePayload;\n",
    'ResearchView payload',
)
text = replace_once(
    text,
    "    </section>\n\n    <section className=\"section-head\"><div><span className=\"eyebrow\">Risk Decomposition</span>",
    "    </section>\n\n    <DecisionCorePanel data={data.decisionCore}/>\n\n    <section className=\"section-head\"><div><span className=\"eyebrow\">Risk Decomposition</span>",
    'ResearchView panel placement',
)
path.write_text(text, encoding='utf-8')

print('Decision intelligence core integration applied successfully.')
