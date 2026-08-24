import { useEffect, useMemo, useState } from 'react';
import { getGeminiAnalysis, getGeminiHealth, type GeminiAnalysis, type GeminiHealth, type GeminiMode } from '../lib/gemini-client';
import './GeminiIntelligenceDock.css';

const MODES: Array<{ mode: Exclude<GeminiMode, 'smc-signal'>; label: string; description: string }> = [
  { mode: 'market-brief', label: 'Market', description: 'Cross-asset prices and technical alignment' },
  { mode: 'macro-brief', label: 'Macro', description: 'Growth, inflation, labour, rates and conditions' },
  { mode: 'economic-context', label: 'Economies', description: 'Economic regime and cross-economy context' },
  { mode: 'event-research', label: 'Event research', description: 'Release studies, OOS validation and research maturity' },
  { mode: 'action-report', label: 'Action report', description: 'Current evidence behind WAIT / WATCH / PREPARE states' },
];

function formatTime(value?: string) {
  if (!value) return '—';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function GeminiIntelligenceDock() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<GeminiHealth | null>(null);
  const [mode, setMode] = useState<Exclude<GeminiMode, 'smc-signal'>>('action-report');
  const [analysis, setAnalysis] = useState<GeminiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getGeminiHealth(controller.signal).then(setHealth).catch(() => setHealth(null));
    return () => controller.abort();
  }, []);

  const selected = useMemo(() => MODES.find(item => item.mode === mode) ?? MODES[0], [mode]);

  async function run(nextMode = mode) {
    setMode(nextMode);
    setLoading(true);
    setError('');
    try {
      const result = await getGeminiAnalysis(nextMode);
      setAnalysis(result);
    } catch (caught) {
      setAnalysis(null);
      setError(caught instanceof Error ? caught.message : 'Gemini analysis failed');
    } finally {
      setLoading(false);
    }
  }

  return <div className={`gemini-dock ${open ? 'open' : ''}`}>
    <button className="gemini-dock-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="gemini-spark">✦</span>
      <span>Gemini AI</span>
      <i className={health?.configured ? 'online' : 'offline'}></i>
    </button>

    {open && <section className="gemini-dock-panel" aria-label="FXGA Gemini intelligence">
      <header>
        <div><small>FXGA · Google Gemini</small><h3>Evidence Intelligence</h3></div>
        <button onClick={() => setOpen(false)} aria-label="Close Gemini panel">×</button>
      </header>

      <div className="gemini-status">
        <i className={health?.configured ? 'online' : 'offline'}></i>
        <span>{health?.configured ? `${health.model} connected` : 'Gemini waiting for server configuration'}</span>
      </div>

      <div className="gemini-mode-grid">
        {MODES.map(item => <button key={item.mode} className={mode === item.mode ? 'active' : ''} onClick={() => void run(item.mode)} disabled={loading || health?.configured === false}>
          <strong>{item.label}</strong><small>{item.description}</small>
        </button>)}
      </div>

      <div className="gemini-output">
        {loading && <div className="gemini-loading"><span></span><p>Reading FXGA evidence and generating explanation…</p></div>}
        {!loading && error && <div className="gemini-error">{error}</div>}
        {!loading && !error && !analysis && <div className="gemini-empty"><strong>{selected.label}</strong><p>Select an intelligence mode. Gemini receives structured FXGA evidence from Google Cloud; it does not receive the API key from your browser and does not create trading signals.</p></div>}
        {!loading && analysis && <>
          <div className="gemini-output-meta"><span>{analysis.label}</span><span>{analysis.model}</span><span>{analysis.cached ? 'cached' : 'fresh'}</span><span>{formatTime(analysis.createdAt)}</span></div>
          <div className="gemini-output-text">{analysis.output}</div>
          <footer>{analysis.policy}</footer>
        </>}
      </div>
    </section>}
  </div>;
}
