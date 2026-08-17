const MINUTE = 60_000;

export const TECHNICAL_TIMEFRAMES = Object.freeze({
  M5: 5 * MINUTE,
  M15: 15 * MINUTE,
  H1: 60 * MINUTE,
  H4: 240 * MINUTE,
  D1: 1440 * MINUTE,
});

export const TECHNICAL_ASSET_IDS = Object.freeze([
  'DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDZAR', 'EURZAR', 'GBPZAR', 'EURGBP', 'XAUUSD',
]);

const BAR_CAPS = Object.freeze({ M5: 720, M15: 640, H1: 480, H4: 300, D1: 220 });
const MIN_BARS = Object.freeze({ M5: 48, M15: 40, H1: 30, H4: 24, D1: 20 });
const PIVOT_LENGTH = 2;
const ATR_LENGTH = 14;
const DISPLACEMENT_ATR = 1.15;
const DISPLACEMENT_BODY = 0.60;
const MAX_OVERLAP = 0.35;
const HISTORY_BARS = 42;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function startOfBucket(timestamp, interval) {
  return Math.floor(timestamp / interval) * interval;
}

function normalizeQuote(input, id, label = id) {
  if (!input || !isFiniteNumber(input.price)) return null;
  return {
    id,
    label: input.label || label,
    symbol: input.symbol || id,
    price: input.price,
    open: isFiniteNumber(input.open) ? input.open : null,
    high: isFiniteNumber(input.high) ? input.high : null,
    low: isFiniteNumber(input.low) ? input.low : null,
    previousClose: isFiniteNumber(input.previousClose) ? input.previousClose : null,
    assetClass: input.assetClass || 'fx',
    source: input.source || 'market-feed',
    synthetic: false,
  };
}

function syntheticQuote(id, label, price, legs) {
  if (!isFiniteNumber(price)) return null;
  return { id, label, symbol:id, price, open:null, high:null, low:null, previousClose:null, assetClass:'fx-cross', source:'derived-cross', synthetic:true, legs };
}

export function deriveTechnicalQuotes(marketSnapshot = {}) {
  const source = new Map((Array.isArray(marketSnapshot.assets) ? marketSnapshot.assets : []).map((asset) => [asset.id, asset]));
  const quotes = new Map();
  for (const id of ['DXY','EURUSD','GBPUSD','USDJPY','USDZAR']) {
    const quote = normalizeQuote(source.get(id), id);
    if (quote) quotes.set(id, quote);
  }
  const gold = normalizeQuote(source.get('GOLD'), 'XAUUSD', 'Gold / U.S. Dollar');
  if (gold) quotes.set('XAUUSD', { ...gold, id:'XAUUSD', label:'Gold / U.S. Dollar', symbol:'XAUUSD' });

  const eurusd = quotes.get('EURUSD')?.price;
  const gbpusd = quotes.get('GBPUSD')?.price;
  const usdzar = quotes.get('USDZAR')?.price;
  if (isFiniteNumber(eurusd) && isFiniteNumber(usdzar)) quotes.set('EURZAR', syntheticQuote('EURZAR','EUR / South African Rand',eurusd * usdzar,['EURUSD','USDZAR']));
  if (isFiniteNumber(gbpusd) && isFiniteNumber(usdzar)) quotes.set('GBPZAR', syntheticQuote('GBPZAR','GBP / South African Rand',gbpusd * usdzar,['GBPUSD','USDZAR']));
  if (isFiniteNumber(eurusd) && isFiniteNumber(gbpusd) && Math.abs(gbpusd) > 1e-12) quotes.set('EURGBP', syntheticQuote('EURGBP','EUR / GBP',eurusd / gbpusd,['EURUSD','GBPUSD']));
  return quotes;
}

