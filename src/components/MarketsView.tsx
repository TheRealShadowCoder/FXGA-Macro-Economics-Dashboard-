import { useEffect, useMemo, useState } from 'react';
import type { MarketQuote } from '../lib/types';
import {
  fetchMT5CacheStatus,
  fetchMT5Prices,
  MT5_WEBSITE_ASSETS,
  type MT5CacheStatus,
  type MT5PricePayload,
  type MT5SeriesStatus,
} from '../lib/mt5-price-cache';
import { TechnicalStructureView } from './TechnicalStructureView';
import { CrossAssetHistoryProgress } from './CrossAssetHistoryProgress';
import { MT5ExtractedDataView } from './MT5ExtractedDataView';
import './MarketsView.css';

const MT5_FRESH_PRICE_MS = 10 * 60_000;
const MT5_STATUS_POLL_MS = 30_000;
const MT5_BARS_POLL_MS = 300_000;

type FusedMarketQuote = MarketQuote & {
  priceSource?: 'mt5' | 'external' | 'mt5-fallback';
  mt5Assisted?: boolean;
  mt5Health?: MT5SeriesStatus['health'] | null;
  mt5FreshnessMinutes?: number | null;
};

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const maximumFractionDigits = abs > 0 && abs < 10 ? Math.max(digits, 5) : digits;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits, minimumFractionDigits: 0 }).format(value);
}

