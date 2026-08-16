import { launch } from '@cloudflare/playwright';
import type { Env } from '../types';
import { extractDocument, hasExpectedMarkers } from './extract';
import type { AcquisitionSource } from './registry';

interface SourceState {
  lastFetchAt?: number;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  failures?: number;
  cooldownUntil?: number;
}

interface BrowserReservation {
  allowed: boolean;
  reservedSeconds: number;
  reason?: string;
  retryAfterSeconds?: number;
}

const USER_AGENT = 'FXGA-Macro-Intelligence/1.0 (+public economic research collector)';
const BROWSER_RESERVATION_SECONDS = 30;
const HARD_BROWSER_SOFT_CAP_SECONDS = 480;
const MIN_BROWSER_LAUNCH_GAP_MS = 22_000;
const ACQUISITION_CACHE_VERSION = 'v2';

function cacheKey(source: AcquisitionSource) {
  return new Request(`https://fxga-cache.internal/acquisition/${ACQUISITION_CACHE_VERSION}/${encodeURIComponent(source.id)}`);
}

function stateKey(source: AcquisitionSource) {
  return `source:${source.id}`;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function retryAfterMs(value: string | null) {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, seconds) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 60_000;
}

async function fetchWithOneRetry(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return fetch(url, init);
  }
}

function parseRobots(text: string, pathname: string) {
  const rules: Array<{ path: string; allow: boolean }> = [];
  let active = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      active = value === '*';
      continue;
    }
    if (!active || (key !== 'allow' && key !== 'disallow') || !value) continue;
    rules.push({ path: value, allow: key === 'allow' });
  }

  const matching = rules
    .filter((rule) => pathname.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length);
  return matching.length ? matching[0].allow : true;
}

