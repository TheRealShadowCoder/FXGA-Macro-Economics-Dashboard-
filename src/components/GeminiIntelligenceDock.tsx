import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  askFxga,
  getGeminiAnalysis,
  getGeminiHealth,
  getIntelligenceHealth,
  getPromptRegistry,
  type FxgaPromptTask,
  type GeminiAnalysis,
  type GeminiChat,
  type GeminiHealth,
  type GeminiMode,
  type IntelligenceHealth,
  type PromptRegistry,
} from '../lib/gemini-client';
import { friendlyErrorFromThrown, type FriendlyFxgaError } from '../lib/fxga-errors';
import './GeminiIntelligenceDock.css';

const LIVE_TRADE_REFRESH_MS = 15_000;
const HEALTH_RETRY_MS = 20_000;

const MODES: Array<{ mode: Exclude<GeminiMode, 'smc-signal'>; label: string; description: string }> = [
  { mode: 'market-brief', label: 'Market', description: 'Cross-asset prices and technical alignment' },
  { mode: 'macro-brief', label: 'Macro', description: 'Growth, inflation, labour, rates and conditions' },
  { mode: 'economic-context', label: 'Economies', description: 'Economic regime and cross-economy context' },
  { mode: 'event-research', label: 'Event research', description: 'Release studies, OOS validation and research maturity' },
  { mode: 'action-report', label: 'Action report', description: 'Current evidence behind WAIT / WATCH / PREPARE states' },
];

const formatTime = (value?: string) => {
  if (!value) return '—';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : value;
};

function ErrorCard({ value }: { value: FriendlyFxgaError }) {
  return (
    <div className="gemini-error-card">
      <strong>{value.title}</strong>
      <p>{value.explanation}</p>
      <small><b>What to do:</b> {value.whatToDo}</small>
      <small><b>Retry:</b> {value.retryable ? 'Yes, this can usually be tried again.' : 'No. Fix the input/configuration or wait for the stated quota reset.'}</small>
      {value.retryAfterSeconds != null && <small><b>Retry after:</b> about {value.retryAfterSeconds} seconds</small>}
      <code>{value.code}{value.technical?.httpStatus ? ` · HTTP ${value.technical.httpStatus}` : ''}</code>
      <a href="/fxga-error-guide.html" target="_blank" rel="noreferrer">Open the full FXGA error guide ↗</a>
    </div>
  );
}

