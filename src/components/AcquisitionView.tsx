import { useMemo, useState } from 'react';
import { acquireSource } from '../lib/api';
import type { AcquisitionCatalogPayload, AcquisitionDocument } from '../lib/types';

function seconds(value: number) {
  if (value >= 60) return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)}m`;
  return `${value}s`;
}

export function AcquisitionView({
  catalog,
  loading,
  error,
  liveStatus,
  lastLiveEvent,
}: {
  catalog: AcquisitionCatalogPayload | null;
  loading: boolean;
  error: string;
  liveStatus: 'connecting' | 'connected' | 'offline';
  lastLiveEvent: string;
}) {
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [syncing, setSyncing] = useState<string>('');
  const [result, setResult] = useState<AcquisitionDocument | null>(null);
  const [syncError, setSyncError] = useState('');

  const browserSources = useMemo(() => catalog?.sources.filter((source) => source.allowBrowser).length ?? 0, [catalog]);

  const sync = async (sourceId: string) => {
    setSelectedSource(sourceId);
    setSyncing(sourceId);
    setSyncError('');
    try {
      setResult(await acquireSource(sourceId));
    } catch (caught) {
      setSyncError(caught instanceof Error ? caught.message : 'Source acquisition failed');
    } finally {
      setSyncing('');
    }
  };

  if (loading && !catalog) return <div className="loading-panel">Loading acquisition engine…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!catalog) return null;

  const budget = catalog.status?.browserBudget;
  const budgetPercent = budget ? Math.min(100, (budget.usedSeconds / Math.max(1, budget.softLimitSeconds)) * 100) : 0;

  return (
    <>
      <section className="acquisition-hero">
        <div className="panel acquisition-summary">
          <span className="eyebrow">FXGA Acquisition Orchestrator</span>
          <h2>API-first, cache-first, browser-last extraction.</h2>
          <p>Structured sources are always preferred. JavaScript rendering is only invoked when the public static response lacks the required data.</p>
          <div className="guard-grid">
            <div><strong>{catalog.limits.externalSubrequestsPerInvocation}</strong><span>hard subrequest ceiling</span></div>
            <div><strong>{catalog.limits.simultaneousOutgoingConnections}</strong><span>platform connection ceiling</span></div>
            <div><strong>{catalog.limits.browserConcurrentJobsInFxga}</strong><span>FXGA browser job at once</span></div>
            <div><strong>{catalog.limits.minBrowserLaunchGapSeconds}s</strong><span>minimum launch gap</span></div>
          </div>
        </div>
        <div className="panel browser-budget-card">
          <div className="panel-title"><div><span className="eyebrow">Browser Run Safety Budget</span><h2>{budget ? `${seconds(budget.remainingSeconds)} remaining` : 'Status unavailable'}</h2></div><span className={`live-pill ${liveStatus}`}>{liveStatus}</span></div>
          {budget && <>
            <div className="budget-meter"><span style={{ width: `${budgetPercent}%` }}></span></div>
            <div className="budget-labels"><span>{seconds(budget.usedSeconds)} used</span><span>{seconds(budget.softLimitSeconds)} FXGA cap</span></div>
            <p>{budget.reason}</p>
          </>}
          <small>{lastLiveEvent || 'Hibernating WebSocket ready for source-change events.'}</small>
        </div>
      </section>

      <section className="section-head"><div><span className="eyebrow">Fallback Ladder</span><h2>Extraction methods</h2></div><span>{catalog.methods.length} methods</span></section>
      <section className="method-grid">
        {catalog.methods.map((method, index) => (
          <article className="method-card" key={method.id}>
            <span className="method-index">{String(index + 1).padStart(2, '0')}</span>
            <div><h3>{method.label}</h3><p>{method.description}</p></div>
            <span className={`cost ${method.cost}`}>{method.cost}</span>
          </article>
        ))}
      </section>

      <section className="section-head"><div><span className="eyebrow">Registered Public Sources</span><h2>Acquisition controls</h2></div><span>{catalog.sources.length} sources · {browserSources} browser-enabled</span></section>
      <section className="acquisition-source-grid">
        {catalog.sources.map((source) => (
          <article className={`acquisition-source-card ${selectedSource === source.id ? 'selected' : ''}`} key={source.id}>
            <div className="acq-source-head"><div><span className="eyebrow">{source.official ? 'Official' : 'Public'} · {source.region}</span><h3>{source.name}</h3></div>{source.allowBrowser && <span className="browser-badge">JS fallback</span>}</div>
            <p>{source.category}</p>
            <div className="method-tags">{source.methods.map((method) => <span key={method}>{method}</span>)}</div>
            <div className="source-guards"><span>Cache {seconds(source.cacheTtlSeconds)}</span><span>Min refresh {seconds(source.minIntervalSeconds)}</span></div>
            <button className="sync-source" disabled={Boolean(syncing)} onClick={() => void sync(source.id)}>{syncing === source.id ? 'Syncing…' : 'Sync source'}</button>
          </article>
        ))}
      </section>

      {syncError && <div className="alert error acquisition-result">{syncError}</div>}
      {result && (
        <section className="panel acquisition-result">
          <div className="panel-title"><div><span className="eyebrow">Latest Acquisition</span><h2>{result.sourceName}</h2></div><span>{new Date(result.fetchedAt).toLocaleString()}</span></div>
          <div className="result-stats">
            <div><strong>{result.browserUsed ? 'Yes' : 'No'}</strong><span>Playwright used</span></div>
            <div><strong>{result.changed ? 'Changed' : 'Unchanged'}</strong><span>content hash</span></div>
            <div><strong>{result.extraction.embeddedPayloads}</strong><span>embedded payloads</span></div>
            <div><strong>{result.extraction.tables}</strong><span>tables</span></div>
            <div><strong>{result.extraction.links}</strong><span>links</span></div>
          </div>
          <div className="result-methods"><strong>Methods:</strong>{result.methodsUsed.map((method) => <span key={method}>{method}</span>)}</div>
          {result.title && <h3 className="result-title">{result.title}</h3>}
          <p className="result-preview">{result.text.slice(0, 1800) || 'No public text extracted.'}</p>
          {result.warnings.length > 0 && <div className="alert warn">{result.warnings.join(' · ')}</div>}
        </section>
      )}

      <section className="panel policy-panel">
        <span className="eyebrow">Collection Policy</span>
        <div className="policy-pills">
          {Object.entries(catalog.policy).map(([key, allowed]) => <span className={allowed ? 'enabled' : 'disabled'} key={key}>{key}: {allowed ? 'yes' : 'no'}</span>)}
        </div>
      </section>
    </>
  );
}
