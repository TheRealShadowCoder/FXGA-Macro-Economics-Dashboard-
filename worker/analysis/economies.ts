import type { MacroObservation } from '../types';

export type EconomyId = 'USA' | 'EUROPE' | 'UK' | 'SOUTH_AFRICA' | 'JAPAN';

export interface EconomyDimension {
  id: 'inflation' | 'growth' | 'labour' | 'policy' | 'financial';
  label: string;
  score: number;
  coverage: number;
  contributors: Array<{ seriesId: string; title: string; score: number; category: string }>;
}

export interface EconomyMacroState {
  id: EconomyId;
  label: string;
  currency: string;
  centralBank: string;
  observationCount: number;
  confidence: number;
  regime: string;
  policyStance: string;
  currencyBias: string;
  currencyScore: number;
  dimensions: EconomyDimension[];
  topSignals: Array<{ seriesId: string; title: string; score: number; value: number | null; date: string | null }>;
  summary: string;
}

const ECONOMIES: Record<EconomyId, { label: string; currency: string; centralBank: string }> = {
  USA: { label: 'United States', currency: 'USD', centralBank: 'Federal Reserve' },
  EUROPE: { label: 'Euro Area / Europe', currency: 'EUR', centralBank: 'European Central Bank' },
  UK: { label: 'United Kingdom', currency: 'GBP', centralBank: 'Bank of England' },
  SOUTH_AFRICA: { label: 'South Africa', currency: 'ZAR', centralBank: 'South African Reserve Bank' },
  JAPAN: { label: 'Japan', currency: 'JPY', centralBank: 'Bank of Japan' },
};

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

function robustMomentum(observation: MacroObservation) {
  const values = observation.history.map((row) => row.value).filter(Number.isFinite);
  if (values.length < 3) return 0;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  const current = changes.at(-1) ?? 0;
  const historical = changes.slice(0, -1);
  const center = median(historical);
  const scale = median(historical.map((value) => Math.abs(value - center))) || median(historical.map(Math.abs)) || Math.abs(center) || 1;
  return clamp(Math.tanh((current - center) / Math.max(scale * 2.5, 1e-9)) * 100);
}

function categories(observation: MacroObservation) {
  return (observation.categories ?? []).map((value) => value.toLowerCase());
}

function title(observation: MacroObservation) {
  return observation.title.toLowerCase();
}

function has(observation: MacroObservation, patterns: RegExp[]) {
  const text = `${categories(observation).join(' ')} ${title(observation)}`;
  return patterns.some((pattern) => pattern.test(text));
}

function dimensionFor(observation: MacroObservation): EconomyDimension['id'][] {
  const output: EconomyDimension['id'][] = [];
  if (has(observation, [/inflation/, /consumer price/, /producer price/, /hicp/, /cpi/, /ppi/, /pce price/])) output.push('inflation');
  if (has(observation, [/growth/, /gdp/, /industrial/, /manufactur/, /retail/, /production/, /mining/, /business-activity/, /consumption/, /machinery/, /household-spending/])) output.push('growth');
  if (has(observation, [/labour/, /employment/, /unemployment/, /payroll/, /jobless/, /claims/, /wage/, /earnings/, /vacanc/, /quits/])) output.push('labour');
  if (has(observation, [/policy-rate/, /policy rate/, /bank rate/, /repo rate/, /fed funds/, /overnight/, /interest rate/, /bond-yield/, /treasury-yields/, /jgb/])) output.push('policy');
  if (has(observation, [/financial-conditions/, /stress/, /credit/, /money/, /liquidity/, /yield-spreads/, /usd-fx/, /exchange rate/, /current account/, /trade balance/, /volatility/])) output.push('financial');
  return [...new Set(output)];
}

function orientedScore(observation: MacroObservation, dimension: EconomyDimension['id']) {
  let score = robustMomentum(observation);
  const text = `${categories(observation).join(' ')} ${title(observation)}`;
  if (dimension === 'labour' && /unemployment|jobless|claims/.test(text)) score *= -1;
  if (dimension === 'financial' && /stress|volatility|credit spread|yield spread/.test(text)) score *= -1;
  return Math.round(clamp(score));
}

