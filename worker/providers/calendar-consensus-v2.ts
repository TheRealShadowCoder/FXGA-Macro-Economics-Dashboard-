import { renderCalendarSourcesShared } from '../acquisition/calendar-browser';
import type { CalendarEvent, Env } from '../types';
import * as legacy from './calendar-consensus';
import { parseFxstreetVisibleCalendar } from './fxstreet-visible';

const SOURCE_STATUS_KEY = 'calendar:scrape-source-status:v1';

interface StoredStatus {
  syncedAt: string;
  horizonDays: number;
  sources: Record<string, { name: string; ok: boolean; events: number; error?: string }>;
  rawEvents: number;
  mergedEvents: number;
}

function withinHorizon(events: CalendarEvent[], days: number) {
  const now = Date.now();
  const from = now - 12 * 60 * 60 * 1000;
  const to = now + Math.min(Math.max(days, 1), 21) * 86_400_000;
  return events.filter((event) => {
    const time = Date.parse(event.date);
    return Number.isFinite(time) && time >= from && time <= to;
  });
}

async function persistFxstreetFallbackStatus(storage: DurableObjectStorage, events: CalendarEvent[], days: number) {
  const previous = (await storage.get<StoredStatus>(SOURCE_STATUS_KEY)) ?? {
    syncedAt: new Date().toISOString(),
    horizonDays: days,
    sources: {},
    rawEvents: 0,
    mergedEvents: 0,
  };
  previous.syncedAt = new Date().toISOString();
  previous.horizonDays = days;
  previous.sources.fxstreet = {
    name: 'FXStreet',
    ok: events.length > 0,
    events: events.length,
    ...(events.length ? {} : { error: 'Rendered FXStreet calendar contained no parseable timed rows.' }),
  };
  previous.rawEvents = Math.max(previous.rawEvents, events.length);
  previous.mergedEvents = Math.max(previous.mergedEvents, events.length);
  await storage.put(SOURCE_STATUS_KEY, previous);
}

export async function getScrapedEconomicCalendar(env: Env, storage: DurableObjectStorage, days = 14): Promise<CalendarEvent[]> {
  try {
    const events = await legacy.getScrapedEconomicCalendar(env, storage, days);
    if (events.length) return events;
  } catch {
    // The legacy path records per-source failures; continue with the robust visible FXStreet parser.
  }

  const rendered = await renderCalendarSourcesShared(env, storage, ['fxstreet-calendar']);
  const document = rendered['fxstreet-calendar'];
  const visible = withinHorizon(parseFxstreetVisibleCalendar(document?.text ?? ''), days);
  await persistFxstreetFallbackStatus(storage, visible, days);
  if (!visible.length) throw new Error('FXStreet rendered calendar was reachable but no timed economic events could be normalized');
  return visible;
}

export async function refreshScrapedReleaseWindow(env: Env, storage: DurableObjectStorage, scheduled: CalendarEvent[]): Promise<CalendarEvent[]> {
  // Preserve the browser-free release window. The legacy implementation attempts the
  // lightweight Myfxbook CSV once for the entire release cluster and otherwise retains
  // persisted state. FXStreet direct public-feed enrichment is added separately once its
  // captured calendar-api schema is normalized.
  try {
    return await legacy.refreshScrapedReleaseWindow(env, storage, scheduled);
  } catch {
    return scheduled;
  }
}
