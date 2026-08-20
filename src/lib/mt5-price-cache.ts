import type { TechnicalAssetState, TechnicalSnapshotPayload } from './types';

export const MT5_PRICE_CACHE_BASE=(import.meta.env.VITE_MT5_PRICE_CACHE_BASE as string|undefined)?.replace(/\/$/,'')||'https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app';
export const MT5_WEBSITE_ASSETS=['DXY','EURUSD','GBPUSD','USDJPY','USDZAR','US2Y','US10Y','SPX','NASDAQ','DJI','VIX','GOLD','WTI','BRENT','BTCUSD','ETHUSD'] as const;
export const MT5_FX_PAIRS=['EURUSD','GBPUSD','USDJPY','USDZAR'] as const;
export const MT5_RETENTION_DAYS=60;

export type MT5Asset=typeof MT5_WEBSITE_ASSETS[number];
export type MT5Pair=typeof MT5_FX_PAIRS[number];
export type MT5Bar=[number,number,number,number,number,number,number,number];
export type MT5BatchIntegrity={
  receivedBars:number;
  acceptedBars:number;
  deduplicatedBars:number;
  rejectedBars:number;
  duplicateTimestamps:number;
  outOfOrderBars:number;
  gapEvents:number;
  missingCandleEstimate:number;
  maxGapMinutes:number;
  wireBytes?:number;
  normalizedBytes?:number;
  normalizedCompressedBytes?:number;
  mode?:string;
  bootstrapTargetBars?:number;
  bootstrapComplete?:boolean;
  at:string;
};
export type MT5SeriesHealth='EXCELLENT'|'GOOD'|'DEGRADED'|'STALE'|'WAITING'|'MARKET_CLOSED';
export type MT5SizeProjection={
  exactStoredRawBytes:number;
  exactStoredCompressedBytes:number;
  rawBytesPerBar:number|null;
  compressedBytesPerBar:number|null;
  wireBytesPerReceivedBar:number|null;
  projectedRawBytesAt20000?:number|null;
  projectedCompressedBytesAt20000?:number|null;
  projectedRawBytesAtRetentionMax?:number|null;
  projectedCompressedBytesAtRetentionMax?:number|null;
  projectedWireBytesFor160Bars:number|null;
};
export type MT5SeriesStatus={
  symbol:string;
  label?:string;
  assetClass?:string;
  timeframe:string;
  bars:number;
  chunks:number;
  oldestMs:number|null;
  newestMs:number|null;
  lastIngestAt:string|null;
  brokerSymbol:string|null;
  compressedBytes?:number;
  rawBytes?:number;
  wireBytesReceived?:number;
  normalizedBytesReceived?:number;
  normalizedCompressedBytesReceived?:number;
  ingestBatches?:number;
  receivedBars?:number;
  acceptedBars?:number;
  deduplicatedBars?:number;
  rejectedBars?:number;
  duplicateTimestamps?:number;
  outOfOrderBars?:number;
  gapEvents?:number;
  missingCandleEstimate?:number;
  maxGapMinutes?:number;
  evictedChunks?:number;
  evictedBars?:number;
  evictedBytes?:number;
  brokerSymbolChanges?:number;
  lastBrokerSymbolChangeAt?:string|null;
  lastBatch?:MT5BatchIntegrity|null;
  latestClose?:number|null;
  latestTickVolume?:number|null;
  latestSpread?:number|null;
  freshnessMs?:number|null;
  freshnessMinutes?:number|null;
  marketOpen?:boolean;
  storagePercentOfCache?:number;
  compressionRatio?:number|null;
  retainedDays?:number;
  retentionDays?:number;
  retentionProgressPercent?:number;
  integrityScore?:number;
  health?:MT5SeriesHealth;
  alerts?:string[];
  size?:MT5SizeProjection;
  bootstrapProgressPercent?:number;
  bootstrapTargetBars?:number;
};
export type MT5DatabaseHealth={
  state:MT5SeriesHealth;
  assetsOnline?:number;
  assetsHealthy?:number;
  assetsExpected?:number;
  pairsOnline:number;
  pairsHealthy:number;
  pairsExpected:number;
  integrityIssues:number;
};
export type MT5CacheManagement={
  governorState:'ARMED'|'WATCH'|'EVICTION_ZONE'|'BLOCKING';
  evictionArmed:boolean;
  timeFifoActive?:boolean;
  retentionDays?:number;
  compressionActive:boolean;
  deduplicationActive:boolean;
  integrityMonitoring:boolean;
  canonicalM1Only?:boolean;
  reconstructionOnDemand?:boolean;
  nextAction:string;
};
export type MT5SizeCalculator={
  measurement:string;
  retentionDays?:number;
  initialBarsPerAsset:number;
  incrementalBarsPerSync:number;
  syncSeconds:number;
  assetsExpected:number;
  assetsMeasured:number;
  totalInitialTargetBars:number;
  exactStoredRawBytes:number;
  exactStoredCompressedBytes:number;
  averageRawBytesPerBar:number|null;
  averageCompressedBytesPerBar:number|null;
  projectedInitialRawBytesAllAssets:number|null;
  projectedInitialCompressedBytesAllAssets:number|null;
  projectedInitialCompressedPercentOf200MB:number|null;
  projectedHeadroomAfterInitial:number|null;
  compressionSavingBytes:number;
  compressionSavingPercent:number;
};
export type MT5CacheStatus={
  schema:string;
  retentionDays?:number;
  retentionCutoff?:string;
  cacheEnvelopeBytes:number;
  payloadHardBytes:number;
  evictTargetBytes:number;
  totalCompressedBytes:number;
  totalRawBytes:number;
  totalBars:number;
  totalChunks:number;
  evictedChunks?:number;
  evictedBars?:number;
  evictedBytes?:number;
  lastEvictionAt?:string|null;
  lastIngestAt?:string|null;
  updatedAt?:string|null;
  utilizationPercent?:number;
  payloadUtilizationPercent?:number;
  freeEnvelopeBytes?:number;
  freeToHardBytes?:number;
  allowedSymbols:string[];
  websiteAssets?:Array<{id:string;label:string;assetClass:string}>;
  baseTimeframe:string;
  derivedTimeframes?:string[];
  initialBarsPerAsset?:number;
  incrementalBarsPerSync?:number;
  syncSeconds?:number;
  series:Record<string,MT5SeriesStatus>;
  policy?:Record<string,unknown>;
  databaseHealth?:MT5DatabaseHealth;
  management?:MT5CacheManagement;
  sizeCalculator?:MT5SizeCalculator;
};
export type MT5PricePayload={
  schema:string;
  source:string;
  symbol:string;
  brokerSymbol:string;
  timeframe:string;
  baseTimeframe:string;
  derived:boolean;
  reconstructionSource?:string;
  retentionDays?:number;
  count:number;
  bars:MT5Bar[];
  oldestMs:number|null;
  newestMs:number|null;
  generatedAt:string;
  cache:{totalCompressedBytes:number;cacheEnvelopeBytes:number;utilizationPercent:number};
};
export type MT5SmcSnapshot=TechnicalSnapshotPayload&{canonicalTimeframe?:string;derivedTimeframes?:string[]};

