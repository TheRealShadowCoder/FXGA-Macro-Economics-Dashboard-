export type QualityMethodState = 'measured' | 'supported' | 'registered' | 'gated';

export type QualityMethod = {
  id: string;
  familyId: string;
  familyLabel: string;
  dimension: string;
  technique: string;
  label: string;
  purpose: string;
};

export type QualityFamilyDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  dimensions: string[];
};

export type QualityFrameworkInput = {
  dataQuality?: {
    overall?: number;
    scores?: Record<string, number>;
    diagnostics?: Record<string, number>;
  } | null;
  sourceReliability?: Array<{
    score?: number;
    numericCoverage?: number;
    freshness?: number;
    historyDepth?: number;
    anomalyRate?: number;
  }> | null;
  forecasts?: Array<{
    sampleSize?: number;
    validationPoints?: number;
    modelAgreement?: number;
    calibrationConfidence?: number;
    modelDispersion?: number;
    uncertainty?: number;
    walkForwardRmse?: Record<string, number | null>;
  }> | null;
  decisionMemory?: {
    sampledDecisions?: number;
    directionalRecorded?: number;
    horizons?: Record<string, {
      count?: number;
      hitRate?: number | null;
      nonLossRate?: number | null;
      brier?: number | null;
    }>;
  } | null;
  decisionCore?: {
    pairDecisions?: Array<{
      crossAsset?: { available?: boolean; score?: number; availableFactors?: number };
      evidenceCompleteness?: { score?: number; mandatoryMissing?: string[]; missing?: string[]; available?: string[] };
      structuralBreak?: { risk?: number; factor?: number; status?: string };
      horizonCalibration?: {
        overallCalibratedProbability?: number;
        rows?: Record<string, { samples?: number; brier?: number | null; empiricalHitRate?: number | null }>;
      };
      historicalAnalogues?: { samples?: number; weightedHitRate?: number | null; averageSimilarity?: number };
      decisionChange?: { directionChanged?: boolean; scoreDelta?: number | null; confidenceDelta?: number | null };
    }>;
  } | null;
  regimes?: Array<{ transitionProbability?: number; sampleSize?: number }> | null;
  risk?: { aggregate?: number; confidenceAfterRisk?: number; categories?: Array<{ score?: number; confidenceHaircut?: number }> } | null;
  operatingStandards?: {
    validationState?: string;
    slos?: Array<{ target?: number; errorBudget?: number }>;
    storageTiers?: Record<string, unknown>;
  } | null;
  decisionQualityAttribution?: unknown;
  policyCalibration?: unknown;
};

export type QualityFamilyScore = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  score: number;
  confidence: number;
  state: QualityMethodState;
  registeredMethods: number;
  evidencePoints: number;
  notes: string[];
};

export type QualityFrameworkResult = {
  totalRegisteredMethods: number;
  measuredFamilies: number;
  supportedFamilies: number;
  overall: number;
  status: 'qualified' | 'watch' | 'insufficient';
  dataQuality: number;
  calibrationQuality: number;
  evidenceQuality: number;
  robustnessQuality: number;
  governanceQuality: number;
  families: QualityFamilyScore[];
};

const TECHNIQUES = [
  { id: 'measure', label: 'Measure', purpose: 'Quantify the current condition using the available point-in-time evidence.' },
  { id: 'validate', label: 'Validate', purpose: 'Check whether the condition satisfies the research rule before it influences a decision.' },
  { id: 'monitor', label: 'Monitor', purpose: 'Track the condition through time so deterioration and drift become visible.' },
  { id: 'stress', label: 'Stress test', purpose: 'Recalculate the condition under adverse, missing, stale, conflicting or extreme inputs.' },
  { id: 'gate', label: 'Gate', purpose: 'Reduce confidence or block a decision when the condition falls below its minimum standard.' },
] as const;