function signed(value: number | null | undefined, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${number(value)}${suffix}`;
}

function timestamp(value: string | number | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function seriesFor(status: MT5CacheStatus | null, symbol: string) {
  if (!status) return null;
  return status.series?.[`${symbol.toUpperCase()}_M1`] ?? status.series?.[symbol.toUpperCase()] ?? null;
}

function fuseMarketQuote(asset: MarketQuote, payload: MT5PricePayload | undefined, status: MT5SeriesStatus | null): FusedMarketQuote {
  const bars = payload?.bars ?? [];
  const last = bars.at(-1) ?? null;
  const previous = bars.length > 1 ? bars.at(-2)! : null;
  const mt5Price = status?.latestClose ?? last?.[4] ?? null;
  if (mt5Price == null || !Number.isFinite(mt5Price)) return { ...asset, priceSource: 'external', mt5Assisted: false };

  const now = Date.now();
  const mt5Ms = timestamp(status?.newestMs ?? payload?.newestMs ?? last?.[0]);
  const externalMs = timestamp(asset.fetchedAt);
  const mt5AgeMs = mt5Ms == null ? Number.POSITIVE_INFINITY : Math.max(0, now - mt5Ms);
  const mt5Fresh = mt5AgeMs <= MT5_FRESH_PRICE_MS;
  const marketClosed = status?.health === 'MARKET_CLOSED' || status?.marketOpen === false;
  const externalMissing = asset.price == null || !Number.isFinite(asset.price);
  const externalStale = Boolean(asset.stale);
  const mt5Newer = mt5Ms != null && (externalMs == null || mt5Ms >= externalMs);

  // MT5 is a live broker-price authority only when it is fresh enough to be useful,
  // or when the normal cross-asset feed is missing/stale and MT5 is the newer verified observation.
  const useMT5Price =
    externalMissing ||
    (mt5Fresh && (externalMs == null || mt5Ms! >= externalMs - 60_000)) ||
    ((externalStale || marketClosed) && mt5Newer);

  const previousReference = asset.previousClose ?? previous?.[4] ?? last?.[1] ?? null;
  const resolvedPrice = useMT5Price ? mt5Price : asset.price;
  const resolvedChange = resolvedPrice != null && previousReference != null
    ? resolvedPrice - previousReference
    : asset.change ?? null;
  const resolvedChangePercent = resolvedPrice != null && previousReference
    ? (resolvedPrice - previousReference) / previousReference * 100
    : asset.changePercent ?? null;
  const mt5Iso = mt5Ms == null ? null : new Date(mt5Ms).toISOString();
  const mt5Stale = !mt5Fresh && !marketClosed;
  const assisted = !useMT5Price && (asset.open == null || asset.high == null || asset.low == null || asset.previousClose == null);

  return {
    ...asset,
    price: resolvedPrice,
    previousClose: asset.previousClose ?? previousReference,
    change: useMT5Price ? resolvedChange : asset.change ?? resolvedChange,
    changePercent: useMT5Price ? resolvedChangePercent : asset.changePercent ?? resolvedChangePercent,
    fetchedAt: useMT5Price ? mt5Iso ?? asset.fetchedAt : asset.fetchedAt,
    sourceName: useMT5Price ? 'MetaTrader 5 · FXGA canonical M1 broker feed' : asset.sourceName,
    source: useMT5Price ? 'MetaTrader 5' : asset.source,
    sourceUrl: useMT5Price ? undefined : asset.sourceUrl,
    mode: useMT5Price ? 'mt5-live-price-fusion' : assisted ? 'cross-feed-mt5-supplement' : asset.mode,
    stale: useMT5Price ? mt5Stale : asset.stale,
    staleSince: useMT5Price && mt5Stale ? mt5Iso : asset.staleSince,
    priceSource: useMT5Price ? (mt5Fresh || marketClosed ? 'mt5' : 'mt5-fallback') : 'external',
    mt5Assisted: useMT5Price || assisted,
    mt5Health: status?.health ?? null,
    mt5FreshnessMinutes: Number.isFinite(mt5AgeMs) ? mt5AgeMs / 60_000 : null,
  };
}

export function MarketsView({ assets }: { assets: MarketQuote[] }) {
  const [mt5, setMT5] = useState<Record<string, MT5PricePayload>>({});
  const [mt5Status, setMT5Status] = useState<MT5CacheStatus | null>(null);
  const [tab, setTab] = useState<'board' | 'mt5'>('board');

  useEffect(() => {
    let stopped = false;
    const loadBars = async () => {
      const results = await Promise.allSettled(MT5_WEBSITE_ASSETS.map((asset) => fetchMT5Prices(asset, 'M1', 3)));
      if (stopped) return;
      const next: Record<string, MT5PricePayload> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.bars.length) next[MT5_WEBSITE_ASSETS[index]] = result.value;
      });
      setMT5(next);
    };
    void loadBars();
    const timer = window.setInterval(() => void loadBars(), MT5_BARS_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const loadStatus = async () => {
      try {
        const next = await fetchMT5CacheStatus();
        if (!stopped) setMT5Status(next);
      } catch {
        // Keep the last verified MT5 status. Normal market feeds remain the fallback.
      }
    };
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), MT5_STATUS_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  const displayAssets = useMemo(
    () => assets.map((asset) => fuseMarketQuote(asset, mt5[asset.id], seriesFor(mt5Status, asset.id))),
    [assets, mt5, mt5Status],
  );

  if (!displayAssets.length) return <div className="empty">Cross-asset prices are awaiting the next verified market update.</div>;

  const mt5PrimaryCount = displayAssets.filter((item) => item.priceSource === 'mt5' || item.priceSource === 'mt5-fallback').length;
  const mt5AssistedCount = displayAssets.filter((item) => item.mt5Assisted).length;

  return <>
    <section className="cross-asset-tabs" role="tablist" aria-label="Cross asset workspace tabs">
      <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}><strong>Cross Asset Board</strong><span>Prices + technical structure</span></button>
      <button className={tab === 'mt5' ? 'active' : ''} onClick={() => setTab('mt5')}><strong>MT5 Data + SMC Fusion</strong><span>20K M1 cache · raw data · reconstruction</span></button>
    </section>
    {tab === 'mt5' ? <MT5ExtractedDataView /> : <>
      <section className="market-summary panel">
        <div>
          <span className="eyebrow">Cross Asset Market Feed</span>
          <h2>FX, yields, commodities, equity indices and digital assets</h2>
          <p>FXGA now resolves every displayed price against the MT5 broker cache and the normal cross-asset feeds. Fresh MT5 prices are preferred when they are newer or when the normal feed is missing or stale; a stale MT5 observation can no longer overwrite a fresher external quote. Source and freshness remain visible on every card.</p>
        </div>
        <div className="market-summary-stats">
          <strong>{displayAssets.filter((item) => item.price != null).length}</strong><span>priced</span>
          <strong>{mt5PrimaryCount}</strong><span>MT5 price authority</span>
          <strong>{mt5AssistedCount}</strong><span>MT5 covered</span>
        </div>
      </section>
      <CrossAssetHistoryProgress />
      <section className="market-grid">
        {displayAssets.map((asset) => {
          const moveClass = (asset.changePercent ?? asset.change ?? 0) > 0 ? 'positive' : (asset.changePercent ?? asset.change ?? 0) < 0 ? 'negative' : 'flat';
          const priceSuffix = asset.quoteKind === 'yield' ? '%' : '';
          const isMT5 = asset.priceSource === 'mt5' || asset.priceSource === 'mt5-fallback';
          const isClosed = asset.mt5Health === 'MARKET_CLOSED';
          const sourceState = isMT5
            ? isClosed ? 'MT5 closed' : asset.stale ? 'MT5 cached' : 'MT5 live'
            : asset.mt5Assisted ? 'Live · MT5 covered' : asset.stale ? 'Last verified' : 'Live';
          const sourceDetail = isMT5
            ? `MetaTrader 5 · canonical M1 broker price${asset.mt5FreshnessMinutes != null ? ` · ${Math.round(asset.mt5FreshnessMinutes)}m age` : ''}`
            : asset.mt5Assisted ? `${asset.sourceName || 'Market feed'} · MT5 available as fallback` : asset.sourceName || 'Market feed';
          return <article className={`market-card ${asset.stale ? 'stale' : ''} ${isMT5 ? 'mt5-market-card' : ''}`} key={asset.id}>
            <div className="market-card-head"><div><span className="eyebrow">{asset.assetClass || 'Market'} · {asset.symbol}</span><h3>{asset.label}</h3></div><span className={`market-state ${asset.stale ? 'stale' : 'live'} ${isMT5 ? 'mt5' : ''}`}>{sourceState}</span></div>
            <div className="market-price-row"><strong>{number(asset.price)}{priceSuffix}</strong><div className={`market-change ${moveClass}`}><span>{signed(asset.change, priceSuffix)}</span><span>{signed(asset.changePercent, '%')}</span></div></div>
            <div className="market-stats"><span><small>Open</small>{number(asset.open)}{asset.quoteKind === 'yield' && asset.open != null ? '%' : ''}</span><span><small>High</small>{number(asset.high)}{asset.quoteKind === 'yield' && asset.high != null ? '%' : ''}</span><span><small>Low</small>{number(asset.low)}{asset.quoteKind === 'yield' && asset.low != null ? '%' : ''}</span><span><small>Previous</small>{number(asset.previousClose)}{asset.quoteKind === 'yield' && asset.previousClose != null ? '%' : ''}</span></div>
            <div className="market-foot"><span>{asset.fetchedAt ? `Updated ${new Date(asset.fetchedAt).toLocaleString()}` : 'Awaiting timestamp'}</span><span>{sourceDetail}</span></div>
            {asset.stale && asset.staleSince ? <small className="market-warning">Current refresh is unavailable; showing the last verified observation from {new Date(asset.staleSince).toLocaleString()}.</small> : null}
          </article>;
        })}
      </section>
      <TechnicalStructureView assets={displayAssets} />
    </>}
  </>;
}
