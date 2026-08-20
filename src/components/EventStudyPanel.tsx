import { useEffect, useMemo, useState } from 'react';
import { fetchEventStudies } from '../lib/api';
import { EVENT_STUDY_HORIZONS, type EconomicEventStudy, type EventStudiesPayload, type EventStudyHorizon, type EventStudyMeasurement, type EventStudyReaction } from '../lib/event-study-types';
import './EventStudyPanel.css';

function ratioPct(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

function move(value: number | null | undefined, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}%` : '—';
}

function price(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 5 : 3 });
}

function qualityLabel(measurement?: EventStudyMeasurement) {
  if (!measurement) return 'Pending';
  if (measurement.quality === 'measured') return 'Measured';
  if (measurement.quality === 'baseline-too-old' || measurement.quality === 'baseline-unavailable') return 'Baseline unavailable';
  if (measurement.quality === 'observation-delayed' || measurement.quality === 'observation-unavailable') return 'Observation unavailable';
  return 'Market data unavailable';
}

function measurementTone(measurement?: EventStudyMeasurement) {
  if (!measurement || measurement.quality !== 'measured') return 'unavailable';
  if (typeof measurement.crossAssetBreadth === 'number') {
    if (measurement.crossAssetBreadth > 0.15) return 'aligned';
    if (measurement.crossAssetBreadth < -0.15) return 'opposed';
    return 'muted';
  }
  if (Number(measurement.opposed || 0) > Number(measurement.aligned || 0)) return 'opposed';
  if (Number(measurement.aligned || 0) > 0) return 'aligned';
  return 'muted';
}

function horizonHeadline(measurement: EventStudyMeasurement) {
  if (measurement.quality !== 'measured') return qualityLabel(measurement);
  if (typeof measurement.averageAbsoluteMovePct === 'number') return `${move(measurement.averageAbsoluteMovePct)} avg |Δ|`;
  if (typeof measurement.directionalAgreement === 'number') return `${ratioPct(measurement.directionalAgreement)} agreement`;
  return `${measurement.usableAssets} assets measured`;
}

function horizonDetail(measurement: EventStudyMeasurement) {
  if (measurement.quality !== 'measured') return `${measurement.usableAssets || 0} usable assets`;
  if (typeof measurement.crossAssetBreadth === 'number') return `${measurement.usableAssets}/${measurement.totalAssets ?? 16} assets · breadth ${ratioPct(measurement.crossAssetBreadth)}`;
  return `${move(measurement.meanBaseCurrencyMovePct)} base-currency move`;
}

function HorizonCell({ horizon, measurement, active, onSelect }: { horizon: EventStudyHorizon; measurement?: EventStudyMeasurement; active: boolean; onSelect: () => void }) {
  if (!measurement) return <button className={`event-horizon pending ${active ? 'active' : ''}`} onClick={onSelect}><b>{horizon}</b><strong>Pending</strong><span>Awaiting price path</span></button>;
  const tone = measurementTone(measurement);
  return <button className={`event-horizon ${tone} ${active ? 'active' : ''}`} title={`${measurement.usableAssets} usable assets`} onClick={onSelect}>
    <b>{horizon}</b>
    <strong>{horizonHeadline(measurement)}</strong>
    <span>{horizonDetail(measurement)}</span>
  </button>;
}

function ReactionCard({ reaction }: { reaction: EventStudyReaction }) {
  const value = reaction.rawMovePct;
  const tone = !reaction.available ? 'unavailable' : Number(value || 0) > 0 ? 'positive' : Number(value || 0) < 0 ? 'negative' : 'flat';
  const observation = reaction.observationPrice ?? reaction.currentPrice;
  return <article className={`event-price-reaction ${tone}`}>
    <header><strong>{reaction.assetId}</strong><span>{reaction.available ? move(value) : 'Unavailable'}</span></header>
    <div><span><small>Before</small>{price(reaction.baselinePrice)}</span><span><small>After</small>{price(observation)}</span></div>
    {reaction.available ? <footer>
      <span>↑ max {move(reaction.maxUpsidePct)}</span>
      <span>↓ max {move(reaction.maxDownsidePct)}</span>
      <span>range {move(reaction.rangePct)}</span>
    </footer> : <footer><span>{reaction.quality || 'No verified M1 observation'}</span></footer>}
  </article>;
}

function preferredHorizon(study: EconomicEventStudy): EventStudyHorizon {
  if (study.horizons?.['1h']) return '1h';
  return EVENT_STUDY_HORIZONS.find((horizon) => study.horizons?.[horizon]) ?? '1h';
}

function StudyRow({ study }: { study: EconomicEventStudy }) {
  const [selected, setSelected] = useState<EventStudyHorizon>(() => preferredHorizon(study));
  const [expanded, setExpanded] = useState(false);
  const measurement = study.horizons?.[selected];
  const measuredAssets = measurement?.reactions?.filter((reaction) => reaction.available).length ?? 0;
  return <article className={`event-study-row ${expanded ? 'expanded' : ''}`}>
    <div className="event-study-release">
      <span className="eyebrow">{study.currency} · {new Date(study.releaseAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <strong>{study.event}</strong>
      <small>Actual {study.actual ?? '—'} · Consensus {study.forecast ?? '—'} · Previous {study.previous ?? '—'}</small>
      <small>{study.priceSource || 'Verified market history'} · {study.sourceTimeframe || 'snapshot'} source</small>
    </div>
    <div className={`event-study-bias ${study.currencyBias}`}><strong>{study.currencyBias}</strong><span>{study.biasConfidence ?? '—'}% release confidence</span><button onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide price path' : 'View price path'}</button></div>
    <div className="event-study-horizons">{EVENT_STUDY_HORIZONS.map((horizon) => <HorizonCell key={horizon} horizon={horizon} measurement={study.horizons?.[horizon]} active={selected === horizon} onSelect={() => { setSelected(horizon); setExpanded(true); }} />)}</div>
    {expanded ? <div className="event-reaction-detail">
      <div className="event-reaction-head"><div><span className="eyebrow">Cross Asset Reaction · {selected}</span><strong>{measuredAssets}/{study.priceUniverse?.length ?? measurement?.totalAssets ?? 16} verified asset paths</strong></div><span>{measurement?.quality === 'measured' ? `Average absolute move ${move(measurement.averageAbsoluteMovePct)}` : qualityLabel(measurement)}</span></div>
      {measurement?.reactions?.length ? <div className="event-price-reaction-grid">{measurement.reactions.map((reaction) => <ReactionCard key={`${study.eventId}-${selected}-${reaction.assetId}`} reaction={reaction} />)}</div> : <div className="event-reaction-empty">No verified price reactions are stored for this horizon yet.</div>}
    </div> : null}
  </article>;
}

export function EventStudyPanel() {
  const [payload, setPayload] = useState<EventStudiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchEventStudies(60)
      .then((result) => { if (!cancelled) { setPayload(result); setError(''); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Release reaction history is unavailable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const studies = useMemo(() => [...(payload?.studies ?? [])].sort((a, b) => Date.parse(b.releaseAt) - Date.parse(a.releaseAt)).slice(0, 120), [payload]);
  const days = payload?.days ?? 60;

  return <section className="event-study-workspace">
    <div className="section-head event-study-title"><div><span className="eyebrow">Event Study & Backtesting</span><h2>Economic releases tied to Cross Asset price paths</h2><p>Every completed release is joined to verified market observations around the release and measured across the program’s Cross Asset universe. The research database tracks 1m, 5m, 15m, 30m, 1h, 2h, 4h, 8h and 24h reactions, including maximum upside/downside excursion and path range where canonical MT5 M1 history is available.</p></div><span>{days}-day study window · {payload?.summary?.assetMeasurements ?? payload?.summary?.measuredHorizons ?? 0} asset measurements</span></div>
    <div className="event-study-summary">{EVENT_STUDY_HORIZONS.map((horizon) => {
      const summary = payload?.summary?.byHorizon?.[horizon];
      return <article key={horizon}><span>{horizon}</span><strong>{summary?.observations ?? 0}</strong><small>{summary?.observations ? `${summary.meanAbsoluteMovePct != null ? `${move(summary.meanAbsoluteMovePct)} mean |Δ|` : `${ratioPct(summary.meanDirectionalAgreement)} mean agreement`} · ${summary.assetObservations ?? 0} asset paths` : 'Building sample'}</small></article>;
    })}</div>
    {loading && !payload ? <div className="loading-panel">Loading economic release price history…</div> : null}
    {error && !payload ? <div className="alert warn">{error}</div> : null}
    {!loading && !studies.length ? <div className="panel event-study-empty"><strong>Market-reaction history is accumulating.</strong><span>Reactions are only marked measured when a real pre-release baseline and matching post-release market observation exist. Missing price evidence is left unavailable rather than synthesized.</span></div> : null}
    {studies.length ? <div className="event-study-list">{studies.map((study) => <StudyRow key={study.eventId} study={study} />)}</div> : null}
  </section>;
}
