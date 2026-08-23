import { useEffect, useMemo, useState } from 'react';
import './SMC2000IndicatorSignals.css';
import './SMC2000BrokerWideScanner.css';
import './SMC2000AllBrokerAssets.css';

type Side = 'BUY' | 'SELL' | 'WAIT';
type Signal = {
  id: string;
  schema?: string;
  source?: string;
  platform?: string;
  engine?: string;
  stream?: string;
  symbol: string;
  brokerSymbol?: string | null;
  brokerCompany?: string | null;
  brokerServer?: string | null;
  timeframe?: string;
  side: Side;
  status?: string;
  methodId?: number | null;
  methodCode?: string | null;
  methodFamily?: string | null;
  methodScore?: number | null;
  exactMatches?: number | null;
  archetypeId?: number | null;
  archetypeCode?: string | null;
  archetypeName?: string | null;
  scannerMode?: string | null;
  scannerScope?: string | null;
  scannerUniverseTotal?: number | null;
  scannerAvailableTotal?: number | null;
  scannerAll50Evaluated?: boolean;
  signalTime?: string | null;
  updatedAt?: string;
  lastEvent?: string;
  lastReason?: string | null;
  lastMeaning?: string | null;
  marketPrice?: number | null;
  tradePlan?: {
    side?: Side;
    tradeMode?: string | null;
    orderType?: string | null;
    filled?: boolean;
    entry?: number | null;
    stopLoss?: number | null;
    tp1?: number | null;
    tp2?: number | null;
    tp3?: number | null;
  };
  riskReward?: { rrTp1?: number | null; rrTp2?: number | null; rrTp3?: number | null };
  timeframeHierarchy?: Record<string, unknown> | null;
  intelligence?: { score?: number; grade?: string; action?: string; label?: string; explanation?: string };
};

type UniverseSymbol = {
  symbol: string;
  description?: string;
  path?: string;
  baseCurrency?: string;
  profitCurrency?: string;
  marginCurrency?: string;
  tradeMode?: number | null;
  digits?: number | null;
  status?: string;
  lastScanMs?: number | null;
  scans?: number;
  published?: number;
};

type UniversePayload = {
  schema?: string;
  source?: string;
  engine?: string;
  stream?: string;
  brokerCompany?: string;
  brokerServer?: string;
  receivedAt?: string;
  generatedAtMs?: number | null;
  terminalTotal?: number;
  scanUniverseTotal?: number;
  symbolCount?: number;
  truncated?: boolean;
  status?: string;
  symbols?: UniverseSymbol[];
};

type SignalPayload = {
  generatedAt?: string;
  stream?: string;
  count?: number;
  complete?: boolean;
  completeWithinLimit?: boolean;
  signals?: Signal[];
};

type Filter = 'ALL' | 'WITH_SETUP' | 'NO_SETUP' | 'BUY' | 'SELL';

const SCANNER_STREAM = 'fxga_smc2000_mt5_multi_asset';
const MT5_SCANNER_ORIGIN = 'https://fxga-mt5-signal-ingress-kbjj66blka-uc.a.run.app';
const PAGE_SIZE = 200;

const numeric = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const text = (value: unknown) => typeof value === 'string' ? value : '';
const words = (value: unknown) => String(value ?? '—').replaceAll('_', ' ');
const fmt = (value?: number | null) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 5 });
const age = (date?: string | null) => {
  if (!date) return '—';
  const ms = Date.now() - Date.parse(date);
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};
const ageMs = (ms?: number | null) => ms && Number.isFinite(ms) ? age(new Date(ms).toISOString()) : 'not scanned yet';
const scoreOf = (signal?: Signal | null) => numeric(signal?.methodScore) ?? numeric(signal?.intelligence?.score) ?? 0;
const brokerSymbolOf = (signal: Signal) => String(signal.brokerSymbol || signal.symbol || '').trim();
const isScannerSignal = (signal: Signal) => String(signal.stream || '').toLowerCase() === SCANNER_STREAM || String(signal.scannerMode || '').toUpperCase() === 'BROKER_WIDE';

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `${url} failed with HTTP ${response.status}`);
  return JSON.parse(body) as T;
}

