import { analyzeCalendarEvent } from './calendar';
import type { EconomyMacroState } from './economies';
import type { CalendarEvent } from '../types';

type Direction = 'BUY' | 'SELL' | 'WAIT';
type SessionId = 'sydney' | 'tokyo' | 'london' | 'new-york' | 'overlap';
type RiskState = 'normal' | 'elevated' | 'event-lockout';
type Coverage = 'full' | 'partial' | 'event-only' | 'asset-model';

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

interface CurrencyMacroState {
  currency: string;
  economy?: string;
  centralBank?: string;
  regime?: string;
  policyStance?: string;
  structuralScore: number;
  policyScore: number;
  confidence: number;
  releaseScore: number;
  releaseConfidence: number;
  releaseCount: number;
  releaseNames: string[];
  covered: boolean;
}

const BASE_SESSIONS: BaseSessionDef[] = [
  { id: 'sydney', label: 'Sydney Session', timeZone: 'Australia/Sydney', localStart: 8 * 60, localEnd: 17 * 60, focusCurrencies: ['AUD', 'NZD', 'JPY', 'USD'], symbols: ['AUDUSD', 'NZDUSD', 'AUDJPY', 'NZDJPY', 'XAUUSD'] },
  { id: 'tokyo', label: 'Tokyo Session', timeZone: 'Asia/Tokyo', localStart: 9 * 60, localEnd: 18 * 60, focusCurrencies: ['JPY', 'CNY', 'AUD', 'NZD', 'USD'], symbols: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'XAUUSD'] },
  { id: 'london', label: 'London Session', timeZone: 'Europe/London', localStart: 8 * 60, localEnd: 17 * 60, focusCurrencies: ['EUR', 'GBP', 'CHF', 'USD', 'ZAR', 'JPY'], symbols: ['EURUSD', 'GBPUSD', 'USDCHF', 'EURGBP', 'EURJPY', 'GBPJPY', 'USDZAR', 'EURZAR', 'GBPZAR', 'XAUUSD'] },
  { id: 'new-york', label: 'New York Session', timeZone: 'America/New_York', localStart: 8 * 60, localEnd: 17 * 60, focusCurrencies: ['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'ZAR'], symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDZAR', 'XAUUSD', 'SPX500', 'BTCUSD'] },
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
    focusCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'ZAR'],
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDZAR', 'EURZAR', 'GBPZAR', 'XAUUSD'],
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

function dimensionScore(state: EconomyMacroState | undefined, id: string) {
  return state?.dimensions.find((dimension) => dimension.id === id)?.score ?? 0;
}

function centralBankReactionScore(state: EconomyMacroState | undefined) {
  if (!state) return 0;
  const inflation = dimensionScore(state, 'inflation');
  const growth = dimensionScore(state, 'growth');
  const labour = dimensionScore(state, 'labour');
  const policy = dimensionScore(state, 'policy');
  return Math.round(clamp(inflation * 0.38 + labour * 0.18 + growth * 0.12 + policy * 0.32));
}

