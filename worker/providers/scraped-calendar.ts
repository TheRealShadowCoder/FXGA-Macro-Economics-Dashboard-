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
}

export async function getCalendarSourceStatus(storage: DurableObjectStorage): Promise<CalendarSourceStatus | null> {
  return (await storage.get<CalendarSourceStatus>(SOURCE_STATUS_KEY)) ?? null;
}
