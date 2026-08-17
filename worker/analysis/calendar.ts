import type { CalendarEvent, ReleaseOutcome } from '../types';

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function numeric(value?: string) {
  if (!value) return null;
  const match = value.replace(/,/g, '').match(/[-+]?\d*\.?\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function inverseEvent(title: string) {
  return /unemployment|jobless|claims|claimant|layoffs?|redundanc|bankrupt|delinquen|default|inventor(?:y|ies)|vacanc(?:y|ies) rate/i.test(title);
}

function outcome(actual: number | null, consensus: number | null, inverse: boolean): ReleaseOutcome {
  if (actual === null) return 'pending';
  if (consensus === null) return 'no-consensus';
  const scale = Math.max(Math.abs(consensus), 1);
  const delta = (actual - consensus) / scale;
  if (Math.abs(delta) <= 0.0025) return 'in-line';
  const better = inverse ? actual < consensus : actual > consensus;
  return better ? 'beat' : 'miss';
}

export function analyzeCalendarEvent(event: CalendarEvent): CalendarEvent {
  const actual = numeric(event.actual);
  const consensus = numeric(event.forecast);
  const previous = numeric(event.previous);
  const revised = numeric(event.revised);
  const inverse = inverseEvent(event.event);
  const result = outcome(actual, consensus, inverse);

  let surprisePercent: number | undefined;
  let normalizedSurprise: number | undefined;
  if (actual !== null && consensus !== null) {
    const scale = Math.max(Math.abs(consensus), Math.abs(previous ?? 0), 1e-9);
    surprisePercent = ((actual - consensus) / scale) * 100;
    normalizedSurprise = clamp(Math.tanh(surprisePercent / 8) * 100);
    if (inverse) normalizedSurprise *= -1;
  }

  let revisionDelta: number | undefined;
  if (revised !== null && previous !== null) revisionDelta = revised - previous;

  const nativeDeviation = typeof event.deviation === 'number' && Number.isFinite(event.deviation) ? event.deviation : undefined;
  let deviationScore = nativeDeviation === undefined ? undefined : clamp(Math.tanh(nativeDeviation / 3.5) * 100);
  if (inverse && deviationScore !== undefined) deviationScore *= -1;
  const releaseScore = deviationScore ?? normalizedSurprise;
  const sourceConfidence = Math.min(25, Math.max(0, (event.sourceCount ?? 1) - 1) * 7);
  const fieldConfidence = (actual !== null ? 25 : 0) + (consensus !== null ? 20 : 0) + (previous !== null ? 10 : 0) + (nativeDeviation !== undefined ? 15 : 0);
  const analysisConfidence = Math.min(95, 35 + sourceConfidence + fieldConfidence);

  const note = nativeDeviation !== undefined
    ? `FXStreet deviation ${nativeDeviation.toFixed(2)}; ${result}. Native deviation is preserved, while FXGA orients the derived release score so positive means a stronger/better-than-expected economic impulse.`
    : actual !== null && consensus !== null
      ? `${result}; FXGA normalized surprise is calculated from actual versus consensus because no native deviation was supplied.`
      : 'Awaiting a released actual and/or consensus.';

  return {
    ...event,
    outcome: result,
    surprisePercent: surprisePercent === undefined ? undefined : Number(surprisePercent.toFixed(2)),
    normalizedSurprise: normalizedSurprise === undefined ? undefined : Math.round(normalizedSurprise),
    revisionDelta: revisionDelta === undefined ? undefined : Number(revisionDelta.toFixed(4)),
    releaseScore: releaseScore === undefined ? undefined : Math.round(releaseScore),
    betterThanExpected: result === 'beat',
    worseThanExpected: result === 'miss',
    analysisConfidence,
    analysisNote: note,
  };
}

export function analyzeCalendar(events: CalendarEvent[]) {
  return events.map(analyzeCalendarEvent);
}
