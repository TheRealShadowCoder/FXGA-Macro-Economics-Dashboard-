import type { MacroObservation } from '../types';

export const ANALYSIS_SERIES = [
  'CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'T5YIE',
  'UNRATE', 'PAYEMS', 'ICSA', 'JTSJOL', 'CES0500000003',
  'A191RL1Q225SBEA', 'INDPRO', 'CFNAI',
  'WALCL', 'WRESBAL', 'RRPONTSYD', 'WTREGEN', 'M2SL',
  'TOTBKCR', 'BUSLOANS', 'BAMLH0A0HYM2', 'BAMLC0A4CBBB', 'DRTSCILM',
  'NFCI', 'STLFSI4', 'SAHMREALTIME', 'RECPROUSM156N',
  'DGS2', 'DGS10', 'T10Y2Y', 'T10Y3M', 'FEDFUNDS',
  'DTWEXBGS', 'VIXCLS',
] as const;

type ObservationMap = Map<string, MacroObservation>;

interface SignalSpec {
  id: string;
  polarity?: number;
  weight?: number;
}

interface DimensionDefinition {
  id: string;
  label: string;
  description: string;
  signals: SignalSpec[];
}

const DIMENSIONS: DimensionDefinition[] = [
  {
    id: 'inflation',
    label: 'Inflation Pressure',
    description: 'Price-level momentum and market inflation expectations.',
    signals: [
      { id: 'CPIAUCSL', weight: 1.2 }, { id: 'CPILFESL', weight: 1.3 },
      { id: 'PCEPILFE', weight: 1.4 }, { id: 'T5YIE', weight: 0.9 },
      { id: 'CES0500000003', weight: 0.8 },
    ],
  },
  {
    id: 'growth',
    label: 'Growth Momentum',
    description: 'Real activity, output and national activity momentum.',
    signals: [
      { id: 'A191RL1Q225SBEA', weight: 1.4 }, { id: 'INDPRO', weight: 1.1 },
      { id: 'CFNAI', weight: 1.2 }, { id: 'PAYEMS', weight: 0.7 },
    ],
  },
  {
    id: 'labour',
    label: 'Labour Strength',
    description: 'Employment demand, slack, claims and wage momentum.',
    signals: [
      { id: 'PAYEMS', weight: 1.2 }, { id: 'JTSJOL', weight: 1.0 },
      { id: 'UNRATE', polarity: -1, weight: 1.2 }, { id: 'ICSA', polarity: -1, weight: 1.0 },
      { id: 'CES0500000003', weight: 0.8 },
    ],
  },
  {
    id: 'liquidity',
    label: 'System Liquidity',
    description: 'Central-bank liquidity, reserves, money and Treasury cash drains.',
    signals: [
      { id: 'WALCL', weight: 1.0 }, { id: 'WRESBAL', weight: 1.2 }, { id: 'M2SL', weight: 1.0 },
      { id: 'RRPONTSYD', polarity: -1, weight: 0.8 }, { id: 'WTREGEN', polarity: -1, weight: 0.8 },
    ],
  },
  {
    id: 'credit',
    label: 'Credit Impulse',
    description: 'Bank lending and corporate-credit conditions.',
    signals: [
      { id: 'TOTBKCR', weight: 1.0 }, { id: 'BUSLOANS', weight: 1.0 },
      { id: 'BAMLH0A0HYM2', polarity: -1, weight: 1.2 }, { id: 'BAMLC0A4CBBB', polarity: -1, weight: 1.0 },
      { id: 'DRTSCILM', polarity: -1, weight: 1.0 },
    ],
  },
  {
    id: 'financialConditions',
    label: 'Financial Conditions',
    description: 'Positive means conditions are easing; negative means tightening/stress.',
    signals: [
      { id: 'NFCI', polarity: -1, weight: 1.2 }, { id: 'STLFSI4', polarity: -1, weight: 1.2 },
      { id: 'BAMLH0A0HYM2', polarity: -1, weight: 1.0 }, { id: 'VIXCLS', polarity: -1, weight: 0.8 },
    ],
  },
  {
    id: 'rates',
    label: 'Rates Momentum',
    description: 'Front-end, long-end and policy-rate momentum.',
    signals: [
      { id: 'DGS2', weight: 1.3 }, { id: 'DGS10', weight: 1.0 }, { id: 'FEDFUNDS', weight: 0.8 },
    ],
  },
];

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function momentum(observation: MacroObservation | undefined, polarity = 1) {
  if (!observation || observation.history.length < 3) return null;
  const diffs: number[] = [];
  for (let i = 1; i < observation.history.length; i += 1) {
    diffs.push(observation.history[i].value - observation.history[i - 1].value);
  }
  const latest = diffs.at(-1) ?? 0;
  const scale = median(diffs.map((value) => Math.abs(value)).filter((value) => value > 0));
  const fallbackScale = Math.max(Math.abs(observation.value ?? 0) * 0.001, 1e-9);
  const normalized = latest / (scale || fallbackScale);
  return clamp(Math.tanh(normalized / 2) * 100 * polarity);
}