function appendSampledBar(bars, quote, timestamp, timeframe) {
  const interval = TECHNICAL_TIMEFRAMES[timeframe];
  const bucket = startOfBucket(timestamp, interval);
  const price = quote.price;
  const next = Array.isArray(bars) ? bars.map((bar) => ({ ...bar })) : [];
  const current = next.at(-1);
  if (current && Date.parse(current.start) === bucket) {
    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
    current.samples = Number(current.samples || 0) + 1;
    current.lastSampleAt = new Date(timestamp).toISOString();
    current.synthetic = Boolean(quote.synthetic);
  } else {
    next.push({
      start:new Date(bucket).toISOString(),
      end:new Date(bucket + interval).toISOString(),
      open:price, high:price, low:price, close:price,
      samples:1,
      firstSampleAt:new Date(timestamp).toISOString(),
      lastSampleAt:new Date(timestamp).toISOString(),
      source:'sampled-close',
      synthetic:Boolean(quote.synthetic),
    });
  }
  return next.slice(-BAR_CAPS[timeframe]);
}

function overlayDailyProviderBar(bars, quote, timestamp) {
  if (quote.synthetic || !isFiniteNumber(quote.open) || !isFiniteNumber(quote.high) || !isFiniteNumber(quote.low)) return bars;
  const next = bars.map((bar) => ({ ...bar }));
  const bucket = startOfBucket(timestamp, TECHNICAL_TIMEFRAMES.D1);
  const current = next.findLast((bar) => Date.parse(bar.start) === bucket);
  if (!current) return next;
  current.open = quote.open;
  current.high = quote.high;
  current.low = quote.low;
  current.close = quote.price;
  current.providerOhlc = true;
  current.source = 'provider-session-ohlc';
  return next;
}

export function updateTechnicalBars(existingById = {}, marketSnapshot = {}) {
  const generatedAt = marketSnapshot.generatedAt || new Date().toISOString();
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) throw new Error('Technical engine received an invalid market timestamp');
  const quotes = deriveTechnicalQuotes(marketSnapshot);
  const states = {};

  for (const id of TECHNICAL_ASSET_IDS) {
    const quote = quotes.get(id);
    const previous = existingById[id] && typeof existingById[id] === 'object' ? existingById[id] : {};
    const bars = { ...(previous.bars || {}) };
    if (quote) {
      for (const timeframe of Object.keys(TECHNICAL_TIMEFRAMES)) {
        bars[timeframe] = appendSampledBar(bars[timeframe], quote, timestamp, timeframe);
      }
      bars.D1 = overlayDailyProviderBar(bars.D1, quote, timestamp);
    }
    states[id] = {
      id,
      label:quote?.label || previous.label || id,
      symbol:quote?.symbol || previous.symbol || id,
      synthetic:Boolean(quote?.synthetic ?? previous.synthetic),
      legs:quote?.legs || previous.legs || null,
      updatedAt:generatedAt,
      lastPrice:quote?.price ?? previous.lastPrice ?? null,
      bars,
    };
  }
  return states;
}

