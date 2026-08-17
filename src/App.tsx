import { useEffect, useMemo, useRef, useState } from 'react';
import { AcquisitionView } from './components/AcquisitionView';
import { AnalysisView } from './components/AnalysisView';
import { MarketsView } from './components/MarketsView';
import { ResearchView } from './components/ResearchView';
import { MetricCard } from './components/MetricCard';
import { SignalsView } from './components/SignalsView';
import { fetchAcquisitionCatalog, fetchDashboard, fetchFredCatalog, fetchFredCategory, fetchMacroAnalysis, fetchSessionSignals } from './lib/api';
import type {
  AcquisitionCatalogPayload,
  CalendarEvent,
  DashboardPayload,
  FredCatalogPayload,
  MacroAnalysisPayload,
  MacroObservation,
  MarketQuote,
  NewsItem,
  SessionSignalsPayload,
} from './lib/types';

type View = 'overview' | 'markets' | 'analysis' | 'research' | 'signals' | 'calendar' | 'indicators' | 'universe' | 'acquisition' | 'news' | 'sources';
type LiveStatus = 'connecting' | 'connected' | 'offline';

const NAV: Array<{ id: View; label: string }> = [
  { id: 'overview', label: 'Macro Dashboard' },
  { id: 'markets', label: 'Cross Asset Prices' },
  { id: 'analysis', label: 'Macro Analysis' },
  { id: 'research', label: 'Research & Risk' },
  { id: 'signals', label: 'Currency Outlook' },
  { id: 'calendar', label: 'Economic Calendar' },
  { id: 'indicators', label: 'Core Indicators' },
  { id: 'universe', label: 'Macro Data Library' },
  { id: 'acquisition', label: 'Data Operations' },
  { id: 'news', label: 'Central Bank News' },
  { id: 'sources', label: 'Data Coverage' },
];

function importanceLabel(value: number) {
  return value >= 3 ? 'High' : value === 2 ? 'Medium' : 'Low';
}

function outcomeLabel(event: CalendarEvent) {
  if (!event.outcome || event.outcome === 'pending' || event.outcome === 'no-consensus') return null;
  return event.outcome === 'in-line' ? 'In line' : event.outcome === 'beat' ? 'Beat' : 'Miss';
}