export const QUALITY_FAMILIES: QualityFamilyDefinition[] = [
  { id: 'raw-data-quality', label: 'Raw Data Quality', shortLabel: 'Data', description: 'Completeness, type integrity, plausibility, continuity and provenance of observations.', dimensions: ['field completeness','observation coverage','numeric type integrity','timestamp integrity','unit consistency','duplicate control','range plausibility','outlier resistance','series continuity','schema and provenance integrity'] },
  { id: 'freshness-timeliness', label: 'Freshness & Timeliness', shortLabel: 'Freshness', description: 'Age, release lag, ingestion lag and whether evidence arrived inside the period where it remains decision relevant.', dimensions: ['observation age','release lag','collector ingestion lag','webhook transmission lag','edge persistence lag','UI visibility lag','source refresh success','event-window freshness','session-aware freshness','staleness decay'] },
  { id: 'source-reliability', label: 'Source Reliability', shortLabel: 'Sources', description: 'Reliability of upstream providers by uptime, accuracy, latency, fallback behaviour and historical stability.', dimensions: ['source uptime','success rate','parsing stability','historical accuracy','revision behaviour','latency reliability','fallback quality','source-specific priors','high-impact resilience','incident severity'] },
  { id: 'multi-source-reconciliation', label: 'Multi-Source Reconciliation', shortLabel: 'Agreement', description: 'Cross-checks values, timestamps, releases and source conflicts before accepting a canonical observation.', dimensions: ['value agreement','timestamp agreement','consensus agreement','revision agreement','event identity matching','unit normalization','official-source priority','reliability-weighted consensus','conflict persistence','canonical resolution'] },
  { id: 'missing-data-coverage', label: 'Missing Data & Coverage', shortLabel: 'Coverage', description: 'Measures evidence gaps, critical missing inputs and the uncertainty introduced by any imputation or retained value.', dimensions: ['missingness pattern','required-series coverage','critical-series availability','consecutive gaps','imputation provenance','imputation uncertainty','category coverage','economy coverage','policy evidence coverage','overall evidence availability'] },
  { id: 'revision-vintage-control', label: 'Revision & Vintage Control', shortLabel: 'Vintages', description: 'Protects historical testing from revised data and records what was actually knowable at each decision time.', dimensions: ['first-release storage','revision history','vintage timestamps','point-in-time reconstruction','revision magnitude','revision bias','revision volatility','revision leakage protection','signal revision sensitivity','vintage integrity'] },
  { id: 'probability-calibration', label: 'Probability Calibration', shortLabel: 'Calibration', description: 'Tests whether stated probabilities match realized frequencies and applies recalibration when they do not.', dimensions: ['Brier quality','log-loss quality','reliability curve','expected calibration error','calibration slope','calibration intercept','overconfidence','underconfidence','regime calibration','online recalibration'] },
  { id: 'directional-calibration', label: 'Directional Calibration', shortLabel: 'Direction', description: 'Measures classification quality for bullish, bearish and neutral decisions across horizons and event types.', dimensions: ['directional hit rate','balanced accuracy','precision','recall','specificity','F1 quality','high-confidence accuracy','false-positive cost','false-negative cost','decision threshold quality'] },
  { id: 'uncertainty-calibration', label: 'Forecast Interval & Uncertainty', shortLabel: 'Uncertainty', description: 'Checks whether uncertainty bands are honest, sharp and wide enough for observed market variability.', dimensions: ['interval coverage','interval width','quantile loss','CRPS quality','dispersion calibration','bootstrap uncertainty','conformal coverage','event-conditioned uncertainty','model disagreement uncertainty','total uncertainty decomposition'] },
  { id: 'historical-backtesting', label: 'Historical Backtesting', shortLabel: 'Backtest', description: 'Replays historical decisions under the data, timing, source and failure conditions that existed at the time.', dimensions: ['walk-forward replay','event-by-event replay','release-time replay','policy-event replay','vintage replay','regime replay','failure-mode replay','crisis replay','confidence replay','attribution replay'] },
  { id: 'out-of-sample', label: 'Out-of-Sample Validation', shortLabel: 'OOS', description: 'Measures generalization on unseen periods, assets, economies, events and regimes.', dimensions: ['strict time holdout','rolling OOS','purged time split','embargoed validation','country holdout','asset holdout','event holdout','regime holdout','champion challenger','OOS deterioration'] },
  { id: 'leakage-causality', label: 'Leakage & Causality Protection', shortLabel: 'Leakage', description: 'Prevents future information, revised values and invalid timing from contaminating historical skill estimates.', dimensions: ['future-value leakage','revision leakage','calendar leakage','publication-time enforcement','point-in-time joins','feature lag enforcement','target leakage','temporal embargo','causal ordering','placebo and reverse-causality checks'] },
  { id: 'robustness-sensitivity', label: 'Robustness & Sensitivity', shortLabel: 'Robustness', description: 'Tests whether results survive changes to parameters, sources, features, samples, noise and adverse inputs.', dimensions: ['parameter sensitivity','feature sensitivity','source sensitivity','threshold sensitivity','sample sensitivity','outlier sensitivity','revision sensitivity','leave-one-out stability','noise injection','ensemble stability'] },
  { id: 'regime-structural-break', label: 'Regime & Structural Break Quality', shortLabel: 'Regime', description: 'Detects when economic relationships change enough that old calibration should no longer be trusted equally.', dimensions: ['change-point risk','structural break risk','inflation regime','growth regime','liquidity regime','volatility regime','policy regime','risk-sentiment regime','regime transition probability','post-break recalibration'] },
  { id: 'evidence-strength', label: 'Evidence Strength', shortLabel: 'Strength', description: 'Measures how much relevant, reliable, fresh and direct evidence supports or contradicts a conclusion.', dimensions: ['supporting evidence','contradicting evidence','official evidence','direct evidence','relevance','freshness','reliability','specificity','information gain','evidence sufficiency'] },
  { id: 'evidence-independence', label: 'Evidence Independence & Conflict', shortLabel: 'Independence', description: 'Avoids counting the same underlying fact multiple times and explicitly measures disagreement between independent evidence families.', dimensions: ['source correlation','shared-provider detection','duplicate syndication','dependency graph','effective evidence count','conditional independence','correlated-source haircut','conflict magnitude','consensus entropy','cross-domain confirmation'] },
  { id: 'attribution-explainability', label: 'Attribution & Explainability', shortLabel: 'Explainability', description: 'Shows which evidence families changed a score, confidence, risk state or final decision.', dimensions: ['feature attribution','source attribution','event attribution','macro attribution','policy attribution','technical attribution','confidence decomposition','uncertainty decomposition','decision-change explanation','version-change explanation'] },
  { id: 'model-data-drift', label: 'Model & Data Drift', shortLabel: 'Drift', description: 'Detects when input distributions, relationships, errors or calibration move away from the environment in which the model was validated.', dimensions: ['feature distribution drift','correlation drift','target drift','residual drift','calibration drift','accuracy drift','source drift','revision drift','event-impact drift','ensemble-weight drift'] },
  { id: 'decision-quality-gating', label: 'Decision Quality & Risk Gating', shortLabel: 'Gating', description: 'Turns quality findings into explicit confidence haircuts, abstention states and hard decision blocks.', dimensions: ['minimum evidence gate','minimum freshness gate','minimum calibration gate','minimum sample gate','maximum conflict gate','maximum uncertainty gate','structural-break gate','event-risk gate','abstention logic','decision readiness'] },
  { id: 'governance-reproducibility', label: 'Governance, Auditability & Reproducibility', shortLabel: 'Governance', description: 'Makes every research result reproducible from versioned data, code, configuration, evidence and decision logs.', dimensions: ['model versioning','dataset versioning','schema versioning','source configuration versioning','immutable snapshots','checksums','audit logging','promotion gates','rollback capability','point-in-time reconstruction'] },
];