function recentEventImpulse(events: CalendarEvent[], currency: string, nowMs: number) {
  const relevant = events
    .filter((event) => event.currency === currency && event.actual && nowMs - Date.parse(event.date) >= 0 && nowMs - Date.parse(event.date) <= 8 * 60 * 60_000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (!relevant.length) return { score: 0, confidence: 0, count: 0, names: [] as string[] };

  let weighted = 0;
  let weights = 0;
  let confidenceWeighted = 0;
  for (const raw of relevant) {
    const event = analyzeCalendarEvent(raw);
    if (typeof event.releaseScore !== 'number') continue;
    const ageMinutes = Math.max(0, (nowMs - Date.parse(event.date)) / 60_000);
    const decay = Math.exp(-ageMinutes / 240);
    const importanceWeight = event.importance >= 3 ? 1.75 : event.importance === 2 ? 1.25 : 0.75;
    const analyticalConfidence = clamp(Number(event.analysisConfidence ?? event.confidence ?? 65), 25, 100) / 100;
    const weight = importanceWeight * decay * analyticalConfidence;
    weighted += event.releaseScore * weight;
    confidenceWeighted += analyticalConfidence * 100 * weight;
    weights += weight;
  }
  return {
    score: weights ? Math.round(clamp(weighted / weights)) : 0,
    confidence: weights ? Math.round(clamp(confidenceWeighted / weights, 0, 100)) : 0,
    count: relevant.length,
    names: relevant.slice(0, 3).map((event) => event.event),
  };
}

function nextCatalyst(events: CalendarEvent[], currencies: string[], nowMs: number) {
  return events
    .filter((event) => currencies.includes(event.currency ?? '') && Date.parse(event.date) >= nowMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
}

function eventRisk(events: CalendarEvent[], currencies: string[], nowMs: number) {
  let risk: RiskState = 'normal';
  let event: CalendarEvent | undefined;
  let minutes = Infinity;
  const candidates = events
    .filter((item) => currencies.includes(item.currency ?? ''))
    .map((item) => ({ item, minutes: (Date.parse(item.date) - nowMs) / 60_000 }))
    .filter(({ minutes }) => minutes >= -20 && minutes <= 90)
    .sort((a, b) => Math.abs(a.minutes) - Math.abs(b.minutes));

  for (const candidate of candidates) {
    const importance = candidate.item.importance ?? 1;
    const pendingAfterRelease = candidate.minutes < 0 && !candidate.item.actual;
    const lockout = importance >= 3 && candidate.minutes <= 20 && candidate.minutes >= (pendingAfterRelease ? -20 : -8);
    const elevated = (importance >= 3 && candidate.minutes > 20 && candidate.minutes <= 60)
      || (importance === 2 && candidate.minutes >= -3 && candidate.minutes <= 30);
    if (lockout) {
      risk = 'event-lockout'; event = candidate.item; minutes = candidate.minutes; break;
    }
    if (elevated && risk === 'normal') {
      risk = 'elevated'; event = candidate.item; minutes = candidate.minutes;
    }
  }
  return { risk, event, minutes };
}

function economyByCurrency(states: EconomyMacroState[]) {
  return new Map(states.map((state) => [state.currency, state]));
}

function currencyState(currency: string, states: Map<string, EconomyMacroState>, events: CalendarEvent[], nowMs: number): CurrencyMacroState {
  const state = states.get(currency);
  const release = recentEventImpulse(events, currency, nowMs);
  return {
    currency,
    economy: state?.label,
    centralBank: state?.centralBank,
    regime: state?.regime,
    policyStance: state?.policyStance,
    structuralScore: state?.currencyScore ?? 0,
    policyScore: centralBankReactionScore(state),
    confidence: state?.confidence ?? (release.count ? 38 : 25),
    releaseScore: release.score,
    releaseConfidence: release.confidence,
    releaseCount: release.count,
    releaseNames: release.names,
    covered: Boolean(state),
  };
}

function symbolCurrencies(symbol: string) {
  if (symbol === 'XAUUSD' || symbol === 'BTCUSD' || symbol === 'SPX500') return ['USD'];
  return [symbol.slice(0, 3), symbol.slice(3, 6)].filter((value) => /^[A-Z]{3}$/.test(value));
}

function sign(value: number, threshold = 8) {
  return value > threshold ? 1 : value < -threshold ? -1 : 0;
}

function signalDirection(score: number, confidence: number, coverage: Coverage, risk: RiskState): Direction {
  if (risk === 'event-lockout') return 'WAIT';
  if (confidence < 48) return 'WAIT';
  const threshold = coverage === 'full' || coverage === 'asset-model' ? 22 : 28;
  if (score >= threshold) return 'BUY';
  if (score <= -threshold) return 'SELL';
  return 'WAIT';
}

function pairCoverage(base: CurrencyMacroState, quote: CurrencyMacroState): Coverage {
  if (base.covered && quote.covered) return 'full';
  if (base.covered || quote.covered) return 'partial';
  return 'event-only';
}

function confidenceForPair(base: CurrencyMacroState, quote: CurrencyMacroState, score: number, structural: number, policy: number, release: number, coverage: Coverage) {
  let structuralConfidence = 30;
  if (coverage === 'full') structuralConfidence = (base.confidence + quote.confidence) / 2;
  else if (coverage === 'partial') structuralConfidence = ((base.covered ? base.confidence : quote.confidence) + 35) / 2;
  const releaseConfidence = Math.max(base.releaseConfidence, quote.releaseConfidence, 35);
  const signs = [sign(structural), sign(policy), sign(release)].filter((value) => value !== 0);
  const sameDirection = signs.length >= 2 && signs.every((value) => value === signs[0]);
  const hardConflict = sign(structural, 18) !== 0 && sign(policy, 18) !== 0 && sign(structural, 18) !== sign(policy, 18);
  let confidence = structuralConfidence * 0.72 + releaseConfidence * 0.12 + Math.min(Math.abs(score), 100) * 0.16;
  if (sameDirection) confidence += 7;
  if (hardConflict) confidence -= 12;
  if (coverage === 'partial') confidence -= 6;
  if (coverage === 'event-only') confidence -= 16;
  return Math.round(clamp(confidence, 20, 95));
}

function scoreFxPair(symbol: string, states: Map<string, EconomyMacroState>, events: CalendarEvent[], nowMs: number) {
  const baseCode = symbol.slice(0, 3);
  const quoteCode = symbol.slice(3, 6);
  const base = currencyState(baseCode, states, events, nowMs);
  const quote = currencyState(quoteCode, states, events, nowMs);
  const structural = clamp(base.structuralScore - quote.structuralScore);
  const policy = clamp(base.policyScore - quote.policyScore);
  const release = clamp(base.releaseScore - quote.releaseScore);
  const score = Math.round(clamp(structural * 0.58 + policy * 0.22 + release * 0.20));
  const coverage = pairCoverage(base, quote);
  const confidence = confidenceForPair(base, quote, score, structural, policy, release, coverage);
  return { base, quote, structural, policy, release, score, confidence, coverage };
}

function scoreAsset(symbol: string, analysis: MacroAnalysisLike, states: Map<string, EconomyMacroState>, events: CalendarEvent[], nowMs: number) {
  const usd = currencyState('USD', states, events, nowMs);
  let asset = 0;
  let structural = 0;
  let policy = 0;
  let release = 0;
  if (symbol === 'XAUUSD') {
    asset = assetScore(analysis, 'gold');
    structural = clamp(asset - usd.structuralScore * 0.20);
    policy = clamp(-usd.policyScore);
    release = clamp(-usd.releaseScore);
  } else if (symbol === 'BTCUSD') {
    asset = assetScore(analysis, 'crypto');
    structural = clamp(asset - usd.structuralScore * 0.12);
    policy = clamp(-usd.policyScore * 0.45);
    release = clamp(-usd.releaseScore * 0.25);
  } else {
    asset = assetScore(analysis, 'equities');
    structural = asset;
    policy = clamp(-usd.policyScore * 0.35);
    release = clamp(usd.releaseScore * 0.10);
  }
  const score = Math.round(clamp(structural * 0.66 + policy * 0.24 + release * 0.10));
  const confidence = Math.round(clamp((analysis.confidence ?? 50) * 0.55 + usd.confidence * 0.30 + Math.abs(score) * 0.15, 25, 94));
  return { usd, structural, policy, release, score, confidence, coverage: 'asset-model' as const };
}

function catalystDetails(events: CalendarEvent[], currencies: string[], nowMs: number) {
  const catalyst = nextCatalyst(events, currencies, nowMs);
  if (!catalyst) return { catalyst: undefined, catalystAt: undefined, minutesToCatalyst: undefined };
  const minutesToCatalyst = Math.round((Date.parse(catalyst.date) - nowMs) / 60_000);
  return {
    catalyst: `${catalyst.currency ?? ''} ${catalyst.event}`.trim(),
    catalystAt: new Date(catalyst.date).toISOString(),
    minutesToCatalyst,
  };
}

function buildSymbolSignal(symbol: string, analysis: MacroAnalysisLike, states: Map<string, EconomyMacroState>, events: CalendarEvent[], nowMs: number) {
  const currencies = symbolCurrencies(symbol);
  const riskState = eventRisk(events, currencies, nowMs);
  const catalyst = catalystDetails(events, currencies, nowMs);
  const isAsset = symbol === 'XAUUSD' || symbol === 'BTCUSD' || symbol === 'SPX500';

  let score = 0;
  let confidence = 0;
  let coverage: Coverage = 'event-only';
  let structural = 0;
  let policy = 0;
  let release = 0;
  let baseScore = 0;
  let quoteScore = 0;
  let centralBankDivergence = 'Cross-asset U.S. macro model';
  let regimes: string[] = [];
  let recentNames: string[] = [];

  if (isAsset) {
    const model = scoreAsset(symbol, analysis, states, events, nowMs);
    ({ score, confidence, coverage, structural, policy, release } = model);
    baseScore = structural;
    quoteScore = model.usd.structuralScore;
    regimes = [model.usd.regime ?? 'U.S. regime unavailable'];
    recentNames = model.usd.releaseNames;
    centralBankDivergence = `Federal Reserve: ${model.usd.policyStance ?? 'insufficient data'}`;
  } else {
    const model = scoreFxPair(symbol, states, events, nowMs);
    ({ score, confidence, coverage, structural, policy, release } = model);
    baseScore = model.base.structuralScore;
    quoteScore = model.quote.structuralScore;
    regimes = [model.base.regime ?? `${model.base.currency} structural model unavailable`, model.quote.regime ?? `${model.quote.currency} structural model unavailable`];
    recentNames = [...model.base.releaseNames, ...model.quote.releaseNames].slice(0, 3);
    centralBankDivergence = `${model.base.centralBank ?? model.base.currency}: ${model.base.policyStance ?? 'no structural state'} vs ${model.quote.centralBank ?? model.quote.currency}: ${model.quote.policyStance ?? 'no structural state'}`;
  }

  if (riskState.risk === 'elevated') confidence = Math.max(20, confidence - 6);
  if (riskState.risk === 'event-lockout') confidence = Math.max(20, confidence - 12);
  const direction = signalDirection(score, confidence, coverage, riskState.risk);
  const conviction = Math.round(Math.abs(score) * confidence / 100);
  const convictionLabel = conviction >= 50 ? 'high' : conviction >= 30 ? 'medium' : 'low';
  const executionGate = riskState.risk === 'event-lockout'
    ? 'WAIT_EVENT'
    : direction === 'WAIT'
      ? 'NO_MACRO_EDGE'
      : 'AWAIT_TECHNICAL_CONFIRMATION';

  const rationale = [
    `Structural macro divergence ${structural >= 0 ? '+' : ''}${Math.round(structural)}/100`,
    `Central-bank reaction divergence ${policy >= 0 ? '+' : ''}${Math.round(policy)}/100`,
    `Recent release impulse ${release >= 0 ? '+' : ''}${Math.round(release)}/100`,
    `Coverage ${coverage} · conviction ${convictionLabel} (${conviction}/100)`,
    ...(recentNames.length ? [`Recent releases: ${recentNames.join(', ')}`] : []),
    ...(riskState.risk === 'event-lockout' && riskState.event ? [`Execution locked around ${riskState.event.currency ?? ''} ${riskState.event.event}`] : []),
  ];

  return {
    symbol,
    direction,
    score,
    confidence,
    conviction,
    convictionLabel,
    coverage,
    risk: riskState.risk,
    executionGate,
    components: {
      structuralDivergence: Math.round(structural),
      policyDivergence: Math.round(policy),
      releaseDivergence: Math.round(release),
      baseCurrencyScore: Math.round(baseScore),
      quoteCurrencyScore: Math.round(quoteScore),
    },
    centralBankDivergence,
    regimes,
    rationale,
    invalidation: 'Macro invalidation: structural or central-bank divergence materially reverses toward the opposite side, or a new high-impact release creates an opposing impulse. A macro bias is not an entry; technical structure, liquidity, stop placement and risk limits must confirm execution.',
    ...catalyst,
  };
}

export function buildSessionSignals(analysis: MacroAnalysisLike, rawEvents: CalendarEvent[], now = new Date(), economyStates: EconomyMacroState[] = []) {
  const nowMs = now.getTime();
  const events = rawEvents.map(analyzeCalendarEvent).filter((event) => Number.isFinite(Date.parse(event.date)));
  const macroConfidence = analysis.confidence ?? 50;
  const states = economyByCurrency(economyStates);
  const resolvedSessions = resolveSessions(now);
  const symbolUniverse = [...new Set(resolvedSessions.flatMap((session) => session.symbols))];
  const signalCache = new Map(symbolUniverse.map((symbol) => [symbol, buildSymbolSignal(symbol, analysis, states, events, nowMs)]));

  const sessions = resolvedSessions.map((def) => {
    const state = sessionState(def, now);
    const relevant = events.filter((event) => def.focusCurrencies.includes(event.currency ?? '') && Math.abs(Date.parse(event.date) - nowMs) <= 18 * 60 * 60_000);
    const catalyst = nextCatalyst(events, def.focusCurrencies, nowMs);
    const sessionRisk = eventRisk(events, def.focusCurrencies, nowMs);
    const signals = def.symbols.map((symbol) => signalCache.get(symbol)!);
    return {
      id: def.id,
      label: def.label,
      windowUtc: formatWindow(def),
      active: state === 'active',
      state,
      risk: sessionRisk.risk,
      focusCurrencies: def.focusCurrencies,
      nextCatalyst: catalyst ? `${catalyst.currency ?? ''} ${catalyst.event} · ${new Date(catalyst.date).toISOString()}` : undefined,
      eventCount: relevant.length,
      signals,
    };
  });

  const currencyStates = economyStates
    .map((state) => ({
      currency: state.currency,
      economy: state.label,
      centralBank: state.centralBank,
      regime: state.regime,
      policyStance: state.policyStance,
      policyScore: centralBankReactionScore(state),
      score: state.currencyScore,
      confidence: state.confidence,
      observationCount: state.observationCount,
    }))
    .sort((a, b) => b.score - a.score)
    .map((state, index) => ({ ...state, rank: index + 1 }));

  const rankedOpportunities = [...signalCache.values()]
    .sort((a, b) => {
      if (a.direction !== 'WAIT' && b.direction === 'WAIT') return -1;
      if (a.direction === 'WAIT' && b.direction !== 'WAIT') return 1;
      return b.conviction - a.conviction;
    })
    .slice(0, 12);

  const strongest = currencyStates[0];
  const weakest = currencyStates.at(-1);
  const actionable = rankedOpportunities.filter((item) => item.direction !== 'WAIT' && item.executionGate !== 'WAIT_EVENT');
  const topOpportunity = actionable[0] ?? rankedOpportunities[0];

  return {
    generatedAt: now.toISOString(),
    methodology: 'FXGA session intelligence now uses true base-versus-quote macro divergence. USD, EUR, GBP, JPY and ZAR structural scores are calculated independently from their own inflation, growth, labour, policy/rates and financial data. Pair bias combines 58% structural currency divergence, 22% central-bank reaction divergence and 20% exponentially decayed release surprise. Event lockouts can force WAIT without erasing the underlying macro edge.',
    caution: 'This is a macro decision layer, not an automatic entry system. BUY or SELL means the report-based macro side has an edge; execution remains gated until technical structure, liquidity, invalidation and risk controls confirm the trade.',
    macroRegime: analysis.regime?.name ?? 'Unknown',
    macroConfidence,
    currencyStates,
    rankedOpportunities,
    decisionSummary: {
      actionableCount: actionable.length,
      waitCount: rankedOpportunities.length - actionable.length,
      strongestCurrency: strongest?.currency ?? null,
      weakestCurrency: weakest?.currency ?? null,
      topOpportunity: topOpportunity ? { symbol: topOpportunity.symbol, direction: topOpportunity.direction, score: topOpportunity.score, confidence: topOpportunity.confidence, conviction: topOpportunity.conviction, executionGate: topOpportunity.executionGate } : null,
    },
    sessions,
  };
}
