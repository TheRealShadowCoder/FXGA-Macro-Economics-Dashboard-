const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function barsAfter(bars, isoTime) {
  const timestamp = Date.parse(isoTime || '');
  return Number.isFinite(timestamp) ? bars.filter((bar) => Date.parse(bar.start) > timestamp) : [];
}

function latestEvent(events, type, direction = null) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type && (!direction || event.direction === direction)) return event;
  }
  return null;
}

function breakerContext(bars, orderBlock) {
  if (!orderBlock || !isNumber(orderBlock.top) || !isNumber(orderBlock.bottom)) return null;
  const later = barsAfter(bars, orderBlock.formedAt);
  if (!later.length) return { status:'active-order-block', direction:orderBlock.direction, top:orderBlock.top, bottom:orderBlock.bottom, invalidatedAt:null, retestedAt:null };
  const invalidated = orderBlock.direction === 'bullish'
    ? later.find((bar) => bar.close < orderBlock.bottom)
    : later.find((bar) => bar.close > orderBlock.top);
  if (!invalidated) return { status:'active-order-block', direction:orderBlock.direction, top:orderBlock.top, bottom:orderBlock.bottom, invalidatedAt:null, retestedAt:null };
  const postInvalidation = later.filter((bar) => Date.parse(bar.start) > Date.parse(invalidated.start));
  const flippedDirection = orderBlock.direction === 'bullish' ? 'bearish' : 'bullish';
  const retest = flippedDirection === 'bearish'
    ? postInvalidation.find((bar) => bar.high >= orderBlock.bottom && bar.low <= orderBlock.top)
    : postInvalidation.find((bar) => bar.low <= orderBlock.top && bar.high >= orderBlock.bottom);
  return {
    status:retest ? 'breaker-retested' : 'breaker-active',
    direction:flippedDirection,
    originalDirection:orderBlock.direction,
    top:orderBlock.top,
    bottom:orderBlock.bottom,
    midpoint:(orderBlock.top + orderBlock.bottom) / 2,
    invalidatedAt:invalidated.start,
    retestedAt:retest?.start ?? null,
    evidence:'order-block-close-through-then-role-reversal',
  };
}

function inverseGapContext(bars, events) {
  const gaps = events.filter((event) => event.type === 'FVG' && isNumber(event.top) && isNumber(event.bottom));
  const inverse = [];
  for (const gap of gaps) {
    const later = barsAfter(bars, gap.time);
    const invalidated = gap.direction === 'bullish'
      ? later.find((bar) => bar.close < gap.bottom)
      : later.find((bar) => bar.close > gap.top);
    if (!invalidated) continue;
    const direction = gap.direction === 'bullish' ? 'bearish' : 'bullish';
    const after = later.filter((bar) => Date.parse(bar.start) > Date.parse(invalidated.start));
    const retest = after.find((bar) => bar.high >= gap.bottom && bar.low <= gap.top);
    inverse.push({
      direction,
      originalDirection:gap.direction,
      top:gap.top,
      bottom:gap.bottom,
      midpoint:(gap.top + gap.bottom) / 2,
      formedAt:gap.time,
      invalidatedAt:invalidated.start,
      retestedAt:retest?.start ?? null,
      status:retest ? 'ifvg-retested' : 'ifvg-active',
    });
  }
  return inverse.at(-1) ?? null;
}

function balancedPriceRange(events) {
  const bullish = events.filter((event) => event.type === 'FVG' && event.direction === 'bullish' && isNumber(event.top) && isNumber(event.bottom)).slice(-8);
  const bearish = events.filter((event) => event.type === 'FVG' && event.direction === 'bearish' && isNumber(event.top) && isNumber(event.bottom)).slice(-8);
  let best = null;
  for (const bull of bullish) {
    for (const bear of bearish) {
      const bottom = Math.max(bull.bottom, bear.bottom);
      const top = Math.min(bull.top, bear.top);
      if (!(top > bottom)) continue;
      const formedAt = Date.parse(bull.time) > Date.parse(bear.time) ? bull.time : bear.time;
      const candidate = { bottom, top, midpoint:(top + bottom) / 2, formedAt, bullishGapTime:bull.time, bearishGapTime:bear.time, width:top-bottom };
      if (!best || Date.parse(candidate.formedAt) > Date.parse(best.formedAt)) best = candidate;
    }
  }
  return best;
}