export function GeminiIntelligenceDock() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<GeminiHealth | null>(null);
  const [intelligenceHealth, setIntelligenceHealth] = useState<IntelligenceHealth | null>(null);
  const [registry, setRegistry] = useState<PromptRegistry | null>(null);
  const [mode, setMode] = useState<Exclude<GeminiMode, 'smc-signal'>>('action-report');
  const [analysis, setAnalysis] = useState<GeminiAnalysis | null>(null);
  const [chat, setChat] = useState<GeminiChat | null>(null);
  const [question, setQuestion] = useState('');
  const [task, setTask] = useState<'auto' | FxgaPromptTask>('auto');
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [healthChecking, setHealthChecking] = useState(true);
  const [healthError, setHealthError] = useState('');
  const [error, setError] = useState<FriendlyFxgaError | null>(null);

  const refreshHealth = useCallback(async (signal?: AbortSignal) => {
    setHealthChecking(true);
    const [healthResult, intelligenceResult, registryResult] = await Promise.allSettled([
      getGeminiHealth(signal),
      getIntelligenceHealth(signal),
      getPromptRegistry(signal),
    ]);

    if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
    if (intelligenceResult.status === 'fulfilled') setIntelligenceHealth(intelligenceResult.value);
    if (registryResult.status === 'fulfilled') setRegistry(registryResult.value);

    const anyHealth = healthResult.status === 'fulfilled' || intelligenceResult.status === 'fulfilled';
    if (!anyHealth) setHealthError('Gemini health endpoint is temporarily unreachable. Questions will still be sent directly to Google Cloud so the server can recover.');
    else setHealthError('');
    setHealthChecking(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshHealth(controller.signal);
    return () => controller.abort();
  }, [refreshHealth]);

  const configured = health?.configured === true || intelligenceHealth?.configured === true;
  const healthKnown = health !== null || intelligenceHealth !== null;
  const selected = useMemo(() => MODES.find((item) => item.mode === mode) ?? MODES[0], [mode]);
  const liveTradeTask = task !== 'auto' && String(task).endsWith('trade-management-live');

  useEffect(() => {
    if (!open || configured) return;
    const timer = window.setInterval(() => void refreshHealth(), HEALTH_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [open, configured, refreshHealth]);

  const promptGroups = useMemo(() => {
    const groups = new Map<string, PromptRegistry['prompts']>();
    for (const item of registry?.prompts ?? []) {
      if (item.id === 'live-intelligence-report') continue;
      const category = item.category || 'other';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(item);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.label.localeCompare(b.label)) }));
  }, [registry]);

  async function run(nextMode = mode) {
    setMode(nextMode);
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await getGeminiAnalysis(nextMode));
      if (!configured) void refreshHealth();
    } catch (caught) {
      setAnalysis(null);
      setError(friendlyErrorFromThrown(caught));
      void refreshHealth();
    } finally {
      setLoading(false);
    }
  }

  async function ask() {
    const clean = question.trim();
    if (!clean || chatLoading) return;
    setChatLoading(true);
    setError(null);
    try {
      setChat(await askFxga(clean, task === 'auto' ? {} : { task }));
      if (!configured) void refreshHealth();
    } catch (caught) {
      setChat(null);
      setError(friendlyErrorFromThrown(caught));
      void refreshHealth();
    } finally {
      setChatLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !liveTradeTask || !question.trim() || chatLoading) return;
    const timer = window.setInterval(() => void ask(), LIVE_TRADE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, liveTradeTask, task, question, chatLoading]);

  const statusText = healthChecking && !healthKnown
    ? 'Checking Google Gemini configuration…'
    : configured
      ? `${intelligenceHealth?.model || health?.model || 'Gemini'} connected · ${intelligenceHealth?.promptCount || registry?.prompts?.length || 0} task prompts · no FXGA hourly/daily cap`
      : healthKnown
        ? 'Gemini credential is not active yet · server recovery is enabled · Ask will retry directly'
        : 'Gemini health unavailable · Ask will retry Google Cloud directly';

  return (
    <div className={`gemini-dock ${open ? 'open' : ''}`}>
      <button className="gemini-dock-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="gemini-spark">✦</span>
        <span>Ask FXGA AI</span>
        <i className={configured ? 'online' : 'offline'}></i>
      </button>

      {open && (
        <section className="gemini-dock-panel" aria-label="FXGA Gemini intelligence">
          <header>
            <div><small>FXGA · Google Gemini</small><h3>Evidence Intelligence</h3></div>
            <button onClick={() => setOpen(false)} aria-label="Close Gemini panel">×</button>
          </header>

          <div className="gemini-status">
            <i className={configured ? 'online' : 'offline'}></i>
            <span>{statusText}</span>
            {!configured && <button type="button" onClick={() => void refreshHealth()} disabled={healthChecking}>{healthChecking ? 'Checking…' : 'Retry'}</button>}
          </div>
          {healthError && <div className="gemini-live-note">{healthError}</div>}

          <div className="gemini-chatbox">
            <div className="gemini-chat-head">
              <strong>Ask anything about the program</strong>
              <a href="/fxga-intelligence-live.html" target="_blank" rel="noreferrer">Open live intelligence ↗</a>
            </div>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void ask(); }}
              placeholder="Examples: What are today's setups? Find a scalp buy entry. Manage this day trade live. Explain the strongest measured evidence and invalidation."
            />
            <div className="gemini-chat-actions">
              <select value={task} onChange={(event) => setTask(event.target.value as 'auto' | FxgaPromptTask)} aria-label="FXGA AI task">
                <option value="auto">Auto-select best advanced prompt</option>
                {promptGroups.map((group) => (
                  <optgroup key={group.category} label={group.category.toUpperCase()}>
                    {group.items.map((item) => <option key={item.id} value={item.id}>{item.label}{item.realtime ? ' · LIVE' : ''}</option>)}
                  </optgroup>
                ))}
              </select>
              <button onClick={() => void ask()} disabled={chatLoading || !question.trim()}>{chatLoading ? 'Analyzing…' : 'Ask FXGA'}</button>
              {liveTradeTask && <small className="gemini-live-note">LIVE · re-checks current evidence every 15 seconds</small>}
            </div>

            {chat && (
              <div className="gemini-chat-answer">
                <div className="gemini-output-meta">
                  <span>{chat.label || 'FXGA intelligence'}</span>
                  <span>{chat.model || 'Gemini'}</span>
                  <span>{chat.cached ? 'cached' : 'fresh'}</span>
                  <span>{formatTime(chat.createdAt)}</span>
                </div>
                <div className="gemini-output-text">{chat.answer || 'Gemini returned no displayable answer.'}</div>
                <footer>Evidence: {(chat.evidenceDomains ?? []).join(' · ') || 'current FXGA evidence'} · {chat.policy || 'Evidence-grounded analysis only.'}</footer>
              </div>
            )}
          </div>

          <div className="gemini-mode-title"><strong>One-click intelligence</strong><small>Specialized evidence summaries</small></div>
          <div className="gemini-mode-grid">
            {MODES.map((item) => (
              <button key={item.mode} className={mode === item.mode ? 'active' : ''} onClick={() => void run(item.mode)} disabled={loading}>
                <strong>{item.label}</strong><small>{item.description}</small>
              </button>
            ))}
          </div>

          {error && <ErrorCard value={error} />}
          <div className="gemini-output">
            {loading && <div className="gemini-loading"><span></span><p>Reading FXGA evidence and generating explanation…</p></div>}
            {!loading && !error && !analysis && <div className="gemini-empty"><strong>{selected.label}</strong><p>Select a one-click intelligence mode, or ask the chatbot anything about the program. The request goes directly to Google Cloud; the Gemini credential never enters the browser.</p></div>}
            {!loading && analysis && (
              <>
                <div className="gemini-output-meta"><span>{analysis.label}</span><span>{analysis.model}</span><span>{analysis.cached ? 'cached' : 'fresh'}</span><span>{formatTime(analysis.createdAt)}</span></div>
                <div className="gemini-output-text">{analysis.output}</div>
                <footer>{analysis.policy}</footer>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
