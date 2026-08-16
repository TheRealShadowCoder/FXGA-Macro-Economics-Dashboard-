import { getCalendarBrowserDebug } from '../acquisition/calendar-browser';

export { getScrapedEconomicCalendar, refreshScrapedReleaseWindow } from './calendar-consensus';

const SOURCE_STATUS_KEY = 'calendar:scrape-source-status:v1';

export interface CalendarSourceStatus {
  syncedAt: string;
  horizonDays: number;
  sources: Record<string, {
    name: string;
    ok: boolean;
    events: number;
    error?: string;
  }>;
  rawEvents: number;
  mergedEvents: number;
  browserDebug?: Record<string, unknown>;
}

export async function getCalendarSourceStatus(storage: DurableObjectStorage): Promise<CalendarSourceStatus | null> {
  const status = (await storage.get<CalendarSourceStatus>(SOURCE_STATUS_KEY)) ?? null;
  if (!status) return null;
  const [myfxbook, fxstreet] = await Promise.all([
    getCalendarBrowserDebug(storage, 'myfxbook-calendar'),
    getCalendarBrowserDebug(storage, 'fxstreet-calendar'),
  ]);
  return {
    ...status,
    browserDebug: {
      myfxbook,
      fxstreet,
    },
  };
}
