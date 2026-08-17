import type { MacroAnalysisPayload } from '../lib/types';
import { EconomyAnalysisView } from './EconomyAnalysisView';

function scoreClass(score: number) {
  return score > 15 ? 'positive' : score < -15 ? 'negative' : 'neutral';
}

function ScoreBar({ score, risk = false }: { score: number; risk?: boolean }) {
  const normalized = risk ? Math.max(0, Math.min(100, score)) : Math.max(-100, Math.min(100, score));
  const width = risk ? normalized : Math.abs(normalized) / 2;
  const left = risk ? 0 : normalized >= 0 ? 50 : 50 - width;
  return (
    <div className={`score-track ${risk ? 'risk' : ''}`}>
      {!risk && <span className="score-mid"></span>}
      <span className={`score-fill ${risk ? 'risk-fill' : scoreClass(score)}`} style={{ left: `${left}%`, width: `${width}%` }}></span>
    </div>
  );
}

export function AnalysisView({ data, loading, error }: { data: MacroAnalysisPayload | null; loading: boolean; error: string }) {
  if (loading && !data) return <div className="loading-panel">Calculating FXGA macro regime…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  return (
    <>
      <section className="analysis-hero">
        <div className="panel regime-card">
          <span className="eyebrow">Current Macro Regime</span>
          <h2>{data.regime.name}</h2>
          <p>{data.regime.summary}</p>
          <div className="regime-stats">
            <div><small>Growth</small><strong className={scoreClass(data.regime.growthScore)}>{data.regime.growthScore}</strong></div>
            <div><small>Inflation</small><strong className={scoreClass(data.regime.inflationScore)}>{data.regime.inflationScore}</strong></div>
            <div><small>Recession Risk</small><strong>{data.regime.recessionRisk}/100</strong></div>
            <div><small>Confidence</small><strong>{data.confidence}%</strong></div>
          </div>
        </div>
        <div className="panel policy-card">
          <span className="eyebrow">Federal Reserve Reaction Function</span>
          <h2>{data.policy.stance}</h2>
          <div className={`large-score ${scoreClass(data.policy.fedReactionScore)}`}>{data.policy.fedReactionScore}</div>
          <ScoreBar score={data.policy.fedReactionScore} />
          <p>Rates momentum: <strong>{data.policy.ratesMomentum}</strong> · Coverage {data.coverage.observed}/{data.coverage.requested}</p>
        </div>
      </section>

      <section className="section-head"><div><span className="eyebrow">Causal Macro Engine</span><h2>Normalized U.S. economic dimensions</h2></div></section>
      <section className="analysis-grid">
        {data.dimensions.map((dimension) => (
          <article className="analysis-card" key={dimension.id}>
            <div className="analysis-card-head"><div><span className="eyebrow">{dimension.coverage} signals</span><h3>{dimension.label}</h3></div><strong className={scoreClass(dimension.score)}>{dimension.score}</strong></div>
            <p>{dimension.description}</p>
            <ScoreBar score={dimension.score} />
            <div className="contributors">
              {dimension.contributors.map((item) => <span key={item.seriesId}>{item.seriesId}<b className={scoreClass(item.score)}>{item.score}</b></span>)}
            </div>
          </article>
        ))}
        <article className="analysis-card recession-card">
          <div className="analysis-card-head"><div><span className="eyebrow">Composite risk gauge</span><h3>Recession Risk</h3></div><strong>{data.regime.recessionRisk}</strong></div>
          <p>Sahm Rule, recession probability, yield-curve inversion, claims and stress.</p>
          <ScoreBar score={data.regime.recessionRisk} risk />
        </article>
      </section>

      <section className="section-head"><div><span className="eyebrow">Transmission Layer</span><h2>Cross-asset macro bias</h2></div></section>
      <section className="asset-grid">
        {data.assets.map((asset) => (
          <article className="asset-card" key={asset.id}>
            <span className="eyebrow">{asset.bias}</span>
            <div className="asset-score"><h3>{asset.label}</h3><strong className={scoreClass(asset.score)}>{asset.score}</strong></div>
            <ScoreBar score={asset.score} />
          </article>
        ))}
      </section>

      <EconomyAnalysisView />

      <section className="two-col analysis-bottom">
        <div className="panel">
          <div className="panel-title"><div><span className="eyebrow">Largest Changes</span><h2>Top U.S. macro impulses</h2></div></div>
          {data.topSignals.map((signal) => (
            <div className="signal-row" key={signal.seriesId}><div><strong>{signal.seriesId}</strong><span>{signal.title}</span></div><b className={scoreClass(signal.score)}>{signal.score}</b></div>
          ))}
        </div>
        <div className="panel methodology-card">
          <span className="eyebrow">Methodology</span>
          <h2>Deterministic, auditable scoring</h2>
          <p>{data.methodology.principle}</p>
          <p>{data.methodology.scoreRange}</p>
          <small>{data.methodology.caution}</small>
        </div>
      </section>
    </>
  );
}
