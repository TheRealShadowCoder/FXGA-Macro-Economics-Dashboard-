import { useEffect, useState } from 'react';
import { fetchReleaseImpact } from '../lib/api';
import type { ReleaseImpactPayload, SessionSignalsPayload } from '../lib/types';
import { DecisionIntelligence } from './DecisionIntelligence';
import { ReleaseImpactView } from './ReleaseImpactView';

function scoreClass(score: number) {
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

export function SignalsView({ data, loading, error }: { data: SessionSignalsPayload | null; loading: boolean; error: string }) {
  const [impact, setImpact] = useState<ReleaseImpactPayload | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState('');

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setImpactLoading(true);
    setImpactError('');
    void fetchReleaseImpact()
      .then((payload) => { if (!cancelled) setImpact(payload); })
      .catch((caught) => { if (!cancelled) setImpactError(caught instanceof Error ? caught.message : 'Unable to calculate release impact'); })
      .finally(() => { if (!cancelled) setImpactLoading(false); });
    return () => { cancelled = true; };
  }, [data?.generatedAt]);

  if (loading && !data) return <div className="loading-panel">Calculating five-economy macro divergence and session intelligence…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return null;

  return (
    <>
      <DecisionIntelligence data={data} />
      <ReleaseImpactView data={impact} loading={impactLoading} error={impactError} />

      <section className="panel signals-summary">
        <div>
          <span className="eyebrow">Session execution layer</span>
          <h2>{data.macroRegime}</h2>
          <p>{data.methodology}</p>
        </div>
        <div className="signal-summary-stat"><strong>{data.macroConfidence}%</strong><span>U.S. structural confidence</span></div>
      </section>

      <section className="session-grid">
        {data.sessions.map((session) => (
          <article className={`panel session-card ${session.active ? 'session-active' : ''}`} key={session.id}>
            <div className="session-head">
              <div><span className="eyebrow">{session.windowUtc}</span><h2>{session.label}</h2></div>
              <span className={`session-state ${session.state}`}>{session.state}</span>
            </div>
            <div className="session-meta">
              <span>Risk <strong>{session.risk.replace('-', ' ')}</strong></span>
              <span>Events <strong>{session.eventCount}</strong></span>
              <span>Focus <strong>{session.focusCurrencies.join(' · ')}</strong></span>
            </div>
            {session.nextCatalyst && <div className="next-catalyst"><small>Next catalyst</small>{session.nextCatalyst}</div>}
            <div className="signal-list">
              {session.signals.map((signal) => {
                const enhanced = signal as typeof signal & {
                  conviction?: number;
                  convictionLabel?: string;
                  coverage?: string;
                  risk?: string;
                  executionGate?: string;
                  components?: { structuralDivergence: number; policyDivergence: number; releaseDivergence: number };
                };
                return (
                  <div className="signal-row" key={signal.symbol}>
                    <div className="signal-symbol"><strong>{signal.symbol}</strong><span>{signal.confidence}% confidence{typeof enhanced.conviction === 'number' ? ` · ${enhanced.conviction}/100 conviction` : ''}</span></div>
                    <div className={`signal-score ${scoreClass(signal.score)}`}>{signal.score > 0 ? '+' : ''}{signal.score}</div>
                    <div className={`signal-direction ${signal.direction.toLowerCase()}`}>{signal.direction}</div>
                    <div className="signal-rationale">
                      {enhanced.components && (
                        <span>Structure {enhanced.components.structuralDivergence >= 0 ? '+' : ''}{enhanced.components.structuralDivergence} · Policy {enhanced.components.policyDivergence >= 0 ? '+' : ''}{enhanced.components.policyDivergence} · Release {enhanced.components.releaseDivergence >= 0 ? '+' : ''}{enhanced.components.releaseDivergence}</span>
                      )}
                      {signal.rationale.slice(0, 2).map((item) => <span key={item}>{item}</span>)}
                      <small>{enhanced.executionGate ? enhanced.executionGate.replaceAll('_', ' ').toLowerCase() : signal.invalidation}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </section>
      <div className="alert warn signal-caution">{data.caution}</div>
    </>
  );
}