function scoreDimension(map: ObservationMap, definition: DimensionDefinition) {
  let weighted = 0;
  let weights = 0;
  const contributors: Array<{ seriesId: string; title: string; score: number }> = [];
  for (const signal of definition.signals) {
    const obs = map.get(signal.id);
    const score = momentum(obs, signal.polarity ?? 1);
    if (score === null || !obs) continue;
    const weight = signal.weight ?? 1;
    weighted += score * weight;
    weights += weight;
    contributors.push({ seriesId: signal.id, title: obs.title, score: Math.round(score) });
  }
  const score = weights ? clamp(weighted / weights) : 0;
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    score: Math.round(score),
    direction: score > 15 ? 'positive' : score < -15 ? 'negative' : 'neutral',
    coverage: `${contributors.length}/${definition.signals.length}`,
    contributors: contributors.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 4),
  };
}

function recessionRisk(map: ObservationMap) {
  const sahm = map.get('SAHMREALTIME')?.value ?? 0;
  const probability = map.get('RECPROUSM156N')?.value ?? 0;
  const spread3m = map.get('T10Y3M')?.value ?? 0;
  const spread2y = map.get('T10Y2Y')?.value ?? 0;
  const claimsMomentum = momentum(map.get('ICSA')) ?? 0;
  const stressMomentum = -(momentum(map.get('STLFSI4'), -1) ?? 0);

  const sahmRisk = clamp((sahm / 0.5) * 55, 0, 100);
  const probabilityRisk = clamp(probability, 0, 100);
  const curveRisk = clamp((Math.max(0, -spread3m) * 35) + (Math.max(0, -spread2y) * 20), 0, 100);
  const claimsRisk = clamp(Math.max(0, claimsMomentum), 0, 100);
  const stressRisk = clamp(Math.max(0, stressMomentum), 0, 100);
  return Math.round(clamp(
    sahmRisk * 0.28 + probabilityRisk * 0.24 + curveRisk * 0.20 + claimsRisk * 0.16 + stressRisk * 0.12,
    0,
    100,
  ));
}

function regimeName(growth: number, inflation: number) {
  if (growth > 15 && inflation < -15) return 'Goldilocks / Disinflationary Expansion';
  if (growth > 15 && inflation > 15) return 'Reflation / Overheating';
  if (growth < -15 && inflation > 15) return 'Stagflation Risk';
  if (growth < -15 && inflation < -15) return 'Contraction / Disinflation';
  if (growth < -15) return 'Growth Slowdown';
  if (inflation > 15) return 'Inflation Pressure';
  return 'Mixed / Transition';
}

function stance(score: number) {
  if (score >= 35) return 'Hawkish';
  if (score <= -35) return 'Dovish';
  if (score >= 15) return 'Hawkish Lean';
  if (score <= -15) return 'Dovish Lean';
  return 'Neutral / Data Dependent';
}

