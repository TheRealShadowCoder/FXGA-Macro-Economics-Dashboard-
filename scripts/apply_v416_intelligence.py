from pathlib import Path


def replace_once(path, old, new):
    p=Path(path)
    text=p.read_text()
    if new in text:
        return False
    if old not in text:
        raise SystemExit(f'Anchor missing in {path}: {old[:140]!r}')
    text=text.replace(old,new,1)
    p.write_text(text)
    return True

# Decision governance: confidence-only realized event-reaction calibration.
path='cloud-run-collector/src/decision-intelligence-core.js'
replace_once(path,"const clamp=(v,min=-1,max=1)=>", "import { eventReactionCalibrationForPair } from './event-reaction-calibration.js';\n\nconst clamp=(v,min=-1,max=1)=>")
replace_once(path,"completenessFactor=Number(controls?.evidenceCompleteness?.factor||1),uncertaintyPenalty=", "completenessFactor=Number(controls?.evidenceCompleteness?.factor||1),eventReactionFactor=Number(controls?.eventReactionCalibration?.factor||1),uncertaintyPenalty=")
replace_once(path,"*breakFactor*independenceFactor*completenessFactor*uncertaintyPenalty", "*breakFactor*independenceFactor*completenessFactor*eventReactionFactor*uncertaintyPenalty")
replace_once(path,"evidenceIndependence=evidenceIndependenceControls(research,opportunity.symbol),catalysts=", "evidenceIndependence=evidenceIndependenceControls(research,opportunity.symbol),eventReactionCalibration=eventReactionCalibrationForPair({symbol:opportunity.symbol,opportunity,events,research,now}),catalysts=")
replace_once(path,"structuralBreak,evidenceIndependence,evidenceCompleteness,uncertainty});", "structuralBreak,evidenceIndependence,evidenceCompleteness,eventReactionCalibration,uncertainty});")
replace_once(path,"structuralBreak,evidenceIndependence,evidenceCompleteness,scenarioRobustness:scenario", "structuralBreak,evidenceIndependence,evidenceCompleteness,eventReactionCalibration,scenarioRobustness:scenario")
replace_once(path,"historicalAnalogues:g.historicalAnalogues,uncertainty:g.uncertainty", "historicalAnalogues:g.historicalAnalogues,eventReactionCalibration:g.eventReactionCalibration,uncertainty:g.uncertainty")
replace_once(path,"return {version:'1.4.0'", "return {version:'1.5.0'")
replace_once(path,"'nearest historical analogues can influence confidence only when they use prior frozen states with realized market outcomes','uncertainty is decomposed before execution'", "'nearest historical analogues can influence confidence only when they use prior frozen states with realized market outcomes','realized release-reaction memory calibrates only the release-derived confidence share and is attenuated when current regime-transition risk is elevated','uncertainty is decomposed before execution'")
replace_once(path,"governedConfidence:'C* = min(posterior directional probability, primary confidence) × contradictionPenalty × evidenceQuality',decision:", "eventReactionCalibration:'C_event = 1 + releaseExposure × (regimeConditionedReactionReliability − 1); C_event changes confidence only and never directional score',governedConfidence:'C* = min(posterior directional probability, primary confidence) × contradictionPenalty × evidenceQuality × governanceFactors × C_event',decision:")

# Future frozen states retain the new confidence control for later attribution.
path='cloud-run-collector/src/decision-memory.js'
replace_once(path,"    causalNet:Number(pair?.causalTransmission?.netTransmission||0)\n", "    causalNet:Number(pair?.causalTransmission?.netTransmission||0),\n    eventReactionFactor:Number(pair?.eventReactionCalibration?.factor||1),\n    eventReactionExposure:Number(pair?.eventReactionCalibration?.releaseExposure||0)\n")

# Research payload: attribution is research-only; event-reaction and policy-path research are also visible to governance context.
path='cloud-run-collector/src/super-economist.js'
replace_once(path,"import { buildDecisionIntelligenceCore, governDecisionMatrix } from './decision-intelligence-core.js';\n", "import { buildDecisionIntelligenceCore, governDecisionMatrix } from './decision-intelligence-core.js';\nimport { buildDecisionQualityAttribution } from './decision-quality-attribution.js';\n")
replace_once(path,"  const eventReactionResearch=buildEventReactionResearch(eventStudies);\n  const policyPathResearch=buildPolicyPathResearch(economyAnalysis,events);\n  const researchPre=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:primaryDecision?.currencyStates||[],opportunities:primaryDecision?.rankedOpportunities||[]});\n", "  const eventReactionResearch=buildEventReactionResearch(eventStudies);\n  const policyPathResearch=buildPolicyPathResearch(economyAnalysis,events);\n  const decisionQualityAttribution=buildDecisionQualityAttribution(decisionMemory);\n  const researchPreBase=buildInstitutionalResearch({observations,events,market:Array.isArray(marketData)?marketData:(marketData?.assets||[]),news,economyAnalysis,currencyStates:primaryDecision?.currencyStates||[],opportunities:primaryDecision?.rankedOpportunities||[]});\n  const researchPre={...researchPreBase,eventReactionResearch,policyPathResearch,decisionQualityAttribution};\n")
replace_once(path,"  const research={...researchBase,eventReactionResearch,policyPathResearch};\n", "  const research={...researchBase,eventReactionResearch,policyPathResearch,decisionQualityAttribution};\n")
replace_once(path,"'decayed-release-surprise','official-narrative'", "'decayed-release-surprise','regime-conditioned-event-reaction-calibration','official-narrative'")
replace_once(path,"'central-bank-reaction','decayed-release-surprise'", "'central-bank-reaction','multi-decision-policy-path-tree','decayed-release-surprise'")
replace_once(path,"'historical-decision-calibration','realized-event-reaction-research'", "'historical-decision-calibration','realized-decision-quality-attribution','realized-event-reaction-research'")