function trueRange(bar, previousClose) {
  if (!bar || !isFiniteNumber(bar.high) || !isFiniteNumber(bar.low)) return null;
  if (!isFiniteNumber(previousClose)) return bar.high - bar.low;
  return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

function atrSeries(bars, length = ATR_LENGTH) {
  const output = Array(bars.length).fill(null);
  let value = null;
  const seed = [];
  for (let index = 0; index < bars.length; index += 1) {
    const tr = trueRange(bars[index], index ? bars[index - 1].close : null);
    if (!isFiniteNumber(tr)) continue;
    if (value == null) {
      seed.push(tr);
      if (seed.length === length) {
        value = seed.reduce((sum, item) => sum + item, 0) / length;
        output[index] = value;
      }
      continue;
    }
    value = ((value * (length - 1)) + tr) / length;
    output[index] = value;
  }
  return output;
}

function pivotMaps(bars, length = PIVOT_LENGTH) {
  const highs = new Map();
  const lows = new Map();
  for (let index = length; index < bars.length - length; index += 1) {
    const high = bars[index].high;
    const low = bars[index].low;
    if (!isFiniteNumber(high) || !isFiniteNumber(low)) continue;
    let highPivot = true;
    let lowPivot = true;
    for (let offset = 1; offset <= length; offset += 1) {
      if (!(high > bars[index - offset].high && high >= bars[index + offset].high)) highPivot = false;
      if (!(low < bars[index - offset].low && low <= bars[index + offset].low)) lowPivot = false;
    }
    if (highPivot) highs.set(index, { index, price:high, confirmedAt:index + length, time:bars[index].start });
    if (lowPivot) lows.set(index, { index, price:low, confirmedAt:index + length, time:bars[index].start });
  }
  return { highs, lows };
}

function candleMetrics(bars, atr, index) {
  const bar = bars[index];
  const previous = bars[index - 1];
  if (!bar || !previous) return { bullish:false, bearish:false, range:null, bodyPercent:null, overlapRatio:null };
  const range = Math.max(bar.high - bar.low, Number.EPSILON);
  const bodyPercent = Math.abs(bar.close - bar.open) / range;
  const previousRange = Math.max(previous.high - previous.low, Number.EPSILON);
  const overlapHeight = Math.max(0, Math.min(bar.high, previous.high) - Math.max(bar.low, previous.low));
  const overlapRatio = overlapHeight / Math.max(range, previousRange);
  const atrValue = atr[index];
  const eligible = isFiniteNumber(atrValue) && range >= atrValue * DISPLACEMENT_ATR && bodyPercent >= DISPLACEMENT_BODY && overlapRatio <= MAX_OVERLAP;
  return {
    bullish:eligible && bar.close > bar.open,
    bearish:eligible && bar.close < bar.open,
    range, bodyPercent, overlapRatio, atr:atrValue,
  };
}

function findOpposingOrderBlock(bars, breakIndex, direction) {
  for (let index = breakIndex - 1; index >= Math.max(0, breakIndex - 16); index -= 1) {
    const bar = bars[index];
    const opposing = direction === 'bullish' ? bar.close < bar.open : bar.close > bar.open;
    if (!opposing) continue;
    return {
      direction,
      formedAt:bar.start,
      sourceIndex:index,
      top:bar.high,
      bottom:bar.low,
      midpoint:(bar.high + bar.low) / 2,
      source:'latest-opposing-candle-before-structure-break',
    };
  }
  return null;
}

function detectEvents(bars) {
  const pivots = pivotMaps(bars);
  const atr = atrSeries(bars);
  const events = [];
  let lastHigh = null;
  let lastLow = null;
  let trend = 0;
  let lastBrokenHighIndex = -1;
  let lastBrokenLowIndex = -1;

  for (let index = 1; index < bars.length; index += 1) {
    for (const pivot of pivots.highs.values()) if (pivot.confirmedAt === index) lastHigh = pivot;
    for (const pivot of pivots.lows.values()) if (pivot.confirmedAt === index) lastLow = pivot;
    const bar = bars[index];
    const previous = bars[index - 1];

    if (lastLow && bar.low < lastLow.price && bar.close > lastLow.price) {
      events.push({ type:'SWEEP', direction:'bullish', index, time:bar.start, level:lastLow.price, pivotTime:lastLow.time });
    }
    if (lastHigh && bar.high > lastHigh.price && bar.close < lastHigh.price) {
      events.push({ type:'SWEEP', direction:'bearish', index, time:bar.start, level:lastHigh.price, pivotTime:lastHigh.time });
    }

    if (lastHigh && lastHigh.index > lastBrokenHighIndex && bar.close > lastHigh.price && previous.close <= lastHigh.price) {
      const type = trend < 0 ? 'CHOCH' : 'BOS';
      events.push({ type, direction:'bullish', index, time:bar.start, level:lastHigh.price, orderBlock:findOpposingOrderBlock(bars,index,'bullish') });
      trend = 1;
      lastBrokenHighIndex = lastHigh.index;
    }
    if (lastLow && lastLow.index > lastBrokenLowIndex && bar.close < lastLow.price && previous.close >= lastLow.price) {
      const type = trend > 0 ? 'CHOCH' : 'BOS';
      events.push({ type, direction:'bearish', index, time:bar.start, level:lastLow.price, orderBlock:findOpposingOrderBlock(bars,index,'bearish') });
      trend = -1;
      lastBrokenLowIndex = lastLow.index;
    }

    const metrics = candleMetrics(bars, atr, index);
    if (metrics.bullish) events.push({ type:'DISPLACEMENT', direction:'bullish', index, time:bar.start, ...metrics });
    if (metrics.bearish) events.push({ type:'DISPLACEMENT', direction:'bearish', index, time:bar.start, ...metrics });

    if (index >= 2 && bar.low > bars[index - 2].high && bar.close > bars[index - 2].high) {
      events.push({ type:'FVG', direction:'bullish', index, time:bar.start, top:bar.low, bottom:bars[index - 2].high, midpoint:(bar.low + bars[index - 2].high) / 2 });
    }
    if (index >= 2 && bar.high < bars[index - 2].low && bar.close < bars[index - 2].low) {
      events.push({ type:'FVG', direction:'bearish', index, time:bar.start, top:bars[index - 2].low, bottom:bar.high, midpoint:(bars[index - 2].low + bar.high) / 2 });
    }
  }

  return { events, pivots, atr, trend };
}

function latest(events, type, direction = null) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === type && (!direction || event.direction === direction)) return event;
  }
  return null;
}

