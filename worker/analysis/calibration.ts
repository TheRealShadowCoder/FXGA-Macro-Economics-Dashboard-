import { analyzeCalendarEvent } from './calendar';
import type { CalendarEvent, ReleaseProbabilities } from '../types';

const CALIBRATION_KEY = 'release:calibration:v1';
const MAX_SCORES = 80;
const MAX_OCCURRENCES = 120;

interface CalibrationBucket {
  total: number;
  beat: number;
  miss: number;
  inLine: number;
  scores: number[];
  occurrenceIds: string[];
  updatedAt: string;
}

type CalibrationMap = Record<string, CalibrationBucket>;

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

function zScore(score: number | undefined, bucket?: CalibrationBucket) {
  if (score === undefined || !bucket || bucket.scores.length < 5) return undefined;
  const mean = bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length;
  const variance = bucket.scores.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / bucket.scores.length;
  const standardDeviation = Math.sqrt(variance);
  if (!(standardDeviation > 1e-9)) return undefined;
  return Number(((score - mean) / standardDeviation).toFixed(2));
}

function enrich(event: CalendarEvent, map: CalibrationMap) {
  const analyzed = analyzeCalendarEvent(event);
  const bucket = map[calibrationKey(analyzed)];
  return {
    ...analyzed,
    probabilities: probabilities(bucket),
    standardizedSurprise: zScore(analyzed.releaseScore, bucket),
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
    scores: [], occurrenceIds: [], updatedAt: new Date().toISOString(),
  };
  if (existing.occurrenceIds.includes(occurrenceId)) return enriched;

  existing.total += 1;
  if (enriched.outcome === 'beat') existing.beat += 1;
  else if (enriched.outcome === 'miss') existing.miss += 1;
  else existing.inLine += 1;
  if (typeof enriched.releaseScore === 'number') existing.scores.push(enriched.releaseScore);
  existing.scores = existing.scores.slice(-MAX_SCORES);
  existing.occurrenceIds = [...existing.occurrenceIds, occurrenceId].slice(-MAX_OCCURRENCES);
  existing.updatedAt = new Date().toISOString();
  map[key] = existing;
  await storage.put(CALIBRATION_KEY, map);
  return enriched;
}

export async function getCalibrationSummary(storage: DurableObjectStorage) {
  const map = (await storage.get<CalibrationMap>(CALIBRATION_KEY)) ?? {};
  const buckets = Object.entries(map).map(([key, bucket]) => ({ key, ...bucket, probabilities: probabilities(bucket) }));
  return {
    methodology: 'Empirical Bayesian beat/miss/in-line frequencies with Laplace priors; standardized surprise becomes available after at least five historical release scores for the same canonical event.',
    buckets: buckets.sort((a, b) => b.total - a.total),
  };
}