function oteContext(basic) {
  const high = basic?.dealingRange?.high;
  const low = basic?.dealingRange?.low;
  const bias = basic?.bias;
  if (!isNumber(high) || !isNumber(low) || !(high > low) || !['bullish','bearish'].includes(bias)) return null;
  const range = high - low;
  if (bias === 'bullish') {
    return {
      direction:'bullish',
      rangeHigh:high,
      rangeLow:low,
      zoneTop:high - range * 0.62,
      ideal:high - range * 0.705,
      zoneBottom:high - range * 0.79,
      retracement:[0.62,0.705,0.79],
    };
  }
  return {
    direction:'bearish',
    rangeHigh:high,
    rangeLow:low,
    zoneBottom:low + range * 0.62,
    ideal:low + range * 0.705,
    zoneTop:low + range * 0.79,
    retracement:[0.62,0.705,0.79],
  };
}

function protectedSwing(bars, basic) {
  const structure = [basic?.structure?.latestBos, basic?.structure?.latestChoch]
    .filter(Boolean)
    .sort((a,b) => Date.parse(a.time) - Date.parse(b.time))
    .at(-1);
  if (!structure?.time) return null;
  const breakTime = Date.parse(structure.time);
  const before = bars.filter((bar) => Date.parse(bar.start) < breakTime).slice(-16);
  if (!before.length) return null;
  if (structure.direction === 'bullish') {
    const swing = before.reduce((best, bar) => !best || bar.low < best.low ? bar : best, null);
    return { direction:'bullish', type:'protected-low', price:swing.low, time:swing.start, invalidation:'close-below-protected-low' };
  }
  const swing = before.reduce((best, bar) => !best || bar.high > best.high ? bar : best, null);
  return { direction:'bearish', type:'protected-high', price:swing.high, time:swing.start, invalidation:'close-above-protected-high' };
}

function median(values) {
  const sorted = values.filter(isNumber).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2;
}

function liquidityVoid(bars) {
  if (bars.length < 8) return null;
  const recent = bars.slice(-32);
  const medianRange = median(recent.map((bar) => bar.high - bar.low));
  if (!isNumber(medianRange) || medianRange <= 0) return null;
  let best = null;
  for (let start = 1; start < recent.length - 1; start += 1) {
    const direction = recent[start].close > recent[start].open ? 'bullish' : recent[start].close < recent[start].open ? 'bearish' : null;
    if (!direction) continue;
    let end = start;
    let totalRange = 0;
    for (let index = start; index < recent.length; index += 1) {
      const bar = recent[index];
      const prior = recent[index-1];
      const sameDirection = direction === 'bullish' ? bar.close > bar.open : bar.close < bar.open;
      const range = bar.high - bar.low;
      const overlap = Math.max(0, Math.min(bar.high,prior.high)-Math.max(bar.low,prior.low));
      const overlapRatio = overlap / Math.max(range,prior.high-prior.low,Number.EPSILON);
      if (!sameDirection || range < medianRange * 1.15 || overlapRatio > 0.30) break;
      end = index;
      totalRange += range;
    }
    if (end - start + 1 < 2) continue;
    const candidate = {
      direction,
      start:recent[start].start,
      end:recent[end].start,
      bars:end-start+1,
      top:Math.max(...recent.slice(start,end+1).map((bar) => bar.high)),
      bottom:Math.min(...recent.slice(start,end+1).map((bar) => bar.low)),
      expansionVsMedian:totalRange / (medianRange * (end-start+1)),
    };
    if (!best || candidate.bars > best.bars || Date.parse(candidate.end) > Date.parse(best.end)) best = candidate;
  }
  return best;
}

function sessionName(isoTime) {
  const date = new Date(isoTime);
  if (!Number.isFinite(date.getTime())) return 'unknown';
  const hour = date.getUTCHours();
  if (hour >= 12 && hour < 16) return 'london-new-york-overlap';
  if (hour >= 7 && hour < 12) return 'london';
  if (hour >= 12 && hour < 21) return 'new-york';
  if (hour >= 0 && hour < 7) return 'asia';
  return 'off-session';
}

function sessionContext(bars) {
  if (!bars.length) return { current:'unknown', counts:{} };
  const counts = {};
  for (const bar of bars.slice(-96)) {
    const session = sessionName(bar.start);
    counts[session] = Number(counts[session] || 0) + 1;
  }
  return { current:sessionName(bars.at(-1).start), counts };
}

function consequentEncroachment(event) {
  if (!event || !isNumber(event.top) || !isNumber(event.bottom)) return null;
  return { top:event.top, bottom:event.bottom, midpoint:(event.top+event.bottom)/2, direction:event.direction, formedAt:event.time };
}