async function robotsAllowed(storage: DurableObjectStorage, source: AcquisitionSource) {
  if (source.official) return true;
  const target = new URL(source.url);
  const key = `robots:${target.origin}`;
  const stored = await storage.get<{ expiresAt: number; text: string }>(key);
  let text = stored?.text ?? '';
  if (!stored || stored.expiresAt < Date.now()) {
    const response = await fetch(`${target.origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
    });
    if (response.ok) text = (await response.text()).slice(0, 100_000);
    else if (response.status === 404) text = '';
    else return false;
    await storage.put(key, { expiresAt: Date.now() + 86_400_000, text });
  }
  return parseRobots(text, target.pathname);
}

async function reserveBrowser(storage: DurableObjectStorage, env: Env): Promise<BrowserReservation> {
  const now = Date.now();
  const activeUntil = (await storage.get<number>('browser:active-until')) ?? 0;
  if (activeUntil > now) {
    return { allowed: false, reservedSeconds: 0, reason: 'A browser job is already active.', retryAfterSeconds: Math.ceil((activeUntil - now) / 1000) };
  }

  const lastStart = (await storage.get<number>('browser:last-start')) ?? 0;
  if (now - lastStart < MIN_BROWSER_LAUNCH_GAP_MS) {
    return { allowed: false, reservedSeconds: 0, reason: 'Browser launch rate guard is active.', retryAfterSeconds: Math.ceil((MIN_BROWSER_LAUNCH_GAP_MS - (now - lastStart)) / 1000) };
  }

  const configured = Number(env.BROWSER_SOFT_BUDGET_SECONDS || HARD_BROWSER_SOFT_CAP_SECONDS);
  const limit = Math.min(Math.max(configured, 60), HARD_BROWSER_SOFT_CAP_SECONDS);
  const key = `browser:used:${utcDay()}`;
  const used = (await storage.get<number>(key)) ?? 0;
  if (used + BROWSER_RESERVATION_SECONDS > limit) {
    return { allowed: false, reservedSeconds: 0, reason: `Daily Browser Run safety budget reached (${used.toFixed(1)}/${limit}s).` };
  }

  await storage.put({
    [key]: used + BROWSER_RESERVATION_SECONDS,
    'browser:last-start': now,
    'browser:active-until': now + 35_000,
  });
  return { allowed: true, reservedSeconds: BROWSER_RESERVATION_SECONDS };
}

async function settleBrowser(storage: DurableObjectStorage, reservedSeconds: number, actualSeconds: number) {
  const key = `browser:used:${utcDay()}`;
  const used = (await storage.get<number>(key)) ?? reservedSeconds;
  const adjusted = Math.max(0, used - reservedSeconds + Math.min(actualSeconds, reservedSeconds));
  await storage.put({ [key]: adjusted, 'browser:active-until': 0 });
}

export async function getBrowserBudgetStatus(storage: DurableObjectStorage, env: Env) {
  const configured = Number(env.BROWSER_SOFT_BUDGET_SECONDS || HARD_BROWSER_SOFT_CAP_SECONDS);
  const limit = Math.min(Math.max(configured, 60), HARD_BROWSER_SOFT_CAP_SECONDS);
  const used = (await storage.get<number>(`browser:used:${utcDay()}`)) ?? 0;
  const lastStart = (await storage.get<number>('browser:last-start')) ?? 0;
  return {
    dayUtc: utcDay(),
    usedSeconds: Math.round(used * 10) / 10,
    softLimitSeconds: limit,
    remainingSeconds: Math.max(0, Math.round((limit - used) * 10) / 10),
    browserSessionReuse: false,
    reason: 'Free-plan safety: browser sessions are explicitly closed after each rendered acquisition so idle sessions cannot consume the 10-minute/day allowance.',
    nextLaunchAllowedAt: lastStart ? new Date(lastStart + MIN_BROWSER_LAUNCH_GAP_MS).toISOString() : null,
  };
}

async function renderWithBrowser(env: Env, storage: DurableObjectStorage, source: AcquisitionSource) {
  const reservation = await reserveBrowser(storage, env);
  if (!reservation.allowed) return { rendered: null, warning: reservation.reason, retryAfterSeconds: reservation.retryAfterSeconds };

  const startedAt = Date.now();
  let browser: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    browser = await launch(env.BROWSER);
    const page = await browser.newPage();
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // Economic-calendar widgets continue rendering after DOMContentLoaded. Waiting a
    // bounded source-specific interval makes the browser fallback useful while still
    // staying inside the daily Browser Run safety budget. It is only used on scheduled
    // broad calendar syncs, never for rapid release-window polling.
    const settleMs = source.id === 'fxstreet-calendar' ? 4_000 : source.id === 'myfxbook-calendar' ? 2_500 : 750;
    await page.waitForTimeout(settleMs);

    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const extracted = await extractDocument(html.slice(0, 2_000_000), source.url, bodyText.slice(0, 100_000));
    return { rendered: extracted, warning: null, retryAfterSeconds: null };
  } catch (error) {
    return { rendered: null, warning: error instanceof Error ? `Playwright fallback failed: ${error.message}` : 'Playwright fallback failed.', retryAfterSeconds: null };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* already closed */ }
    }
    await settleBrowser(storage, reservation.reservedSeconds, (Date.now() - startedAt) / 1000);
  }
}

export async function acquireSource(env: Env, storage: DurableObjectStorage, source: AcquisitionSource) {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const key = cacheKey(source);
  const cached = await cache.match(key);
  if (cached) return cached.json();

  const allowed = await robotsAllowed(storage, source);
  if (!allowed) {
    throw new Error(`Collection blocked by robots policy for ${source.name}`);
  }

  const state = (await storage.get<SourceState>(stateKey(source))) ?? {};
  const now = Date.now();
  if (state.cooldownUntil && state.cooldownUntil > now) {
    throw new Error(`Source cooldown active for ${source.name} until ${new Date(state.cooldownUntil).toISOString()}`);
  }
  if (state.lastFetchAt && source.minIntervalSeconds > 0 && now - state.lastFetchAt < source.minIntervalSeconds * 1000) {
    throw new Error(`Source refresh guard active for ${source.name}`);
  }

  const headers = new Headers({
    'User-Agent': USER_AGENT,
    Accept: 'application/json, application/xml, text/xml, application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.5',
  });
  if (state.etag) headers.set('If-None-Match', state.etag);
  if (state.lastModified) headers.set('If-Modified-Since', state.lastModified);

  let response: Response;
  try {
    response = await fetchWithOneRetry(source.url, { headers, redirect: 'follow' });
  } catch (error) {
    const failures = (state.failures ?? 0) + 1;
    const cooldown = Math.min(30 * 60_000, 30_000 * (2 ** Math.min(failures, 5)));
    await storage.put(stateKey(source), { ...state, failures, cooldownUntil: Date.now() + cooldown });
    throw error;
  }

  if (response.status === 304) {
    const stale = await cache.match(key, { ignoreMethod: true });
    if (stale) return stale.json();
  }

  if (response.status === 429 || response.status >= 500) {
    const failures = (state.failures ?? 0) + 1;
    const cooldown = response.status === 429
      ? retryAfterMs(response.headers.get('Retry-After'))
      : Math.min(30 * 60_000, 30_000 * (2 ** Math.min(failures, 5)));
    await storage.put(stateKey(source), { ...state, failures, cooldownUntil: Date.now() + cooldown, lastFetchAt: now });
    throw new Error(`${source.name} returned ${response.status}; cooldown applied.`);
  }
  if (!response.ok) {
    await storage.put(stateKey(source), { ...state, failures: (state.failures ?? 0) + 1, lastFetchAt: now });
    throw new Error(`${source.name} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  const raw = (await response.text()).slice(0, 2_000_000);
  const staticExtraction = await extractDocument(raw, response.url || source.url);
  const markerPass = hasExpectedMarkers(staticExtraction.text, source.expectedMarkers);
  const hasStructuredPayload = staticExtraction.embeddedJson.length > 0 || staticExtraction.tables.length > 0 || staticExtraction.dataAttributes.length > 0;

  let extraction = staticExtraction;
  let browserUsed = false;
  const warnings: string[] = [];
  const methodsUsed = source.methods.filter((method) => method !== 'playwright');

  if (source.allowBrowser && (!markerPass || !hasStructuredPayload)) {
    const browserResult = await renderWithBrowser(env, storage, source);
    if (browserResult.rendered) {
      extraction = browserResult.rendered;
      browserUsed = true;
      methodsUsed.push('playwright');
    } else if (browserResult.warning) {
      warnings.push(browserResult.warning);
    }
  }

  const changed = state.contentHash ? state.contentHash !== extraction.contentHash : true;
  const document = {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    finalUrl: response.url || source.url,
    fetchedAt: new Date().toISOString(),
    contentType,
    official: source.official,
    methodsAvailable: source.methods,
    methodsUsed,
    browserUsed,
    changed,
    warnings,
    ...extraction,
  };

  await storage.put(stateKey(source), {
    lastFetchAt: now,
    etag: response.headers.get('ETag') ?? state.etag,
    lastModified: response.headers.get('Last-Modified') ?? state.lastModified,
    contentHash: extraction.contentHash,
    failures: 0,
    cooldownUntil: 0,
  } satisfies SourceState);

  const cachedResponse = new Response(JSON.stringify(document), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${source.cacheTtlSeconds}`,
    },
  });
  await cache.put(key, cachedResponse.clone());
  return document;
}