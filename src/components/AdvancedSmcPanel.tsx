import type { TechnicalAssetState, TechnicalSnapshotPayload, TechnicalTimeframeState } from '../lib/types';
import './AdvancedSmcPanel.css';

type Zone = { top?: number; bottom?: number; midpoint?: number; ideal?: number; zoneTop?: number; zoneBottom?: number; status?: string; direction?: string; type?: string; price?: number; current?: string; bars?: number; expansionVsMedian?: number };
type AdvancedFrame = TechnicalTimeframeState & { advanced?: { breaker?: Zone | null; inverseFvg?: Zone | null; balancedPriceRange?: Zone | null; consequentEncroachment?: Zone | null; ote?: Zone | null; protectedSwing?: Zone | null; liquidityVoid?: Zone | null; session?: Zone | null } };
type AdvancedAsset = TechnicalAssetState & { nested?: { status?: string; coverage?: number; required?: number; checks?: Record<string, boolean | null> } };
type AdvancedSnapshot = TechnicalSnapshotPayload & { smt?: { count?: number; divergences?: Array<{ first: string; second: string; relationship: string; timeframe: string; divergence: string; observedAt: string; samples: number }> }; advancedConcepts?: string[] };

const price = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—';
const titleCase = (value?: string) => value ? value.replaceAll('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : '—';

function Evidence({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="advanced-evidence"><small>{label}</small><strong>{value}</strong>{detail ? <span>{detail}</span> : null}</div>;
}

export function AdvancedSmcPanel({ state }: { state: TechnicalAssetState }) {
  const asset = state as AdvancedAsset;
  const frame = (state.timeframes.H1?.history?.length ? state.timeframes.H1 : state.timeframes.H4) as AdvancedFrame | undefined;
  const advanced = frame?.advanced;
  if (!advanced) return null;

  const breaker = advanced.breaker;
  const ifvg = advanced.inverseFvg;
  const bpr = advanced.balancedPriceRange;
  const ce = advanced.consequentEncroachment;
  const ote = advanced.ote;
  const protectedSwing = advanced.protectedSwing;
  const voidState = advanced.liquidityVoid;
  const session = advanced.session;
  const nested = asset.nested;

  return <section className="advanced-smc-panel">
    <div className="advanced-smc-head"><span>Advanced structure evidence</span><strong>{frame?.timeframe ?? '—'}</strong></div>
    <div className="advanced-smc-grid">
      <Evidence label="Breaker" value={breaker ? titleCase(breaker.status) : 'Not confirmed'} detail={breaker ? `${titleCase(breaker.direction)} · ${price(breaker.bottom)} – ${price(breaker.top)}` : undefined} />
      <Evidence label="Inverse FVG" value={ifvg ? titleCase(ifvg.status) : 'Not confirmed'} detail={ifvg ? `${titleCase(ifvg.direction)} · CE ${price(ifvg.midpoint)}` : undefined} />
      <Evidence label="Balanced Price Range" value={bpr ? `${price(bpr.bottom)} – ${price(bpr.top)}` : 'No overlap'} detail={bpr ? `CE ${price(bpr.midpoint)}` : undefined} />
      <Evidence label="FVG Consequent Encroachment" value={ce ? price(ce.midpoint) : 'Not available'} detail={ce ? titleCase(ce.direction) : undefined} />
      <Evidence label="Optimal Trade Entry" value={ote ? `70.5% · ${price(ote.ideal)}` : 'Not available'} detail={ote ? `${price(ote.zoneBottom)} – ${price(ote.zoneTop)}` : undefined} />
      <Evidence label="Protected Swing" value={protectedSwing ? `${titleCase(protectedSwing.type)} · ${price(protectedSwing.price)}` : 'Not established'} detail={protectedSwing ? titleCase(protectedSwing.direction) : undefined} />
      <Evidence label="Liquidity Void" value={voidState ? `${titleCase(voidState.direction)} · ${voidState.bars ?? 0} bars` : 'Not detected'} detail={voidState?.expansionVsMedian ? `${voidState.expansionVsMedian.toFixed(2)}× median expansion` : undefined} />
      <Evidence label="Session Context" value={titleCase(session?.current)} detail="UTC market session classification" />
      <Evidence label="Nested Structure" value={nested ? titleCase(nested.status) : 'Not evaluated'} detail={nested ? `${nested.coverage ?? 0}/${nested.required ?? 4} hierarchy checks observed` : undefined} />
    </div>
  </section>;
}

export function SmtDivergencePanel({ technical }: { technical: TechnicalSnapshotPayload | null }) {
  const snapshot = technical as AdvancedSnapshot | null;
  const divergences = snapshot?.smt?.divergences ?? [];
  return <section className="panel smt-panel">
    <div className="smt-head"><div><span className="eyebrow">Relative Market Confirmation</span><h2>SMT divergence monitor</h2><p>Correlated and inversely related instruments are compared only where synchronized retained bars exist.</p></div><strong>{snapshot?.smt?.count ?? 0}</strong></div>
    {!divergences.length ? <div className="smt-empty">No synchronized SMT divergence is currently confirmed, or the required history is still building.</div> : <div className="smt-grid">{divergences.slice(-8).reverse().map((item, index) => <article key={`${item.first}-${item.second}-${item.timeframe}-${item.observedAt}-${index}`}><span>{item.timeframe} · {titleCase(item.relationship)}</span><strong>{item.first} / {item.second}</strong><small>{titleCase(item.divergence)} · {item.samples} synchronized bars</small></article>)}</div>}
  </section>;
}
