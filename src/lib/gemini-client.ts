export type GeminiMode =
  | 'smc-signal'
  | 'market-brief'
  | 'macro-brief'
  | 'economic-context'
  | 'event-research'
  | 'action-report';

export type GeminiHealth = {
  ok: boolean;
  configured: boolean;
  provider: string;
  api: string;
  model: string;
  fallbackModel: string;
  modes: GeminiMode[];
  keyExposedToBrowser: false;
  timestamp: string;
};

export type GeminiAnalysis = {
  schema: 'fxga.gemini.analysis.v1';
  mode: GeminiMode;
  label: string;
  model: string;
  output: string;
  contextHash: string;
  signalId?: string | null;
  createdAt: string;
  cached: boolean;
  policy: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) throw new Error(String(body?.error || `Gemini request failed with HTTP ${response.status}`));
  return body as T;
}

export async function getGeminiHealth(signal?: AbortSignal): Promise<GeminiHealth> {
  const response = await fetch('/api/gemini/health', {
    method: 'GET',
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  return readJson<GeminiHealth>(response);
}

export async function getGeminiAnalysis(mode: GeminiMode, options: { signalId?: string; signal?: AbortSignal } = {}): Promise<GeminiAnalysis> {
  const response = await fetch('/api/gemini/analyze', {
    method: 'POST',
    cache: 'no-store',
    signal: options.signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({ mode, ...(options.signalId ? { signalId: options.signalId } : {}) }),
  });
  return readJson<GeminiAnalysis>(response);
}
