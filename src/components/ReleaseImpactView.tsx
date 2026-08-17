import type { ReleaseImpactPayload } from '../lib/types';

function probabilityEntries(probabilities: Record<string, number>) {
  return Object.entries(probabilities).map(([label, value]) => ({ label, value }));
}

export function ReleaseImpactView({ data, loading, error }: { data: ReleaseImpactPayload | null; loading: boolean; error: string }) {
  if (loading && !data) return <div className="loading-panel compact">Calculating release impact probabilities…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  return (
    <section className="panel release-impact-panel">
      <div className="release-impact-head">
        <div>
          <span className="eyebrow">Immediate post release transmission</span>
          <h2>Macro Asset Probabilities</h2>
          <p>{data.methodology}</p>
        </div>
        <span className="regime-chip">{data.regime}</span>
      </div>
      <div className="release-impact-grid">
        {data.assets.map((asset) => (
          <article className="release-impact-card" key={asset.id}>
            <div className="impact-card-head"><strong>{asset.label}</strong><span>{asset.bias}</span></div>
            <div className="impact-score">{asset.score > 0 ? '+' : ''}{asset.score}<small>/100</small></div>
            <div className="impact-components"><span>Baseline {asset.baselineScore > 0 ? '+' : ''}{asset.baselineScore}</span><span>Release {asset.releaseImpulse > 0 ? '+' : ''}{asset.releaseImpulse}</span><span>{asset.confidence}% conf.</span></div>
            <div className="probability-stack">
              {probabilityEntries(asset.probabilities).map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value.toFixed(1)}%</strong></span>)}
            </div>
          </article>
        ))}
      </div>
      {data.contributors.length > 0 && (
        <div className="release-contributors">
          <small>Recent release contributors</small>
          {data.contributors.map((item, index) => <span key={`${item.currency}-${item.event}-${index}`}>{item.currency} {item.event} · {item.score > 0 ? '+' : ''}{item.score} · {item.ageMinutes}m ago</span>)}
        </div>
      )}
    </section>
  );
}
