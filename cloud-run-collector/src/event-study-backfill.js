import { Firestore } from '@google-cloud/firestore';
import { summarizeEventStudies } from './event-study.js';
import { fetchCalendarHistoryWindow } from './calendar-history-60d.js';
import { buildMT5EventPriceStudy, MT5_EVENT_ASSETS, MT5_EVENT_HORIZONS } from './mt5-event-price-history.js';

const db = new Firestore({ ignoreUndefinedProperties:true });
const state = db.collection('fxga_collector_state');
const calendarHistory = db.collection('fxga_calendar_history');
const eventStudies = db.collection('fxga_event_studies');
const DAY_MS = 86_400_000;
const RETENTION_DAYS = 60;

const hasActual = (value) => value != null && String(value).trim() !== '' && !['-','—','null'].includes(String(value).trim().toLowerCase());
const completed24h = (study) => study?.horizons?.['24h']?.quality === 'measured' && Number(study?.horizons?.['24h']?.usableAssets || 0) > 0;

async function persistCalendarHistory(events) {
  let written = 0;
  for (let offset = 0; offset < events.length; offset += 400) {
    const batch = db.batch();
    for (const event of events.slice(offset, offset + 400)) {
      batch.set(calendarHistory.doc(event.id), {
        ...event,
        archivedAt:new Date().toISOString(),
        retentionWindowDays:RETENTION_DAYS,
        priceResearchUniverse:[...MT5_EVENT_ASSETS],
      }, { merge:true });
      written += 1;
    }
    await batch.commit();
  }
  return written;
}

async function calendarEvents(days) {
  const [historical, current] = await Promise.all([
    fetchCalendarHistoryWindow({ days }),
    state.doc('calendar').get(),
  ]);
  const currentEvents = current.exists ? current.data()?.payload?.events || [] : [];
  const merged = new Map();
  for (const event of [...historical.events, ...currentEvents]) {
    if (!event?.id) continue;
    merged.set(event.id, { ...(merged.get(event.id) || {}), ...event });
  }
  const now = Date.now();
  const cutoff = now - days * DAY_MS;
  const events = [...merged.values()].filter((event) => {
    const time = Date.parse(event?.date || '');
    return Number.isFinite(time) && time <= now && time >= cutoff && hasActual(event?.actual);
  }).sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
  const persisted = await persistCalendarHistory(events);
  return { events, persisted, failures:historical.failures };
}

async function existingStudies(days) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const query = await eventStudies.where('releaseAt','>=',cutoff).limit(3000).get();
  return new Map(query.docs.map((doc) => [doc.id, doc.data()]));
}

async function publishState(days) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const query = await eventStudies.where('releaseAt','>=',cutoff).limit(3000).get();
  const studies = query.docs.map((doc) => doc.data()).sort((a,b) => Date.parse(b?.releaseAt || 0) - Date.parse(a?.releaseAt || 0));
  const payload = {
    generatedAt:new Date().toISOString(),
    days,
    source:'MetaTrader5 canonical M1 + FXStreet economic calendar history',
    priceUniverse:[...MT5_EVENT_ASSETS],
    horizons:Object.values(MT5_EVENT_HORIZONS),
    summary:summarizeEventStudies(studies),
    studies,
  };
  await state.doc('event-studies').set({ updatedAt:payload.generatedAt, payload }, { merge:true });
  return payload;
}

export async function backfillEventStudies({ days=RETENTION_DAYS, maxEvents=1200, force=false }={}) {
  days = Math.min(RETENTION_DAYS, Math.max(1, Number(days) || RETENTION_DAYS));
  maxEvents = Math.min(3000, Math.max(1, Number(maxEvents) || 1200));
  const [{ events, persisted, failures }, existing] = await Promise.all([calendarEvents(days), existingStudies(days)]);
  const now = Date.now();
  const candidates = events
    .filter((event) => {
      if (force) return true;
      const previous = existing.get(event.id);
      if (!previous) return true;
      const releaseMs = Date.parse(event.date || '');
      if (!Number.isFinite(releaseMs)) return false;
      if (now - releaseMs < 25 * 60 * 60_000) return true;
      return !completed24h(previous);
    })
    .sort((a,b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0,maxEvents);

  let studiesTouched = 0;
  let measurementsWritten = 0;
  let measured = 0;
  let unavailable = 0;
  let assetsMeasured = 0;

  for (const event of candidates) {
    const priceStudy = await buildMT5EventPriceStudy(event);
    if (!priceStudy) continue;
    const previous = existing.get(event.id) || {};
    const horizons = { ...(previous.horizons || {}), ...(priceStudy.horizons || {}) };
    for (const measurement of Object.values(priceStudy.horizons || {})) {
      measurementsWritten += 1;
      if (measurement?.quality === 'measured') {
        measured += 1;
        assetsMeasured += Number(measurement.usableAssets || 0);
      } else {
        unavailable += 1;
      }
    }
    await eventStudies.doc(event.id).set({
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
      outcome:event.outcome ?? null,
      currencyBias:event.currencyBias ?? 'neutral',
      currencyBiasScore:event.currencyBiasScore ?? 0,
      biasConfidence:event.biasConfidence ?? null,
      surpriseValue:event.surpriseValue ?? null,
      surprisePercent:event.surprisePercent ?? null,
      interpretationFamily:event.interpretationFamily ?? null,
      priceSource:priceStudy.source,
      sourceTimeframe:priceStudy.sourceTimeframe,
      priceUniverse:priceStudy.assets,
      horizonOrder:Object.values(MT5_EVENT_HORIZONS),
      horizons,
      backfilledAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
    }, { merge:true });
    studiesTouched += 1;
  }

  const published = await publishState(days);
  return {
    days,
    retentionPolicy:'60-day rolling M1 research window; derived event studies persist beyond raw-price FIFO',
    calendarEvents:events.length,
    calendarEventsPersisted:persisted,
    calendarFetchFailures:failures,
    candidateEvents:candidates.length,
    studiesTouched,
    measurementsWritten,
    measured,
    unavailable,
    assetsMeasured,
    priceUniverse:[...MT5_EVENT_ASSETS],
    horizons:Object.values(MT5_EVENT_HORIZONS),
    summary:published.summary,
  };
}
