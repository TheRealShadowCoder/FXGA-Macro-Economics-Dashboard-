import { analyzeCalendarEvent } from './calendar';
import type { CalendarEvent } from '../types';

type MacroAnalysisLike = {
  regime?: { name?: string };
  confidence?: number;
  policy?: { fedReactionScore?: number; ratesMomentum?: number; stance?: string };
  assets?: Array<{ id: string; label?: string; score: number; bias?: string }>;
};

interface Factors {
  usd: number;
  rates: number;
  gold: number;
  equities: number;
  crypto: number;
}

const NEUTRAL_FACTORS: Factors = { usd: .45, rates: .35, gold: -.30, equities: .20, crypto: .10 };

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function family(title: string) {
  const text = title.toLowerCase();
  if (/cpi|consumer price|pce|producer price|ppi|inflation|average hourly|wage|earnings/.test(text)) return 'inflation';
  if (/payroll|employment|unemployment|jobless|claims|jolts|job openings|labou?r/.test(text)) return 'labour';
  if (/fed|fomc|interest rate|rate decision|policy rate/.test(text)) return 'policy';
  if (/gdp|retail sales|industrial production|pmi|ism|business activity|durable|factory|consumer confidence|sentiment/.test(text)) return 'growth';
  if (/housing|home sales|building permit|housing starts/.test(text)) return 'housing';
  return 'general';
}

function factorsFor(title: string): Factors {
  switch (family(title)) {
    case 'inflation': return { usd: .90, rates: 1.00, gold: -.85, equities: -.60, crypto: -.55 };
    case 'labour': return { usd: .82, rates: .85, gold: -.68, equities: -.20, crypto: -.30 };
    case 'policy': return { usd: 1.00, rates: 1.00, gold: -.95, equities: -.80, crypto: -.75 };
    case 'growth': return { usd: .72, rates: .55, gold: -.45, equities: .55, crypto: .25 };
    case 'housing': return { usd: .42, rates: .30, gold: -.25, equities: .30, crypto: .12 };
    default: return NEUTRAL_FACTORS;
  }
}

function assetScore(analysis: MacroAnalysisLike, id: string) {
  return analysis.assets?.find((asset) => asset.id === id)?.score ?? 0;
}

function baselineScores(analysis: MacroAnalysisLike): Factors {
  const fedReaction = analysis.policy?.fedReactionScore ?? 0;
  const ratesMomentum = analysis.policy?.ratesMomentum ?? 0;
  return {
    usd: assetScore(analysis, 'usd'),
    rates: clamp(fedReaction * .55 + ratesMomentum * .45),
    gold: assetScore(analysis, 'gold'),
    equities: assetScore(analysis, 'equities'),
    crypto: assetScore(analysis, 'crypto'),
  };
}

function revisionImpulse(event: CalendarEvent) {
  if (typeof event.revisionDelta !== 'number' || event.revisionDelta === 0) return 0;
  return clamp(Math.tanh(event.revisionDelta / Math.max(Math.abs(event.revisionDelta), 1)) * 18, -18, 18);
}

