import { useEffect, useMemo, useState } from 'react';
import './FirestoreCapacityDock.css';

type RuntimeCounts = {
  stateSnapshots: number;
  mt5Batches: number;
  liveSignals: number;
  geminiCacheEntries: number;
  securityEvents: number;
  runtimeMetaEntries: number;
  stateUpdatedAt?: string | null;
  mt5UpdatedAt?: string | null;
  signalsUpdatedAt?: string | null;
};

type RuntimeCapacity = {
  generatedAt: string;
  architecture?: string;
  runtime?: string;
  databaseId?: string;
  databaseName?: string;
  status?: 'live' | 'degraded' | string;
  lastDataAt?: string | null;
  counts?: Partial<RuntimeCounts>;
  signalPipeline?: {
    totalEvents?: number;
    mt5Events?: number;
    totalSignals?: number;
    mt5Signals?: number;
  };
  notes?: string[];
  message?: string;
};

const fmt = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString()
  : '—';
const time = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

async function getUsage(): Promise<RuntimeCapacity> {
  const request = async (path: string) => {
    const response = await fetch(path, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`D1 runtime ledger unavailable (${response.status})`);
    if (!text.trim()) throw new Error('D1 runtime ledger returned an empty response');
    return JSON.parse(text) as RuntimeCapacity;
  };

  try {
    return await request('/api/runtime/capacity');
  } catch (primaryError) {
    // Compatibility for a Worker/browser bundle that is briefly on a mixed deployment.
    try { return await request('/api/tradingview/firestore-usage'); }
    catch { throw primaryError; }
  }
}

function LedgerMetric({ label, value, detail }: { label: string; value: number | null | undefined; detail: string }) {
  return (
    <div className="fs-cap-gauge ok">
      <div><span>{label}</span><strong>{fmt(value)}</strong></div>
      <i><b style={{ width: value ? '100%' : '8%' }} /></i>
      <p>{detail}</p>
    </div>
  );
}

export function FirestoreCapacityDock() {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<RuntimeCapacity | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const next = await getUsage();
      setUsage(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'D1 runtime ledger unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 300_000);
    const focus = () => void load();
    window.addEventListener('focus', focus, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, []);

  const counts = usage?.counts ?? {};
  const live = usage?.status !== 'degraded' && Boolean(usage);
  const totalRecords = useMemo(() => (
    number(counts.stateSnapshots)
    + number(counts.mt5Batches)
    + number(counts.liveSignals)
    + number(counts.geminiCacheEntries)
    + number(counts.securityEvents)
    + number(counts.runtimeMetaEntries)
  ), [counts]);

  return (
    <div className={`fs-cap-dock ${open ? 'open' : ''} ${live ? 'ok' : 'warn'}`}>
      <button className="fs-cap-toggle" onClick={() => setOpen((value) => !value)} title="Cloudflare D1 capacity and signal ledger">
        <span className="fs-cap-dot" />
        <div><strong>D1 RUNTIME</strong><small>{loading ? 'SYNCING' : live ? 'PRIMARY DATABASE' : 'CHECKING'}</small></div>
        <b>{open ? '×' : 'DB'}</b>
      </button>

      {open && (
        <div className="fs-cap-panel">
          <div className="fs-cap-head">
            <div><span>PRIMARY INFRASTRUCTURE · CLOUDFLARE D1</span><h3>Capacity & Signal Ledger</h3></div>
            <button onClick={() => void load()} disabled={loading}>{loading ? 'SYNCING' : 'REFRESH'}</button>
          </div>

          {error && <div className="fs-cap-error">{error}{usage ? ' · Showing the last successful ledger sample.' : ''}</div>}
          {!usage && loading ? <div className="fs-cap-loading">Reading Cloudflare D1 runtime ledger…</div> : null}

          {usage && (
            <>
              <div className="fs-cap-storage">
                <div>
                  <span>Production persistence</span>
                  <strong>{usage.databaseName || 'Cloudflare D1'} <small>· R0</small></strong>
                  <p className="fs-cap-runtime-copy">Workers + D1 is the live primary data contract. Firestore is no longer required by this dashboard.</p>
                </div>
                <div className={`fs-cap-ring ${live ? 'ok' : 'warn'}`}><b>{live ? 'LIVE' : 'CHECK'}</b></div>
              </div>
              <div className="fs-cap-storage-foot">
                <span>{fmt(totalRecords)} tracked runtime records</span>
                <span>Last data activity: {time(usage.lastDataAt)}</span>
              </div>

              <div className="fs-cap-grid">
                <LedgerMetric label="State snapshots" value={counts.stateSnapshots} detail="Normalized macro, market and research state stored in D1." />
                <LedgerMetric label="MT5 batches" value={counts.mt5Batches ?? usage.signalPipeline?.mt5Events} detail="Authenticated MT5 ingestion batches persisted by the R0 Worker." />
                <LedgerMetric label="Live signals" value={counts.liveSignals ?? usage.signalPipeline?.totalSignals} detail="Current persisted signal records available to the dashboard." />
              </div>

              <div className="fs-cap-signal">
                <div><span>Gemini cache</span><strong>{fmt(counts.geminiCacheEntries)}</strong><small>Cached intelligence responses</small></div>
                <div><span>Security events</span><strong>{fmt(counts.securityEvents)}</strong><small>Edge security audit records</small></div>
                <div><span>Runtime metadata</span><strong>{fmt(counts.runtimeMetaEntries)}</strong><small>Persistent runtime control state</small></div>
              </div>

              <div className="fs-cap-meta">
                <span>Architecture: {usage.architecture || 'cloudflare-r0'}</span>
                <span>Database: {usage.databaseId || 'fxga-free-db'}</span>
                <span>Sample: {time(usage.generatedAt)}</span>
              </div>
              <p className="fs-cap-note">This ledger now reads the production Cloudflare D1 database directly. Legacy Firestore telemetry remains only as a temporary compatibility endpoint for cached browser bundles.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
