import { analyzeCalendarEvent } from './calendar';
import type { CalendarEvent } from '../types';

type Direction = 'BUY' | 'SELL' | 'WAIT';
type SessionId = 'sydney' | 'tokyo' | 'london' | 'new-york' | 'overlap';

type MacroAnalysisLike = {
  regime?: { name?: string };
  confidence?: number;
  assets?: Array<{ id: string; score: number; bias?: string }>;
};

interface BaseSessionDef {
  id: Exclude<SessionId, 'overlap'>;
  label: string;
  timeZone: string;
  localStart: number;
  localEnd: number;
  focusCurrencies: string[];
  symbols: string[];
}

interface SessionDef {
  id: SessionId;
  label: string;
  start: number;
  end: number;
  focusCurrencies: string[];
  symbols: string[];
}

const BASE_SESSIONS: BaseSessionDef[] = [
  { id: 'sydney', label: 'Sydney Session', timeZone: 'Australia/Sydney', localStart: 8 * 60, localEnd: 17 * 60, focusCurrencies: ['AUD', 'NZD', 'JPY', 'USD'], symbols: ['AUDUSD', 'NZDUSD', 'AUDJPY', 'NZDJPY', 'XAUUSD'] },
  { id: 'tokyo', label: 'Tokyo Session', timeZone: 'Asia/Tokyo', localStart: 9 * 60, localEnd: 18 * 60, focusCurrencies: ['JPY', 'CNY', 'AUD', 'NZD', 'USD'], symbols: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'XAUUSD'] },
  { id: 'london', label: 'London Session', timeZone: 'Europe/London', localStart: 8 * 60, localEnd: 17 * 60, focusCurrencies: ['EUR', 'GBP', 'CHF', 'USD'], symbols: ['EURUSD', 'GBPUSD', 'USDCHF', 'EURGBP', 'XAUUSD'] },
  { id: 'new-york', label: 'New York Session', timeZone: 'America/New_York', localStart: 8 * 60, localEnd: 17 * 60, focusCurrencies: ['USD', 'CAD', 'EUR', 'GBP', 'JPY'], symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD', 'SPX500', 'BTCUSD'] },
];

function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMinute(value: number) {
  return ((value % 1440) + 1440) % 1440;
}

function timeZoneOffsetMinutes(timeZone: string, date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const representedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((representedUtc - date.getTime()) / 60_000);
}

function resolveBaseSession(def: BaseSessionDef, now: Date): SessionDef {
  const offset = timeZoneOffsetMinutes(def.timeZone, now);
  return {
    id: def.id,
    label: def.label,
    start: normalizeMinute(def.localStart - offset),
    end: normalizeMinute(def.localEnd - offset),
    focusCurrencies: def.focusCurrencies,
    symbols: def.symbols,
  };
}

function resolveSessions(now: Date): SessionDef[] {
  const resolved = BASE_SESSIONS.map((def) => resolveBaseSession(def, now));
  const london = resolved.find((session) => session.id === 'london')!;
  const newYork = resolved.find((session) => session.id === 'new-york')!;
  const overlap: SessionDef = {
    id: 'overlap',
    label: 'London / New York Overlap',
    start: Math.max(london.start, newYork.start),
    end: Math.min(london.end, newYork.end),
    focusCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'JPY'],
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD'],
  };
  return [...resolved, overlap];
}