function strictSequence(events, direction) {
  const types = ['SWEEP','CHOCH','DISPLACEMENT','BOS','FVG'];
  const labels = ['Liquidity sweep','CHoCH','Displacement','BOS','FVG'];
  let cursor = -1;
  let stage = 0;
  const matched = [];
  for (const event of events) {
    if (event.direction !== direction || event.index <= cursor) continue;
    if (event.type !== types[stage]) continue;
    matched.push(event);
    cursor = event.index;
    stage += 1;
    if (stage === types.length) break;
  }
  if (stage < types.length) {
    const possibleStarts = events.filter((event) => event.type === 'SWEEP' && event.direction === direction).slice(-8);
    let best = { stage, matched };
    for (const start of possibleStarts) {
      let localStage = 1;
      let localCursor = start.index;
      const localMatched = [start];
      for (const event of events) {
        if (event.index <= localCursor || event.direction !== direction || localStage >= types.length) continue;
        if (event.type === types[localStage]) {
          localMatched.push(event);
          localCursor = event.index;
          localStage += 1;
        }
      }
      if (localStage > best.stage) best = { stage:localStage, matched:localMatched };
    }
    stage = best.stage;
    matched.splice(0, matched.length, ...best.matched);
  }
  return {
    direction,
    stage,
    total:types.length,
    confirmed:stage === types.length,
    next:stage < labels.length ? labels[stage] : 'Confirmed',
    matched:matched.map((event) => ({ type:event.type, time:event.time, level:event.level ?? null })),
  };
}

function timeframeQuality(timeframe, bars) {
  if (!bars.length) return { grade:'unavailable', score:0, averageSamples:0, providerOhlc:false };
  const recent = bars.slice(-Math.min(12, bars.length));
  const averageSamples = recent.reduce((sum, bar) => sum + Number(bar.samples || 0), 0) / recent.length;
  const providerOhlc = recent.some((bar) => bar.providerOhlc);
  if (timeframe === 'D1' && providerOhlc) return { grade:'high', score:92, averageSamples, providerOhlc:true };
  const mediumMinimum = timeframe === 'H4' ? 4 : timeframe === 'H1' ? 3 : timeframe === 'M15' ? 2 : 2;
  const highMinimum = timeframe === 'H4' ? 10 : timeframe === 'H1' ? 5 : timeframe === 'M15' ? 3 : 3;
  if (averageSamples >= highMinimum) return { grade:'high', score:88, averageSamples, providerOhlc:false };
  if (averageSamples >= mediumMinimum) return { grade:'medium', score:68, averageSamples, providerOhlc:false };
  return { grade:'low', score:38, averageSamples, providerOhlc:false };
}

