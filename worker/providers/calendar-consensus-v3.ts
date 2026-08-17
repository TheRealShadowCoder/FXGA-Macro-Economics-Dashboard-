import type { CalendarEvent, Env } from '../types';
import * as base from './calendar-consensus-v2';
import { fetchFxstreetPublicWindow, mergeFxstreetReleaseValues } from './fxstreet-public-feed';

export async function getScrapedEconomicCalendar(env: Env, storage: DurableObjectStorage, days = 14): Promise<CalendarEvent[]> {
  const events = await base.getScrapedEconomicCalendar(env, storage, days);

  // Enrich only the near-term schedule with the same public JSON feed the FXStreet
  // calendar widget loads. This is one lightweight request and makes the persisted
  // schedule more useful without increasing Browser Run use.
  const upcoming = events.filter((event) => Date.parse(event.date) >= Date.now()).slice(0, 80);
  if (!upcoming.length) return events;
  const fromMs = Math.max(Date.now() - 15 * 60_000, Math.min(...upcoming.map((event) => Date.parse(event.date))) - 15 * 60_000);
  const toMs = Math.min(Date.now() + 48 * 60 * 60_000, Math.max(...upcoming.map((event) => Date.parse(event.date))) + 15 * 60_000);
  if (!(toMs > fromMs)) return events;

  const fresh = await fetchFxstreetPublicWindow(new Date(fromMs), new Date(toMs));
  if (!fresh.length) return events;
  return mergeFxstreetReleaseValues(events, fresh);
}

export async function refreshScrapedReleaseWindow(env: Env, storage: DurableObjectStorage, scheduled: CalendarEvent[]): Promise<CalendarEvent[]> {
  if (!scheduled.length) return [];
  const validTimes = scheduled.map((event) => Date.parse(event.date)).filter(Number.isFinite);
  if (!validTimes.length) return scheduled;

  const from = new Date(Math.min(...validTimes) - 10 * 60_000);
  const to = new Date(Math.max(...validTimes) + 10 * 60_000);
  const fxstreet = await fetchFxstreetPublicWindow(from, to);
  if (fxstreet.length) return mergeFxstreetReleaseValues(scheduled, fxstreet);

  // Myfxbook remains an opportunistic fallback. In the current Cloudflare runtime it
  // may return a security challenge; that failure is deliberately non-fatal and no
  // anti-bot bypass is attempted.
  return base.refreshScrapedReleaseWindow(env, storage, scheduled);
}
