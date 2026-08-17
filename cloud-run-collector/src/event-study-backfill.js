import { Firestore } from '@google-cloud/firestore';
import { EVENT_STUDY_HORIZONS, buildEventStudyMeasurement, summarizeEventStudies, supportedEventStudyCurrency } from './event-study.js';

const db = new Firestore({ ignoreUndefinedProperties:true });
const state = db.collection('fxga_collector_state');
const marketSnapshots = db.collection('fxga_market_snapshots');
const eventStudies = db.collection('fxga_event_studies');
const DAY_MS = 86_400_000;

const hasActual = (value) => value != null && String(value).trim() !== '' && !['-','—','null'].includes(String(value).trim().toLowerCase());
const snapshotTime = (snapshot) => Date.parse(snapshot?.capturedAt || snapshot?.generatedAt || '');

function nearestBefore(snapshots, targetMs, maxLagMs = 45 * 60_000) {
  let best = null;
  for (const snapshot of snapshots) {
    const time = snapshotTime(snapshot);
    if (!Number.isFinite(time) || time > targetMs) break;
    if (targetMs - time <= maxLagMs) best = snapshot;
  }
  return best;
}

function nearestAround(snapshots, targetMs, toleranceMs) {
  let best = null;
  let bestDistance = Infinity;
  for (const snapshot of snapshots) {
    const time = snapshotTime(snapshot);
    if (!Number.isFinite(time)) continue;
    if (time < targetMs - toleranceMs) continue;
    if (time > targetMs + toleranceMs) break;
    const distance = Math.abs(time - targetMs);
    if (distance < bestDistance) {
      best = snapshot;
      bestDistance = distance;
    }
  }
  return best;
}

async function currentCalendarEvents(days) {
  const saved = await state.doc('calendar').get();
  const events = saved.exists ? saved.data()?.payload?.events || [] : [];
  const now = Date.now();
  const cutoff = now - days * DAY_MS;
  return events.filter((event) => {
    const time = Date.parse(event?.date || '');
    return Number.isFinite(time) && time <= now && time >= cutoff && supportedEventStudyCurrency(event?.currency) && hasActual(event?.actual);
  });
}

async function persistedMarketSnapshots(days) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const query = await marketSnapshots.where('capturedAt','>=',cutoff).orderBy('capturedAt','asc').limit(2000).get();
  return query.docs.map((doc) => doc.data()).filter((snapshot) => Number.isFinite(snapshotTime(snapshot)) && Array.isArray(snapshot?.assets));
}

async function publishState(days) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const query = await eventStudies.where('releaseAt','>=',cutoff).limit(500).get();
  const studies = query.docs.map((doc) => doc.data()).sort((a,b) => Date.parse(b?.releaseAt || 0) - Date.parse(a?.releaseAt || 0));
  const payload = { generatedAt:new Date().toISOString(), days, summary:summarizeEventStudies(studies), studies };
  await state.doc('event-studies').set({ updatedAt:payload.generatedAt, payload }, { merge:true });
  return payload;
}

export async function backfillEventStudies({ days = 7, maxEvents = 120 } = {}) {
  days = Math.min(7, Math.max(1, Number(days) || 7));
  maxEvents = Math.min(250, Math.max(1, Number(maxEvents) || 120));
  const [events, snapshots] = await Promise.all([currentCalendarEvents(days), persistedMarketSnapshots(days)]);
  const candidates = events.sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, maxEvents);
  let studiesTouched = 0;
  let measurementsWritten = 0;
  let measured = 0;
  let unavailable = 0;

  for (const event of candidates) {
    const releaseMs = Date.parse(event.date || '');
    if (!Number.isFinite(releaseMs)) continue;
    const baseline = nearestBefore(snapshots, releaseMs);
    const horizons = {};
    for (const [offsetText, horizon] of Object.entries(EVENT_STUDY_HORIZONS)) {
      const offsetSeconds = Number(offsetText);
      const targetMs = releaseMs + offsetSeconds * 1000;
      const toleranceMs = Math.max(180_000, offsetSeconds * 1000 * 0.25);
      const observation = nearestAround(snapshots, targetMs, toleranceMs);
      if (!baseline || !observation) {
        unavailable += 1;
        continue;
      }
      const measurement = buildEventStudyMeasurement(event, baseline, observation, offsetSeconds);
      if (!measurement) continue;
      horizons[horizon] = measurement;
      measurementsWritten += 1;
      if (measurement.quality === 'measured') measured += 1;
    }
    if (!Object.keys(horizons).length) continue;
    const ref = eventStudies.doc(event.id);
    const existing = await ref.get();
    const previous = existing.exists ? existing.data() : {};
    await ref.set({
      eventId:event.id,
      event:event.event,
      currency:event.currency,
      country:event.country,
      category:event.category,
      importance:event.importance,
      releaseAt:event.date,
      actual:event.actual ?? null,
      forecast:event.forecast ?? null,
      previous:event.previous ?? null,
      revised:event.revised ?? null,
      currencyBias:event.currencyBias ?? 'neutral',
      currencyBiasScore:event.currencyBiasScore ?? 0,
      biasConfidence:event.biasConfidence ?? null,
      interpretationFamily:event.interpretationFamily ?? null,
      horizons:{ ...(previous?.horizons || {}), ...horizons },
      backfilledAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
    }, { merge:true });
    studiesTouched += 1;
  }

  const published = await publishState(days);
  return {
    days,
    candidateEvents:candidates.length,
    persistedMarketSnapshots:snapshots.length,
    studiesTouched,
    measurementsWritten,
    measured,
    unavailable,
    summary:published.summary,
  };
}