function analyzeTimeframe(timeframe, inputBars = []) {
  const bars = inputBars.filter((bar) => [bar.open,bar.high,bar.low,bar.close].every(isFiniteNumber));
  const quality = timeframeQuality(timeframe, bars);
  const requiredBars = MIN_BARS[timeframe];
  const enoughBars = bars.length >= requiredBars;
  if (!bars.length) {
    return { timeframe, status:'warming', ready:false, bars:0, requiredBars, quality, bias:'neutral', confidence:0, sequence:{bullish:null,bearish:null}, history:[] };
  }
  const { events, pivots, trend } = detectEvents(bars);
  const latestBos = latest(events,'BOS');
  const latestChoch = latest(events,'CHOCH');
  const structureEvent = [latestBos,latestChoch].filter(Boolean).sort((a,b)=>a.index-b.index).at(-1) || null;
  const bias = structureEvent?.direction || (trend > 0 ? 'bullish' : trend < 0 ? 'bearish' : 'neutral');
  const bullishSequence = strictSequence(events,'bullish');
  const bearishSequence = strictSequence(events,'bearish');
  const lastBar = bars.at(-1);
  const highPivots = [...pivots.highs.values()];
  const lowPivots = [...pivots.lows.values()];
  const swingHigh = highPivots.at(-1)?.price ?? Math.max(...bars.slice(-20).map((bar)=>bar.high));
  const swingLow = lowPivots.at(-1)?.price ?? Math.min(...bars.slice(-20).map((bar)=>bar.low));
  const range = swingHigh > swingLow ? swingHigh - swingLow : null;
  const location = range ? clamp(((lastBar.close - swingLow) / range) * 100, 0, 100) : null;
  const currentSequence = bias === 'bullish' ? bullishSequence : bias === 'bearish' ? bearishSequence : null;
  const readiness = enoughBars && quality.grade !== 'low';
  const confidence = Math.round(clamp((quality.score * .55) + (Math.min(1,bars.length/requiredBars)*25) + ((currentSequence?.stage || 0)/5*20),0,100));
  const recentEvents = events.slice(-24).map((event)=>({ type:event.type,direction:event.direction,time:event.time,level:event.level??null,top:event.top??null,bottom:event.bottom??null }));
  return {
    timeframe,
    status:readiness ? 'ready' : 'warming',
    ready:readiness,
    bars:bars.length,
    requiredBars,
    quality,
    bias,
    confidence,
    structure:{ latestBos, latestChoch, latestOrderBlock:latestBos?.orderBlock || latestChoch?.orderBlock || null },
    liquidity:{ swingHigh, swingLow, latestBullishSweep:latest(events,'SWEEP','bullish'), latestBearishSweep:latest(events,'SWEEP','bearish') },
    imbalance:{ latestBullishFvg:latest(events,'FVG','bullish'), latestBearishFvg:latest(events,'FVG','bearish'), latestBullishDisplacement:latest(events,'DISPLACEMENT','bullish'), latestBearishDisplacement:latest(events,'DISPLACEMENT','bearish') },
    dealingRange:{ high:swingHigh, low:swingLow, equilibrium:range ? swingLow + range/2 : null, locationPercent:location, zone:location == null?'unknown':location <= 33.333?'discount':location >= 66.667?'premium':'equilibrium' },
    sequence:{ bullish:bullishSequence, bearish:bearishSequence, active:currentSequence },
    recentEvents,
    history:bars.slice(-HISTORY_BARS),
  };
}

function executionModel(name, timeframes, definition) {
  const direction = timeframes[definition.direction];
  const confirmation = timeframes[definition.confirmation];
  const entry = definition.entry === 'M1' ? null : timeframes[definition.entry];
  const missing = [];
  if (!direction?.ready) missing.push(definition.direction);
  if (!confirmation?.ready) missing.push(definition.confirmation);
  if (!entry?.ready) missing.push(definition.entry);
  if (missing.length) return { name, ...definition, status:'warming', direction:'neutral', confidence:0, missing, reason:`Awaiting sufficient verified bar history on ${missing.join(', ')}.` };
  const biases = [direction.bias,confirmation.bias,entry.bias];
  const directional = biases.filter((bias)=>bias === 'bullish' || bias === 'bearish');
  if (directional.length < 3) return { name, ...definition, status:'awaiting-confirmation', direction:direction.bias, confidence:Math.min(direction.confidence,confirmation.confidence,entry.confidence), missing:[], reason:'One or more structure layers remain balanced.' };
  if (!biases.every((bias)=>bias === biases[0])) return { name, ...definition, status:'conflict', direction:direction.bias, confidence:Math.min(direction.confidence,confirmation.confidence,entry.confidence), missing:[], reason:'Direction, confirmation and entry structure are not aligned.' };
  const sequence = confirmation.sequence?.[biases[0]];
  const entrySequence = entry.sequence?.[biases[0]];
  const confirmed = Boolean(sequence?.confirmed && (entrySequence?.stage || 0) >= 2);
  return {
    name, ...definition,
    status:confirmed ? 'confirmed' : 'awaiting-confirmation',
    direction:biases[0],
    confidence:Math.round((direction.confidence + confirmation.confidence + entry.confidence)/3),
    missing:[],
    reason:confirmed ? 'Multi-timeframe structure and ordered reaction sequence are aligned.' : `Structure is aligned; waiting for ${sequence?.next || 'ordered confirmation'} and lower-timeframe confirmation.`,
  };
}

