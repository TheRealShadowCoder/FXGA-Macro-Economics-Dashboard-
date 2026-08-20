import { gunzipSync } from 'node:zlib';
import { Firestore } from '@google-cloud/firestore';

export const MT5_EVENT_ASSETS = Object.freeze([
  'DXY','EURUSD','GBPUSD','USDJPY','USDZAR','US2Y','US10Y','SPX','NASDAQ','DJI','VIX','GOLD','WTI','BRENT','BTCUSD','ETHUSD',
]);

export const MT5_EVENT_HORIZONS = Object.freeze({
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

const DAY_MS = 86_400_000;
const CHUNKS = 'fxga_mt5_price_cache_chunks';
const BASE_TIMEFRAME = 'M1';
const MAX_BASELINE_LAG_MS = 30 * 60_000;
const db = new Firestore({ ignoreUndefinedProperties:true });
const chunks = db.collection(CHUNKS);

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const dayKey = (ms) => new Date(ms).toISOString().slice(0,10).replaceAll('-','');
const chunkId = (symbol, ms) => `${symbol}_${BASE_TIMEFRAME}_${dayKey(ms)}`;
const pct = (change, base) => base ? (change / Math.abs(base)) * 100 : null;

function payloadBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value.toBuffer === 'function') return value.toBuffer();
  if (typeof value.toUint8Array === 'function') return Buffer.from(value.toUint8Array());
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function decodeBars(value) {
  try {
    const buffer = payloadBuffer(value);
    if (!buffer) return [];
    const rows = JSON.parse(gunzipSync(buffer).toString('utf8'));
    return Array.isArray(rows) ? rows.filter((row) => Array.isArray(row) && finite(row[0]) != null) : [];
  } catch {
    return [];
  }
}

function idsForRange(symbol, startMs, endMs) {
  const ids = [];
  let cursor = new Date(startMs);
  cursor.setUTCHours(0,0,0,0);
  const end = new Date(endMs);
  end.setUTCHours(0,0,0,0);
  while (cursor.getTime() <= end.getTime()) {
    ids.push(chunkId(symbol, cursor.getTime()));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return ids;
}

export async function loadMT5Bars(symbol, startMs, endMs) {
  symbol = String(symbol || '').toUpperCase();
  if (!MT5_EVENT_ASSETS.includes(symbol)) return [];
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const ids = idsForRange(symbol, startMs, endMs);
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const refs = ids.slice(offset, offset + 100).map((id) => chunks.doc(id));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      rows.push(...decodeBars(doc.data()?.payload));
    }
  }
  return [...new Map(rows
    .filter((row) => Number(row[0]) >= startMs && Number(row[0]) <= endMs)
    .map((row) => [Number(row[0]), row]))
    .values()].sort((a,b) => Number(a[0]) - Number(b[0]));
}

function baselineBar(rows, releaseMs) {
  let best = null;
  for (const row of rows) {
    const time = Number(row[0]);
    if (time > releaseMs) break;
    best = row;
  }
  if (!best) return null;
  return releaseMs - Number(best[0]) <= MAX_BASELINE_LAG_MS ? best : null;
}

function observationBar(rows, targetMs, toleranceMs) {
  let best = null;
  let distance = Infinity;
  for (const row of rows) {
    const time = Number(row[0]);
    if (time < targetMs - toleranceMs) continue;
    if (time > targetMs + toleranceMs) break;
    const nextDistance = Math.abs(time - targetMs);
    if (nextDistance < distance) {
      best = row;
      distance = nextDistance;
    }
  }
  return best;
}

function pathMetrics(rows, baseline, observation) {
  const basePrice = finite(baseline?.[4]);
  const endPrice = finite(observation?.[4]);
  if (basePrice == null || endPrice == null || Math.abs(basePrice) < Number.EPSILON) return null;
  const startMs = Number(baseline[0]);
  const endMs = Number(observation[0]);
  const path = rows.filter((row) => Number(row[0]) >= startMs && Number(row[0]) <= endMs);
  if (!path.length) return null;

  let high = -Infinity;
  let low = Infinity;
  let peakAt = null;
  let troughAt = null;
  let volume = 0;
  let spreadSum = 0;
  let spreadCount = 0;
  for (const row of path) {
    const rowHigh = finite(row[2]);
    const rowLow = finite(row[3]);
    if (rowHigh != null && rowHigh > high) { high = rowHigh; peakAt = Number(row[0]); }
    if (rowLow != null && rowLow < low) { low = rowLow; troughAt = Number(row[0]); }
    volume += Math.max(0, finite(row[5]) ?? 0);
    const spread = finite(row[6]);
    if (spread != null) { spreadSum += spread; spreadCount += 1; }
  }
  const move = endPrice - basePrice;
  const movePercent = pct(move, basePrice);
  const maxUpsidePct = Number.isFinite(high) ? pct(high - basePrice, basePrice) : null;
  const maxDownsidePct = Number.isFinite(low) ? pct(low - basePrice, basePrice) : null;
  const rangePct = Number.isFinite(high) && Number.isFinite(low) ? pct(high - low, basePrice) : null;
  return {
    baselinePrice:basePrice,
    observationPrice:endPrice,
    rawMove:move,
    rawMovePct:movePercent,
    direction:movePercent == null || Math.abs(movePercent) < 1e-12 ? 'flat' : movePercent > 0 ? 'up' : 'down',
    maxUpsidePct,
    maxDownsidePct,
    maxAbsoluteExcursionPct:Math.max(Math.abs(maxUpsidePct ?? 0), Math.abs(maxDownsidePct ?? 0)),
    rangePct,
    barsObserved:path.length,
    tickVolume:volume,
    averageSpread:spreadCount ? spreadSum / spreadCount : null,
    peakAt:peakAt == null ? null : new Date(peakAt).toISOString(),
    troughAt:troughAt == null ? null : new Date(troughAt).toISOString(),
  };
}

