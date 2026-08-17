import { FX_GLOBAL_AVENGERS_LOGO } from './brand';

const replacements: Array<[RegExp, string]> = [
  [/FXGA Google Cloud Ingestion Matrix/gi, 'Institutional Data Operations'],
  [/Google Cloud Sources/gi, 'Primary Data Sources'],
  [/Google Cloud state update/gi, 'data update'],
  [/Google Cloud update/gi, 'data update'],
  [/Google-side feeds/gi, 'source feeds'],
  [/Google source groups/gi, 'source groups'],
  [/Google collection/gi, 'data collection'],
  [/Google Cloud/gi, 'primary infrastructure'],
  [/FXGA 9705/gi, ''],
  [/9705/gi, ''],
  [/FXGA Critical Intelligence Matrix/gi, 'Decision Intelligence'],
  [/FXGA Causal Chain/gi, 'Macro Transmission Chain'],
  [/FXGA macro regime/gi, 'macro regime'],
  [/FXGA decision pipeline/gi, 'decision framework'],
  [/FXGA Macro Intelligence/gi, 'Macro Intelligence'],
  [/Signed Webhook Transport/gi, 'Secure Live Data Channel'],
  [/signed webhooks/gi, 'authenticated live updates'],
  [/webhooks/gi, 'live updates'],
  [/Architecture Contract/gi, 'Operating Controls'],
  [/Cloudflare acquisition/gi, 'edge acquisition'],
  [/Cloudflare browser/gi, 'edge browser collection'],
  [/Cloudflare FRED\/news\/calendar requests/gi, 'edge upstream collection'],
  [/Causal Macro Engine/gi, 'Macro Framework'],
  [/Decision Relevant FRED Set/gi, 'Decision Relevant Macro Library'],
  [/important FRED indicators/gi, 'important macro indicators'],
  [/live FRED observations/gi, 'live macro observations'],
  [/FRED catalog/gi, 'macro data catalog'],
  [/\bWS\s+/g, 'Live '],
];

function clean(value: string) {
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+·/g, ' ·')
    .trim();
}

function sanitize(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    const node = root as Text;
    const original = node.nodeValue ?? '';
    if (!original.trim()) return;
    const next = clean(original);
    if (next !== original.trim()) node.nodeValue = next;
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) sanitize(current);
}

function brand() {
  const mark = document.querySelector<HTMLElement>('.brand-mark');
  if (!mark || mark.dataset.branded === 'true') return;
  mark.dataset.branded = 'true';
  mark.textContent = '';
  const image = document.createElement('img');
  image.src = FX_GLOBAL_AVENGERS_LOGO;
  image.alt = 'FX Global Avengers Trading Academy';
  image.className = 'brand-logo-image';
  image.decoding = 'async';
  mark.appendChild(image);
  const copy = mark.nextElementSibling;
  const strong = copy?.querySelector('strong');
  const small = copy?.querySelector('span');
  if (strong) strong.textContent = 'FX Global Avengers';
  if (small) small.textContent = 'Trading Academy · Macro Intelligence';
}

function accessibility() {
  document.documentElement.dataset.ui = 'institutional';
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach((button) => {
    if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.textContent?.trim() || 'Navigation');
  });
  const search = document.querySelector<HTMLInputElement>('.top-actions input');
  if (search && !search.getAttribute('aria-label')) search.setAttribute('aria-label', 'Search macro intelligence');
}

function finish() { sanitize(document.body); brand(); accessibility(); }
const observer = new MutationObserver((records) => {
  for (const record of records) for (const node of record.addedNodes) sanitize(node);
  brand();
  accessibility();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
queueMicrotask(finish);
window.addEventListener('load', finish, { once: true });
