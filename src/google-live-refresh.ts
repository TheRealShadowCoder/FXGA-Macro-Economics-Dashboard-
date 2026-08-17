let socket: WebSocket | null = null;
let timer: number | null = null;
let retry = 0;
let stopped = false;
let lastRefresh = 0;

function refreshActiveView() {
  const now = Date.now();
  if (now - lastRefresh < 1200) return;
  lastRefresh = now;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const button = document.querySelector<HTMLButtonElement>('button.refresh');
    if (button && !button.disabled) button.click();
  }, 300);
}

function connect() {
  if (stopped || typeof window === 'undefined') return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/api/live`);
  socket.onopen = () => { retry = 0; };
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as { type?: string; updateType?: string };
      if (payload.type === 'google-cloud-update') refreshActiveView();
    } catch { /* Ignore non-JSON transport messages. */ }
  };
  socket.onerror = () => socket?.close();
  socket.onclose = () => {
    if (stopped) return;
    retry += 1;
    const delay = Math.min(30_000, 2_000 * (2 ** Math.min(retry - 1, 4)));
    window.setTimeout(connect, delay);
  };
}

if (typeof window !== 'undefined') connect();

window.addEventListener('beforeunload', () => {
  stopped = true;
  if (timer !== null) window.clearTimeout(timer);
  socket?.close(1000, 'Page closing');
}, { once: true });