function bias(score: number) {
  if (score >= 35) return 'Bullish';
  if (score <= -35) return 'Bearish';
  if (score >= 15) return 'Bullish Lean';
  if (score <= -15) return 'Bearish Lean';
  return 'Neutral';
}

export function buildMacroAnalysis(observations: MacroObservation[]) {
  const map: ObservationMap = new Map(observations.map((item) => [item.seriesId, item]));
  const dimensions = DIMENSIONS.map((definition) => scoreDimension(map, definition));
  const get = (id: string) => dimensions.find((dimension) => dimension.id === id)?.score ?? 0;

  const inflation = get('inflation');
  const growth = get('growth');
  const labour = get('labour');
  const liquidity = get('liquidity');
  const credit = get('credit');
  const financialConditions = get('financialConditions');
  const rates = get('rates');
  const recession = recessionRisk(map);
  const directUsd = momentum(map.get('DTWEXBGS')) ?? 0;
  const volatility = momentum(map.get('VIXCLS')) ?? 0;

  const fedReaction = Math.round(clamp(
    inflation * 0.38 + labour * 0.23 + growth * 0.16 + rates * 0.15 - financialConditions * 0.08,
  ));
  const usd = Math.round(clamp(
    fedReaction * 0.42 + rates * 0.25 + directUsd * 0.18 + ((recession - 50) * 2) * 0.15,
  ));
  const gold = Math.round(clamp(
    -fedReaction * 0.28 - usd * 0.25 - rates * 0.18 + liquidity * 0.13 + ((recession - 50) * 2) * 0.11 + volatility * 0.05,
  ));
  const equities = Math.round(clamp(
    growth * 0.28 + liquidity * 0.22 + credit * 0.20 + financialConditions * 0.18 - fedReaction * 0.08 - ((recession - 50) * 2) * 0.16,
  ));
  const crypto = Math.round(clamp(
    liquidity * 0.30 + equities * 0.22 + credit * 0.15 + financialConditions * 0.12 - usd * 0.13 - fedReaction * 0.08,
  ));

  const allSignals = observations
    .map((observation) => ({
      seriesId: observation.seriesId,
      title: observation.title,
      score: Math.round(momentum(observation) ?? 0),
      value: observation.value,
      date: observation.date,
    }))
    .filter((item) => item.value !== null)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const observed = observations.filter((item) => item.value !== null).length;
  const coverage = observations.length ? observed / observations.length : 0;
  const directionalScores = dimensions.map((item) => Math.abs(item.score));
  const coherence = directionalScores.length ? median(directionalScores) / 100 : 0;
  const confidence = Math.round(clamp(50 + coverage * 30 + coherence * 15, 0, 95));
  const regime = regimeName(growth, inflation);

  return {
    generatedAt: new Date().toISOString(),
    regime: {
      name: regime,
      growthScore: growth,
      inflationScore: inflation,
      recessionRisk: recession,
      summary: `${regime}. Growth ${growth >= 0 ? 'positive' : 'negative'} (${growth}), inflation pressure ${inflation >= 0 ? 'rising' : 'easing'} (${inflation}), recession-risk gauge ${recession}/100.`,
    },
    dimensions,
    policy: {
      fedReactionScore: fedReaction,
      stance: stance(fedReaction),
      ratesMomentum: rates,
    },
    assets: [
      { id: 'usd', label: 'U.S. Dollar', score: usd, bias: bias(usd) },
      { id: 'gold', label: 'Gold', score: gold, bias: bias(gold) },
      { id: 'equities', label: 'U.S. Equities', score: equities, bias: bias(equities) },
      { id: 'crypto', label: 'Crypto', score: crypto, bias: bias(crypto) },
    ],
    confidence,
    coverage: { observed, requested: observations.length },
    topSignals: allSignals.slice(0, 8),
    methodology: {
      scoreRange: '-100 to +100; recession risk is 0 to 100',
      principle: 'Robust recent-momentum scoring using each series own historical change scale, then causal weighted aggregation.',
      caution: 'This is a deterministic macro regime model, not a guarantee or standalone trade signal.',
    },
  };
}
