import { useEffect, useMemo, useState } from 'react';
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

function ErrorCard({ value }: { value: FriendlyFxgaError }) {
  return <div className="gemini-error-card">
    <strong>{value.title}</strong>
    <p>{value.explanation}</p>
    <small><b>What to do:</b> {value.whatToDo}</small>
    <small><b>Retry:</b> {value.retryable ? 'Yes, this can usually be tried again.' : 'No. Fix the input/configuration or wait for the stated quota reset.'}</small>
    {value.retryAfterSeconds != null && <small><b>Retry after:</b> about {value.retryAfterSeconds} seconds</small>}
    <code>{value.code}{value.technical?.httpStatus ? ` · HTTP ${value.technical.httpStatus}` : ''}</code>
    <a href="/fxga-error-guide.html" target="_blank" rel="noreferrer">Open the full FXGA error guide ↗</a>
  </div>;
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
  const [error, setError] = useState<FriendlyFxgaError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getGeminiHealth(controller.signal).catch(() => null),
      getIntelligenceHealth(controller.signal).catch(() => null),
      getPromptRegistry(controller.signal).catch(() => null),
    ]).then(([baseHealth, extendedHealth, promptRegistry]) => {
      setHealth(baseHealth);
      setIntelligenceHealth(extendedHealth);
      setRegistry(promptRegistry);
    });
    return () => controller.abort();
  }, []);

  const selected = useMemo(() => MODES.find(item => item.mode === mode) ?? MODES[0], [mode]);
  const configured = health?.configured ?? intelligenceHealth?.configured ?? false;

  async function run(nextMode = mode) {
    setMode(nextMode);
    setLoading(true);
    setError(null);
    try {
      const result = await getGeminiAnalysis(nextMode);
      setAnalysis(result);
    } catch (caught) {
      setAnalysis(null);
      setError(friendlyErrorFromThrown(caught));
    } finally { setLoading(false); }
  }

  async function ask() {
    const clean = question.trim();
    if (!clean) return;
    setChatLoading(true);
    setError(null);
    try {
      const result = await askFxga(clean, task === 'auto' ? {} : { task });
      setChat(result);
    } catch (caught) {
      setChat(null);
      setError(friendlyErrorFromThrown(caught));
    } finally { setChatLoading(false); }
  }

  return <div className={`gemini-dock ${open ? 'open' : ''}`}>
    <button className="gemini-dock-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="gemini-spark">✦</span><span>Ask FXGA AI</span><i className={configured ? 'online' : 'offline'}></i>
    </button>

    {open && <section className="gemini-dock-panel" aria-label="FXGA Gemini intelligence">
      <header>
        <div><small>FXGA · Google Gemini</small><h3>Evidence Intelligence</h3></div>
        <button onClick={() => setOpen(false)} aria-label="Close Gemini panel">×</button>
      </header>

      <div className="gemini-status">
        <i className={configured ? 'online' : 'offline'}></i>
        <span>{configured ? `${intelligenceHealth?.model || health?.model || 'Gemini'} connected · ${intelligenceHealth?.promptCount || registry?.prompts.length || 0} task prompts · no FXGA hourly/daily cap` : 'Gemini waiting for server configuration'}</span>
      </div>

      <div className="gemini-chatbox">
        <div className="gemini-chat-head"><strong>Ask anything about the program</strong><a href="/fxga-intelligence-live.html" target="_blank" rel="noreferrer">Open live intelligence ↗</a></div>
        <textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void ask(); }} placeholder="Examples: Where is the strongest measured edge? Why was this setup invalidated? What does the macro regime mean? What is wrong with the data? Forecast the current chart scenarios…" />
        <div className="gemini-chat-actions">
          <select value={task} onChange={event => setTask(event.target.value as 'auto' | FxgaPromptTask)} aria-label="FXGA AI task">
            <option value="auto">Auto-select best advanced prompt</option>
            {registry?.prompts.filter(item => item.id !== 'live-intelligence-report').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button onClick={() => void ask()} disabled={chatLoading || !configured || !question.trim()}>{chatLoading ? 'Analyzing…' : 'Ask FXGA'}</button>
        </div>
        {chat && <div className="gemini-chat-answer">
          <div className="gemini-output-meta"><span>{chat.label}</span><span>{chat.model}</span><span>{chat.cached ? 'cached' : 'fresh'}</span><span>{formatTime(chat.createdAt)}</span></div>
          <div className="gemini-output-text">{chat.answer}</div>
          <footer>Evidence: {chat.evidenceDomains.join(' · ')} · {chat.policy}</footer>
        </div>}
      </div>

      <div className="gemini-mode-title"><strong>One-click intelligence</strong><small>Specialized evidence summaries</small></div>
      <div className="gemini-mode-grid">
        {MODES.map(item => <button key={item.mode} className={mode === item.mode ? 'active' : ''} onClick={() => void run(item.mode)} disabled={loading || !configured}>
          <strong>{item.label}</strong><small>{item.description}</small>
        </button>)}
      </div>

      {error && <ErrorCard value={error} />}

      <div className="gemini-output">
        {loading && <div className="gemini-loading"><span></span><p>Reading FXGA evidence and generating explanation…</p></div>}
        {!loading && !error && !analysis && <div className="gemini-empty"><strong>{selected.label}</strong><p>Select a one-click intelligence mode, or ask the chatbot anything about the program. The AI receives structured FXGA evidence from Google Cloud and never receives the API key from your browser.</p></div>}
        {!loading && analysis && <>
          <div className="gemini-output-meta"><span>{analysis.label}</span><span>{analysis.model}</span><span>{analysis.cached ? 'cached' : 'fresh'}</span><span>{formatTime(analysis.createdAt)}</span></div>
          <div className="gemini-output-text">{analysis.output}</div>
          <footer>{analysis.policy}</footer>
        </>}
      </div>
    </section>}
  </div>;
}
