import type { MarketQuote } from '../lib/types';
import { TechnicalStructureView } from './TechnicalStructureView';

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

export function MarketsView({ assets }: { assets: MarketQuote[] }) {
  if (!assets.length) {
    return <div className="empty">Cross-asset prices are awaiting the next verified market update.</div>;
  }

  return (
    <>
      <section className="market-summary panel">
        <div>
          <span className="eyebrow">Cross Asset Market Feed</span>
          <h2>FX, yields, commodities, equity indices and digital assets</h2>
          <p>Public market observations are normalized into a consistent cross-asset view. When a source refresh is temporarily unavailable, the last verified observation is retained and clearly marked.</p>
        </div>
        <div className="market-summary-stats">
          <strong>{assets.filter((item) => item.price != null).length}</strong><span>priced</span>
          <strong>{assets.filter((item) => item.stale).length}</strong><span>last verified</span>
        </div>
      </section>

      <section className="market-grid">
        {assets.map((asset) => {
          const moveClass = (asset.changePercent ?? asset.change ?? 0) > 0 ? 'positive' : (asset.changePercent ?? asset.change ?? 0) < 0 ? 'negative' : 'flat';
          const priceSuffix = asset.quoteKind === 'yield' ? '%' : '';
          return (
            <article className={`market-card ${asset.stale ? 'stale' : ''}`} key={asset.id}>
              <div className="market-card-head">
                <div>
                  <span className="eyebrow">{asset.assetClass || 'Market'} · {asset.symbol}</span>
                  <h3>{asset.label}</h3>
                </div>
                <span className={`market-state ${asset.stale ? 'stale' : 'live'}`}>{asset.stale ? 'Last verified' : 'Live'}</span>
              </div>

              <div className="market-price-row">
                <strong>{number(asset.price)}{priceSuffix}</strong>
                <div className={`market-change ${moveClass}`}>
                  <span>{signed(asset.change, priceSuffix)}</span>
                  <span>{signed(asset.changePercent, '%')}</span>
                </div>
              </div>

              <div className="market-stats">
                <span><small>Open</small>{number(asset.open)}{asset.quoteKind === 'yield' && asset.open != null ? '%' : ''}</span>
                <span><small>High</small>{number(asset.high)}{asset.quoteKind === 'yield' && asset.high != null ? '%' : ''}</span>
                <span><small>Low</small>{number(asset.low)}{asset.quoteKind === 'yield' && asset.low != null ? '%' : ''}</span>
                <span><small>Previous</small>{number(asset.previousClose)}{asset.quoteKind === 'yield' && asset.previousClose != null ? '%' : ''}</span>
              </div>

              <div className="market-foot">
                <span>{asset.fetchedAt ? `Updated ${new Date(asset.fetchedAt).toLocaleString()}` : 'Awaiting timestamp'}</span>
                {asset.sourceUrl ? <a href={asset.sourceUrl} target="_blank" rel="noreferrer">Source</a> : <span>Market feed</span>}
              </div>
              {asset.stale && asset.staleSince ? <small className="market-warning">Current refresh is unavailable; showing the last verified observation from {new Date(asset.staleSince).toLocaleString()}.</small> : null}
            </article>
          );
        })}
      </section>

      <TechnicalStructureView assets={assets} />
    </>
  );
}