async function getJson<T>(path:string):Promise<T>{
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),15_000);
  try{
    const response=await fetch(`${MT5_PRICE_CACHE_BASE}${path}`,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
    const text=await response.text();
    if(!response.ok)throw new Error(text||`MT5 cache HTTP ${response.status}`);
    return JSON.parse(text) as T;
  }finally{
    window.clearTimeout(timer);
  }
}

export function fetchMT5CacheStatus(){return getJson<MT5CacheStatus>('/api/mt5/price-cache/status');}
export function fetchMT5Prices(symbol:string,timeframe='M1',limit=1000){
  const params=new URLSearchParams({symbol:symbol.toUpperCase(),timeframe:timeframe.toUpperCase(),limit:String(limit)});
  return getJson<MT5PricePayload>(`/api/mt5/prices?${params.toString()}`);
}
export function fetchMT5PriceRange(symbol:string,from:number|Date,to:number|Date,timeframe='M1',limit=100_000){
  const fromMs=from instanceof Date?from.getTime():Number(from);
  const toMs=to instanceof Date?to.getTime():Number(to);
  const params=new URLSearchParams({
    symbol:symbol.toUpperCase(),
    timeframe:timeframe.toUpperCase(),
    limit:String(limit),
    from:String(fromMs),
    to:String(toMs),
  });
  return getJson<MT5PricePayload>(`/api/mt5/prices?${params.toString()}`);
}
export function fetchMT5SmcSnapshot(){return getJson<MT5SmcSnapshot>('/api/mt5/smc-snapshot');}
export function fetchMT5Smc(symbol:string){
  const params=new URLSearchParams({symbol:symbol.toUpperCase()});
  return getJson<TechnicalAssetState>(`/api/mt5/smc?${params.toString()}`);
}
