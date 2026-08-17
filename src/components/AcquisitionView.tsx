import type { AcquisitionCatalogPayload } from '../lib/types';

type PassiveSource = {
  id: string;
  name: string;
  category: string;
  region: string;
  status?: 'live' | 'error' | 'stale' | 'partial';
  note?: string;
};

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
  if (loading && !catalog) return <div className="loading-panel">Loading Google Cloud ingestion state…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!catalog) return null;

  const sources = catalog.sources as unknown as PassiveSource[];
  const live = sources.filter((source) => !source.status || source.status === 'live').length;

  return (
    <>
      <section className="acquisition-hero">
        <div className="panel acquisition-summary">
          <span className="eyebrow">FXGA Google Cloud Ingestion Matrix</span>
          <h2>Acquisition happens in Google Cloud. Cloudflare only receives signed state updates.</h2>
          <p>FRED, economic calendars, official central-bank/statistics feeds, browser fallback and the FXGA intelligence engine run upstream in Google Cloud. This page is an observability console, not a Cloudflare fetch control.</p>
          <div className="guard-grid">
            <div><strong>{sources.length}</strong><span>registered Google sources</span></div>
            <div><strong>{live}</strong><span>sources reporting live</span></div>
            <div><strong>0</strong><span>Cloudflare upstream fetches</span></div>
            <div><strong>0s</strong><span>Cloudflare browser budget</span></div>
          </div>
        </div>
        <div className="panel browser-budget-card">
          <div className="panel-title"><div><span className="eyebrow">Signed Webhook Transport</span><h2>{liveStatus === 'connected' ? 'Connected' : liveStatus}</h2></div><span className={`live-pill ${liveStatus}`}>{liveStatus}</span></div>
          <p>Google publishes changed calendar, macro and intelligence snapshots through authenticated webhooks. WebSocket updates then tell the dashboard to refresh its cached views.</p>
          <small>{lastLiveEvent || 'Waiting for the next Google Cloud state update.'}</small>
        </div>
      </section>

      <section className="section-head"><div><span className="eyebrow">Google Cloud Sources</span><h2>Ingestion and decision dependencies</h2></div><span>{live}/{sources.length} live</span></section>
      <section className="acquisition-source-grid">
        {sources.map((source) => (
          <article className="acquisition-source-card" key={source.id}>
            <div className="acq-source-head">
              <div><span className="eyebrow">{source.region}</span><h3>{source.name}</h3></div>
              <span className={`source-status ${source.status ?? 'live'}`}>{source.status ?? 'live'}</span>
            </div>
            <p>{source.category}</p>
            {source.note && <small>{source.note}</small>}
            <div className="source-guards"><span>Execution: Google Cloud</span><span>Edge fetch: disabled</span></div>
          </article>
        ))}
      </section>

      <section className="panel policy-panel">
        <span className="eyebrow">Architecture Contract</span>
        <div className="policy-pills">
          <span className="enabled">Google acquisition: yes</span>
          <span className="enabled">Google intelligence: yes</span>
          <span className="enabled">signed webhook replay: yes</span>
          <span className="disabled">Cloudflare acquisition: no</span>
          <span className="disabled">Cloudflare browser: no</span>
          <span className="disabled">Cloudflare FRED/news/calendar requests: no</span>
        </div>
      </section>
    </>
  );
}
