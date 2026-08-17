export interface MarketBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface EventMarketImpactInput {
  eventId: string;
  occurrenceId: string;
  symbol: string;
  releaseAt: string;
  deviation?: number;
  orientedReleaseScore?: number;
  preReleaseBars: MarketBar[];
  postReleaseBars: MarketBar[];
  atrLookback?: number;
}

export interface EventMarketImpactResult {
  eventId: string;
  occurrenceId: string;
  symbol: string;
  releaseAt: string;
  sampleStatus: 'complete' | 'insufficient-price-history';
  deviation?: number;
  orientedReleaseScore?: number;
  baselineAtr?: number;
  eventTrueRange?: number;
  volatilityRatio?: number;
  closeToCloseMove?: number;
  directionAlignedWithRelease?: boolean;
  rangePerDeviationUnit?: number;
  methodology: 'fxga-transparent-market-impact';
}

export interface EventMarketImpactRelationship {
  sampleSize: number;
  deviationTrueRangeCorrelation?: number;
  deviationVolatilityRatioCorrelation?: number;
  releaseScoreDirectionHitRate?: number;
  medianVolatilityRatio?: number;
  medianTrueRange?: number;
  regression?: {
    intercept: number;
    slope: number;
    rSquared: number;
  };
  methodology: 'fxga-transparent-market-impact';
}

function finite(value: number) {
  return Number.isFinite(value);
}

function round(value: number | undefined, digits = 6) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function trueRange(bar: MarketBar, previousClose?: number) {
  const candidates = [bar.high - bar.low];
  if (previousClose !== undefined && finite(previousClose)) {
    candidates.push(Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  }
  return Math.max(...candidates.filter(finite));
}

export function averageTrueRange(bars: MarketBar[], lookback = 20) {
  const valid = bars.filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(finite));
  if (valid.length < 2) return undefined;
  const selected = valid.slice(-Math.max(2, lookback));
  const ranges = selected.map((bar, index) => trueRange(bar, index > 0 ? selected[index - 1].close : undefined));
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function aggregateEventTrueRange(preReleaseBars: MarketBar[], postReleaseBars: MarketBar[]) {
  if (!postReleaseBars.length) return undefined;
  const valid = postReleaseBars.filter((bar) => [bar.high, bar.low, bar.close].every(finite));
  if (!valid.length) return undefined;
  const previousClose = preReleaseBars.at(-1)?.close;
  const high = Math.max(...valid.map((bar) => bar.high));
  const low = Math.min(...valid.map((bar) => bar.low));
  const candidates = [high - low];
  if (previousClose !== undefined && finite(previousClose)) {
    candidates.push(Math.abs(high - previousClose), Math.abs(low - previousClose));
  }
  return Math.max(...candidates.filter(finite));
}

export function analyzeEventMarketImpact(input: EventMarketImpactInput): EventMarketImpactResult {
  const lookback = Math.min(Math.max(input.atrLookback ?? 20, 5), 120);
  const baselineAtr = averageTrueRange(input.preReleaseBars, lookback);
  const eventTrueRange = aggregateEventTrueRange(input.preReleaseBars, input.postReleaseBars);
  const previousClose = input.preReleaseBars.at(-1)?.close;
  const finalClose = input.postReleaseBars.at(-1)?.close;
  const closeToCloseMove = previousClose !== undefined && finalClose !== undefined
    ? finalClose - previousClose
    : undefined;
  const volatilityRatio = baselineAtr && eventTrueRange !== undefined && baselineAtr > 0
    ? eventTrueRange / baselineAtr
    : undefined;
  const directionAlignedWithRelease = closeToCloseMove !== undefined && input.orientedReleaseScore !== undefined
    ? Math.sign(closeToCloseMove) === Math.sign(input.orientedReleaseScore) && Math.sign(input.orientedReleaseScore) !== 0
    : undefined;
  const rangePerDeviationUnit = eventTrueRange !== undefined && input.deviation !== undefined && Math.abs(input.deviation) > 1e-9
    ? eventTrueRange / Math.abs(input.deviation)
    : undefined;

  return {
    eventId: input.eventId,
    occurrenceId: input.occurrenceId,
    symbol: input.symbol,
    releaseAt: input.releaseAt,
    sampleStatus: baselineAtr !== undefined && eventTrueRange !== undefined ? 'complete' : 'insufficient-price-history',
    deviation: input.deviation,
    orientedReleaseScore: input.orientedReleaseScore,
    baselineAtr: round(baselineAtr),
    eventTrueRange: round(eventTrueRange),
    volatilityRatio: round(volatilityRatio, 4),
    closeToCloseMove: round(closeToCloseMove),
    directionAlignedWithRelease,
    rangePerDeviationUnit: round(rangePerDeviationUnit),
    methodology: 'fxga-transparent-market-impact',
  };
}

function pearson(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length < 3) return undefined;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const xd = xs[index] - xMean;
    const yd = ys[index] - yMean;
    numerator += xd * yd;
    xVariance += xd ** 2;
    yVariance += yd ** 2;
  }
  const denominator = Math.sqrt(xVariance * yVariance);
  if (!(denominator > 1e-12)) return undefined;
  return numerator / denominator;
}

