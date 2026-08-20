import { deriveTechnicalQuotes } from './technical-engine.js';

export const EVENT_STUDY_HORIZONS = Object.freeze({
  60: '1m',
  300: '5m',
  900: '15m',
  1800: '30m',
  3600: '1h',
  7200: '2h',
  14400: '4h',
  28800: '8h',
  86400: '24h',
});

const CURRENCY_MAPPINGS = Object.freeze({
  USD: [
    ['DXY', 1], ['EURUSD', -1], ['GBPUSD', -1], ['USDJPY', 1], ['USDZAR', 1], ['GOLD', -1], ['XAUUSD', -1],
  ],
  EUR: [
    ['EURUSD', 1], ['EURGBP', 1], ['EURZAR', 1],
  ],
  GBP: [
    ['GBPUSD', 1], ['EURGBP', -1], ['GBPZAR', 1],
  ],
  JPY: [
    ['USDJPY', -1],
  ],
  ZAR: [
    ['USDZAR', -1], ['EURZAR', -1], ['GBPZAR', -1],
  ],
});

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function marketPayload(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.assets)) return { generatedAt:null, assets:[] };
  return { generatedAt:snapshot.generatedAt || snapshot.capturedAt || null, assets:snapshot.assets };
}

function quoteMap(snapshot) {
  return deriveTechnicalQuotes(marketPayload(snapshot));
}

function noiseThreshold(assetId) {
  if (assetId === 'XAUUSD' || assetId === 'GOLD') return 0.015;
  if (assetId === 'DXY') return 0.005;
  if (/ZAR/.test(assetId)) return 0.008;
  return 0.004;
}

function alignmentFor(bias, baseCurrencyMovePct, threshold) {
  if (!isNumber(baseCurrencyMovePct)) return 'unavailable';
  if (Math.abs(baseCurrencyMovePct) <= threshold) return 'muted';
  if (bias === 'bullish') return baseCurrencyMovePct > 0 ? 'aligned' : 'opposed';
  if (bias === 'bearish') return baseCurrencyMovePct < 0 ? 'aligned' : 'opposed';
  return 'neutral-bias';
}

function reactionFor(assetId, polarity, baselineQuote, currentQuote, currencyBias) {
  const baselinePrice = baselineQuote?.price;
  const currentPrice = currentQuote?.price;
  if (!isNumber(baselinePrice) || !isNumber(currentPrice) || Math.abs(baselinePrice) < Number.EPSILON) {
    return {
      assetId,
      polarity,
      available:false,
      baselinePrice:isNumber(baselinePrice) ? baselinePrice : null,
      currentPrice:isNumber(currentPrice) ? currentPrice : null,
      rawMovePct:null,
      baseCurrencyMovePct:null,
      alignment:'unavailable',
    };
  }
  const rawMovePct = ((currentPrice - baselinePrice) / Math.abs(baselinePrice)) * 100;
  const baseCurrencyMovePct = rawMovePct * polarity;
  const threshold = noiseThreshold(assetId);
  const alignment = alignmentFor(currencyBias, baseCurrencyMovePct, threshold);
  return {
    assetId,
    polarity,
    available:true,
    baselinePrice,
    currentPrice,
    rawMovePct,
    baseCurrencyMovePct,
    noiseThresholdPct:threshold,
    alignment,
    aligned:alignment === 'aligned',
    opposed:alignment === 'opposed',
    reactionStrength:Math.round(clamp(Math.abs(baseCurrencyMovePct) / Math.max(threshold, Number.EPSILON) * 25, 0, 100)),
  };
}

export function supportedEventStudyCurrency(currency) {
  return Boolean(CURRENCY_MAPPINGS[String(currency || '').toUpperCase()]);
}

