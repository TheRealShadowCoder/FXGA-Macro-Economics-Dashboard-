import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import './SMC2000IndicatorSignals.css';
import './SMC2000BrokerWideScanner.css';

type Side = 'BUY' | 'SELL' | 'WAIT';
type Signal = {
  id: string;
  schema?: string;
  source?: string;
  platform?: string;
  engine?: string;
  stream?: string;
  symbol: string;
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
  brokerSymbol?: string | null;
  brokerCompany?: string | null;
  brokerServer?: string | null;
  scannerUniverseTotal?: number | null;
  scannerAvailableTotal?: number | null;
  scannerAll50Evaluated?: boolean;
  signalTime?: string | null;
  updatedAt: string;
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
    primaryTargetType?: string | null;
  };
  riskReward?: {
    riskPriceDistance?: number | null;
    rrTp1?: number | null;
    rrTp2?: number | null;
    rrTp3?: number | null;
  };
  lifecycle?: {
    barsSinceSignal?: number | null;
    entryFilled?: boolean;
    tp1Hit?: boolean;
    tp2Hit?: boolean;
    finalTargetHit?: boolean;
  };
  timeframeHierarchy?: Record<string, unknown>;
  intelligence?: {
    score?: number;
    grade?: string;
    action?: string;
    label?: string;
    explanation?: string;
    components?: Record<string, number>;
  };
};

type TradePlan = NonNullable<Signal['tradePlan']>;
type SignalList = { generatedAt?: string; count?: number; signals: Signal[] };
type SignalEvent = { id: string; eventId?: string; event: string; receivedAt: string; payload?: Record<string, unknown> };
type SignalDetail = { signal: Signal; events: SignalEvent[] };
type Archetype = { id: number | null; code: string; name: string };
type FilterSide = 'ALL' | 'BUY' | 'SELL';
type FilterStatus = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'INVALIDATED';
type FilterSource = 'ALL' | 'BROKER_WIDE' | 'CHART';

const MT5_STREAM = 'fxga_smc2000_mt5';
const SCANNER_STREAM = 'fxga_smc2000_mt5_multi_asset';
const ACTIVE = new Set(['PENDING_ENTRY', 'ACTIVE_FILLED']);

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const numeric = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const words = (value: unknown) => String(value ?? '—').replaceAll('_', ' ');
const fmt = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 5 });
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `${path} failed with ${response.status}`);
  return JSON.parse(body) as T;
}

function isSMC2000(signal: Signal) {
  const source = `${signal.platform ?? ''} ${signal.source ?? ''}`.toUpperCase();
  const stream = String(signal.stream ?? '').toLowerCase();
  return String(signal.engine ?? '').toUpperCase() === 'FXGA_SMC2000'
    && (source.includes('MT5') || source.includes('METATRADER'))
    && (!stream || stream === MT5_STREAM || stream === SCANNER_STREAM || stream.includes('smc2000'));
}

function isBrokerWide(signal: Signal) {
  return String(signal.stream ?? '').toLowerCase() === SCANNER_STREAM
    || String(signal.scannerMode ?? '').toUpperCase() === 'BROKER_WIDE'
    || String(signal.scannerScope ?? '').toUpperCase() === 'ALL_BROKER_SYMBOLS';
}

function canonicalScore(signal: Signal) {
  const direct = numeric(signal.methodScore);
  const intelligence = numeric(signal.intelligence?.score);
  return direct ?? intelligence ?? 0;
}

function hierarchyValue(signal: Signal, key: 'h4' | 'm15' | 'm1') {
  const hierarchy = record(signal.timeframeHierarchy);
  const at = record(hierarchy.at_signal);
  const current = record(hierarchy.current);
  const aliases = key === 'h4' ? ['h4_major', 'h4'] : key === 'm15' ? ['m15_confirmation', 'm15'] : ['m1_execution', 'm1'];
  for (const alias of aliases) {
    const value = current[alias] ?? at[alias] ?? hierarchy[alias];
    if (typeof value === 'string' && value) return value;
  }
  return '—';
}

