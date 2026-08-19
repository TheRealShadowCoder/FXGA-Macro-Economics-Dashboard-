export const MT5_PRICE_CACHE_BASE=(import.meta.env.VITE_MT5_PRICE_CACHE_BASE as string|undefined)?.replace(/\/$/,'')||'https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app';
export const MT5_FX_PAIRS=['EURUSD','GBPUSD','USDJPY','USDZAR'] as const;
export type MT5Pair=typeof MT5_FX_PAIRS[number];
export type MT5Bar=[number,number,number,number,number,number,number,number];
export type MT5SeriesStatus={symbol:string;timeframe:string;bars:number;chunks:number;oldestMs:number|null;newestMs:number|null;lastIngestAt:string|null;brokerSymbol:string|null};
export type MT5CacheStatus={schema:string;cacheEnvelopeBytes:number;payloadHardBytes:number;evictTargetBytes:number;totalCompressedBytes:number;totalRawBytes:number;totalBars:number;totalChunks:number;evictedChunks?:number;evictedBars?:number;evictedBytes?:number;lastEvictionAt?:string|null;lastIngestAt?:string|null;updatedAt?:string|null;utilizationPercent?:number;payloadUtilizationPercent?:number;freeEnvelopeBytes?:number;allowedSymbols:string[];baseTimeframe:string;derivedTimeframes?:string[];series:Record<string,MT5SeriesStatus>;policy?:Record<string,unknown>};
export type MT5PricePayload={schema:string;source:string;symbol:string;brokerSymbol:string;timeframe:string;baseTimeframe:string;derived:boolean;count:number;bars:MT5Bar[];oldestMs:number|null;newestMs:number|null;generatedAt:string;cache:{totalCompressedBytes:number;cacheEnvelopeBytes:number;utilizationPercent:number}};

async function getJson<T>(path:string):Promise<T>{
  const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),10_000);
  try{const response=await fetch(`${MT5_PRICE_CACHE_BASE}${path}`,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});const text=await response.text();if(!response.ok)throw new Error(text||`MT5 cache HTTP ${response.status}`);return JSON.parse(text) as T;}finally{window.clearTimeout(timer);}
}
export function fetchMT5CacheStatus(){return getJson<MT5CacheStatus>('/api/mt5/price-cache/status');}
export function fetchMT5Prices(symbol:string,timeframe='M1',limit=1000){const params=new URLSearchParams({symbol:symbol.toUpperCase(),timeframe:timeframe.toUpperCase(),limit:String(limit)});return getJson<MT5PricePayload>(`/api/mt5/prices?${params.toString()}`);}
