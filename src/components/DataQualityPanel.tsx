import { useEffect, useMemo, useState } from 'react';
import { fetchDataQuality } from '../lib/api';
import type { DataQualityPayload, MacroFailureSeries } from '../lib/data-quality-types';
import './DataQualityPanel.css';

const pct = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
const title = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

function FailureRow({ item }: { item: MacroFailureSeries }) {
  return <div className="dq-failure-row">
    <div><strong>{item.title || item.seriesId}</strong><span>{item.seriesId} · {title(item.economy)} · {title(item.category)}</span></div>
    <span className={`dq-failure-type ${item.retryable ? 'retryable' : 'persistent'}`}>{title(item.type)}</span>
  </div>;
}

export function DataQualityPanel({ refreshKey = '' }: { refreshKey?: string }) {
  const [data, setData] = useState<DataQualityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchDataQuality()
      .then((payload) => { if (!cancelled) { setData(payload); setError(''); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Data-quality diagnostics are unavailable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const failureTypes = useMemo(() => Object.entries(data?.macro.failures.byType ?? {}).sort((a, b) => b[1] - a[1]), [data]);
  const economyFailures = useMemo(() => Object.entries(data?.macro.failures.byEconomy ?? {}).sort((a, b) => b[1] - a[1]), [data]);
  const coverage = data?.macro.coverage;

  if (loading && !data) return <section className="panel dq-loading"><span className="eyebrow">Data Quality</span><h2>Validating coverage and source integrity…</h2></section>;
  if (error && !data) return <div className="alert warn">{error}</div>;
  if (!data) return null;

  return <section className="dq-workspace">
    <div className="section-head dq-title"><div><span className="eyebrow">Data Quality & Coverage</span><h2>Evidence integrity</h2><p>Coverage distinguishes live observations, retained last-known-good values and unresolved series. Failed observations remain visible and are never replaced with synthetic evidence.</p></div><span>{data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : 'Latest state'}</span></div>

    <div className="dq-kpi-grid">
      <article><span>Effective coverage</span><strong>{pct(coverage?.effectiveCoveragePercent)}</strong><small>{coverage?.usableObservations ?? 0} usable of {coverage?.requested ?? 0} requested</small></article>
      <article><span>Live coverage</span><strong>{pct(coverage?.liveCoveragePercent)}</strong><small>{coverage?.liveFetched ?? 0} refreshed in current cycle</small></article>
      <article><span>Last-known-good retained</span><strong>{coverage?.retainedLastKnownGood ?? 0}</strong><small>Preserved rather than replaced with blanks</small></article>
      <article><span>Unresolved series</span><strong>{data.macro.failures.unresolved}</strong><small>{data.macro.failures.retryable} retryable · {data.macro.failures.nonRetryable} persistent</small></article>
      <article><span>Market coverage</span><strong>{data.market.priced}/{data.market.assets}</strong><small>{data.market.stale} retained stale quotes</small></article>
      <article><span>Structure coverage</span><strong>{data.technical.assets}</strong><small>{data.technical.confirmed} confirmed · {data.technical.warming} building</small></article>
    </div>

    <div className="dq-two-col">
      <article className="panel dq-breakdown"><div className="panel-title"><div><span className="eyebrow">Failure Classification</span><h2>Current macro exceptions</h2></div><span>{data.macro.failures.total}</span></div>
        {failureTypes.length ? <div className="dq-pill-grid">{failureTypes.map(([type, count]) => <div key={type}><strong>{count}</strong><span>{title(type)}</span></div>)}</div> : <div className="dq-empty">No macro-source exceptions in the current snapshot.</div>}
      </article>
      <article className="panel dq-breakdown"><div className="panel-title"><div><span className="eyebrow">Economy Impact</span><h2>Coverage exceptions by economy</h2></div></div>
        {economyFailures.length ? <div className="dq-pill-grid">{economyFailures.map(([economy, count]) => <div key={economy}><strong>{count}</strong><span>{title(economy)}</span></div>)}</div> : <div className="dq-empty">No economy-level coverage exceptions.</div>}
      </article>
    </div>

    {data.macro.failures.series.length ? <article className="panel dq-series"><div className="panel-title"><div><span className="eyebrow">Series Diagnostics</span><h2>Unresolved or degraded observations</h2></div><span>{data.macro.failures.series.length} shown</span></div><div className="dq-series-list">{data.macro.failures.series.map((item) => <FailureRow key={`${item.seriesId}-${item.type}`} item={item} />)}</div></article> : null}
    <small className="dq-policy">{data.publicPolicy}</small>
  </section>;
}
