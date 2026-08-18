import assert from 'node:assert/strict';
import { QUALITY_CONTROL_FAMILIES, QUALITY_METHOD_REGISTRY, buildQualityCalibrationEvidence } from '../src/quality-calibration-evidence.js';

assert.equal(QUALITY_CONTROL_FAMILIES.length,20,'Expected exactly 20 quality-control families');
assert.equal(QUALITY_METHOD_REGISTRY.length,1000,'Expected exactly 1000 quality-control methods');
assert.equal(new Set(QUALITY_METHOD_REGISTRY.map(method=>method.id)).size,1000,'Quality-control method IDs must be unique');
for(const family of QUALITY_CONTROL_FAMILIES){
  assert.equal(family.dimensions.length,10,`${family.id} must contain 10 dimensions`);
  assert.equal(QUALITY_METHOD_REGISTRY.filter(method=>method.familyId===family.id).length,50,`${family.id} must register exactly 50 methods`);
}

const empty=buildQualityCalibrationEvidence();
assert.equal(empty.registeredMethods,1000);
assert.equal(empty.registeredFamilies,20);
assert.equal(empty.families.length,20);
assert.equal(empty.methods.length,1000);
for(const family of empty.families){
  assert.ok(Number.isFinite(family.score),`${family.id} score must be finite`);
  assert.ok(family.score>=0&&family.score<=100,`${family.id} score must remain within 0..100`);
  assert.ok(Number.isFinite(family.confidence),`${family.id} confidence must be finite`);
  if(family.evidencePoints===0)assert.equal(family.state,'registered',`${family.id} cannot be measured without evidence`);
}

const healthy=buildQualityCalibrationEvidence({
  research:{
    generatedAt:new Date().toISOString(),
    dataQuality:{overall:94,scores:{coverage:96,history:91,freshness:93,anomaly:97}},
    sourceReliability:[
      {source:'official-a',score:95,numericCoverage:.98,freshness:.95,historyDepth:.90,anomalyRate:.01},
      {source:'official-b',score:91,numericCoverage:.96,freshness:.92,historyDepth:.86,anomalyRate:.02},
      {source:'market-a',score:88,numericCoverage:.94,freshness:.97,historyDepth:.82,anomalyRate:.03},
    ],
    evidenceIndependence:{independenceRatio:.82,effectiveSignals:28},
    forecasts:[
      {sampleSize:260,validationPoints:120,modelAgreement:.78,calibrationConfidence:.81,modelDispersion:.18,uncertainty:.20,walkForwardRmse:{ar1:.8,ets:.7}},
      {sampleSize:240,validationPoints:110,modelAgreement:.75,calibrationConfidence:.79,modelDispersion:.20,uncertainty:.22,walkForwardRmse:{ar1:.9,ets:.75}},
    ],
    regimes:[{transitionProbability:.18,sampleSize:180},{transitionProbability:.22,sampleSize:170}],
    risk:{aggregate:24,confidenceAfterRisk:76,categories:[{score:20},{score:30},{score:22}]},
    operatingStandards:{validationState:'passed',slos:[{target:99.5,errorBudget:.5},{target:99,errorBudget:1}],storageTiers:{hot:{retention:'30d'},warm:{retention:'1y'}}},
    decisionQualityAttribution:{available:true},
    policyCalibration:{available:true},
  },
  decisionCore:{
    evidenceQuality:{score:89,coverage:.92,freshness:.91,historyDepth:.86,sourceBreadth:.84},
    audit:{pairCount:2,directionalCount:2,waitCount:0,governanceVetoes:0,averageGovernedConfidence:75},
    contradictionSummary:{contained:2,material:0,severe:0,total:2},
    pairDecisions:[
      {
        quality:{score:88,status:'qualified'},evidenceIndependence:{independenceRatio:.84},historicalCalibration:{samples:180,hitRate:.64,brier:.19},modelHealth:{score:85},uncertainty:{score:20},scenarioRobustness:{available:true,score:82,matches:4,flips:0,waits:1,total:5},transitionRisk:{maxRisk:19},final:{direction:'BUY',confidence:77,executionGate:'pass'},contradictions:{count:1,weightedSeverity:10,status:'contained'},
        crossAsset:{available:true,score:78,availableFactors:5},evidenceCompleteness:{score:91,mandatoryMissing:[],missing:['positioning'],available:['macro','policy','rates','market','calendar']},structuralBreak:{risk:18,factor:.9,status:'stable'},horizonCalibration:{rows:{'4h':{samples:100,brier:.18,empiricalHitRate:.66},'1d':{samples:90,brier:.20,empiricalHitRate:.63}}},historicalAnalogues:{samples:85,weightedHitRate:.65,averageSimilarity:.81},
      },
      {
        quality:{score:84,status:'qualified'},evidenceIndependence:{independenceRatio:.79},historicalCalibration:{samples:160,hitRate:.62,brier:.21},modelHealth:{score:82},uncertainty:{score:24},scenarioRobustness:{available:true,score:78,matches:4,flips:1,waits:0,total:5},transitionRisk:{maxRisk:24},final:{direction:'SELL',confidence:73,executionGate:'pass'},contradictions:{count:1,weightedSeverity:14,status:'contained'},
        crossAsset:{available:true,score:74,availableFactors:4},evidenceCompleteness:{score:88,mandatoryMissing:[],missing:['positioning'],available:['macro','policy','rates','market']},structuralBreak:{risk:22,factor:.88,status:'stable'},horizonCalibration:{rows:{'4h':{samples:95,brier:.20,empiricalHitRate:.64},'1d':{samples:88,brier:.22,empiricalHitRate:.61}}},historicalAnalogues:{samples:78,weightedHitRate:.63,averageSimilarity:.78},
      },
    ],
  },
  decisionMemory:{sampledDecisions:220,directionalRecorded:200,horizons:{'4h':{count:110,hitRate:.65,nonLossRate:.72,brier:.19},'1d':{count:100,hitRate:.63,nonLossRate:.70,brier:.21}}},
  registry:{totalMethods:9705},
});

assert.equal(healthy.registeredMethods,1000);
assert.equal(healthy.methods.length,1000);
assert.ok(healthy.overall>=1&&healthy.overall<=100,'Overall quality must remain within 1..100');
for(const value of Object.values(healthy.pillars))assert.ok(Number.isFinite(value)&&value>=1&&value<=100,'Every quality pillar must be finite and bounded');
for(const family of healthy.families){
  assert.ok(Number.isFinite(family.score)&&family.score>=0&&family.score<=100,`${family.id} score invalid`);
  assert.ok(Number.isFinite(family.confidence)&&family.confidence>=0&&family.confidence<=100,`${family.id} confidence invalid`);
  if(family.evidencePoints===0)assert.equal(family.state,'registered',`${family.id} cannot claim measurement without evidence`);
}
assert.match(healthy.nonFabricationPolicy,/never become measured/i,'Non-fabrication policy must remain explicit');
console.log(JSON.stringify({ok:true,registeredMethods:healthy.registeredMethods,families:healthy.registeredFamilies,overall:healthy.overall,status:healthy.status,measuredFamilies:healthy.measuredFamilies,supportedFamilies:healthy.supportedFamilies}));