function buildDimension(observations: MacroObservation[], id: EconomyDimension['id'], label: string): EconomyDimension {
  const contributors = observations
    .filter((observation) => dimensionFor(observation).includes(id))
    .map((observation) => ({
      seriesId: observation.seriesId,
      title: observation.title,
      score: orientedScore(observation, id),
      category: categories(observation)[0] ?? 'other',
    }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const score = contributors.length
    ? Math.round(contributors.reduce((sum, item) => sum + item.score, 0) / contributors.length)
    : 0;
  return { id, label, score, coverage: contributors.length, contributors: contributors.slice(0, 8) };
}

function regime(dimensions: EconomyDimension[]) {
  const inflation = dimensions.find((item) => item.id === 'inflation')?.score ?? 0;
  const growth = dimensions.find((item) => item.id === 'growth')?.score ?? 0;
  const labour = dimensions.find((item) => item.id === 'labour')?.score ?? 0;
  if (growth >= 25 && inflation <= 15) return 'Disinflationary Expansion';
  if (growth >= 25 && inflation >= 25) return 'Reflation / Overheating';
  if (growth <= -25 && inflation >= 25) return 'Stagflation Risk';
  if (growth <= -25 && inflation <= 10) return 'Contraction / Disinflation';
  if (growth < -10 || labour < -20) return 'Growth Slowdown';
  if (inflation > 20) return 'Inflation Pressure';
  return 'Mixed / Transition';
}

function policyStance(dimensions: EconomyDimension[]) {
  const inflation = dimensions.find((item) => item.id === 'inflation')?.score ?? 0;
  const growth = dimensions.find((item) => item.id === 'growth')?.score ?? 0;
  const labour = dimensions.find((item) => item.id === 'labour')?.score ?? 0;
  const policy = dimensions.find((item) => item.id === 'policy')?.score ?? 0;
  const score = clamp(inflation * 0.38 + labour * 0.18 + growth * 0.12 + policy * 0.32);
  if (score >= 35) return 'Hawkish';
  if (score >= 15) return 'Hawkish Lean';
  if (score <= -35) return 'Dovish';
  if (score <= -15) return 'Dovish Lean';
  return 'Neutral / Data Dependent';
}

function currencyModel(dimensions: EconomyDimension[]) {
  const inflation = dimensions.find((item) => item.id === 'inflation')?.score ?? 0;
  const growth = dimensions.find((item) => item.id === 'growth')?.score ?? 0;
  const labour = dimensions.find((item) => item.id === 'labour')?.score ?? 0;
  const policy = dimensions.find((item) => item.id === 'policy')?.score ?? 0;
  const financial = dimensions.find((item) => item.id === 'financial')?.score ?? 0;
  const score = Math.round(clamp(policy * 0.34 + growth * 0.24 + labour * 0.16 + financial * 0.18 + inflation * 0.08));
  const bias = score >= 30 ? 'Strong Bullish' : score >= 12 ? 'Bullish' : score <= -30 ? 'Strong Bearish' : score <= -12 ? 'Bearish' : 'Neutral';
  return { score, bias };
}

function belongs(observation: MacroObservation, economy: EconomyId) {
  const tags = Array.isArray(observation.economies) && observation.economies.length
    ? observation.economies.map(String)
    : [String(observation.economy ?? '')];
  return tags.includes(economy);
}

export function buildEconomyAnalysis(observations: MacroObservation[]) {
  const states = (Object.keys(ECONOMIES) as EconomyId[]).map((id) => {
    const metadata = ECONOMIES[id];
    const economyObservations = observations.filter((observation) => belongs(observation, id));
    const dimensions = [
      buildDimension(economyObservations, 'inflation', 'Inflation Pressure'),
      buildDimension(economyObservations, 'growth', 'Growth Momentum'),
      buildDimension(economyObservations, 'labour', 'Labour Strength'),
      buildDimension(economyObservations, 'policy', 'Policy / Rates Momentum'),
      buildDimension(economyObservations, 'financial', 'Financial / External Conditions'),
    ];
    const coverage = dimensions.reduce((sum, dimension) => sum + Math.min(dimension.coverage, 5), 0);
    const confidence = Math.round(Math.min(95, 20 + coverage * 3));
    const currency = currencyModel(dimensions);
    const signalPool = dimensions.flatMap((dimension) => dimension.contributors.map((item) => ({ ...item, dimension: dimension.id })));
    const bySeries = new Map<string, { seriesId: string; title: string; score: number; value: number | null; date: string | null }>();
    for (const signal of signalPool.sort((a, b) => Math.abs(b.score) - Math.abs(a.score))) {
      if (bySeries.has(signal.seriesId)) continue;
      const observation = economyObservations.find((item) => item.seriesId === signal.seriesId);
      bySeries.set(signal.seriesId, { seriesId: signal.seriesId, title: signal.title, score: signal.score, value: observation?.value ?? null, date: observation?.date ?? null });
    }
    const stateRegime = regime(dimensions);
    const stance = policyStance(dimensions);
    return {
      id,
      ...metadata,
      observationCount: economyObservations.length,
      confidence,
      regime: stateRegime,
      policyStance: stance,
      currencyBias: currency.bias,
      currencyScore: currency.score,
      dimensions,
      topSignals: [...bySeries.values()].slice(0, 10),
      summary: `${metadata.label}: ${stateRegime}. ${metadata.centralBank} reaction function is ${stance.toLowerCase()}. ${metadata.currency} macro bias is ${currency.bias.toLowerCase()} (${currency.score >= 0 ? '+' : ''}${currency.score}).`,
    } satisfies EconomyMacroState;
  });

  return {
    generatedAt: new Date().toISOString(),
    methodology: 'Each economy is analyzed independently. Sequential changes are robustly normalized against each series own recent history, oriented by economic meaning, then aggregated into inflation, growth, labour, policy/rates and financial/external dimensions. International observations never overwrite the separate Fed/USD structural model.',
    minimumCoverageNote: 'Low-coverage economies should be treated as provisional until the Google Cloud Run full international collector is active.',
    economies: states,
  };
}