function releaseImpulse(events: CalendarEvent[], nowMs: number) {
  const totals: Factors = { usd: 0, rates: 0, gold: 0, equities: 0, crypto: 0 };
  let totalWeight = 0;
  const contributors: Array<{ event: string; currency: string; score: number; family: string; ageMinutes: number }> = [];

  for (const raw of events) {
    const event = analyzeCalendarEvent(raw);
    if (!event.actual || typeof event.releaseScore !== 'number') continue;
    const releasedAt = Date.parse(event.date);
    const ageMs = nowMs - releasedAt;
    if (ageMs < 0 || ageMs > 6 * 60 * 60_000) continue;
    const ageMinutes = ageMs / 60_000;
    const decay = Math.exp(-ageMinutes / 180);
    const importanceWeight = event.importance >= 3 ? 1 : event.importance === 2 ? .65 : .35;
    const currencyWeight = event.currency === 'USD' ? 1 : event.importance >= 3 ? .22 : .08;
    const weight = decay * importanceWeight * currencyWeight;
    if (!(weight > 0)) continue;

    const effectiveScore = clamp(event.releaseScore + revisionImpulse(event));
    const factors = factorsFor(event.event);
    totals.usd += effectiveScore * factors.usd * weight;
    totals.rates += effectiveScore * factors.rates * weight;
    totals.gold += effectiveScore * factors.gold * weight;
    totals.equities += effectiveScore * factors.equities * weight;
    totals.crypto += effectiveScore * factors.crypto * weight;
    totalWeight += weight;
    contributors.push({
      event: event.event,
      currency: event.currency ?? event.country,
      score: effectiveScore,
      family: family(event.event),
      ageMinutes: Math.round(ageMinutes),
    });
  }

  if (!totalWeight) return { scores: totals, contributors: [] as typeof contributors };
  return {
    scores: {
      usd: clamp(totals.usd / totalWeight),
      rates: clamp(totals.rates / totalWeight),
      gold: clamp(totals.gold / totalWeight),
      equities: clamp(totals.equities / totalWeight),
      crypto: clamp(totals.crypto / totalWeight),
    },
    contributors: contributors.sort((a, b) => a.ageMinutes - b.ageMinutes).slice(0, 8),
  };
}

function probabilities(score: number) {
  const buyLogit = score / 22;
  const sellLogit = -score / 22;
  const neutralLogit = 1.15 - Math.abs(score) / 38;
  const buy = Math.exp(buyLogit);
  const sell = Math.exp(sellLogit);
  const neutral = Math.exp(neutralLogit);
  const total = buy + sell + neutral;
  return {
    positive: Math.round((buy / total) * 1000) / 10,
    negative: Math.round((sell / total) * 1000) / 10,
    neutral: Math.round((neutral / total) * 1000) / 10,
  };
}

function output(id: keyof Factors, label: string, baseline: number, impulse: number, confidence: number) {
  const score = Math.round(clamp(baseline * .70 + impulse * .55));
  const probability = probabilities(score);
  const positiveLabel = id === 'rates' ? 'Higher' : 'Bullish';
  const negativeLabel = id === 'rates' ? 'Lower' : 'Bearish';
  const bias = probability.positive >= probability.negative && probability.positive >= probability.neutral
    ? positiveLabel
    : probability.negative >= probability.neutral ? negativeLabel : 'Neutral';
  return {
    id, label, score,
    baselineScore: Math.round(baseline),
    releaseImpulse: Math.round(impulse),
    bias,
    probabilities: {
      [positiveLabel.toLowerCase()]: probability.positive,
      [negativeLabel.toLowerCase()]: probability.negative,
      neutral: probability.neutral,
    },
    confidence: Math.round(Math.min(95, Math.max(25, confidence * .65 + Math.abs(score) * .35))),
  };
}

export function buildReleaseImpact(analysis: MacroAnalysisLike, events: CalendarEvent[], now = new Date()) {
  const baseline = baselineScores(analysis);
  const impulse = releaseImpulse(events, now.getTime());
  const confidence = analysis.confidence ?? 50;
  const assets = [
    output('usd', 'U.S. Dollar', baseline.usd, impulse.scores.usd, confidence),
    output('rates', 'U.S. Rates', baseline.rates, impulse.scores.rates, confidence),
    output('gold', 'Gold', baseline.gold, impulse.scores.gold, confidence),
    output('equities', 'Equities', baseline.equities, impulse.scores.equities, confidence),
    output('crypto', 'Crypto', baseline.crypto, impulse.scores.crypto, confidence),
  ];

  return {
    generatedAt: now.toISOString(),
    regime: analysis.regime?.name ?? 'Unknown',
    methodology: 'Structural FRED macro baseline is combined with decaying, importance-weighted economic release surprises. FXStreet native deviation is preferred when available; revision effects are included separately. Non-USD releases receive a deliberately smaller global spillover weight.',
    contributors: impulse.contributors,
    assets,
  };
}