function dedupe(rows: Signal[]) {
  const map = new Map<string, Signal>();
  for (const row of rows) {
    if (!row?.id) continue;
    const previous = map.get(row.id);
    if (!previous || Date.parse(row.updatedAt || row.signalTime || '') > Date.parse(previous.updatedAt || previous.signalTime || '')) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.updatedAt || b.signalTime || '') - Date.parse(a.updatedAt || a.signalTime || ''));
}

function hierarchy(signal: Signal, key: 'h4' | 'm15' | 'm1') {
  const h = signal.timeframeHierarchy && typeof signal.timeframeHierarchy === 'object' ? signal.timeframeHierarchy : {};
  const at = h && typeof h.at_signal === 'object' ? h.at_signal as Record<string, unknown> : {};
  const current = h && typeof h.current === 'object' ? h.current as Record<string, unknown> : {};
  const aliases = key === 'h4' ? ['h4', 'h4_major'] : key === 'm15' ? ['m15', 'm15_confirmation'] : ['m1', 'm1_execution'];
  for (const alias of aliases) {
    const value = current[alias] ?? at[alias] ?? h[alias];
    if (typeof value === 'string' && value) return value;
  }
  return '—';
}

export function SMC2000IndicatorSignals() {
  const [universe, setUniverse] = useState<UniversePayload>({ symbols: [] });
  const [scannerSignals, setScannerSignals] = useState<Signal[]>([]);
  const [chartSignals, setChartSignals] = useState<Signal[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('ALL');
  const [selectedSignalId, setSelectedSignalId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState('');

  const load = async () => {
    setLoading(true);
    const errors: string[] = [];
    const [universeResult, scannerResult, liveResult, historyResult] = await Promise.allSettled([
      json<UniversePayload>(`${MT5_SCANNER_ORIGIN}/api/mt5/scanner-universe`),
      json<SignalPayload>(`${MT5_SCANNER_ORIGIN}/api/mt5/scanner-signals`),
      json<SignalPayload>('/api/tradingview/signals/live?limit=250'),
      json<SignalPayload>('/api/tradingview/signals?limit=250'),
    ]);

    if (universeResult.status === 'fulfilled') setUniverse({ ...universeResult.value, symbols: universeResult.value.symbols ?? [] });
    else errors.push(`broker universe: ${universeResult.reason instanceof Error ? universeResult.reason.message : 'unavailable'}`);

    if (scannerResult.status === 'fulfilled') setScannerSignals(dedupe((scannerResult.value.signals ?? []).filter(isScannerSignal)));
    else errors.push(`broker-wide signals: ${scannerResult.reason instanceof Error ? scannerResult.reason.message : 'unavailable'}`);

    const chartRows: Signal[] = [];
    if (liveResult.status === 'fulfilled') chartRows.push(...(liveResult.value.signals ?? []));
    if (historyResult.status === 'fulfilled') chartRows.push(...(historyResult.value.signals ?? []));
    setChartSignals(dedupe(chartRows.filter(row => String(row.engine || '').toUpperCase() === 'FXGA_SMC2000' && !isScannerSignal(row))));

    setError(errors.join(' · '));
    setLastSync(new Date().toISOString());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const fullUniverse = useMemo(() => {
    const map = new Map<string, UniverseSymbol>();
    for (const row of universe.symbols ?? []) if (row.symbol) map.set(row.symbol, row);
    for (const signal of scannerSignals) {
      const symbol = brokerSymbolOf(signal);
      if (symbol && !map.has(symbol)) map.set(symbol, { symbol, description: 'Observed in broker-wide SMC signal stream', status: 'SIGNAL_OBSERVED' });
    }
    return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol, undefined, { numeric: true }));
  }, [universe.symbols, scannerSignals]);

  const signalMap = useMemo(() => {
    const map = new Map<string, Signal[]>();
    for (const signal of scannerSignals) {
      const symbol = brokerSymbolOf(signal);
      const rows = map.get(symbol) ?? [];
      rows.push(signal);
      map.set(symbol, rows);
    }
    return map;
  }, [scannerSignals]);

  const latestMap = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const [symbol, rows] of signalMap) if (rows.length) map.set(symbol, rows[0]);
    return map;
  }, [signalMap]);

  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fullUniverse.filter(asset => {
      const rows = signalMap.get(asset.symbol) ?? [];
      const latest = rows[0];
      if (selectedSymbol !== 'ALL' && asset.symbol !== selectedSymbol) return false;
      if (filter === 'WITH_SETUP' && rows.length === 0) return false;
      if (filter === 'NO_SETUP' && rows.length > 0) return false;
      if (filter === 'BUY' && latest?.side !== 'BUY') return false;
      if (filter === 'SELL' && latest?.side !== 'SELL') return false;
      if (q && !`${asset.symbol} ${asset.description ?? ''} ${asset.path ?? ''} ${asset.baseCurrency ?? ''} ${asset.profitCurrency ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [fullUniverse, signalMap, selectedSymbol, filter, query]);

  const visibleSignals = useMemo(() => scannerSignals.filter(signal => selectedSymbol === 'ALL' || brokerSymbolOf(signal) === selectedSymbol), [scannerSignals, selectedSymbol]);
  const pageCount = Math.max(1, Math.ceil(visibleSignals.length / PAGE_SIZE));
  const pageSignals = visibleSignals.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { if (page >= pageCount) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);
  useEffect(() => { setPage(0); }, [selectedSymbol]);

  const selectedSignal = scannerSignals.find(row => row.id === selectedSignalId) ?? visibleSignals[0] ?? null;
  const symbolsWithSetups = signalMap.size;
  const activeSignals = scannerSignals.filter(row => ['PENDING_ENTRY', 'ACTIVE_FILLED'].includes(String(row.status || '').toUpperCase())).length;
  const brokerName = universe.brokerCompany || scannerSignals.find(row => row.brokerCompany)?.brokerCompany || 'Connected MT5 broker';
  const brokerServer = universe.brokerServer || scannerSignals.find(row => row.brokerServer)?.brokerServer || '';

  return <div className="smc2000-workspace smc-all-assets-workspace">
    <section className="smc-hero">
      <div>
        <span className="eyebrow">MetaTrader 5 · Broker-wide SMC2000 scanner · S01–S50</span>
        <h2>SMC2000 Signals · All Broker Assets</h2>
        <p>The asset board is populated from the complete symbol universe reported by the connected MT5 terminal. Assets remain visible even when there is no accepted setup. The setup feed retrieves the dedicated <strong>{SCANNER_STREAM}</strong> stream across every broker symbol.</p>
        <div className="smc-health"><i className={error ? 'offline' : 'online'}></i><strong>{error ? 'One or more feeds need attention' : 'Broker scanner connected'}</strong><span>{lastSync ? `last synchronized ${age(lastSync)}` : 'connecting'}</span></div>
      </div>
      <div className="smc-architecture">
        <span>{fullUniverse.length || '—'}</span><strong>Broker assets visible</strong><small>{brokerName}{brokerServer ? ` · ${brokerServer}` : ''}</small>
        <b>H4</b><i></i><b>M15</b><i></i><b>M1</b><i></i><b>S01–S50</b>
      </div>
    </section>

    <section className="smc-kpis">
      <div><span>Terminal symbols</span><strong>{universe.terminalTotal ?? fullUniverse.length}</strong><small>Everything exposed by MT5</small></div>
      <div><span>Scan universe</span><strong>{universe.scanUniverseTotal ?? fullUniverse.length}</strong><small>Assets included by the EA scanner</small></div>
      <div><span>Assets with setups</span><strong>{symbolsWithSetups}</strong><small>{Math.max(0, fullUniverse.length - symbolsWithSetups)} currently without stored setup</small></div>
      <div><span>Broker-wide signals</span><strong>{scannerSignals.length}</strong><small>All fetched scanner records</small></div>
      <div><span>Active setups</span><strong>{activeSignals}</strong><small>Pending entry or active filled</small></div>
    </section>

    {error && <div className="smc-error">{error}</div>}

    <section className="smc-all-assets-panel">
      <div className="smc-all-assets-head">
        <div><span className="eyebrow">Full MT5 instrument inventory</span><h3>All broker asset pairs</h3><p>Every symbol is retained in this list. “No active setup” means the EA has not published an accepted S01–S50 setup for that symbol in the stored scanner feed.</p></div>
        <div className="smc-all-assets-summary"><strong>{visibleAssets.length}</strong><span>shown of {fullUniverse.length}</span></div>
      </div>
      <div className="smc-all-assets-toolbar">
        <button className={selectedSymbol === 'ALL' ? 'active' : ''} onClick={() => setSelectedSymbol('ALL')}>ALL ASSETS</button>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search symbol, description, market path…" />
        <select value={filter} onChange={event => setFilter(event.target.value as Filter)}>
          <option value="ALL">All states</option><option value="WITH_SETUP">With setups</option><option value="NO_SETUP">No setup</option><option value="BUY">Latest BUY</option><option value="SELL">Latest SELL</option>
        </select>
        <button onClick={() => void load()} disabled={loading}>{loading ? 'SYNCING…' : 'REFRESH ALL'}</button>
      </div>
      <div className="smc-all-assets-table-wrap">
        <table className="smc-all-assets-table">
          <thead><tr><th>Broker symbol</th><th>Market</th><th>Scanner state</th><th>Setups</th><th>Latest setup</th><th>Direction</th><th>Score</th><th>Last scan</th></tr></thead>
          <tbody>{visibleAssets.map(asset => {
            const rows = signalMap.get(asset.symbol) ?? [];
            const latest = latestMap.get(asset.symbol);
            const direction = latest?.side || 'WAIT';
            const code = latest?.archetypeCode || (latest?.archetypeId ? `S${String(latest.archetypeId).padStart(2, '0')}` : '—');
            return <tr key={asset.symbol} className={selectedSymbol === asset.symbol ? 'selected' : ''} onClick={() => setSelectedSymbol(asset.symbol)}>
              <td><strong>{asset.symbol}</strong><small>{asset.baseCurrency && asset.profitCurrency ? `${asset.baseCurrency}/${asset.profitCurrency}` : asset.description || 'MT5 instrument'}</small></td>
              <td><span>{asset.path || asset.description || 'Broker market'}</span></td>
              <td><span className={`asset-scan-state ${rows.length ? 'has-setup' : ''}`}>{rows.length ? 'SETUP STORED' : words(asset.status || 'NO_ACTIVE_SETUP')}</span></td>
              <td><strong>{rows.length}</strong></td>
              <td><strong>{code}</strong><small>{latest?.archetypeName || 'No active setup'}</small></td>
              <td><span className={`smc-side ${String(direction).toLowerCase()}`}>{direction}</span></td>
              <td><strong>{latest ? Math.round(scoreOf(latest)) : '—'}</strong></td>
              <td><span>{ageMs(asset.lastScanMs)}</span></td>
            </tr>;
          })}</tbody>
        </table>
        {!visibleAssets.length && <div className="smc-mini-empty">No broker assets match the current filters.</div>}
      </div>
    </section>

    <section className="smc-all-signals-panel">
      <div className="smc-all-assets-head">
        <div><span className="eyebrow">Dedicated broker-wide stream</span><h3>{selectedSymbol === 'ALL' ? 'Signals from all asset pairs' : `${selectedSymbol} · all stored SMC setups`}</h3><p>The feed is not limited to the chart symbol. It reads the complete broker-wide scanner stream and then filters locally only when you select an asset.</p></div>
        <div className="smc-all-assets-summary"><strong>{visibleSignals.length}</strong><span>setup records</span></div>
      </div>
      <div className="smc-signal-pagination"><button disabled={page <= 0} onClick={() => setPage(value => Math.max(0, value - 1))}>Previous</button><span>Page {page + 1} of {pageCount} · {PAGE_SIZE} per page</span><button disabled={page >= pageCount - 1} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))}>Next</button></div>
      <div className="smc-all-signal-grid">{pageSignals.map(signal => {
        const score = Math.round(scoreOf(signal));
        const code = signal.archetypeCode || (signal.archetypeId ? `S${String(signal.archetypeId).padStart(2, '0')}` : 'S—');
        return <button key={signal.id} className={`smc-all-signal-card ${signal.side.toLowerCase()} ${selectedSignal?.id === signal.id ? 'selected' : ''}`} onClick={() => setSelectedSignalId(signal.id)}>
          <div><span className={`smc-side ${signal.side.toLowerCase()}`}>{signal.side}</span><strong>{brokerSymbolOf(signal)}</strong><time>{age(signal.updatedAt || signal.signalTime)}</time></div>
          <h4>{code} · {signal.archetypeName || 'SMC2000 setup'}</h4>
          <p>{signal.methodCode || `M${signal.methodId ?? '—'}`} · {signal.methodFamily || 'SMC2000'} · {words(signal.status || signal.lastEvent)}</p>
          <footer><span>{hierarchy(signal, 'h4')} → {hierarchy(signal, 'm15')} → {hierarchy(signal, 'm1')}</span><strong>{score}/100</strong></footer>
        </button>;
      })}</div>
      {!pageSignals.length && <div className="smc-mini-empty">No accepted S01–S50 setup has been stored for the selected broker asset yet.</div>}
    </section>

    {selectedSignal && <section className="smc-selected-signal">
      <div className="smc-all-assets-head"><div><span className="eyebrow">Selected setup detail</span><h3>{brokerSymbolOf(selectedSignal)} · {selectedSignal.archetypeCode || `S${selectedSignal.archetypeId ?? '—'}`}</h3><p>{selectedSignal.archetypeName || selectedSignal.methodFamily || 'FXGA SMC2000 broker-wide setup'}</p></div><span className={`smc-side ${selectedSignal.side.toLowerCase()}`}>{selectedSignal.side}</span></div>
      <div className="smc-selected-levels"><div><span>Entry</span><strong>{fmt(selectedSignal.tradePlan?.entry)}</strong></div><div><span>Stop</span><strong>{fmt(selectedSignal.tradePlan?.stopLoss)}</strong></div><div><span>TP1</span><strong>{fmt(selectedSignal.tradePlan?.tp1)}</strong></div><div><span>TP2</span><strong>{fmt(selectedSignal.tradePlan?.tp2)}</strong></div><div><span>TP3</span><strong>{fmt(selectedSignal.tradePlan?.tp3)}</strong></div><div><span>RR TP3</span><strong>{selectedSignal.riskReward?.rrTp3 == null ? '—' : `${selectedSignal.riskReward.rrTp3.toFixed(2)}R`}</strong></div></div>
      <div className="smc-selected-hierarchy"><div><span>H4 Direction</span><strong>{words(hierarchy(selectedSignal, 'h4'))}</strong></div><div><span>M15 Confirmation</span><strong>{words(hierarchy(selectedSignal, 'm15'))}</strong></div><div><span>M1 Execution</span><strong>{words(hierarchy(selectedSignal, 'm1'))}</strong></div><div><span>Method</span><strong>{selectedSignal.methodCode || `M${selectedSignal.methodId ?? '—'}`}</strong></div><div><span>Score</span><strong>{Math.round(scoreOf(selectedSignal))}/100</strong></div><div><span>State</span><strong>{words(selectedSignal.status || selectedSignal.lastEvent)}</strong></div></div>
      {selectedSignal.intelligence?.explanation && <p className="smc-selected-explanation">{selectedSignal.intelligence.explanation}</p>}
    </section>}

    {!!chartSignals.length && <section className="smc-chart-stream-note"><strong>{chartSignals.length}</strong><span>attached-chart SMC2000 records are also available in the existing chart stream; the broker-wide asset matrix above is driven only by the dedicated multi-asset scanner.</span></section>}
  </div>;
}