function deriveArchetype(detail: SignalDetail | null, selected?: Signal | null): Archetype {
  const directId = numeric(selected?.archetypeId);
  const directCode = text(selected?.archetypeCode);
  const directName = text(selected?.archetypeName);
  if (!detail) {
    return {
      id: directId == null ? null : Math.trunc(directId),
      code: directCode || (directId ? `S${String(Math.trunc(directId)).padStart(2, '0')}` : 'S01–S50'),
      name: directName || 'FXGA SMC2000 archetype',
    };
  }
  const event = detail.events.find((row) => row.event === 'SIGNAL_NEW') ?? detail.events[detail.events.length - 1];
  const payload = record(event?.payload);
  const id = numeric(payload.archetype_id) ?? directId;
  const code = text(payload.archetype_code) || directCode || (id ? `S${String(Math.trunc(id)).padStart(2, '0')}` : 'S01–S50');
  const name = text(payload.archetype_name) || directName || 'FXGA SMC2000 archetype';
  return { id: id == null ? null : Math.trunc(id), code, name };
}

function signalPayload(detail: SignalDetail | null) {
  if (!detail) return {};
  const event = detail.events.find((row) => row.event === 'SIGNAL_NEW') ?? detail.events[detail.events.length - 1];
  return record(event?.payload);
}

function ScoreRing({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(100, Math.round(score)));
  return <div className="smc-score-ring" style={{ '--smc-score': `${safe}%` } as CSSProperties}><div><strong>{safe}</strong><span>/100</span></div></div>;
}

function SignalCard({ signal, active, onClick }: { signal: Signal; active: boolean; onClick: () => void }) {
  const score = canonicalScore(signal);
  const status = String(signal.status || signal.lastEvent || 'PENDING_ENTRY');
  const code = signal.archetypeCode || (signal.archetypeId ? `S${String(Math.trunc(signal.archetypeId)).padStart(2, '0')}` : signal.methodCode || `M${signal.methodId ?? '—'}`);
  return (
    <button className={`smc-signal-card ${signal.side.toLowerCase()} ${active ? 'selected' : ''}`} onClick={onClick}>
      <div className="smc-card-head">
        <span className={`smc-side ${signal.side.toLowerCase()}`}>{signal.side}</span>
        <div><strong>{signal.symbol}</strong><small>{signal.timeframe || 'M1 execution'} · {code}{isBrokerWide(signal) ? ' · BROKER SCAN' : ''}</small></div>
        <time>{age(signal.updatedAt || signal.signalTime)}</time>
      </div>
      <div className="smc-card-meta"><span>{words(status)}</span><span>{signal.archetypeName || signal.methodFamily || 'SMC2000'}</span></div>
      <div className="smc-card-score"><span>{signal.intelligence?.label || 'Indicator signal'}</span><strong>{Math.round(score)}</strong></div>
      <div className="smc-card-bar"><i style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div>
    </button>
  );
}

function BrokerScannerCard({ signal, onClick }: { signal: Signal; onClick: () => void }) {
  const code = signal.archetypeCode || (signal.archetypeId ? `S${String(Math.trunc(signal.archetypeId)).padStart(2, '0')}` : 'S—');
  const score = canonicalScore(signal);
  return <button className={`smc-broker-scan-card ${signal.side.toLowerCase()}`} onClick={onClick}>
    <div className="smc-broker-scan-top"><span className={`smc-side ${signal.side.toLowerCase()}`}>{signal.side}</span><strong>{signal.symbol}</strong><time>{age(signal.updatedAt || signal.signalTime)}</time></div>
    <div className="smc-broker-scan-code"><strong>{code}</strong><span>{signal.archetypeName || 'SMC2000 setup'}</span></div>
    <div className="smc-broker-scan-meta"><span>{signal.brokerSymbol || signal.symbol}</span><span>M{signal.methodId ?? '—'}</span><b>{Math.round(score)}</b></div>
  </button>;
}