function linearRegression(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length < 3) return undefined;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    numerator += (xs[index] - xMean) * (ys[index] - yMean);
    denominator += (xs[index] - xMean) ** 2;
  }
  if (!(denominator > 1e-12)) return undefined;
  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  const predicted = xs.map((value) => intercept + slope * value);
  const ssResidual = ys.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  const ssTotal = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const rSquared = ssTotal > 1e-12 ? 1 - ssResidual / ssTotal : 0;
  return { intercept, slope, rSquared };
}

export function buildEventMarketImpactRelationship(results: EventMarketImpactResult[]): EventMarketImpactRelationship {
  const complete = results.filter((result) => result.sampleStatus === 'complete');
  const deviationRange = complete.filter((result) => result.deviation !== undefined && result.eventTrueRange !== undefined);
  const deviationVolatility = complete.filter((result) => result.deviation !== undefined && result.volatilityRatio !== undefined);
  const directional = complete.filter((result) => result.directionAlignedWithRelease !== undefined);

  const deviationXs = deviationRange.map((result) => Math.abs(result.deviation!));
  const trueRanges = deviationRange.map((result) => result.eventTrueRange!);
  const volatilityXs = deviationVolatility.map((result) => Math.abs(result.deviation!));
  const volatilityYs = deviationVolatility.map((result) => result.volatilityRatio!);
  const regression = linearRegression(deviationXs, trueRanges);

  return {
    sampleSize: complete.length,
    deviationTrueRangeCorrelation: round(pearson(deviationXs, trueRanges), 4),
    deviationVolatilityRatioCorrelation: round(pearson(volatilityXs, volatilityYs), 4),
    releaseScoreDirectionHitRate: directional.length
      ? round((directional.filter((result) => result.directionAlignedWithRelease).length / directional.length) * 100, 1)
      : undefined,
    medianVolatilityRatio: round(median(complete.map((result) => result.volatilityRatio).filter((value): value is number => value !== undefined)), 4),
    medianTrueRange: round(median(complete.map((result) => result.eventTrueRange).filter((value): value is number => value !== undefined))),
    regression: regression ? {
      intercept: round(regression.intercept)!,
      slope: round(regression.slope)!,
      rSquared: round(regression.rSquared, 4)!,
    } : undefined,
    methodology: 'fxga-transparent-market-impact',
  };
}

export const FXSTREET_STYLE_MARKET_METHODS = {
  actualDeviation: 'Track actual, consensus and native FXStreet deviation occurrence by occurrence.',
  trueRange: 'Use standard True Range on synchronized market bars around each release.',
  volatilityRatio: 'Event True Range divided by pre-release ATR for the same symbol and bar interval.',
  trueRangeVsDeviation: 'Scatter/correlation/regression of absolute native deviation against realized event True Range.',
  directionHitRate: 'Share of observations where the post-release close-to-close direction agrees with the oriented macro release score.',
} as const;
