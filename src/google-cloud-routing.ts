// Browser-side routing boundary for the Cloudflare-hosted SPA.
// Cloudflare only serves static files. Every /api request and live socket is sent
// directly from the user's browser to the public Google Cloud Run application.
// Release guard: this source revision includes safe Firestore telemetry, resilient
// Live Signal Intelligence reads, and FRED/CNBC Event Study source provenance.
const rawBase = String(
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLOUD_API_BASE || ''
).trim().replace(/\/+$/, '');

if (typeof window !== 'undefined' && rawBase) {
  const apiOrigin = new URL(rawBase).origin;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const transient = new Set([408, 425, 429, 500, 502, 503, 504]);

  const routeHttp = (value: string) => {
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        return `${rawBase}${url.pathname}${url.search}${url.hash}`;
      }
    } catch { /* Leave malformed/non-URL inputs to native fetch. */ }
    return value;
  };

  const retryableApi = (value: string, init?: RequestInit) => {
    try {
      const url = new URL(value, window.location.origin);
      const method = String(init?.method || 'GET').toUpperCase();
      return method === 'GET' && url.origin === apiOrigin && (
        url.pathname.startsWith('/api/tradingview/') ||
        url.pathname.startsWith('/api/event-') ||
        url.pathname === '/api/research' ||
        url.pathname === '/api/calendar-history'
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
      if (target !== input.url) routed = new Request(target, input);
      else target = input.url;
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

  const NativeWebSocket = globalThis.WebSocket;
  const routeSocket = (value: string | URL) => {
    try {
      const url = new URL(String(value), window.location.origin);
      const sameWebsiteHost = url.host === window.location.host;
      const websocketProtocol = url.protocol === 'ws:' || url.protocol === 'wss:';
      if (sameWebsiteHost && websocketProtocol && url.pathname === '/api/live') {
        const target = new URL(rawBase);
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        target.pathname = '/api/live';
        target.search = url.search;
        target.hash = '';
        return target.toString();
      }
    } catch { /* Let the native constructor validate the value. */ }
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

  console.info(`FXGA browser routing active: static host ${window.location.origin}; Google Cloud API ${apiOrigin}; resilient live-signal/event reads enabled`);
}
