// Browser-side routing boundary for the R0 Cloudflare architecture.
// Production uses same-origin /api routes handled by the Cloudflare Worker.
// VITE_FXGA_API_BASE is an optional development/transition override only.
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
const rawBase = String(env.VITE_FXGA_API_BASE || env.VITE_GOOGLE_CLOUD_API_BASE || '')
  .trim()
  .replace(/\/+$/, '');

if (typeof window !== 'undefined') {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const transient = new Set([408, 425, 429, 500, 502, 503, 504]);

  const routeHttp = (value: string) => {
    if (!rawBase) return value;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        return `${rawBase}${url.pathname}${url.search}${url.hash}`;
      }
    } catch { /* Let native fetch validate malformed/non-URL inputs. */ }
    return value;
  };

  const retryableApi = (value: string, init?: RequestInit) => {
    try {
      const url = new URL(value, window.location.origin);
      const method = String(init?.method || 'GET').toUpperCase();
      return method === 'GET' && url.pathname.startsWith('/api/') && (
        url.pathname.startsWith('/api/tradingview/') ||
        url.pathname.startsWith('/api/event-') ||
        url.pathname === '/api/research' ||
        url.pathname === '/api/calendar-history' ||
        url.pathname.startsWith('/api/gemini/')
      );
    } catch { return false; }
  };

  const resilientFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let routed: RequestInfo | URL = input;
    let target = '';
    if (typeof input === 'string' || input instanceof URL) {
      target = routeHttp(String(input));
      routed = target;
    } else if (input instanceof Request) {
      target = routeHttp(input.url);
      routed = target !== input.url ? new Request(target, input) : input;
    }

    const canRetry = retryableApi(target || String(input), init);
    let last: Response | null = null;
    for (let attempt = 0; attempt < (canRetry ? 3 : 1); attempt += 1) {
      try {
        const response = await nativeFetch(routed, init);
        last = response;
        if (!canRetry || !transient.has(response.status) || attempt === 2) return response;
      } catch (error) {
        if (!canRetry || attempt === 2) throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 350 * (2 ** attempt)));
    }
    if (last) return last;
    return nativeFetch(routed, init);
  };

  globalThis.fetch = resilientFetch as typeof fetch;

  // Keep the old socket override only when an explicit external development API is used.
  // Production R0 routing stays same-origin and does not depend on Cloud Run.
  if (rawBase) {
    const NativeWebSocket = globalThis.WebSocket;
    const routeSocket = (value: string | URL) => {
      try {
        const url = new URL(String(value), window.location.origin);
        if (url.host === window.location.host && (url.protocol === 'ws:' || url.protocol === 'wss:') && url.pathname === '/api/live') {
          const target = new URL(rawBase);
          target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
          target.pathname = '/api/live';
          target.search = url.search;
          target.hash = '';
          return target.toString();
        }
      } catch { /* Let native WebSocket validate the value. */ }
      return String(value);
    };

    const RoutedWebSocket = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
      return protocols === undefined
        ? new NativeWebSocket(routeSocket(url))
        : new NativeWebSocket(routeSocket(url), protocols);
    } as unknown as typeof WebSocket;

    RoutedWebSocket.prototype = NativeWebSocket.prototype;
    Object.defineProperties(RoutedWebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING },
      OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING },
      CLOSED: { value: NativeWebSocket.CLOSED },
    });
    globalThis.WebSocket = RoutedWebSocket;
  }

  console.info(rawBase
    ? `FXGA R0 browser routing active with development API override ${new URL(rawBase).origin}`
    : `FXGA R0 browser routing active: static assets and API are same-origin at ${window.location.origin}`
  );
}
