// Browser-side routing boundary for the Cloudflare-hosted SPA.
// Cloudflare only serves static files. Every /api request and live socket is sent
// directly from the user's browser to the public Google Cloud Run application.
const rawBase = String(
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLOUD_API_BASE || ''
).trim().replace(/\/+$/, '');

if (typeof window !== 'undefined' && rawBase) {
  const apiOrigin = new URL(rawBase).origin;
  const nativeFetch = globalThis.fetch.bind(globalThis);

  const routeHttp = (value: string) => {
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        return `${rawBase}${url.pathname}${url.search}${url.hash}`;
      }
    } catch { /* Leave malformed/non-URL inputs to native fetch. */ }
    return value;
  };

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' || input instanceof URL) {
      return nativeFetch(routeHttp(String(input)), init);
    }
    if (input instanceof Request) {
      const routed = routeHttp(input.url);
      if (routed !== input.url) return nativeFetch(new Request(routed, input), init);
    }
    return nativeFetch(input, init);
  }) as typeof fetch;

  const NativeWebSocket = globalThis.WebSocket;
  const routeSocket = (value: string | URL) => {
    try {
      const url = new URL(String(value), window.location.origin);
      if (url.origin === window.location.origin && url.pathname === '/api/live') {
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

  console.info(`FXGA browser routing active: static host ${window.location.origin}; Google Cloud API ${apiOrigin}`);
}