function decisionGate(timeframes, models) {
  const confirmed = Object.values(models).find((model)=>model.status === 'confirmed');
  if (confirmed) return { status:'confirmed', direction:confirmed.direction, confidence:confirmed.confidence, model:confirmed.name, reason:confirmed.reason };
  const conflicts = Object.values(models).filter((model)=>model.status === 'conflict');
  if (conflicts.length) return { status:'conflict', direction:'neutral', confidence:Math.max(...conflicts.map((model)=>model.confidence)), model:null, reason:'At least one execution hierarchy has conflicting structure.' };
  const h4 = timeframes.H4;
  const h1 = timeframes.H1;
  if (h4?.ready && h1?.ready && h4.bias !== 'neutral' && h4.bias === h1.bias) {
    return { status:'context-aligned', direction:h4.bias, confidence:Math.round((h4.confidence+h1.confidence)/2), model:'H4/H1 context', reason:'Higher-timeframe structure is aligned, but the full execution hierarchy has not completed.' };
  }
  return { status:'warming', direction:'neutral', confidence:0, model:null, reason:'The technical engine is accumulating verified price history. No missing structure is inferred.' };
}

export function buildTechnicalSnapshot(states = {}, generatedAt = new Date().toISOString()) {
  const assets = {};
  for (const id of TECHNICAL_ASSET_IDS) {
    const state = states[id] || { id, bars:{} };
    const timeframes = {};
    for (const timeframe of Object.keys(TECHNICAL_TIMEFRAMES)) timeframes[timeframe] = analyzeTimeframe(timeframe,state.bars?.[timeframe] || []);
    timeframes.M1 = { timeframe:'M1',status:'unavailable',ready:false,bars:0,requiredBars:60,quality:{grade:'unavailable',score:0,averageSamples:0,providerOhlc:false},bias:'neutral',confidence:0,sequence:{bullish:null,bearish:null},history:[],reason:'One-minute OHLC is not claimed without a verified one-minute bar source.' };
    const models = {
      D1_H1_M5:executionModel('D1 → H1 → M5',timeframes,{direction:'D1',confirmation:'H1',entry:'M5'}),
      H4_M15_M1:executionModel('H4 → M15 → M1',timeframes,{direction:'H4',confirmation:'M15',entry:'M1'}),
    };
    assets[id] = {
      id,
      label:state.label || id,
      symbol:state.symbol || id,
      synthetic:Boolean(state.synthetic),
      legs:state.legs || null,
      updatedAt:state.updatedAt || generatedAt,
      lastPrice:state.lastPrice ?? null,
      timeframes,
      models,
      decisionGate:decisionGate(timeframes,models),
    };
  }
  const values = Object.values(assets);
  return {
    generatedAt,
    methodology:'evidence-gated-multi-timeframe-market-structure',
    sequence:['Liquidity Sweep','CHoCH','Displacement','BOS','FVG'],
    hierarchy:['D1 → H1 → M5','H4 → M15 → M1'],
    sourcePolicy:'Only observed or provider-supplied price history is used. Unavailable structure remains unavailable.',
    counts:{
      assets:values.length,
      confirmed:values.filter((asset)=>asset.decisionGate.status==='confirmed').length,
      contextAligned:values.filter((asset)=>asset.decisionGate.status==='context-aligned').length,
      conflict:values.filter((asset)=>asset.decisionGate.status==='conflict').length,
      warming:values.filter((asset)=>asset.decisionGate.status==='warming').length,
    },
    assets,
  };
}
