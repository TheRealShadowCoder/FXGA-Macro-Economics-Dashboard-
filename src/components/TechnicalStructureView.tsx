import { useEffect, useMemo, useState } from 'react';
import { fetchTechnicalSnapshot } from '../lib/api';
import { AdvancedSmcPanel, SmtDivergencePanel } from './AdvancedSmcPanel';
import type { MarketQuote, TechnicalAssetState, TechnicalBar, TechnicalBias, TechnicalGateStatus, TechnicalSnapshotPayload, TechnicalTimeframeState } from '../lib/types';
import './TechnicalStructureView.css';

type SessionState = 'bullish' | 'bearish' | 'balanced' | 'unavailable';
const TIMEFRAMES = ['D1', 'H4', 'H1', 'M15', 'M5', 'M1'];
const FOCUS_ASSETS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDZAR', 'EURZAR', 'GBPZAR', 'EURGBP', 'XAUUSD'];
const num = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function digits(asset: MarketQuote) {
  if (asset.quoteKind === 'yield') return 3;
  if (/JPY|ZAR|EUR|GBP|DXY/i.test(asset.id)) return 4;
  return (asset.price ?? 0) >= 1000 ? 2 : 3;
}

function fmt(asset: MarketQuote, value?: number | null) {
  const parsed = num(value);
  return parsed == null ? '—' : parsed.toLocaleString(undefined, { maximumFractionDigits: digits(asset) });
}

function deriveSession(asset: MarketQuote) {
  const price = num(asset.price), open = num(asset.open), high = num(asset.high), low = num(asset.low), previous = num(asset.previousClose);
  if (price == null) return { state: 'unavailable' as SessionState, location: null, zone: 'Unavailable', rangePct: null, momentum: null, expansion: null };
  const state: SessionState = open != null && previous != null
    ? price > open && price > previous ? 'bullish' : price < open && price < previous ? 'bearish' : 'balanced'
    : previous != null ? price > previous ? 'bullish' : price < previous ? 'bearish' : 'balanced' : 'balanced';
  const range = high != null && low != null && high > low ? high - low : null;
  const location = range != null ? Math.max(0, Math.min(100, ((price - low!) / range) * 100)) : null;
  const zone = location == null ? 'No range' : location >= 66.67 ? 'Premium' : location <= 33.33 ? 'Discount' : 'Equilibrium';
  const reference = previous ?? open;
  const momentum = reference != null && Math.abs(reference) > 1e-12 ? ((price - reference) / Math.abs(reference)) * 100 : num(asset.changePercent);
  const rangePct = range != null && previous != null && Math.abs(previous) > 1e-12 ? (range / Math.abs(previous)) * 100 : null;
  const expansion = range != null && reference != null && range > 1e-12 ? Math.min(100, Math.abs(price - reference) / range * 100) : null;
  return { state, location, zone, rangePct, momentum, expansion };
}

function SessionStatePill({ state }: { state: SessionState }) {
  return <span className={`technical-state ${state}`}>{state === 'balanced' ? 'Balanced' : state === 'unavailable' ? 'No quote' : state[0].toUpperCase() + state.slice(1)}</span>;
}

function gateLabel(status: TechnicalGateStatus) {
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'context-aligned') return 'Context aligned';
  if (status === 'awaiting-confirmation') return 'Awaiting confirmation';
  if (status === 'conflict') return 'Conflict';
  if (status === 'unavailable') return 'Unavailable';
  return 'Building history';
}

function biasLabel(bias: TechnicalBias) {
  return bias === 'bullish' ? 'Bullish' : bias === 'bearish' ? 'Bearish' : 'Balanced';
}