export function buildEventStudyMeasurement(event, baselineSnapshot, currentSnapshot, offsetSeconds) {
  const horizon = EVENT_STUDY_HORIZONS[Number(offsetSeconds)];
  if (!horizon) return null;
  const currency = String(event?.currency || '').toUpperCase();
  const mappings = CURRENCY_MAPPINGS[currency];
  if (!mappings) return null;

  const releaseMs = Date.parse(event?.date || event?.releaseAt || '');
  const baselineAt = baselineSnapshot?.capturedAt || baselineSnapshot?.generatedAt || null;
  const currentAt = currentSnapshot?.generatedAt || currentSnapshot?.capturedAt || null;
  const baselineMs = Date.parse(baselineAt || '');
  const currentMs = Date.parse(currentAt || '');
  const baselineLagSeconds = Number.isFinite(releaseMs) && Number.isFinite(baselineMs) ? Math.round((releaseMs - baselineMs) / 1000) : null;
  const observationLagSeconds = Number.isFinite(releaseMs) && Number.isFinite(currentMs) ? Math.round((currentMs - releaseMs) / 1000) : null;
  const baselineFresh = baselineLagSeconds != null && baselineLagSeconds >= -60 && baselineLagSeconds <= 45 * 60;
  const observationFresh = observationLagSeconds != null && Math.abs(observationLagSeconds - Number(offsetSeconds)) <= Math.max(180, Number(offsetSeconds) * 0.25);

  const baselineQuotes = quoteMap(baselineSnapshot);
  const currentQuotes = quoteMap(currentSnapshot);
  const reactions = mappings.map(([assetId, polarity]) => reactionFor(assetId, polarity, baselineQuotes.get(assetId), currentQuotes.get(assetId), event?.currencyBias));
  const usable = reactions.filter((item) => item.available);
  const aligned = usable.filter((item) => item.alignment === 'aligned').length;
  const opposed = usable.filter((item) => item.alignment === 'opposed').length;
  const muted = usable.filter((item) => item.alignment === 'muted').length;
  const meanBaseCurrencyMovePct = usable.length ? usable.reduce((sum, item) => sum + item.baseCurrencyMovePct, 0) / usable.length : null;
  const directionalAgreement = aligned + opposed > 0 ? aligned / (aligned + opposed) : null;
  const averageAbsoluteMovePct = usable.length ? usable.reduce((sum,item) => sum + Math.abs(Number(item.rawMovePct || 0)),0) / usable.length : null;

  return {
    horizon,
    offsetSeconds:Number(offsetSeconds),
    capturedAt:new Date().toISOString(),
    releaseAt:event?.date || event?.releaseAt || null,
    currency,
    currencyBias:event?.currencyBias || 'neutral',
    biasConfidence:event?.biasConfidence ?? null,
    baselineAt,
    currentAt,
    baselineLagSeconds,
    observationLagSeconds,
    quality:!baselineFresh ? 'baseline-too-old' : !observationFresh ? 'observation-delayed' : usable.length ? 'measured' : 'market-data-unavailable',
    usableAssets:usable.length,
    aligned,
    opposed,
    muted,
    directionalAgreement,
    meanBaseCurrencyMovePct,
    averageAbsoluteMovePct,
    reactions,
  };
}

function measurementAbsoluteMove(measurement) {
  if (isNumber(measurement?.averageAbsoluteMovePct)) return measurement.averageAbsoluteMovePct;
  const usable = Array.isArray(measurement?.reactions)
    ? measurement.reactions.filter((row) => row?.available && isNumber(Number(row.rawMovePct)))
    : [];
  return usable.length ? usable.reduce((sum,row) => sum + Math.abs(Number(row.rawMovePct)),0) / usable.length : null;
}

export function summarizeEventStudies(studies = []) {
  const measurements = [];
  const horizonSet = new Set(Object.values(EVENT_STUDY_HORIZONS));
  for (const study of studies) {
    for (const [horizon, measurement] of Object.entries(study?.horizons || {})) {
      horizonSet.add(horizon);
      if (measurement?.quality !== 'measured') continue;
      measurements.push({ eventId:study.eventId, currency:study.currency, horizon, ...measurement });
    }
  }
  const byHorizon = {};
  for (const horizon of horizonSet) {
    const rows = measurements.filter((item) => item.horizon === horizon);
    const directional = rows.filter((item) => typeof item.directionalAgreement === 'number');
    const absolute = rows.map(measurementAbsoluteMove).filter(isNumber);
    byHorizon[horizon] = {
      observations:rows.length,
      assetObservations:rows.reduce((sum,item) => sum + Number(item.usableAssets || 0),0),
      averageUsableAssets:rows.length ? rows.reduce((sum,item) => sum + Number(item.usableAssets || 0),0) / rows.length : null,
      meanDirectionalAgreement:directional.length ? directional.reduce((sum, item) => sum + item.directionalAgreement, 0) / directional.length : null,
      meanAbsoluteMovePct:absolute.length ? absolute.reduce((sum,value) => sum + value,0) / absolute.length : null,
      aligned:rows.reduce((sum, item) => sum + Number(item.aligned || 0), 0),
      opposed:rows.reduce((sum, item) => sum + Number(item.opposed || 0), 0),
    };
  }
  return {
    studies:studies.length,
    measuredHorizons:measurements.length,
    assetMeasurements:measurements.reduce((sum,item) => sum + Number(item.usableAssets || 0),0),
    byHorizon,
  };
}