# Collector check covers new production modules.
path='cloud-run-collector/package.json'
replace_once(path,"node --check src/event-reaction-research.js && node --check src/policy-path-research.js", "node --check src/event-reaction-research.js && node --check src/event-reaction-calibration.js && node --check src/policy-path-research.js && node --check src/decision-quality-attribution.js")

# Research workspace exposes attribution explicitly.
path='src/components/ResearchView.tsx'
replace_once(path,"import { PolicyEventResearchPanel } from './PolicyEventResearchPanel';\n", "import { PolicyEventResearchPanel } from './PolicyEventResearchPanel';\nimport { DecisionAttributionPanel, type DecisionQualityAttribution } from './DecisionAttributionPanel';\n")
replace_once(path,"  policyPathResearch?:PolicyEventPanelProps['policyPath'];\n", "  policyPathResearch?:PolicyEventPanelProps['policyPath'];\n  decisionQualityAttribution?:DecisionQualityAttribution;\n")
replace_once(path,"    <DecisionMemoryPanel data={data.decisionMemory}/>\n", "    <DecisionMemoryPanel data={data.decisionMemory}/>\n    <DecisionAttributionPanel data={data.decisionQualityAttribution}/>\n")

# Pair audit exposes the exact event-reaction multiplier and active measured releases.
path='src/components/AdvancedGovernancePanel.tsx'
replace_once(path,"  crossAsset?:{available:boolean;score:number;alignment:string;status:string;availableFactors:number;used?:Array<{id:string;weight:number;score:number;changePercent:number;stale?:boolean}>};\n", "  crossAsset?:{available:boolean;score:number;alignment:string;status:string;availableFactors:number;used?:Array<{id:string;weight:number;score:number;changePercent:number;stale?:boolean}>};\n  eventReactionCalibration?:{available:boolean;status:string;factor:number;rawProfileFactor?:number;releaseExposure:number;activeEvents:Array<{event:string;currency:string;category:string;ageHours:number;profileStatus:string;profileAgreement:number|null;reversalRisk:number|null;regimeTransitionRisk:number|null;conditionedFactor:number}>;methodology:string};\n")
replace_once(path,"p.crossAsset||p.evidenceCompleteness", "p.crossAsset||p.eventReactionCalibration||p.evidenceCompleteness")
replace_once(path,"cross=pair.crossAsset,complete=", "cross=pair.crossAsset,eventCalibration=pair.eventReactionCalibration,complete=")
replace_once(path,"          <div><small>Cross asset</small><strong className={quality(cross?.alignment)}>{cross?.available?cross.alignment:'Not available'}</strong><span>{cross?.available?`${sign(cross.score)} · ${cross.availableFactors} factors`:'Insufficient factors'}</span></div>\n", "          <div><small>Cross asset</small><strong className={quality(cross?.alignment)}>{cross?.available?cross.alignment:'Not available'}</strong><span>{cross?.available?`${sign(cross.score)} · ${cross.availableFactors} factors`:'Insufficient factors'}</span></div>\n          <div><small>Release reaction calibration</small><strong className={quality(eventCalibration?.status)}>{eventCalibration?.available?eventCalibration.status.replaceAll('-',' '):'Inactive'}</strong><span>{eventCalibration?.available?`Confidence × ${n(eventCalibration.factor,3)} · release share ${pct(eventCalibration.releaseExposure)}`:'No active measured-release adjustment'}</span></div>\n")
replace_once(path,"          {cross?.used?.length?<><strong>Cross asset factors</strong>", "          {eventCalibration?.activeEvents?.length?<><strong>Realized release-reaction calibration</strong>{eventCalibration.activeEvents.slice(0,5).map((x,i)=><p key={i}>{x.currency} {x.category}: {x.event} · profile {x.profileStatus.replaceAll('-',' ')} · agreement {x.profileAgreement==null?'—':pct(x.profileAgreement)} · regime transition {x.regimeTransitionRisk==null?'—':pct(x.regimeTransitionRisk)} · conditioned factor {n(x.conditionedFactor,3)}.</p>)}</>:null}\n          {cross?.used?.length?<><strong>Cross asset factors</strong>")

print('v4.16 integration patch applied')