export function buildAdvancedTimeframeContext(bars = [], basic = {}) {
  const events = Array.isArray(basic.recentEvents) ? basic.recentEvents : [];
  const latestFvg = basic.bias === 'bearish' ? basic?.imbalance?.latestBearishFvg : basic?.imbalance?.latestBullishFvg;
  return {
    breaker:breakerContext(bars,basic?.structure?.latestOrderBlock),
    inverseFvg:inverseGapContext(bars,events),
    balancedPriceRange:balancedPriceRange(events),
    consequentEncroachment:consequentEncroachment(latestFvg),
    ote:oteContext(basic),
    protectedSwing:protectedSwing(bars,basic),
    liquidityVoid:liquidityVoid(bars),
    session:sessionContext(bars),
  };
}

function alignedBars(first, second, limit = 48) {
  const a = new Map((first || []).slice(-limit).map((bar) => [bar.start,bar]));
  const pairs = [];
  for (const bar of (second || []).slice(-limit)) {
    const match = a.get(bar.start);
    if (match) pairs.push([match,bar]);
  }
  return pairs;
}

function rangeBreak(history, direction, lookback = 12) {
  if (history.length < lookback + 1) return false;
  const current = history.at(-1);
  const prior = history.slice(-(lookback+1),-1);
  if (direction === 'high') return current.high > Math.max(...prior.map((bar) => bar.high));
  return current.low < Math.min(...prior.map((bar) => bar.low));
}

function smtPair(firstId, secondId, firstFrame, secondFrame, relationship = 'positive') {
  const pairs = alignedBars(firstFrame?.history,secondFrame?.history);
  if (pairs.length < 14) return null;
  const first = pairs.map(([a]) => a);
  const second = pairs.map(([,b]) => b);
  const firstHigh = rangeBreak(first,'high');
  const firstLow = rangeBreak(first,'low');
  const secondHigh = rangeBreak(second,'high');
  const secondLow = rangeBreak(second,'low');
  let divergence = null;
  if (relationship === 'positive') {
    if (firstHigh !== secondHigh && (firstHigh || secondHigh)) divergence = 'high-divergence';
    else if (firstLow !== secondLow && (firstLow || secondLow)) divergence = 'low-divergence';
  } else {
    if (firstHigh !== secondLow && (firstHigh || secondLow)) divergence = 'inverse-high-low-divergence';
    else if (firstLow !== secondHigh && (firstLow || secondHigh)) divergence = 'inverse-low-high-divergence';
  }
  if (!divergence) return null;
  return {
    first:firstId,
    second:secondId,
    relationship,
    timeframe:firstFrame.timeframe,
    divergence,
    observedAt:first.at(-1).start,
    samples:pairs.length,
    evidence:{ firstHigh,firstLow,secondHigh,secondLow },
  };
}

export function buildSmtContext(assets = {}) {
  const checks = [];
  const definitions = [
    ['EURUSD','GBPUSD','positive'],
    ['EURUSD','DXY','inverse'],
    ['GBPUSD','DXY','inverse'],
    ['XAUUSD','DXY','inverse'],
    ['EURZAR','GBPZAR','positive'],
  ];
  for (const timeframe of ['H1','M15','H4']) {
    for (const [first,second,relationship] of definitions) {
      const result = smtPair(first,second,assets[first]?.timeframes?.[timeframe],assets[second]?.timeframes?.[timeframe],relationship);
      if (result) checks.push(result);
    }
  }
  return { generatedAt:new Date().toISOString(), divergences:checks.slice(-20), count:checks.length };
}

function zoneContains(parent, child) {
  if (!parent || !child || !isNumber(parent.top) || !isNumber(parent.bottom) || !isNumber(child.top) || !isNumber(child.bottom)) return null;
  const tolerance = Math.max((parent.top-parent.bottom)*0.02,Number.EPSILON);
  return child.bottom >= parent.bottom-tolerance && child.top <= parent.top+tolerance;
}

export function buildNestedContext(timeframes = {}) {
  const zone = (tf) => timeframes?.[tf]?.structure?.latestOrderBlock ?? null;
  const checks = {
    D1_contains_H1:zoneContains(zone('D1'),zone('H1')),
    H1_contains_M5:zoneContains(zone('H1'),zone('M5')),
    H4_contains_M15:zoneContains(zone('H4'),zone('M15')),
    M15_contains_M1:zoneContains(zone('M15'),zone('M1')),
  };
  const known = Object.values(checks).filter((value) => value !== null);
  return {
    checks,
    confirmed:known.length > 0 && known.every(Boolean),
    coverage:known.length,
    required:4,
    status:known.length === 4 ? known.every(Boolean) ? 'confirmed' : 'not-nested' : 'partial',
  };
}
