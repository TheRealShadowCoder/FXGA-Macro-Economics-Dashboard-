import { useEffect, useMemo, useState } from 'react';
import { fetchEventStudies } from '../lib/api';
import type { EconomicEventStudy, EventStudiesPayload, EventStudyMeasurement } from '../lib/event-study-types';
import './EventStudyPanel.css';

const HORIZONS = ['5m', '15m', '1h', '4h'] as const;

function pct(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

function move(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(3)}%` : '—';
}

function qualityLabel(measurement?: EventStudyMeasurement) {
  if (!measurement) return 'Pending';
  if (measurement.quality === 'measured') return 'Measured';
  if (measurement.quality === 'baseline-too-old') return 'Baseline unavailable';
  if (measurement.quality === 'observation-delayed') return 'Delayed observation';
  return 'Market data unavailable';
}

function HorizonCell({ measurement }: { measurement?: EventStudyMeasurement }) {
  if (!measurement) return <div className="event-horizon pending"><strong>Pending</strong><span>Awaiting horizon</span></div>;
  const status = measurement.quality === 'measured'
    ? measurement.opposed > measurement.aligned ? 'opposed' : measurement.aligned > 0 ? 'aligned' : 'muted'
    : 'unavailable';
  return <div className={`event-horizon ${status}`} title={`${measurement.usableAssets} usable market references`}>
    <strong>{measurement.quality === 'measured' ? pct(measurement.directionalAgreement) : qualityLabel(measurement)}</strong>
    <span>{measurement.quality === 'measured' ? `${move(measurement.meanBaseCurrencyMovePct)} base-currency move` : `${measurement.usableAssets} references`}</span>
  </div>;
}

function StudyRow({ study }: { study: EconomicEventStudy }) {
  return <article className="event-study-row">
    <div className="event-study-release">
      <span className="eyebrow">{study.currency} · {new Date(study.releaseAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <strong>{study.event}</strong>
      <small>Actual {study.actual ?? '—'} · Consensus {study.forecast ?? '—'} · Previous {study.previous ?? '—'}</small>
    </div>
    <div className={`event-study-bias ${study.currencyBias}`}><strong>{study.currencyBias}</strong><span>{study.biasConfidence ?? '—'}% confidence</span></div>
    <div className="event-study-horizons">{HORIZONS.map((horizon) => <HorizonCell key={horizon} measurement={study.horizons?.[horizon]} />)}</div>
  </article>;
}

export function EventStudyPanel() {
  const [payload, setPayload] = useState<EventStudiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchEventStudies(7)
      .then((result) => { if (!cancelled) { setPayload(result); setError(''); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Release reaction history is unavailable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const studies = useMemo(() => [...(payload?.studies ?? [])].sort((a, b) => Date.parse(b.releaseAt) - Date.parse(a.releaseAt)).slice(0, 40), [payload]);

  return <section className="event-study-workspace">
    <div className="section-head event-study-title"><div><span className="eyebrow">Event Study & Backtesting</span><h2>Release reaction evidence</h2><p>Completed economic releases are compared with the verified market path at +5 minutes, +15 minutes, +1 hour and +4 hours. Directional agreement is measured against the base-currency bias recorded at release time.</p></div><span>{payload?.summary?.measuredHorizons ?? 0} measured horizons</span></div>
    <div className="event-study-summary">{HORIZONS.map((horizon) => {
      const summary = payload?.summary?.byHorizon?.[horizon];
      return <article key={horizon}><span>{horizon}</span><strong>{summary?.observations ?? 0}</strong><small>{summary?.observations ? `${pct(summary.meanDirectionalAgreement)} mean agreement` : 'Building sample'}</small></article>;
    })}</div>
    {loading && !payload ? <div className="loading-panel">Loading release reaction history…</div> : null}
    {error && !payload ? <div className="alert warn">{error}</div> : null}
    {!loading && !studies.length ? <div className="panel event-study-empty"><strong>Market-reaction history is accumulating.</strong><span>Existing calendar results remain available immediately. Reaction horizons are only marked measured when a verified pre-release baseline and post-release quote snapshot exist.</span></div> : null}
    {studies.length ? <div className="event-study-list">{studies.map((study) => <StudyRow key={study.eventId} study={study} />)}</div> : null}
  </section>;
}