function minuteOfDay(date: Date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function sessionState(def: SessionDef, now: Date) {
  const minute = minuteOfDay(now);
  const wraps = def.start > def.end;
  const active = wraps ? minute >= def.start || minute < def.end : minute >= def.start && minute < def.end;
  if (active) return 'active' as const;
  if (wraps) return minute < def.start && minute >= def.end ? 'upcoming' as const : 'closed' as const;
  return minute < def.start ? 'upcoming' as const : 'closed' as const;
}

function formatWindow(def: SessionDef) {
  const fmt = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return `${fmt(def.start)}–${fmt(def.end)} UTC`;
}

function assetScore(analysis: MacroAnalysisLike, id: string) {
  return analysis.assets?.find((asset) => asset.id === id)?.score ?? 0;
}

function recentEventImpulse(events: CalendarEvent[], currency: string, nowMs: number) {
  const relevant = events.filter((event) => event.currency === currency && event.actual && nowMs - Date.parse(event.date) >= 0 && nowMs - Date.parse(event.date) <= 6 * 60 * 60_000);
  if (!relevant.length) return { score: 0, count: 0, names: [] as string[] };
  let weighted = 0;
  let weights = 0;
  for (const raw of relevant) {
    const event = analyzeCalendarEvent(raw);
    if (typeof event.releaseScore !== 'number') continue;
    const weight = Math.max(1, event.importance);
    weighted += event.releaseScore * weight;
    weights += weight;
  }
  return {
    score: weights ? clamp(weighted / weights) : 0,
    count: relevant.length,
    names: relevant.slice(0, 3).map((event) => event.event),
  };
}

function currencyScore(currency: string, usdMacro: number, events: CalendarEvent[], nowMs: number) {
  const impulse = recentEventImpulse(events, currency, nowMs);
  const macro = currency === 'USD' ? usdMacro : 0;
  return { score: clamp(macro * 0.7 + impulse.score * 0.55), impulse };
}

function nextCatalyst(events: CalendarEvent[], currencies: string[], nowMs: number) {
  return events
    .filter((event) => currencies.includes(event.currency ?? '') && Date.parse(event.date) >= nowMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
}

function symbolCurrencies(symbol: string) {
  if (symbol === 'XAUUSD' || symbol === 'BTCUSD' || symbol === 'SPX500') return ['USD'];
  return [symbol.slice(0, 3), symbol.slice(3, 6)].filter((value) => /^[A-Z]{3}$/.test(value));
}

function scoreSymbol(symbol: string, analysis: MacroAnalysisLike, events: CalendarEvent[], nowMs: number) {
  const usd = assetScore(analysis, 'usd');
  if (symbol === 'XAUUSD') return clamp(assetScore(analysis, 'gold') - usd * 0.25);
  if (symbol === 'BTCUSD') return clamp(assetScore(analysis, 'crypto') - usd * 0.20);
  if (symbol === 'SPX500') return clamp(assetScore(analysis, 'equities') - usd * 0.08);
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  return clamp(currencyScore(base, usd, events, nowMs).score - currencyScore(quote, usd, events, nowMs).score);
}

function direction(score: number): Direction {
  if (score >= 20) return 'BUY';
  if (score <= -20) return 'SELL';
  return 'WAIT';
}

export function buildSessionSignals(analysis: MacroAnalysisLike, rawEvents: CalendarEvent[], now = new Date()) {
  const nowMs = now.getTime();
  const events = rawEvents.map(analyzeCalendarEvent).filter((event) => Number.isFinite(Date.parse(event.date)));
  const macroConfidence = analysis.confidence ?? 50;
  const usdMacro = assetScore(analysis, 'usd');
  const sessions = resolveSessions(now).map((def) => {
    const state = sessionState(def, now);
    const relevant = events.filter((event) => def.focusCurrencies.includes(event.currency ?? '') && Math.abs(Date.parse(event.date) - nowMs) <= 18 * 60 * 60_000);
    const catalyst = nextCatalyst(events, def.focusCurrencies, nowMs);
    const minutesToCatalyst = catalyst ? (Date.parse(catalyst.date) - nowMs) / 60_000 : Infinity;
    const eventLockout = Boolean(catalyst && catalyst.importance >= 3 && minutesToCatalyst >= 0 && minutesToCatalyst <= 15);
    const elevated = Boolean(catalyst && catalyst.importance >= 2 && minutesToCatalyst >= 0 && minutesToCatalyst <= 45);
    const risk = eventLockout ? 'event-lockout' as const : elevated ? 'elevated' as const : 'normal' as const;

    const signals = def.symbols.map((symbol) => {
      const score = Math.round(scoreSymbol(symbol, analysis, events, nowMs));
      const currencies = symbolCurrencies(symbol);
      const symbolCatalyst = nextCatalyst(events, currencies, nowMs);
      const mins = symbolCatalyst ? (Date.parse(symbolCatalyst.date) - nowMs) / 60_000 : Infinity;
      const locked = Boolean(symbolCatalyst && symbolCatalyst.importance >= 3 && mins >= 0 && mins <= 15);
      const proposed = direction(score);
      const finalDirection: Direction = locked ? 'WAIT' : proposed;
      const recent = currencies.flatMap((currency) => recentEventImpulse(events, currency, nowMs).names).slice(0, 3);
      const confidence = Math.round(Math.min(92, 35 + Math.abs(score) * 0.35 + macroConfidence * 0.25 + recent.length * 3));
      const rationale = [
        `Macro score ${score >= 0 ? '+' : ''}${score}/100`,
        `USD macro impulse ${usdMacro >= 0 ? '+' : ''}${usdMacro}/100`,
        ...(recent.length ? [`Recent releases: ${recent.join(', ')}`] : []),
        ...(locked && symbolCatalyst ? [`High-impact lockout before ${symbolCatalyst.event}`] : []),
      ];
      return {
        symbol, direction: finalDirection, score, confidence, rationale,
        invalidation: 'Invalidate on an opposite high-impact macro surprise or when the underlying macro score crosses back through neutral. Require technical execution confirmation before entry.',
        catalyst: symbolCatalyst ? `${symbolCatalyst.currency ?? ''} ${symbolCatalyst.event} · ${new Date(symbolCatalyst.date).toISOString()}` : undefined,
      };
    });

    return {
      id: def.id, label: def.label, windowUtc: formatWindow(def), active: state === 'active', state, risk,
      focusCurrencies: def.focusCurrencies,
      nextCatalyst: catalyst ? `${catalyst.currency ?? ''} ${catalyst.event} · ${new Date(catalyst.date).toISOString()}` : undefined,
      eventCount: relevant.length, signals,
    };
  });

  return {
    generatedAt: now.toISOString(),
    methodology: 'Session signal = macro regime + USD/risk-asset bias + released FXStreet surprise/deviation impulses + scheduled catalyst lockouts. Sydney, Tokyo, London and New York windows are converted from their local market clocks to UTC using current timezone offsets, so seasonal daylight-saving changes are reflected automatically.',
    caution: 'These are report-based directional biases, not standalone entries. Technical structure, liquidity, invalidation and risk controls remain mandatory before execution.',
    macroRegime: analysis.regime?.name ?? 'Unknown', macroConfidence, sessions,
  };
}