function reactionForHorizon(symbol, rows, releaseMs, offsetSeconds) {
  const baseline = baselineBar(rows, releaseMs);
  if (!baseline) {
    return { assetId:symbol, available:false, quality:'baseline-unavailable' };
  }
  const targetMs = releaseMs + offsetSeconds * 1000;
  const toleranceMs = Math.max(180_000, Math.min(30 * 60_000, offsetSeconds * 1000 * 0.10));
  const observation = observationBar(rows, targetMs, toleranceMs);
  if (!observation) {
    return {
      assetId:symbol,
      available:false,
      quality:'observation-unavailable',
      baselineAt:new Date(Number(baseline[0])).toISOString(),
      baselinePrice:finite(baseline[4]),
    };
  }
  const metrics = pathMetrics(rows, baseline, observation);
  return {
    assetId:symbol,
    available:Boolean(metrics),
    quality:metrics ? 'measured' : 'invalid-price',
    baselineAt:new Date(Number(baseline[0])).toISOString(),
    observationAt:new Date(Number(observation[0])).toISOString(),
    targetAt:new Date(targetMs).toISOString(),
    observationLagSeconds:Math.round((Number(observation[0]) - targetMs) / 1000),
    ...metrics,
  };
}

export async function buildMT5EventPriceStudy(event) {
  const releaseMs = Date.parse(event?.date || event?.releaseAt || '');
  if (!Number.isFinite(releaseMs)) return null;
  const maxHorizonSeconds = Math.max(...Object.keys(MT5_EVENT_HORIZONS).map(Number));
  const windowStart = releaseMs - MAX_BASELINE_LAG_MS;
  const windowEnd = releaseMs + maxHorizonSeconds * 1000 + 30 * 60_000;
  const assetRows = new Map();

  await Promise.all(MT5_EVENT_ASSETS.map(async (symbol) => {
    const rows = await loadMT5Bars(symbol, windowStart, windowEnd);
    assetRows.set(symbol, rows);
  }));

  const horizons = {};
  for (const [offsetText, horizon] of Object.entries(MT5_EVENT_HORIZONS)) {
    const offsetSeconds = Number(offsetText);
    const reactions = MT5_EVENT_ASSETS.map((symbol) => reactionForHorizon(symbol, assetRows.get(symbol) || [], releaseMs, offsetSeconds));
    const usable = reactions.filter((row) => row.available);
    const positive = usable.filter((row) => Number(row.rawMovePct) > 0).length;
    const negative = usable.filter((row) => Number(row.rawMovePct) < 0).length;
    const flat = usable.length - positive - negative;
    const averageAbsoluteMovePct = usable.length
      ? usable.reduce((sum,row) => sum + Math.abs(Number(row.rawMovePct || 0)), 0) / usable.length
      : null;
    horizons[horizon] = {
      horizon,
      offsetSeconds,
      releaseAt:new Date(releaseMs).toISOString(),
      capturedAt:new Date().toISOString(),
      source:'MetaTrader5 canonical M1 Firestore cache',
      quality:usable.length ? 'measured' : 'market-data-unavailable',
      usableAssets:usable.length,
      totalAssets:MT5_EVENT_ASSETS.length,
      positive,
      negative,
      flat,
      crossAssetBreadth:usable.length ? (positive - negative) / usable.length : null,
      averageAbsoluteMovePct,
      reactions,
    };
  }

  return {
    source:'MetaTrader5 canonical M1 Firestore cache',
    sourceTimeframe:'M1',
    assets:[...MT5_EVENT_ASSETS],
    horizons,
  };
}
