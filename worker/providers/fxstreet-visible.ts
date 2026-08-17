import type { CalendarEvent } from '../types';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function nearestUtcDate(month: number, day: number, hour: number, minute: number) {
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((candidateYear) => new Date(Date.UTC(candidateYear, month, day, hour, minute)));
  candidates.sort((a, b) => Math.abs(a.getTime() - now) - Math.abs(b.getTime() - now));
  return candidates[0];
}

function clean(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== '-' && trimmed !== '—' ? trimmed : undefined;
}

function numberFrom(value: string | undefined) {
  const cleaned = clean(value)?.replace(/,/g, '').replace(/%/g, '');
  if (!cleaned) return undefined;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'AM' && hour === 12) hour = 0;
  else if (period === 'PM' && hour !== 12) hour += 12;
  return { hour, minute };
}

function tokenizeChunk(chunk: string) {
  return chunk.split(/[\t\n]+/).map((value) => value.trim()).filter(Boolean);
}

export function parseFxstreetVisibleCalendar(text: string): CalendarEvent[] {
  const headingRegex = /(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{1,2})/gi;
  const headings = [...text.matchAll(headingRegex)];
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();

  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const heading = headings[headingIndex];
    const month = MONTHS.indexOf(heading[2].toLowerCase());
    const day = Number(heading[3]);
    if (month < 0 || !Number.isFinite(day)) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headingIndex + 1 < headings.length ? (headings[headingIndex + 1].index ?? text.length) : text.length;
    const segment = text.slice(start, end);
    const times = [...segment.matchAll(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/gi)];

    for (let timeIndex = 0; timeIndex < times.length; timeIndex += 1) {
      const timeMatch = times[timeIndex];
      const parsedTime = parseTime(timeMatch[1]);
      if (!parsedTime) continue;
      const chunkStart = timeMatch.index ?? 0;
      const chunkEnd = timeIndex + 1 < times.length ? (times[timeIndex + 1].index ?? segment.length) : segment.length;
      const tokens = tokenizeChunk(segment.slice(chunkStart, chunkEnd));
      const currencyIndex = tokens.findIndex((value, index) => index > 0 && /^[A-Z]{3}$/.test(value));
      if (currencyIndex < 1 || !tokens[currencyIndex + 1]) continue;
      const currency = tokens[currencyIndex];
      const event = tokens[currencyIndex + 1];
      const values = tokens.slice(currencyIndex + 2, currencyIndex + 6);
      const actual = clean(values[0]);
      const deviation = numberFrom(values[1]);
      const consensus = clean(values[2]);
      const previous = clean(values[3]);
      const date = nearestUtcDate(month, day, parsedTime.hour, parsedTime.minute);
      const identity = `${date.toISOString()}|${currency}|${event.toLowerCase()}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      events.push({
        id: `fxstreet-visible-${hash(identity)}`,
        date: date.toISOString(), country: currency, currency, event,
        category: 'Economic Calendar', importance: 1,
        actual, deviation, previous, forecast: consensus,
        source: 'FXStreet', providers: ['fxstreet'], sourceCount: 1,
        lastUpdate: new Date().toISOString(),
      });
    }
  }
  return events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
