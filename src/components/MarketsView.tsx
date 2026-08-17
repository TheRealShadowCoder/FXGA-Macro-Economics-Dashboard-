export interface MarketQuoteView {
  id: string;
  symbol: string;
  label: string;
  sourceName?: string;
  assetClass?: string;
  quoteKind?: 'price' | 'yield' | string;
  currency?: string | null;
  exchange?: string | null;
  price: number | null;
  change?: number | null;
  changePercent?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previousClose?: number | null;
  volume?: number | null;
  source?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  mode?: string;
  stale?: boolean;
  staleSince?: string | null;
  error?: string;
}

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

export function MarketsView({ assets }: { assets: MarketQuoteView[] }) {
  if (!assets.length) {
    return <div className="empty">CNBC cross-asset prices have not been ingested yet. The Google Cloud collector will populate this view on the next market sync.</div>;
  }

  return (
    <>
      <section className="market-summary panel">
        <div>
          <span className="eyebrow">CNBC Cross Asset Feed</span>
          <h2>FX, yields, commodities, equity indices and crypto</h2>
          <p>Google Cloud collects public CNBC quote pages, normalizes the latest observations and retains the last valid quote if a refresh is temporarily unavailable.</p>
        </div>
        <div className="market-summary-stats">
          <strong>{assets.filter((item) => item.price != null).length}</strong><span>priced</span>
          <strong>{assets.filter((item) => item.stale).length}</strong><span>stale retained</span>
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
                <span className={`market-state ${asset.stale ? 'stale' : 'live'}`}>{asset.stale ? 'Last good' : 'CNBC live'}</span>
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
                <span><small>Prev</small>{number(asset.previousClose)}{asset.quoteKind === 'yield' && asset.previousClose != null ? '%' : ''}</span>
              </div>

              <div className="market-foot">
                <span>{asset.fetchedAt ? `Updated ${new Date(asset.fetchedAt).toLocaleString()}` : 'Awaiting timestamp'}</span>
                {asset.sourceUrl ? <a href={asset.sourceUrl} target="_blank" rel="noreferrer">CNBC source</a> : <span>CNBC</span>}
              </div>
              {asset.stale && asset.staleSince ? <small className="market-warning">Current fetch failed; showing the last valid quote from {new Date(asset.staleSince).toLocaleString()}.</small> : null}
            </article>
          );
        })}
      </section>
    </>
  );
}