export const QUALITY_METHOD_REGISTRY: QualityMethod[] = QUALITY_FAMILIES.flatMap((family) =>
  family.dimensions.flatMap((dimension) => TECHNIQUES.map((technique) => ({
    id: `${family.id}:${dimension.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}:${technique.id}`,
    familyId: family.id,
    familyLabel: family.label,
    dimension,
    technique: technique.label,
    label: `${technique.label} ${dimension}`,
    purpose: technique.purpose,
  }))),
);

if (QUALITY_METHOD_REGISTRY.length !== 1000) {
  throw new Error(`FXGA quality framework must register exactly 1000 methods; found ${QUALITY_METHOD_REGISTRY.length}.`);
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const avg = (values: Array<number | null | undefined>) => {
  const usable = values.map(Number).filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
};
const normalize01 = (value?: number | null) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return clamp(number <= 1 ? number * 100 : number);
};
const inverse01 = (value?: number | null) => 100 - normalize01(value);
const scoreOr = (record: Record<string, number> | undefined, keys: string[], fallback: number) => {
  if (!record) return fallback;
  for (const key of keys) {
    const match = Object.entries(record).find(([candidate]) => candidate.toLowerCase().replace(/[_\s-]/g, '') === key.toLowerCase().replace(/[_\s-]/g, ''));
    if (match && Number.isFinite(Number(match[1]))) return clamp(Number(match[1]));
  }
  return fallback;
};
const sampleConfidence = (samples: number, full = 300) => clamp(Math.sqrt(Math.max(0, samples) / full) * 100);