function CandleStrip({ bars, bias }: { bars: TechnicalBar[]; bias: TechnicalBias }) {
  const selected = bars.slice(-28);
  if (selected.length < 2) return <div className="structure-chart-empty">Building bar history</div>;
  const high = Math.max(...selected.map((bar) => bar.high));
  const low = Math.min(...selected.map((bar) => bar.low));
  const span = Math.max(high - low, Number.EPSILON);
  const width = 280;
  const height = 72;
  const step = width / selected.length;
  const y = (price: number) => 5 + ((high - price) / span) * (height - 10);
  return (
    <svg className={`structure-candle-strip ${bias}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent observed OHLC history">
      {selected.map((bar, index) => {
        const x = index * step + step / 2;
        const up = bar.close >= bar.open;
        const bodyTop = Math.min(y(bar.open), y(bar.close));
        const bodyBottom = Math.max(y(bar.open), y(bar.close));
        return (
          <g key={`${bar.start}-${index}`} className={up ? 'up' : 'down'}>
            <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} />
            <rect x={x - Math.max(1.3, step * .22)} y={bodyTop} width={Math.max(2.6, step * .44)} height={Math.max(1.3, bodyBottom - bodyTop)} rx=".8" />
          </g>
        );
      })}
    </svg>
  );
}

function FrameCell({ frame }: { frame?: TechnicalTimeframeState }) {
  if (!frame) return <div className="structure-frame unavailable"><strong>—</strong><span>Unavailable</span></div>;
  const className = frame.status === 'ready' ? frame.bias : frame.status;
  return (
    <div className={`structure-frame ${className}`} title={frame.reason || `${frame.bars}/${frame.requiredBars} bars · ${frame.quality.grade} history quality`}>
      <strong>{biasLabel(frame.bias)}</strong>
      <span>{frame.status === 'unavailable' ? 'Unavailable' : `${frame.bars}/${frame.requiredBars} · ${frame.quality.grade}`}</span>
    </div>
  );
}

function SequenceProgress({ frame, bias }: { frame?: TechnicalTimeframeState; bias: TechnicalBias }) {
  const sequence = bias === 'neutral' ? frame?.sequence?.active : frame?.sequence?.[bias];
  const steps = ['Sweep', 'CHoCH', 'Displacement', 'BOS', 'FVG'];
  const stage = sequence?.stage ?? 0;
  return (
    <div className="structure-sequence" aria-label="Ordered technical confirmation sequence">
      {steps.map((step, index) => <span key={step} className={index < stage ? 'complete' : index === stage ? 'next' : ''}>{step}</span>)}
    </div>
  );
}

function StructureAssetCard({ state, quote }: { state: TechnicalAssetState; quote?: MarketQuote }) {
  const primaryFrame = state.timeframes.H1?.history?.length ? state.timeframes.H1 : state.timeframes.H4;
  const activeBias = state.decisionGate.direction !== 'neutral' ? state.decisionGate.direction : primaryFrame?.bias ?? 'neutral';
  const lastEvent = [...(primaryFrame?.recentEvents ?? [])].at(-1);
  const latestOrderBlock = primaryFrame?.structure?.latestOrderBlock as { top?: number; bottom?: number } | null | undefined;
  const latestFvg = activeBias === 'bearish' ? primaryFrame?.imbalance?.latestBearishFvg : primaryFrame?.imbalance?.latestBullishFvg;
  const modelA = state.models.D1_H1_M5;
  const modelB = state.models.H4_M15_M1;
  return (
    <article className={`structure-asset-card ${state.decisionGate.status}`}>
      <div className="structure-asset-head">
        <div><span className="eyebrow">{state.synthetic ? 'Derived cross · verified legs' : 'Observed market history'}</span><h3>{state.label}</h3><small>{state.id}</small></div>
        <div className={`structure-gate ${state.decisionGate.status}`}><strong>{gateLabel(state.decisionGate.status)}</strong><span>{state.decisionGate.confidence}%</span></div>
      </div>

      <div className="structure-price-line"><strong>{quote ? fmt(quote, state.lastPrice) : state.lastPrice?.toLocaleString() ?? '—'}</strong><span className={activeBias}>{biasLabel(activeBias)} technical context</span></div>
      <CandleStrip bars={primaryFrame?.history ?? []} bias={activeBias} />

      <div className="structure-timeframes">
        {TIMEFRAMES.map((timeframe) => <div key={timeframe}><small>{timeframe}</small><FrameCell frame={state.timeframes[timeframe]} /></div>)}
      </div>

      <SequenceProgress frame={primaryFrame} bias={activeBias} />

      <div className="structure-evidence-grid">
        <div><small>Latest structure event</small><strong>{lastEvent ? `${lastEvent.type} · ${biasLabel(lastEvent.direction)}` : 'Awaiting structure break'}</strong></div>
        <div><small>Dealing range</small><strong>{primaryFrame?.dealingRange?.zone ? primaryFrame.dealingRange.zone[0].toUpperCase() + primaryFrame.dealingRange.zone.slice(1) : 'Building range'}</strong></div>
        <div><small>Order block</small><strong>{latestOrderBlock?.top != null && latestOrderBlock?.bottom != null ? `${latestOrderBlock.bottom.toFixed(4)} – ${latestOrderBlock.top.toFixed(4)}` : 'Not confirmed'}</strong></div>
        <div><small>Imbalance</small><strong>{latestFvg ? `${activeBias === 'bullish' ? 'Bullish' : 'Bearish'} FVG observed` : 'No active evidence'}</strong></div>
      </div>

      <div className="structure-models">
        {[modelA, modelB].filter(Boolean).map((model) => (
          <div key={model.name} className={model.status}>
            <span>{model.name}</span><strong>{gateLabel(model.status)}</strong><small>{model.reason}</small>
          </div>
        ))}
      </div>
      <AdvancedSmcPanel state={state} />
      <p className="structure-reason">{state.decisionGate.reason}</p>
    </article>
  );
}

export function TechnicalStructureView({ assets }: { assets: MarketQuote[] }) {
  const [technical, setTechnical] = useState<TechnicalSnapshotPayload | null>(null);
  const [technicalError, setTechnicalError] = useState('');
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const refreshKey = assets.map((asset) => `${asset.id}:${asset.fetchedAt ?? ''}:${asset.price ?? ''}`).join('|');

  useEffect(() => {
    let cancelled = false;
    setTechnicalLoading(true);
    setTechnicalError('');
    void fetchTechnicalSnapshot()
      .then((payload) => { if (!cancelled) setTechnical(payload); })
      .catch((error) => { if (!cancelled) setTechnicalError(error instanceof Error ? error.message : 'Technical history is not available yet.'); })
      .finally(() => { if (!cancelled) setTechnicalLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const quoteById = useMemo(() => new Map(assets.map((asset) => [asset.id === 'GOLD' ? 'XAUUSD' : asset.id, asset])), [assets]);
  const rows = assets.filter((asset) => num(asset.price) != null).map((asset) => ({ asset, technical: deriveSession(asset) }));
  const bullish = rows.filter((item) => item.technical.state === 'bullish').length;
  const bearish = rows.filter((item) => item.technical.state === 'bearish').length;
  const balanced = rows.filter((item) => item.technical.state === 'balanced').length;
  const structureAssets = FOCUS_ASSETS.map((id) => technical?.assets?.[id]).filter((item): item is TechnicalAssetState => Boolean(item));

  return <>
    <section className="technical-summary">
      <article className="panel technical-intro"><span className="eyebrow">Technical Market Context</span><h2>Observed structure, range location and execution confirmation.</h2><p>Session observations remain separate from the historical structure engine. Directional execution is only upgraded when verified bars support the required higher-timeframe, confirmation-timeframe and entry-timeframe sequence.</p></article>
      <article className="panel technical-breadth"><span className="eyebrow">Cross Asset Breadth</span><div className="technical-breadth-grid"><div><strong>{bullish}</strong><span>Bullish</span></div><div><strong>{bearish}</strong><span>Bearish</span></div><div><strong>{balanced}</strong><span>Balanced</span></div><div><strong>{rows.length}</strong><span>Live instruments</span></div></div></article>
    </section>

    <section className="section-head"><div><span className="eyebrow">Session Reference Board</span><h2>Range and liquidity context</h2><p>Premium and discount use the observed session range. Session high and low are liquidity references, not automatic reversal calls.</p></div></section>
    <section className="technical-grid">{rows.map(({ asset, technical: session }) => <article className="technical-card" key={asset.id}>
      <div className="technical-card-head"><div><span className="eyebrow">{asset.assetClass?.replaceAll('-', ' ') || 'Market'}</span><h3>{asset.label}</h3><small>{asset.id}</small></div><SessionStatePill state={session.state} /></div>
      <div className="technical-price-row"><strong>{fmt(asset, asset.price)}</strong><span className={(session.momentum ?? 0) > 0 ? 'positive' : (session.momentum ?? 0) < 0 ? 'negative' : 'neutral'}>{session.momentum == null ? '—' : `${session.momentum > 0 ? '+' : ''}${session.momentum.toFixed(2)}%`}</span></div>
      <div className="range-track"><i className="range-third discount"></i><i className="range-third equilibrium"></i><i className="range-third premium"></i>{session.location != null ? <b style={{ left: `${session.location}%` }}></b> : null}</div>
      <div className="technical-zone"><span>{session.zone}</span><strong>{session.location == null ? '—' : `${session.location.toFixed(0)}% of range`}</strong></div>
      <div className="technical-levels"><div><small>Session high</small><b>{fmt(asset, asset.high)}</b></div><div><small>Session low</small><b>{fmt(asset, asset.low)}</b></div><div><small>Open</small><b>{fmt(asset, asset.open)}</b></div><div><small>Previous close</small><b>{fmt(asset, asset.previousClose)}</b></div></div>
      <div className="technical-diagnostics"><span>Range {session.rangePct == null ? '—' : `${session.rangePct.toFixed(2)}%`}</span><span>Expansion {session.expansion == null ? '—' : `${session.expansion.toFixed(0)}%`}</span><span>{asset.stale ? 'Last verified quote' : 'Live quote'}</span></div>
    </article>)}</section>

    <section className="section-head structure-heading"><div><span className="eyebrow">Multi Timeframe Structure</span><h2>Liquidity → CHoCH → displacement → BOS → FVG</h2><p>The ordered reaction sequence is evaluated only from retained price history. D1 → H1 → M5 and H4 → M15 → M1 remain locked until every required layer has sufficient data quality.</p></div><div className="structure-summary-pills"><span>{technical?.counts?.confirmed ?? 0} confirmed</span><span>{technical?.counts?.contextAligned ?? 0} context aligned</span><span>{technical?.counts?.warming ?? 0} building</span></div></section>
    {technicalLoading && !technical ? <div className="loading-panel">Building verified multi-timeframe structure…</div> : null}
    {technicalError && !technical ? <div className="panel structure-warming"><span className="eyebrow">Structure history</span><h3>Price history is being initialized</h3><p>{technicalError}</p></div> : null}
    {structureAssets.length ? <section className="structure-asset-grid">{structureAssets.map((state) => <StructureAssetCard key={state.id} state={state} quote={quoteById.get(state.id)} />)}</section> : null}
    <SmtDivergencePanel technical={technical} />

    <section className="panel technical-method"><div><span className="eyebrow">Execution Framework</span><h2>Evidence-gated market structure</h2></div><div className="technical-framework"><div><strong>Directional context</strong><span>D1 and H4 structure, strong and weak swing points, dealing range and premium or discount.</span></div><div><strong>Confirmation</strong><span>Mapped liquidity, sweep, CHoCH, displacement, BOS and directional imbalance in strict order.</span></div><div><strong>Execution</strong><span>H1/M5 and M15/M1 hierarchy remains locked until the required lower-timeframe evidence exists.</span></div><div><strong>Protection</strong><span>Unverified bars, thin sampling and missing one-minute OHLC reduce quality instead of creating synthetic confirmation.</span></div></div><small className="technical-disclaimer">The structure engine uses observed market snapshots and provider-supplied session OHLC only. It does not infer missing candles, sweeps, order blocks or structure breaks.</small></section>
  </>;
}
