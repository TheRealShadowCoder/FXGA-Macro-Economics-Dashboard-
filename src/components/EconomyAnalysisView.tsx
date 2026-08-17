import { useEffect, useState } from 'react';
import { fetchEconomyAnalysis } from '../lib/api';
import type { EconomyAnalysisPayload } from '../lib/economy-types';

function scoreClass(score: number) {
  return score > 15 ? 'positive' : score < -15 ? 'negative' : 'neutral';
}

function ScoreBar({ score }: { score: number }) {
  const normalized = Math.max(-100, Math.min(100, score));
  const width = Math.abs(normalized) / 2;
  const left = normalized >= 0 ? 50 : 50 - width;
  return (
    <div className="score-track">
      <span className="score-mid"></span>
      <span className={`score-fill ${scoreClass(score)}`} style={{ left: `${left}%`, width: `${width}%` }}></span>
    </div>
  );
}

export function EconomyAnalysisView() {
  const [data, setData] = useState<EconomyAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchEconomyAnalysis()
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to load economy analysis'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading && !data) return <div className="loading-panel">Building USA, Europe, UK, South Africa and Japan macro states…</div>;
  if (error) return <div className="alert warn">Global economy analysis: {error}</div>;
  if (!data) return null;

  return (
    <>
      <section className="section-head">
        <div>
          <span className="eyebrow">Five-Economy Reaction Engine</span>
          <h2>Independent central-bank and currency macro states</h2>
          <p>{data.observationCount} tagged observations · {data.collectorMode}</p>
        </div>
      </section>

      <section className="analysis-grid economy-grid">
        {data.economies.map((economy) => (
          <article className="analysis-card economy-card" key={economy.id}>
            <div className="analysis-card-head">
              <div>
                <span className="eyebrow">{economy.currency} · {economy.observationCount} observations</span>
                <h3>{economy.label}</h3>
              </div>
              <strong className={scoreClass(economy.currencyScore)}>{economy.currencyScore >= 0 ? '+' : ''}{economy.currencyScore}</strong>
            </div>
            <p>{economy.summary}</p>
            <div className="regime-stats economy-stats">
              <div><small>Regime</small><strong>{economy.regime}</strong></div>
              <div><small>{economy.centralBank}</small><strong>{economy.policyStance}</strong></div>
              <div><small>{economy.currency} Bias</small><strong className={scoreClass(economy.currencyScore)}>{economy.currencyBias}</strong></div>
              <div><small>Confidence</small><strong>{economy.confidence}%</strong></div>
            </div>
            <div className="economy-dimensions">
              {economy.dimensions.map((dimension) => (
                <div className="economy-dimension" key={dimension.id}>
                  <div><span>{dimension.label}</span><b className={scoreClass(dimension.score)}>{dimension.score}</b></div>
                  <ScoreBar score={dimension.score} />
                  <small>{dimension.coverage} contributing series</small>
                </div>
              ))}
            </div>
            {economy.topSignals.length > 0 && (
              <div className="contributors economy-contributors">
                {economy.topSignals.slice(0, 6).map((signal) => (
                  <span key={signal.seriesId}>{signal.seriesId}<b className={scoreClass(signal.score)}>{signal.score}</b></span>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="panel methodology-card economy-methodology">
        <span className="eyebrow">Global Methodology</span>
        <h2>Separate economies, shared normalization discipline</h2>
        <p>{data.methodology}</p>
        <small>{data.minimumCoverageNote}</small>
      </section>
    </>
  );
}