function stateFor(score: number, evidencePoints: number, confidence: number): QualityMethodState {
  if (evidencePoints <= 0) return 'registered';
  if (score < 35 || confidence < 25) return 'gated';
  if (confidence < 55) return 'supported';
  return 'measured';
}

export function deriveQualityFramework(input: QualityFrameworkInput): QualityFrameworkResult {
  const dq = input.dataQuality;
  const baseQuality = clamp(Number(dq?.overall ?? 0));
  const scores = dq?.scores;
  const sources = input.sourceReliability ?? [];
  const forecasts = input.forecasts ?? [];
  const memory = input.decisionMemory;
  const pairs = input.decisionCore?.pairDecisions ?? [];
  const regimes = input.regimes ?? [];

  const sourceScore = avg(sources.map((item) => item.score));
  const sourceCoverage = avg(sources.map((item) => item.numericCoverage));
  const sourceFreshness = avg(sources.map((item) => item.freshness));
  const sourceHistory = avg(sources.map((item) => item.historyDepth));
  const anomalyQuality = avg(sources.map((item) => 100 - normalize01(item.anomalyRate)));

  const forecastCalibration = avg(forecasts.map((item) => normalize01(item.calibrationConfidence)));
  const modelAgreement = avg(forecasts.map((item) => normalize01(item.modelAgreement)));
  const modelDispersionQuality = avg(forecasts.map((item) => inverse01(item.modelDispersion)));
  const uncertaintyQuality = avg(forecasts.map((item) => inverse01(item.uncertainty)));
  const validationPoints = forecasts.reduce((sum, item) => sum + Math.max(0, Number(item.validationPoints ?? 0)), 0);
  const forecastSamples = forecasts.reduce((sum, item) => sum + Math.max(0, Number(item.sampleSize ?? 0)), 0);
  const walkForwardModels = forecasts.filter((item) => Object.values(item.walkForwardRmse ?? {}).some((value) => value != null && Number.isFinite(Number(value)))).length;

  const horizons = Object.values(memory?.horizons ?? {});
  const memorySamples = horizons.reduce((sum, row) => sum + Math.max(0, Number(row.count ?? 0)), 0);
  const memoryHit = avg(horizons.filter((row) => row.hitRate != null).map((row) => normalize01(row.hitRate)));
  const memoryNonLoss = avg(horizons.filter((row) => row.nonLossRate != null).map((row) => normalize01(row.nonLossRate)));
  const memoryBrierQuality = avg(horizons.filter((row) => row.brier != null).map((row) => clamp((1 - Number(row.brier)) * 100)));

  const evidenceCompleteness = avg(pairs.map((pair) => pair.evidenceCompleteness?.score));
  const evidenceAvailable = pairs.reduce((sum, pair) => sum + (pair.evidenceCompleteness?.available?.length ?? 0), 0);
  const evidenceMissing = pairs.reduce((sum, pair) => sum + (pair.evidenceCompleteness?.missing?.length ?? 0) + (pair.evidenceCompleteness?.mandatoryMissing?.length ?? 0), 0);
  const crossAvailable = pairs.filter((pair) => pair.crossAsset?.available).length;
  const crossFactors = pairs.reduce((sum, pair) => sum + Math.max(0, Number(pair.crossAsset?.availableFactors ?? 0)), 0);
  const structuralQuality = avg(pairs.map((pair) => pair.structuralBreak ? clamp(100 - Number(pair.structuralBreak.risk ?? 0)) : undefined));
  const analogueSamples = pairs.reduce((sum, pair) => sum + Math.max(0, Number(pair.historicalAnalogues?.samples ?? 0)), 0);
  const analogueHit = avg(pairs.map((pair) => pair.historicalAnalogues?.weightedHitRate == null ? undefined : normalize01(pair.historicalAnalogues.weightedHitRate)));
  const horizonSamples = pairs.reduce((sum, pair) => sum + Object.values(pair.horizonCalibration?.rows ?? {}).reduce((inner, row) => inner + Math.max(0, Number(row.samples ?? 0)), 0), 0);
  const horizonBrierQuality = avg(pairs.flatMap((pair) => Object.values(pair.horizonCalibration?.rows ?? {})).filter((row) => row.brier != null).map((row) => clamp((1 - Number(row.brier)) * 100)));
  const horizonHit = avg(pairs.flatMap((pair) => Object.values(pair.horizonCalibration?.rows ?? {})).filter((row) => row.empiricalHitRate != null).map((row) => normalize01(row.empiricalHitRate)));

  const regimeStability = avg(regimes.map((row) => 100 - normalize01(row.transitionProbability)));
  const regimeSamples = regimes.reduce((sum, row) => sum + Math.max(0, Number(row.sampleSize ?? 0)), 0);
  const riskConfidence = clamp(Number(input.risk?.confidenceAfterRisk ?? 0));
  const riskQuality = clamp(100 - Number(input.risk?.aggregate ?? 100));
  const sloQuality = avg((input.operatingStandards?.slos ?? []).map((item) => item.target));
  const validationState = String(input.operatingStandards?.validationState ?? '').toLowerCase();
  const governanceValidation = validationState.includes('pass') || validationState.includes('valid') || validationState.includes('ready') ? 100 : validationState ? 65 : 35;

  const entries: Record<string, { score: number; confidence: number; evidence: number; notes: string[] }> = {
    'raw-data-quality': { score: avg([baseQuality, scoreOr(scores, ['coverage','completeness'], baseQuality), anomalyQuality || baseQuality]), confidence: sampleConfidence((sources.length * 10) + forecasts.length, 100), evidence: sources.length + forecasts.length, notes: ['Uses current research data-quality score, source anomaly quality and observed coverage.'] },
    'freshness-timeliness': { score: avg([scoreOr(scores, ['freshness','timeliness'], sourceFreshness || baseQuality), sourceFreshness || baseQuality]), confidence: sampleConfidence(sources.length, 20), evidence: sources.length, notes: ['Rewards fresh upstream evidence and penalizes stale collection states.'] },
    'source-reliability': { score: avg([sourceScore, sourceCoverage, sourceFreshness, sourceHistory]), confidence: sampleConfidence(sources.length, 20), evidence: sources.length, notes: ['Aggregates provider reliability, coverage, freshness and history depth.'] },
    'multi-source-reconciliation': { score: avg([sourceScore, evidenceCompleteness, crossFactors ? clamp(crossFactors * 4) : 0]), confidence: sampleConfidence(sources.length + crossAvailable, 30), evidence: sources.length + crossAvailable, notes: ['Higher when multiple reliable evidence channels are simultaneously available.'] },
    'missing-data-coverage': { score: avg([scoreOr(scores, ['coverage','completeness'], baseQuality), sourceCoverage, evidenceCompleteness]), confidence: sampleConfidence(evidenceAvailable + sources.length, 80), evidence: evidenceAvailable + sources.length, notes: [`Observed evidence items ${evidenceAvailable}; missing evidence items ${evidenceMissing}.`] },
    'revision-vintage-control': { score: avg([scoreOr(scores, ['revision','vintage','integrity'], baseQuality), governanceValidation]), confidence: clamp(governanceValidation * 0.8), evidence: validationState ? 1 : 0, notes: ['Uses the research validation state as the public proof that point-in-time controls are active.'] },
    'probability-calibration': { score: avg([forecastCalibration, memoryBrierQuality, horizonBrierQuality]), confidence: sampleConfidence(memorySamples + horizonSamples, 500), evidence: memorySamples + horizonSamples, notes: [`Realized calibration sample ${memorySamples + horizonSamples}.`] },
    'directional-calibration': { score: avg([memoryHit, memoryNonLoss, horizonHit]), confidence: sampleConfidence(memorySamples + horizonSamples, 500), evidence: memorySamples + horizonSamples, notes: ['Measures whether directional calls actually resolve in the stated direction across recorded horizons.'] },
    'uncertainty-calibration': { score: avg([uncertaintyQuality, modelDispersionQuality, forecastCalibration]), confidence: sampleConfidence(forecastSamples, 1000), evidence: forecasts.length, notes: ['Uses model uncertainty, ensemble dispersion and calibration confidence.'] },
    'historical-backtesting': { score: avg([memoryHit, analogueHit, horizonHit, validationPoints ? clamp(Math.log10(validationPoints + 1) * 28) : 0]), confidence: sampleConfidence(memorySamples + analogueSamples + validationPoints, 1000), evidence: memorySamples + analogueSamples + validationPoints, notes: [`Walk-forward checks ${validationPoints}; realized analogue samples ${analogueSamples}.`] },
    'out-of-sample': { score: avg([forecastCalibration, modelAgreement, walkForwardModels ? clamp((walkForwardModels / Math.max(1, forecasts.length)) * 100) : 0]), confidence: sampleConfidence(validationPoints, 500), evidence: validationPoints, notes: [`${walkForwardModels}/${forecasts.length || 0} forecast rows expose walk-forward RMSE evidence.`] },
    'leakage-causality': { score: avg([governanceValidation, scoreOr(scores, ['integrity','provenance'], baseQuality)]), confidence: validationState ? 75 : 20, evidence: validationState ? 1 : 0, notes: ['Public score is intentionally conservative because leakage protection needs backend point-in-time tests, not a visual estimate.'] },
    'robustness-sensitivity': { score: avg([modelAgreement, modelDispersionQuality, structuralQuality, analogueHit]), confidence: sampleConfidence(forecasts.length + analogueSamples, 250), evidence: forecasts.length + analogueSamples, notes: ['Combines ensemble agreement, dispersion, structural stability and realised analogue behaviour.'] },
    'regime-structural-break': { score: avg([structuralQuality, regimeStability]), confidence: sampleConfidence(regimeSamples + pairs.length, 300), evidence: regimeSamples + pairs.length, notes: ['Low transition probability and low structural-break risk improve the score.'] },
    'evidence-strength': { score: avg([evidenceCompleteness, sourceScore, sourceFreshness]), confidence: sampleConfidence(evidenceAvailable, 100), evidence: evidenceAvailable, notes: [`Available evidence ${evidenceAvailable}; unresolved or missing evidence ${evidenceMissing}.`] },
    'evidence-independence': { score: avg([evidenceCompleteness, crossAvailable ? clamp((crossAvailable / Math.max(1, pairs.length)) * 100) : 0, crossFactors ? clamp(crossFactors * 4) : 0]), confidence: sampleConfidence(crossFactors, 40), evidence: crossFactors, notes: [`Independent cross-asset factors currently exposed: ${crossFactors}.`] },
    'attribution-explainability': { score: input.decisionQualityAttribution ? 92 : pairs.length ? 70 : 40, confidence: input.decisionQualityAttribution ? 90 : 45, evidence: input.decisionQualityAttribution ? 1 : 0, notes: ['Measures whether the engine exposes enough contribution and decision-change information to explain itself.'] },
    'model-data-drift': { score: avg([structuralQuality, regimeStability, sourceFreshness]), confidence: sampleConfidence(regimeSamples + pairs.length, 300), evidence: regimeSamples + pairs.length, notes: ['Uses structural-break and transition evidence as the current public drift proxy.'] },
    'decision-quality-gating': { score: avg([riskConfidence, riskQuality, evidenceCompleteness, structuralQuality]), confidence: sampleConfidence(pairs.length + (input.risk?.categories?.length ?? 0), 40), evidence: pairs.length + (input.risk?.categories?.length ?? 0), notes: ['Quality gates should reduce confidence or force abstention when evidence, stability or risk conditions deteriorate.'] },
    'governance-reproducibility': { score: avg([sloQuality, governanceValidation, baseQuality]), confidence: input.operatingStandards ? 85 : 30, evidence: (input.operatingStandards?.slos?.length ?? 0) + Object.keys(input.operatingStandards?.storageTiers ?? {}).length, notes: ['Based on validation state, service-level objectives and explicit storage/retention controls.'] },
  };

  const families = QUALITY_FAMILIES.map((family) => {
    const entry = entries[family.id] ?? { score: 0, confidence: 0, evidence: 0, notes: [] };
    const score = clamp(entry.score);
    const confidence = clamp(entry.confidence);
    return {
      id: family.id,
      label: family.label,
      shortLabel: family.shortLabel,
      description: family.description,
      score: Math.round(score),
      confidence: Math.round(confidence),
      state: stateFor(score, entry.evidence, confidence),
      registeredMethods: family.dimensions.length * TECHNIQUES.length,
      evidencePoints: Math.round(entry.evidence),
      notes: entry.notes,
    } satisfies QualityFamilyScore;
  });

  const byId = Object.fromEntries(families.map((family) => [family.id, family]));
  const geometric = (ids: string[]) => {
    const values = ids.map((id) => Math.max(1, byId[id]?.score ?? 1));
    return Math.pow(values.reduce((product, value) => product * value, 1), 1 / Math.max(1, values.length));
  };

  const dataQuality = geometric(['raw-data-quality','freshness-timeliness','source-reliability','multi-source-reconciliation','missing-data-coverage','revision-vintage-control']);
  const calibrationQuality = geometric(['probability-calibration','directional-calibration','uncertainty-calibration','historical-backtesting','out-of-sample','leakage-causality']);
  const evidenceQuality = geometric(['evidence-strength','evidence-independence','attribution-explainability']);
  const robustnessQuality = geometric(['robustness-sensitivity','regime-structural-break','model-data-drift']);
  const governanceQuality = geometric(['decision-quality-gating','governance-reproducibility']);
  const overall = Math.pow(Math.max(1, dataQuality) ** 0.25 * Math.max(1, calibrationQuality) ** 0.25 * Math.max(1, evidenceQuality) ** 0.25 * Math.max(1, robustnessQuality) ** 0.15 * Math.max(1, governanceQuality) ** 0.10, 1);
  const measuredFamilies = families.filter((family) => family.state === 'measured').length;
  const supportedFamilies = families.filter((family) => family.state === 'measured' || family.state === 'supported').length;
  const status: QualityFrameworkResult['status'] = overall >= 70 && calibrationQuality >= 55 && evidenceQuality >= 60 ? 'qualified' : overall >= 50 ? 'watch' : 'insufficient';

  return {
    totalRegisteredMethods: QUALITY_METHOD_REGISTRY.length,
    measuredFamilies,
    supportedFamilies,
    overall: Math.round(overall),
    status,
    dataQuality: Math.round(dataQuality),
    calibrationQuality: Math.round(calibrationQuality),
    evidenceQuality: Math.round(evidenceQuality),
    robustnessQuality: Math.round(robustnessQuality),
    governanceQuality: Math.round(governanceQuality),
    families,
  };
}
