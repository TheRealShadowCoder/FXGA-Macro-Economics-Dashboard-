import { analyzeCalendarEvent } from './calendar';
import type { CalendarEvent, FxstreetStyleAnalytics, ReleaseProbabilities } from '../types';

const CALIBRATION_KEY = 'release:calibration:v1';
const MAX_SCORES = 80;
const MAX_OCCURRENCES = 120;

interface CalibrationBucket {
  total: number;
  beat: number;
  miss: number;
  inLine: number;
  scores: number[];
  deviations?: number[];
  surprisePercents?: number[];
  revisionDeltas?: number[];
  occurrenceIds: string[];
  updatedAt: string;
}

type CalibrationMap = Record<string, CalibrationBucket>;

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTitle(value: string) {
  return value.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bconsumer price index\b/g, 'cpi')
    .replace(/\bproducer price index\b/g, 'ppi')
    .replace(/\bgross domestic product\b/g, 'gdp')
    .replace(/\bnon[- ]?farm payrolls?\b/g, 'nfp')
    .replace(/\b(preliminary|prelim|final|flash|seasonally adjusted)\b/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calibrationKey(event: CalendarEvent) {
  return event.canonicalKey || `${event.currency ?? event.country}|${normalizeTitle(event.event)}`;
}

function probabilities(bucket?: CalibrationBucket): ReleaseProbabilities {
  const total = bucket?.total ?? 0;
  const denominator = total + 3;
  return {
    beat: Math.round((((bucket?.beat ?? 0) + 1) / denominator) * 1000) / 10,
    miss: Math.round((((bucket?.miss ?? 0) + 1) / denominator) * 1000) / 10,
    inLine: Math.round((((bucket?.inLine ?? 0) + 1) / denominator) * 1000) / 10,
    sampleSize: total,
    method: 'empirical-bayesian',
  };
}

function meanStd(values: number[]) {
  if (!values.length) return { mean: undefined, std: undefined };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function zAgainst(value: number | undefined, values: number[], minSamples = 5) {
  if (value === undefined || values.length < minSamples) return undefined;
  const { mean, std } = meanStd(values);
  if (mean === undefined || std === undefined || !(std > 1e-9)) return undefined;
  return Number(((value - mean) / std).toFixed(2));
}

function zScore(score: number | undefined, bucket?: CalibrationBucket) {
  return zAgainst(score, bucket?.scores ?? []);
}

function percentileRank(value: number | undefined, values: number[]) {
  if (value === undefined || !values.length) return undefined;
  const target = Math.abs(value);
  const ranked = values.map(Math.abs);
  const lessOrEqual = ranked.filter((item) => item <= target).length;
  return Math.round((lessOrEqual / ranked.length) * 100);
}

function expectedImpact(importance: number): FxstreetStyleAnalytics['expectedImpact'] {
  if (importance >= 3) return 'high';
  if (importance === 2) return 'medium';
  if (importance === 1) return 'low';
  return 'none';
}

function directionalConsistency(bucket?: CalibrationBucket) {
  if (!bucket) return undefined;
  const directional = bucket.beat + bucket.miss;
  if (!directional) return undefined;
  return Math.round((Math.max(bucket.beat, bucket.miss) / directional) * 100);
}

function historicalReliability(bucket?: CalibrationBucket) {
  const total = bucket?.total ?? 0;
  if (!total) return 30;
  const depth = Math.min(1, total / 20);
  const consistency = directionalConsistency(bucket) ?? 50;
  const inLineShare = (bucket?.inLine ?? 0) / Math.max(total, 1);
  return Math.round(Math.min(95, 35 + depth * 35 + consistency * 0.20 + (1 - inLineShare) * 5));
}

function surpriseMomentum(score: number | undefined, history: number[]): FxstreetStyleAnalytics['surpriseMomentum'] {
  if (score === undefined || history.length < 3) return 'insufficient-history';
  const recent = history.slice(-5);
  const baseline = recent.reduce((sum, value) => sum + Math.abs(value), 0) / recent.length;
  if (!(baseline > 1e-9)) return 'stable';
  const ratio = Math.abs(score) / baseline;
  if (ratio >= 1.25) return 'accelerating';
  if (ratio <= 0.75) return 'decelerating';
  return 'stable';
}

function buildFxstreetStyleAnalytics(event: CalendarEvent, bucket?: CalibrationBucket): FxstreetStyleAnalytics {
  const deviations = bucket?.deviations ?? [];
  const surprises = bucket?.surprisePercents ?? [];
  const revisions = bucket?.revisionDeltas ?? [];
  const deviationStats = meanStd(deviations);
  const consensusErrorZ = zAgainst(event.surprisePercent, surprises);
  const revisionZ = zAgainst(event.revisionDelta, revisions);
  const revisionAdjustment = revisionZ === undefined ? 0 : clamp(revisionZ * 10, -20, 20);
  const revisionAdjustedScore = event.releaseScore === undefined
    ? undefined
    : Math.round(clamp(event.releaseScore + revisionAdjustment));

  return {
    expectedImpact: expectedImpact(event.importance),
    expectedImpactScore: Math.max(0, Math.min(3, Math.round(event.importance))),
    nativeDeviation: event.deviation,
    deviationPercentile: percentileRank(event.deviation, deviations),
    consensusErrorZ,
    revisionZ,
    revisionAdjustedScore,
    surpriseMomentum: surpriseMomentum(event.releaseScore, bucket?.scores ?? []),
    directionalConsistency: directionalConsistency(bucket),
    historicalReliability: historicalReliability(bucket),
    historicalMeanDeviation: deviationStats.mean === undefined ? undefined : Number(deviationStats.mean.toFixed(2)),
    historicalDeviationStd: deviationStats.std === undefined ? undefined : Number(deviationStats.std.toFixed(2)),
    sampleSize: bucket?.total ?? 0,
    methodology: 'fxga-transparent-fxstreet-style',
    marketImpactAvailability: {
      trueRange: 'requires-market-price-history',
      volatilityRatio: 'requires-market-price-history',
      trueRangeVsDeviation: 'requires-market-price-history',
    },
  };
}

function analyticsNote(analytics: FxstreetStyleAnalytics) {
  const parts = [
    `Expected impact ${analytics.expectedImpact.toUpperCase()}`,
    `history n=${analytics.sampleSize}`,
    `reliability ${analytics.historicalReliability}%`,
  ];
  if (analytics.deviationPercentile !== undefined) parts.push(`Dev percentile ${analytics.deviationPercentile}%`);
  if (analytics.consensusErrorZ !== undefined) parts.push(`consensus-error z ${analytics.consensusErrorZ >= 0 ? '+' : ''}${analytics.consensusErrorZ}`);
  if (analytics.revisionZ !== undefined) parts.push(`revision z ${analytics.revisionZ >= 0 ? '+' : ''}${analytics.revisionZ}`);
  if (analytics.surpriseMomentum !== 'insufficient-history') parts.push(`surprise momentum ${analytics.surpriseMomentum}`);
  return `FXGA FXStreet-style analytics: ${parts.join(' · ')}.`;
}

function enrich(event: CalendarEvent, map: CalibrationMap) {
  const analyzed = analyzeCalendarEvent(event);
  const bucket = map[calibrationKey(analyzed)];
  const fxstreetAnalytics = buildFxstreetStyleAnalytics(analyzed, bucket);
  const existingNote = analyzed.analysisNote ? `${analyzed.analysisNote} ` : '';
  return {
    ...analyzed,
    probabilities: probabilities(bucket),
    standardizedSurprise: zScore(analyzed.releaseScore, bucket),
    fxstreetAnalytics,
    analysisNote: `${existingNote}${analyticsNote(fxstreetAnalytics)}`.trim(),
  };
}

export async function enrichCalendarWithCalibration(storage: DurableObjectStorage, events: CalendarEvent[]) {
  const map = (await storage.get<CalibrationMap>(CALIBRATION_KEY)) ?? {};
  return events.map((event) => enrich(event, map));
}

export async function recordReleaseCalibration(storage: DurableObjectStorage, event: CalendarEvent) {
  const map = (await storage.get<CalibrationMap>(CALIBRATION_KEY)) ?? {};
  const enriched = enrich(event, map);
  if (!['beat', 'miss', 'in-line'].includes(enriched.outcome ?? '')) return enriched;

  const key = calibrationKey(enriched);
  const occurrenceId = enriched.eventDateId || enriched.id;
  const existing = map[key] ?? {
    total: 0, beat: 0, miss: 0, inLine: 0,
    scores: [], deviations: [], surprisePercents: [], revisionDeltas: [],
    occurrenceIds: [], updatedAt: new Date().toISOString(),
  };
  if (existing.occurrenceIds.includes(occurrenceId)) return enriched;

  existing.total += 1;
  if (enriched.outcome === 'beat') existing.beat += 1;
  else if (enriched.outcome === 'miss') existing.miss += 1;
  else existing.inLine += 1;

  if (typeof enriched.releaseScore === 'number') existing.scores.push(enriched.releaseScore);
  if (typeof enriched.deviation === 'number') (existing.deviations ??= []).push(enriched.deviation);
  if (typeof enriched.surprisePercent === 'number') (existing.surprisePercents ??= []).push(enriched.surprisePercent);
  if (typeof enriched.revisionDelta === 'number') (existing.revisionDeltas ??= []).push(enriched.revisionDelta);

  existing.scores = existing.scores.slice(-MAX_SCORES);
  existing.deviations = (existing.deviations ?? []).slice(-MAX_SCORES);
  existing.surprisePercents = (existing.surprisePercents ?? []).slice(-MAX_SCORES);
  existing.revisionDeltas = (existing.revisionDeltas ?? []).slice(-MAX_SCORES);
  existing.occurrenceIds = [...existing.occurrenceIds, occurrenceId].slice(-MAX_OCCURRENCES);
  existing.updatedAt = new Date().toISOString();
  map[key] = existing;
  await storage.put(CALIBRATION_KEY, map);
  return enrich(event, map);
}

export async function getCalibrationSummary(storage: DurableObjectStorage) {
  const map = (await storage.get<CalibrationMap>(CALIBRATION_KEY)) ?? {};
  const buckets = Object.entries(map).map(([key, bucket]) => ({
    key,
    ...bucket,
    probabilities: probabilities(bucket),
    directionalConsistency: directionalConsistency(bucket),
    historicalReliability: historicalReliability(bucket),
  }));
  return {
    methodology: 'FXStreet-native deviation is preserved when supplied. FXGA adds transparent empirical-Bayesian beat/miss/in-line probabilities, standardized surprise, deviation percentile, consensus-error z-score, revision z-score, revision-adjusted release score, surprise momentum, directional consistency and historical reliability. True Range and Volatility Ratio require synchronized market-price history and are never fabricated from calendar values alone.',
    buckets: buckets.sort((a, b) => b.total - a.total),
  };
}
