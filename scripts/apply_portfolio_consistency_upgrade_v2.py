from pathlib import Path

path=Path('cloud-run-collector/src/decision-intelligence-core.js')
text=path.read_text(encoding='utf-8')
old="decisionCore:{posterior:g.bayesian.posterior,refinedScore:g.refined.score,expectationGap:g.expectationGap,contradictions:g.contradictions,thesis:g.thesis,governanceReasons:reasons,dynamicThreshold:g.final.dynamicThreshold,causalTransmission:g.causalTransmission,counterfactual:g.counterfactual,temporalIntelligence:g.temporalIntelligence,transitionRisk:g.transitionRisk,historicalCalibration:g.historicalCalibration}"
new="decisionCore:{posterior:g.bayesian.posterior,refinedScore:g.refined.score,expectationGap:g.expectationGap,contradictions:g.contradictions,thesis:g.thesis,governanceReasons:reasons,dynamicThreshold:g.final.dynamicThreshold,causalTransmission:g.causalTransmission,counterfactual:g.counterfactual,temporalIntelligence:g.temporalIntelligence,transitionRisk:g.transitionRisk,evidenceIndependence:g.evidenceIndependence,scenarioRobustness:g.scenarioRobustness,modelHealth:g.modelHealth,historicalCalibration:g.historicalCalibration,uncertainty:g.uncertainty,premortem:g.premortem}"
if old not in text:
    raise SystemExit('portfolio advanced-field anchor missing')
text=text.replace(old,new,1)
path.write_text(text,encoding='utf-8')
print('Portfolio governance now preserves all advanced pair controls.')