export function SMC2000IndicatorSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<SignalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState('');
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<FilterSide>('ALL');
  const [status, setStatus] = useState<FilterStatus>('ALL');
  const [source, setSource] = useState<FilterSource>('ALL');
  const [symbol, setSymbol] = useState('ALL');

  const load = async () => {
    setLoading(true);
    try {
      const [live, history] = await Promise.all([
        getJson<SignalList>('/api/tradingview/signals/live?limit=250'),
        getJson<SignalList>('/api/tradingview/signals?limit=500'),
      ]);
      const merged = new Map<string, Signal>();
      [...live.signals, ...history.signals].filter(isSMC2000).forEach((row) => {
        const current = merged.get(row.id);
        if (!current || Date.parse(row.updatedAt || '') > Date.parse(current.updatedAt || '')) merged.set(row.id, row);
      });
      const next = [...merged.values()].sort((a, b) => Date.parse(b.updatedAt || b.signalTime || '') - Date.parse(a.updatedAt || a.signalTime || ''));
      setSignals(next);
      setSelectedId((current) => current && next.some((row) => row.id === current) ? current : next[0]?.id || '');
      setLastSync(new Date().toISOString());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'FXGA SMC2000 signal feed is unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    void getJson<SignalDetail>(`/api/tradingview/signals/${selectedId}`)
      .then((value) => { if (!cancelled) setDetail(value); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const scannerSignals = useMemo(() => signals.filter(isBrokerWide), [signals]);
  const chartSignals = useMemo(() => signals.filter((row) => !isBrokerWide(row)), [signals]);
  const symbols = useMemo(() => ['ALL', ...new Set(signals.map((row) => row.symbol).filter(Boolean))], [signals]);

  const scannerStats = useMemo(() => {
    const setupSymbols = new Set(scannerSignals.map((row) => row.symbol).filter(Boolean));
    const archetypes = new Set(scannerSignals.map((row) => row.archetypeId).filter((value) => value != null));
    const universe = Math.max(0, ...scannerSignals.map((row) => numeric(row.scannerUniverseTotal) ?? 0));
    const available = Math.max(0, ...scannerSignals.map((row) => numeric(row.scannerAvailableTotal) ?? 0));
    const broker = scannerSignals.find((row) => row.brokerCompany)?.brokerCompany || 'Connected MT5 broker';
    const server = scannerSignals.find((row) => row.brokerServer)?.brokerServer || '';
    return { setupSymbols: setupSymbols.size, archetypes: archetypes.size, universe, available, broker, server };
  }, [scannerSignals]);

  const visible = useMemo(() => signals.filter((row) => {
    if (source === 'BROKER_WIDE' && !isBrokerWide(row)) return false;
    if (source === 'CHART' && isBrokerWide(row)) return false;
    if (symbol !== 'ALL' && row.symbol !== symbol) return false;
    if (side !== 'ALL' && row.side !== side) return false;
    const rowStatus = String(row.status || row.lastEvent || '').toUpperCase();
    if (status === 'ACTIVE' && !ACTIVE.has(rowStatus)) return false;
    if (status === 'COMPLETED' && rowStatus !== 'COMPLETED' && row.lastEvent !== 'TP3_HIT') return false;
    if (status === 'INVALIDATED' && rowStatus !== 'CANCELLED' && row.lastEvent !== 'INVALIDATED') return false;
    const q = query.trim().toLowerCase();
    if (q && !`${row.symbol} ${row.brokerSymbol ?? ''} ${row.archetypeCode ?? ''} ${row.archetypeName ?? ''} ${row.methodCode ?? ''} ${row.methodId ?? ''} ${row.methodFamily ?? ''} ${row.side} ${row.status ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  }), [signals, source, symbol, side, status, query]);

  const stats = useMemo(() => {
    const active = signals.filter((row) => ACTIVE.has(String(row.status || '').toUpperCase())).length;
    const buys = signals.filter((row) => row.side === 'BUY').length;
    const sells = signals.filter((row) => row.side === 'SELL').length;
    const scores = signals.map(canonicalScore).filter((value) => value > 0);
    const avg = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
    const methods = new Set(signals.map((row) => row.methodId).filter((value) => value != null)).size;
    return { active, buys, sells, averageScore: avg, methods };
  }, [signals]);

  const selected = signals.find((row) => row.id === selectedId) ?? null;
  const archetype = deriveArchetype(detail, selected);
  const raw = signalPayload(detail);
  const rawSignal = record(raw.signal);
  const rawHierarchy = record(raw.timeframe_hierarchy);
  const rawMethod = record(raw.smc_method);
  const rawEvidence = record(raw.evidence);
  const rawValidation = record(raw.validation);
  const plan: TradePlan = selected?.tradePlan ?? {};
  const score = numeric(rawSignal.score) ?? (selected ? canonicalScore(selected) : 0);
  const directionalEdge = numeric(rawSignal.directional_edge);
  const independentCategories = numeric(rawSignal.independent_categories);
  const hierarchy = {
    h4: text(rawHierarchy.h4) || (selected ? hierarchyValue(selected, 'h4') : '—'),
    m15: text(rawHierarchy.m15) || (selected ? hierarchyValue(selected, 'm15') : '—'),
    m1: text(rawHierarchy.m1) || (selected ? hierarchyValue(selected, 'm1') : '—'),
    aligned: typeof rawHierarchy.fully_aligned === 'boolean' ? rawHierarchy.fully_aligned : false,
    mode: text(rawHierarchy.trade_mode) || words(selected?.tradePlan?.tradeMode),
  };
  const evidenceRows = Object.entries(rawEvidence).filter(([, value]) => typeof value === 'boolean');

  return (
    <div className="smc2000-workspace">
      <section className="smc-hero">
        <div>
          <span className="eyebrow">MetaTrader 5 · FXGA SMC2000 · Google Cloud Live</span>
          <h2>FXGA SMC2000 Setups</h2>
          <p>Live S01–S50 setups from both the attached-chart engine and the dedicated broker-wide scanner. The broker-wide stream scans every symbol exposed by the connected MT5 broker and publishes only setups that pass the existing SMC2000 validation and false-signal firewall.</p>
          <div className="smc-health"><i className={error ? 'offline' : 'online'}></i><strong>{error ? 'Feed degraded' : 'Signal feed online'}</strong><span>{lastSync ? `last synchronized ${age(lastSync)}` : 'connecting'}</span></div>
        </div>
        <div className="smc-architecture">
          <span>50</span><strong>Signal archetypes</strong><small>S01 → S50 · all broker symbols</small>
          <b>H4</b><i></i><b>M15</b><i></i><b>M1</b><i></i><b>Cloud</b>
        </div>
      </section>

      <section className="smc-kpis">
        <div><span>Stored signals</span><strong>{signals.length}</strong><small>Chart + broker-wide streams</small></div>
        <div><span>Active setups</span><strong>{stats.active}</strong><small>Pending or filled</small></div>
        <div><span>BUY / SELL</span><strong>{stats.buys} / {stats.sells}</strong><small>Directional distribution</small></div>
        <div><span>Average score</span><strong>{stats.averageScore ? Math.round(stats.averageScore) : '—'}</strong><small>Available source scores</small></div>
        <div><span>Methods observed</span><strong>{stats.methods}</strong><small>of 2,000 SMC methods</small></div>
      </section>

      <section className="smc-broker-scanner-section">
        <div className="smc-broker-scanner-head">
          <div><span className="eyebrow">Dedicated section · {SCANNER_STREAM}</span><h3>Broker-Wide Multi-Asset SMC Scanner</h3><p>All accepted S01–S50 setups discovered across the complete symbol universe exposed by the connected MT5 broker. Multiple valid archetypes on the same symbol remain separate setup records.</p></div>
          <div className="smc-broker-scanner-state"><i className={error ? 'offline' : 'online'}></i><strong>{scannerSignals.length ? 'Scanner receiving setups' : 'Waiting for first accepted setup'}</strong><span>{scannerStats.broker}{scannerStats.server ? ` · ${scannerStats.server}` : ''}</span></div>
        </div>
        <div className="smc-broker-scanner-kpis">
          <div><span>Broker universe</span><strong>{scannerStats.universe || '—'}</strong><small>symbols enumerated by MT5</small></div>
          <div><span>Available / selected</span><strong>{scannerStats.available || scannerStats.universe || '—'}</strong><small>symbols eligible for scanning</small></div>
          <div><span>Symbols with setups</span><strong>{scannerStats.setupSymbols}</strong><small>accepted setups observed</small></div>
          <div><span>Accepted setup records</span><strong>{scannerSignals.length}</strong><small>not collapsed by archetype</small></div>
          <div><span>Archetypes observed</span><strong>{scannerStats.archetypes}</strong><small>of 50 evaluated per asset</small></div>
        </div>
        {scannerSignals.length ? <div className="smc-broker-scan-grid">{scannerSignals.slice(0, 80).map((row) => <BrokerScannerCard key={row.id} signal={row} onClick={() => setSelectedId(row.id)} />)}</div> : <div className="smc-broker-scanner-empty"><strong>Scanner stream is ready.</strong><span>No broker-wide setup has passed the full SMC2000 acceptance rules yet. This section will populate automatically as the EA scans the broker's symbols.</span></div>}
      </section>

      <section className="smc-toolbar">
        <div className="smc-filter-group"><label>Source<select value={source} onChange={(event) => setSource(event.target.value as FilterSource)}><option value="ALL">ALL</option><option value="BROKER_WIDE">BROKER WIDE</option><option value="CHART">CHART</option></select></label><label>Symbol<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{symbols.map((item) => <option key={item}>{item}</option>)}</select></label><label>Side<select value={side} onChange={(event) => setSide(event.target.value as FilterSide)}><option>ALL</option><option>BUY</option><option>SELL</option></select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as FilterStatus)}><option>ALL</option><option>ACTIVE</option><option>COMPLETED</option><option>INVALIDATED</option></select></label></div>
        <div className="smc-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search broker symbol, setup, method…" /><button onClick={() => void load()} disabled={loading}>{loading ? 'Syncing…' : 'Refresh feed'}</button></div>
      </section>

      {error && <div className="smc-error">{error}</div>}
      {loading && !signals.length && <div className="smc-empty">Connecting to the FXGA SMC2000 signal collection…</div>}
      {!loading && !signals.length && !error && <div className="smc-empty"><strong>Connection is ready.</strong><span>No accepted S01–S50 signal has been stored yet.</span></div>}

      {!!signals.length && <section className="smc-main-grid">
        <div className="smc-feed-panel">
          <div className="smc-panel-head"><div><span className="eyebrow">Chart + broker-wide</span><h3>Complete setup feed</h3></div><span>{visible.length} records · {scannerSignals.length} scanner · {chartSignals.length} chart</span></div>
          <div className="smc-feed-list">{visible.map((row) => <SignalCard key={row.id} signal={row} active={row.id === selectedId} onClick={() => setSelectedId(row.id)} />)}{!visible.length && <div className="smc-mini-empty">No SMC2000 setups match the current filters.</div>}</div>
        </div>

        <div className="smc-detail-panel">
          {!selected ? <div className="smc-empty">Select an FXGA SMC2000 setup.</div> : <>
            <div className="smc-detail-head">
              <div className="smc-detail-title"><span className={`smc-side ${selected.side.toLowerCase()}`}>{selected.side}</span><div><span className="eyebrow">{archetype.code} · {archetype.name}</span><h3>{selected.symbol} · {selected.methodCode || `M${selected.methodId ?? '—'}`}</h3><p>{isBrokerWide(selected) ? `Broker-wide scan · ${selected.brokerSymbol || selected.symbol}` : 'Attached-chart engine'} · {selected.intelligence?.label || words(selected.lastEvent || selected.status)}</p></div></div>
              <ScoreRing score={score} />
            </div>

            {detailLoading && <div className="smc-detail-loading">Loading complete setup evidence…</div>}

            <div className="smc-hierarchy">
              <div><span>H4 Direction</span><strong>{words(hierarchy.h4)}</strong></div>
              <i></i><div><span>M15 Confirmation</span><strong>{words(hierarchy.m15)}</strong></div>
              <i></i><div><span>M1 Execution</span><strong>{words(hierarchy.m1)}</strong></div>
              <div className={hierarchy.aligned ? 'aligned' : 'mixed'}><span>Hierarchy</span><strong>{hierarchy.aligned ? 'ALIGNED' : 'MIXED'}</strong><small>{words(hierarchy.mode)}</small></div>
            </div>

            <div className="smc-trade-plan">
              <div><span>Entry</span><strong>{fmt(plan.entry)}</strong></div>
              <div><span>Stop</span><strong>{fmt(plan.stopLoss)}</strong></div>
              <div><span>TP1</span><strong>{fmt(plan.tp1)}</strong></div>
              <div><span>TP2</span><strong>{fmt(plan.tp2)}</strong></div>
              <div><span>TP3 / DOL</span><strong>{fmt(plan.tp3)}</strong></div>
              <div><span>RR TP3</span><strong>{selected.riskReward?.rrTp3 == null ? '—' : `${selected.riskReward.rrTp3.toFixed(2)}R`}</strong></div>
            </div>

            <div className="smc-analysis-grid">
              <article><span>Archetype</span><strong>{archetype.code}</strong><p>{archetype.name}</p></article>
              <article><span>SMC method</span><strong>{text(rawMethod.code) || selected.methodCode || `M${selected.methodId ?? '—'}`}</strong><p>{text(rawMethod.family) || selected.methodFamily || 'FXGA SMC2000 method family'}</p></article>
              <article><span>Directional edge</span><strong>{directionalEdge == null ? '—' : directionalEdge.toFixed(1)}</strong><p>{independentCategories == null ? 'Independent evidence pending' : `${Math.trunc(independentCategories)} independent evidence categories`}</p></article>
              <article><span>Source</span><strong>{isBrokerWide(selected) ? 'BROKER WIDE' : 'CHART'}</strong><p>{selected.brokerCompany || 'MetaTrader 5'} · {selected.brokerSymbol || selected.symbol}</p></article>
            </div>

            <div className="smc-evidence-panel">
              <div className="smc-panel-head"><div><span className="eyebrow">False-signal firewall</span><h3>Evidence at signal</h3></div><span>{evidenceRows.filter(([, value]) => value === true).length}/{evidenceRows.length || '—'} active</span></div>
              {evidenceRows.length ? <div className="smc-evidence-grid">{evidenceRows.map(([key, value]) => <span key={key} className={value ? 'on' : 'off'}><i></i>{words(key)}</span>)}</div> : <div className="smc-mini-empty">Detailed evidence becomes available from the raw S01–S50 event payload.</div>}
            </div>

            <div className="smc-validation-grid">
              <article><span>Validation</span><p>{text(rawValidation.rule) || 'Validation rule is stored with the originating SMC2000 signal event.'}</p></article>
              <article><span>Invalidation</span><p>{text(rawValidation.invalidation) || selected.lastMeaning || 'Structural invalidation is monitored by the indicator lifecycle.'}</p></article>
              <article><span>False-signal filter</span><p>{text(rawValidation.false_signal_filter) || 'Central FXGA false-signal firewall applied before publication.'}</p></article>
            </div>

            <div className="smc-event-log">
              <div className="smc-panel-head"><div><span className="eyebrow">Google Cloud lifecycle</span><h3>Setup events</h3></div><span>{detail?.events.length ?? selected.lifecycle?.barsSinceSignal ?? 0}</span></div>
              <div>{detail?.events?.length ? [...detail.events].reverse().map((event) => <div key={event.id}><i></i><strong>{words(event.event)}</strong><span>{new Date(event.receivedAt).toLocaleString()}</span></div>) : <div className="smc-mini-empty">Awaiting event history.</div>}</div>
            </div>
          </>}
        </div>
      </section>}

      <section className="smc-contract-strip"><div><strong>S01–S50</strong><span>50 detection archetypes per broker asset</span></div><div><strong>M0001–M2000</strong><span>2,000 SMC method combinations</span></div><div><strong>H4 → M15 → M1</strong><span>Direction · confirmation · execution</span></div><div><strong>Broker-wide → Cloud</strong><span>Every accepted setup stored independently</span></div></section>
    </div>
  );
}