function CalendarRow({ event }: { event: CalendarEvent }) {
  const result = outcomeLabel(event);
  const historical = Date.parse(event.date) < Date.now();
  const bias = event.currencyBias;
  const biasTitle = event.currencyBiasReason || (bias ? `${event.currency || 'Base currency'} ${bias}` : '');
  return (
    <div className="calendar-row">
      <div className="event-time">
        <strong>{new Date(event.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
        <span>{new Date(event.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
      </div>
      <div className="event-main">
        <div className="event-title">
          <span className={`impact i${event.importance}`}></span>
          {event.currency ? `${event.currency} · ` : ''}{event.event}
          {bias && <span className={`currency-bias ${bias}`} title={biasTitle}>{event.currency || 'Base'} {bias}</span>}
        </div>
        <div className="event-meta">
          {event.country} · {event.category} · {importanceLabel(event.importance)} · {historical ? 'Historical' : 'Upcoming'}
          {result && <span className={`outcome ${event.outcome}`}> · {result}</span>}
          {event.biasConfidence !== undefined && bias !== 'pending' ? <span> · Bias confidence {event.biasConfidence}%</span> : null}
        </div>
        {event.currencyBiasReason && historical ? <div className="event-analysis-note">{event.currencyBiasReason}</div> : event.analysisNote && <div className="event-analysis-note">{event.analysisNote}</div>}
      </div>
      <div className="event-numbers rich">
        <span><small>Actual</small>{event.actual || '—'}</span>
        <span><small>Dev</small>{event.deviation !== undefined ? event.deviation.toFixed(2) : '—'}</span>
        <span><small>Consensus</small>{event.forecast || '—'}</span>
        <span><small>Previous</small>{event.previous || '—'}</span>
        <span><small>Revision</small>{event.revisionDelta !== undefined ? `${event.revisionDelta > 0 ? '+' : ''}${event.revisionDelta}` : event.revised || '—'}</span>
      </div>
    </div>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <a className="news-row" href={item.link} target="_blank" rel="noreferrer">
      <div>
        <span className="eyebrow">{item.sourceName} · {item.region}</span>
        <h3>{item.title}</h3>
        {item.summary && <p>{item.summary}</p>}
      </div>
      <time>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Latest'}</time>
    </a>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [view, setView] = useState<View>('overview');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const [analysis, setAnalysis] = useState<MacroAnalysisPayload | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  const [signals, setSignals] = useState<SessionSignalsPayload | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState('');

  const [catalog, setCatalog] = useState<FredCatalogPayload | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [universeCategory, setUniverseCategory] = useState('inflation');
  const [universeSeries, setUniverseSeries] = useState<MacroObservation[]>([]);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [universeError, setUniverseError] = useState('');

  const [acquisitionCatalog, setAcquisitionCatalog] = useState<AcquisitionCatalogPayload | null>(null);
  const [acquisitionLoading, setAcquisitionLoading] = useState(false);
  const [acquisitionError, setAcquisitionError] = useState('');
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [lastLiveEvent, setLastLiveEvent] = useState('');
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAttempt = useRef(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try { setData(await fetchDashboard()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load dashboard'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (stopped) return;
      setLiveStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/live`);
      socket.onopen = () => { reconnectAttempt.current = 0; setLiveStatus('connected'); };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; sourceId?: string; fetchedAt?: string; updateType?: string; timestamp?: string };
          if (payload.type === 'source-update' || payload.type === 'google-cloud-update' || payload.type === 'data-update') {
            const source = payload.sourceId || payload.updateType || 'Data network';
            const updatedAt = payload.fetchedAt || payload.timestamp;
            setLastLiveEvent(`${source} updated ${updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'now'}`);
            setAcquisitionCatalog(null);
            setSignals(null);
            setAnalysis(null);
            setCatalog(null);
            setUniverseSeries([]);
            void load();
          }
        } catch { /* Ignore non-JSON WebSocket messages. */ }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setLiveStatus('offline');
        reconnectAttempt.current += 1;
        const delay = Math.min(30_000, 3_000 * (2 ** Math.min(reconnectAttempt.current - 1, 3)));
        reconnectTimer.current = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      socket?.close(1000, 'Page closed');
    };
  }, []);

  useEffect(() => {
    if (view !== 'analysis' || analysis || analysisLoading) return;
    let cancelled = false;
    setAnalysisLoading(true); setAnalysisError('');
    void fetchMacroAnalysis()
      .then((payload) => { if (!cancelled) setAnalysis(payload); })
      .catch((err) => { if (!cancelled) setAnalysisError(err instanceof Error ? err.message : 'Unable to calculate macro analysis'); })
      .finally(() => { if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
  }, [view, analysis]);

  useEffect(() => {
    if (view !== 'signals' || signals || signalsLoading) return;
    let cancelled = false;
    setSignalsLoading(true); setSignalsError('');
    void fetchSessionSignals()
      .then((payload) => { if (!cancelled) setSignals(payload); })
      .catch((err) => { if (!cancelled) setSignalsError(err instanceof Error ? err.message : 'Unable to calculate session signals'); })
      .finally(() => { if (!cancelled) setSignalsLoading(false); });
    return () => { cancelled = true; };
  }, [view, signals]);

  useEffect(() => {
    if (view !== 'universe' || catalog || catalogLoading) return;
    let cancelled = false;
    setCatalogLoading(true); setCatalogError('');
    void fetchFredCatalog()
      .then((payload) => { if (!cancelled) setCatalog(payload); })
      .catch((err) => { if (!cancelled) setCatalogError(err instanceof Error ? err.message : 'Unable to load FRED catalog'); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [view, catalog]);

  useEffect(() => {
    if (view !== 'universe' || !catalog) return;
    let cancelled = false;
    setUniverseLoading(true); setUniverseError('');
    void fetchFredCategory(universeCategory, catalog.maxSeriesPerRequest)
      .then((series) => { if (!cancelled) setUniverseSeries(series); })
      .catch((err) => { if (!cancelled) setUniverseError(err instanceof Error ? err.message : 'Unable to load macro category'); })
      .finally(() => { if (!cancelled) setUniverseLoading(false); });
    return () => { cancelled = true; };
  }, [view, catalog, universeCategory]);

  useEffect(() => {
    if (view !== 'acquisition' || acquisitionCatalog || acquisitionLoading) return;
    let cancelled = false;
    setAcquisitionLoading(true); setAcquisitionError('');
    void fetchAcquisitionCatalog()
      .then((payload) => { if (!cancelled) setAcquisitionCatalog(payload); })
      .catch((err) => { if (!cancelled) setAcquisitionError(err instanceof Error ? err.message : 'Unable to load acquisition engine'); })
      .finally(() => { if (!cancelled) setAcquisitionLoading(false); });
    return () => { cancelled = true; };
  }, [view, acquisitionCatalog]);

  const filteredNews = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data || !q) return data?.news ?? [];
    return data.news.filter((n) => `${n.title} ${n.sourceName} ${n.category}`.toLowerCase().includes(q));
  }, [data, query]);

  const filteredCalendar = useMemo(() => {
    const q = query.trim().toLowerCase();
    const events = data?.calendar ?? [];
    const selected = q ? events.filter((e) => `${e.event} ${e.country} ${e.category} ${e.currency ?? ''} ${e.currencyBias ?? ''}`.toLowerCase().includes(q)) : events;
    return [...selected].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }, [data, query]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    const assets = data?.market ?? [];
    if (!q) return assets;
    return assets.filter((item: MarketQuote) => `${item.id} ${item.symbol} ${item.label} ${item.assetClass ?? ''}`.toLowerCase().includes(q));
  }, [data, query]);

  const filteredUniverse = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return universeSeries;
    return universeSeries.filter((item) => `${item.seriesId} ${item.title} ${item.categories.join(' ')}`.toLowerCase().includes(q));
  }, [universeSeries, query]);

  const calendarHistoryStats = useMemo(() => {
    const now = Date.now();
    const completed = (data?.calendar ?? []).filter((event) => Date.parse(event.date) <= now && event.actual !== undefined && event.actual !== '');
    return {
      completed: completed.length,
      bullish: completed.filter((event) => event.currencyBias === 'bullish').length,
      bearish: completed.filter((event) => event.currencyBias === 'bearish').length,
      neutral: completed.filter((event) => event.currencyBias === 'neutral').length,
    };
  }, [data]);

  const highImpact = data?.calendar.filter((event) => event.importance >= 3 && Date.parse(event.date) >= Date.now()).length ?? 0;
  const liveSources = data?.sources.filter((source) => source.status === 'live').length ?? 0;
  const configuredSources = data?.sources.length ?? 0;
  const activeCategory = catalog?.categories.find((category) => category.id === universeCategory);
  const nextEvents = (data?.calendar ?? []).filter((event) => Date.parse(event.date) >= Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(0, 6);

  const refreshCurrent = () => {
    if (view === 'analysis') setAnalysis(null);
    else if (view === 'signals') setSignals(null);
    else if (view === 'acquisition') setAcquisitionCatalog(null);
    else if (view === 'universe') { setCatalog(null); setUniverseSeries([]); }
    else void load();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"></div><div><strong>FX Global Avengers</strong><span>Trading Academy · Macro Intelligence</span></div></div>
        <nav>{NAV.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span className="nav-dot"></span>{item.label}</button>)}</nav>
        <div className="sidebar-foot"><span className={`system-light ${liveStatus}`}></span><div><strong>Data Network</strong><small>{liveSources}/{configuredSources || '—'} sources available · Live {liveStatus}</small></div></div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">FX Global Avengers Trading Academy</span><h1>{NAV.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions"><span className={`live-pill ${liveStatus}`}>Live {liveStatus}</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search intelligence…" /><button className="refresh" onClick={refreshCurrent} disabled={loading}>{loading ? 'Syncing…' : 'Refresh'}</button></div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {data?.errors.length ? <div className="alert warn">Some collectors need attention: {data.errors.map((item) => `${item.provider}: ${item.message}`).join(' · ')}</div> : null}
        {loading && !data ? <div className="loading-panel">Connecting to macro sources…</div> : null}

        {data && view === 'overview' && (
          <>
            <section className="hero-grid">
              <div className="hero-card"><span className="eyebrow">Global Macro Feed</span><h2>One causal view of growth, inflation, labour, policy and cross-asset risk.</h2><p>Official economic data, release history and cross-asset intelligence are normalized into a consistent decision framework.</p><div className="hero-stats"><div><strong>{data.macro.length}</strong><span>Core indicators</span></div><div><strong>{highImpact}</strong><span>Upcoming high-impact events</span></div><div><strong>{data.market?.filter((item) => item.price != null).length ?? 0}</strong><span>Cross-asset quotes</span></div></div></div>
              <div className="pipeline-card"><span className="eyebrow">Macro Transmission</span>{['Growth', 'Inflation', 'Employment', 'Central Banks', 'Rates & Yields', 'Currencies', 'Risk Assets'].map((step, index) => <div className="pipeline-step" key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></div>)}</div>
            </section>
            <section className="section-head"><div><span className="eyebrow">Live Macro Board</span><h2>Core economic indicators</h2></div></section>
            <section className="metrics-grid">{data.macro.map((item) => <MetricCard key={item.seriesId} item={item} />)}</section>
            <section className="two-col">
              <div className="panel"><div className="panel-title"><div><span className="eyebrow">Next catalysts</span><h2>Economic events</h2></div><button onClick={() => setView('calendar')}>View all</button></div>{nextEvents.length ? nextEvents.map((event) => <CalendarRow key={event.id} event={event} />) : <div className="empty">No upcoming calendar events in the current collection window.</div>}</div>
              <div className="panel"><div className="panel-title"><div><span className="eyebrow">Official feeds</span><h2>Central-bank intelligence</h2></div><button onClick={() => setView('news')}>View all</button></div>{data.news.slice(0, 5).map((item) => <NewsRow key={item.id} item={item} />)}</div>
            </section>
          </>
        )}

        {data && view === 'markets' && <MarketsView assets={filteredMarket} />}
        {view === 'analysis' && <AnalysisView data={analysis} loading={analysisLoading} error={analysisError} />}
        {view === 'research' && <ResearchView />}
        {view === 'signals' && <SignalsView data={signals} loading={signalsLoading} error={signalsError} />}

        {data && view === 'calendar' && (
          <>
            <section className="calendar-history-summary">
              <div className="calendar-history-stat"><strong>{calendarHistoryStats.completed}</strong><span>Completed releases · 7 day window</span></div>
              <div className="calendar-history-stat"><strong>{calendarHistoryStats.bullish}</strong><span>Base currency bullish</span></div>
              <div className="calendar-history-stat"><strong>{calendarHistoryStats.bearish}</strong><span>Base currency bearish</span></div>
              <div className="calendar-history-stat"><strong>{calendarHistoryStats.neutral}</strong><span>Neutral or context sensitive</span></div>
            </section>
            <section className="panel full"><div className="panel-title"><div><span className="eyebrow">Past 7 days + upcoming · Actual · Consensus · Previous · Currency bias</span><h2>Economic calendar and backtest history</h2></div><span>{filteredCalendar.length} events</span></div>{filteredCalendar.length ? filteredCalendar.map((event) => <CalendarRow key={event.id} event={event} />) : <div className="empty">No persisted calendar events are currently available in the selected window.</div>}</section>
          </>
        )}
        {data && view === 'indicators' && <section className="metrics-grid wide">{data.macro.map((item) => <MetricCard key={item.seriesId} item={item} />)}</section>}

        {view === 'universe' && (
          <>
            {catalogError && <div className="alert error">{catalogError}</div>}
            {catalogLoading && !catalog ? <div className="loading-panel">Loading important macro indicators…</div> : null}
            {catalog && <><section className="panel universe-panel"><div className="universe-summary"><div><span className="eyebrow">Decision Relevant Macro Library</span><h2>{catalog.total} important macro series</h2><p>{catalog.policy?.scope}</p></div><div className="catalog-stats"><strong>{catalog.categories.length}</strong><span>macro categories</span><strong>{catalog.maxSeriesPerRequest}</strong><span>max live series/request</span></div></div><div className="category-strip">{catalog.categories.map((category) => <button key={category.id} className={universeCategory === category.id ? 'active' : ''} onClick={() => setUniverseCategory(category.id)}><strong>{category.label}</strong><span>{category.count}</span></button>)}</div></section><section className="section-head universe-heading"><div><span className="eyebrow">{activeCategory?.label}</span><h2>{activeCategory?.description}</h2></div><span>{universeLoading ? 'Syncing live observations…' : `${filteredUniverse.length} important series`}</span></section>{universeError && <div className="alert error">{universeError}</div>}{universeLoading && !universeSeries.length ? <div className="loading-panel">Fetching live macro observations…</div> : null}{!universeLoading && !filteredUniverse.length ? <div className="empty">No important series match this category or search.</div> : null}<section className="metrics-grid wide">{filteredUniverse.map((item) => <MetricCard key={item.seriesId} item={item} />)}</section></>}
          </>
        )}

        {view === 'acquisition' && <AcquisitionView catalog={acquisitionCatalog} loading={acquisitionLoading} error={acquisitionError} liveStatus={liveStatus} lastLiveEvent={lastLiveEvent} />}
        {data && view === 'news' && <section className="panel full"><div className="panel-title"><div><span className="eyebrow">Primary-source intelligence</span><h2>Official releases and speeches</h2></div><span>{filteredNews.length} items</span></div>{filteredNews.map((item) => <NewsRow key={item.id} item={item} />)}</section>}
        {data && view === 'sources' && <section className="source-grid">{data.sources.map((source) => <article className="source-card" key={source.id}><div className="source-status"><span className={`status ${source.status}`}></span>{source.status.replace('_', ' ')}</div><h3>{source.name}</h3><p>{source.category} · {source.region}</p>{source.note && <small>{source.note}</small>}</article>)}</section>}
        <footer>Generated {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'} · FX Global Avengers Trading Academy</footer>
      </main>
    </div>
  );
}
