import { launch } from '@cloudflare/playwright';
import { extractDocument } from './extract';
import { getAcquisitionSource } from './registry';
import type { Env } from '../types';

const DAILY_SOFT_CAP_SECONDS = 480;
const RESERVATION_SECONDS = 45;
const MIN_LAUNCH_GAP_MS = 22_000;
const CACHE_VERSION = 'v4';
const DOCUMENT_TTL_MS = 6 * 60 * 60 * 1000;
const FXSTREET_PAYLOAD_TIMEOUT_MS = 2_500;
const GENERIC_SETTLE_MS = 2_500;

export interface RenderedCalendarDocument {
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  browserUsed: true;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  embeddedJson: Array<{ kind: string; value: unknown }>;
  dataAttributes: Array<{ attribute: string; value: string }>;
  tables: string[][][];
  contentHash: string;
  extraction: {
    textCharacters: number;
    links: number;
    embeddedPayloads: number;
    dataAttributes: number;
    tables: number;
  };
  warnings: string[];
  networkTrace: Array<{ url: string; status: number; contentType: string }>;
  fetchDurationMs: number;
}

interface StoredDocument {
  expiresAt: number;
  document: RenderedCalendarDocument;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function documentKey(sourceId: string) {
  return `calendar-browser:${CACHE_VERSION}:${sourceId}`;
}

function debugKey(sourceId: string) {
  return `calendar-browser-debug:${sourceId}`;
}

function closestYearDate(month: number, day: number, hour: number, minute: number) {
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((candidateYear) => new Date(Date.UTC(candidateYear, month, day, hour, minute)));
  candidates.sort((a, b) => Math.abs(a.getTime() - now) - Math.abs(b.getTime() - now));
  return candidates[0];
}

function parseFxstreetRenderedText(text: string) {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const events: Array<Record<string, unknown>> = [];
  let month = -1;
  let day = -1;

  for (const rawBlock of text.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;

    const heading = block.match(/^(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+([A-Z]+)\s+(\d{1,2})$/i);
    if (heading) {
      month = months.indexOf(heading[1].toLowerCase());
      day = Number(heading[2]);
      continue;
    }
    if (month < 0 || day < 1) continue;

    const tokens = block
      .split(/[\t\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (tokens.length < 3) continue;

    const timeIndex = tokens.findIndex((value) => /^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(value));
    if (timeIndex < 0) continue;
    const currency = tokens[timeIndex + 1];
    const name = tokens[timeIndex + 2];
    if (!/^[A-Z]{3}$/.test(currency ?? '') || !name) continue;

    const time = tokens[timeIndex].match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!time) continue;
    let hour = Number(time[1]);
    const minute = Number(time[2]);
    const period = time[3].toUpperCase();
    if (period === 'AM' && hour === 12) hour = 0;
    else if (period === 'PM' && hour !== 12) hour += 12;
    const date = closestYearDate(month, day, hour, minute);

    const values = tokens.slice(timeIndex + 3);
    const actual = values[0] && values[0] !== '-' ? values[0] : undefined;
    const deviation = values[1] && values[1] !== '-' ? values[1] : undefined;
    const consensus = values[2] && values[2] !== '-' ? values[2] : undefined;
    const previous = values[3] && values[3] !== '-' ? values[3] : undefined;

    events.push({
      dateUtc: date.toISOString(),
      name,
      currency,
      actual,
      deviation,
      consensus,
      previous,
      impact: 1,
      source: 'FXStreet rendered calendar',
    });
  }

  return events;
}

async function cachedDocument(storage: DurableObjectStorage, sourceId: string) {
  const stored = await storage.get<StoredDocument>(documentKey(sourceId));
  if (!stored || stored.expiresAt <= Date.now()) return null;
  return stored.document;
}

async function reserveBrowser(storage: DurableObjectStorage, env: Env) {
  const now = Date.now();
  const activeUntil = (await storage.get<number>('browser:active-until')) ?? 0;
  if (activeUntil > now) return { allowed: false, reason: 'A browser acquisition is already active.' };

  const lastStart = (await storage.get<number>('browser:last-start')) ?? 0;
  if (now - lastStart < MIN_LAUNCH_GAP_MS) return { allowed: false, reason: 'Browser launch-rate guard is active.' };

  const configured = Number(env.BROWSER_SOFT_BUDGET_SECONDS || DAILY_SOFT_CAP_SECONDS);
  const limit = Math.min(Math.max(configured, 60), DAILY_SOFT_CAP_SECONDS);
  const usageKey = `browser:used:${dayKey()}`;
  const used = (await storage.get<number>(usageKey)) ?? 0;
  if (used + RESERVATION_SECONDS > limit) return { allowed: false, reason: `Daily Browser Run safety budget reached (${used.toFixed(1)}/${limit}s).` };

  await storage.put({
    [usageKey]: used + RESERVATION_SECONDS,
    'browser:last-start': now,
    'browser:active-until': now + 55_000,
  });
  return { allowed: true, usageKey, used };
}

async function settleBrowser(storage: DurableObjectStorage, usageKey: string, usedBefore: number, elapsedSeconds: number) {
  await storage.put({
    [usageKey]: usedBefore + Math.min(elapsedSeconds, RESERVATION_SECONDS),
    'browser:active-until': 0,
  });
}

function shouldTrace(url: string) {
  return /fxstreet|myfxbook|calendar|economic|event|widget/i.test(url);
}

function shouldCaptureJson(url: string, contentType: string) {
  return contentType.toLowerCase().includes('json') && shouldTrace(url);
}

function isFxstreetCalendarPayload(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'calendar-api.fxsstatic.com' && /\/eventDates\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isNonessentialRequest(url: string, resourceType: string) {
  if (['image', 'font', 'media'].includes(resourceType)) return true;
  return /doubleclick|google-analytics|googletagmanager|facebook\.net|tiktok\.com|taboola|adservice|securepubads/i.test(url);
}

async function renderPage(
  browser: Awaited<ReturnType<typeof launch>>,
  sourceId: string,
): Promise<RenderedCalendarDocument> {
  const source = getAcquisitionSource(sourceId);
  if (!source) throw new Error(`Unknown calendar browser source: ${sourceId}`);

  const startedAt = Date.now();
  const page = await browser.newPage();
  const captured: Array<{ kind: string; value: unknown }> = [];
  const networkTrace: Array<{ url: string; status: number; contentType: string }> = [];
  const captures: Promise<void>[] = [];
  let resolveFxstreetPayload: (() => void) | null = null;
  const fxstreetPayloadReady = new Promise<void>((resolve) => { resolveFxstreetPayload = resolve; });

  if (sourceId === 'fxstreet-calendar') {
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (isNonessentialRequest(request.url(), request.resourceType())) await route.abort();
      else await route.continue();
    });
  }

  page.on('response', (response) => {
    const task = (async () => {
      try {
        const headers = response.headers();
        const contentType = headers['content-type'] ?? '';
        const url = response.url();
        if (shouldTrace(url) && networkTrace.length < 80) {
          networkTrace.push({ url: url.slice(0, 500), status: response.status(), contentType: contentType.slice(0, 120) });
        }
        if (captured.length >= 30 || !response.ok() || !shouldCaptureJson(url, contentType)) return;
        const value = await response.json();
        const serialized = JSON.stringify(value);
        if (serialized.length > 1_000_000) return;
        captured.push({ kind: `network-json:${new URL(url).hostname}`, value });
        if (isFxstreetCalendarPayload(url)) resolveFxstreetPayload?.();
      } catch {
        // Ignore non-JSON, inaccessible, or already-consumed responses.
      }
    })();
    captures.push(task);
  });

  try {
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (sourceId === 'fxstreet-calendar') {
      await Promise.race([
        fxstreetPayloadReady,
        page.waitForTimeout(FXSTREET_PAYLOAD_TIMEOUT_MS),
      ]);
      await page.waitForTimeout(150);
    } else {
      await page.waitForTimeout(GENERIC_SETTLE_MS);
    }
    await Promise.allSettled(captures);

    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const extracted = await extractDocument(html.slice(0, 2_000_000), source.url, bodyText.slice(0, 150_000));
    const renderedEvents = sourceId === 'fxstreet-calendar' ? parseFxstreetRenderedText(extracted.text) : [];
    const embeddedJson = [
      ...extracted.embeddedJson,
      ...(renderedEvents.length ? [{ kind: 'fxstreet-rendered-text-events', value: renderedEvents }] : []),
      ...captured,
    ];

    return {
      sourceId,
      sourceUrl: source.url,
      fetchedAt: new Date().toISOString(),
      browserUsed: true,
      ...extracted,
      embeddedJson,
      extraction: {
        ...extracted.extraction,
        embeddedPayloads: embeddedJson.length,
      },
      warnings: [],
      networkTrace,
      fetchDurationMs: Date.now() - startedAt,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function persistDebug(storage: DurableObjectStorage, sourceId: string, document: RenderedCalendarDocument | null, error?: unknown) {
  await storage.put(debugKey(sourceId), document ? {
    fetchedAt: document.fetchedAt,
    title: document.title.slice(0, 300),
    textPreview: document.text.slice(0, 1200),
    textCharacters: document.extraction.textCharacters,
    tables: document.extraction.tables,
    embeddedPayloads: document.extraction.embeddedPayloads,
    embeddedKinds: document.embeddedJson.map((payload) => payload.kind).slice(0, 30),
    renderedEventCount: document.embeddedJson.find((payload) => payload.kind === 'fxstreet-rendered-text-events' && Array.isArray(payload.value))
      ? (document.embeddedJson.find((payload) => payload.kind === 'fxstreet-rendered-text-events')!.value as unknown[]).length
      : 0,
    networkTrace: document.networkTrace.slice(0, 60),
    fetchDurationMs: document.fetchDurationMs,
  } : {
    fetchedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message.slice(0, 800) : String(error ?? 'Browser render unavailable').slice(0, 800),
  });
}

export async function getCalendarBrowserDebug(storage: DurableObjectStorage, sourceId: string) {
  return (await storage.get<Record<string, unknown>>(debugKey(sourceId))) ?? null;
}

export async function renderCalendarSourcesShared(
  env: Env,
  storage: DurableObjectStorage,
  sourceIds: string[],
) {
  const result: Record<string, RenderedCalendarDocument | null> = {};
  const missing: string[] = [];

  for (const sourceId of sourceIds) {
    const cached = await cachedDocument(storage, sourceId);
    if (cached) {
      result[sourceId] = cached;
      await persistDebug(storage, sourceId, cached);
    } else missing.push(sourceId);
  }
  if (!missing.length) return result;

  const reservation = await reserveBrowser(storage, env);
  if (!reservation.allowed || !reservation.usageKey || reservation.used === undefined) {
    for (const sourceId of missing) {
      result[sourceId] = null;
      await persistDebug(storage, sourceId, null, reservation.reason);
    }
    return result;
  }

  const startedAt = Date.now();
  let browser: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    browser = await launch(env.BROWSER);
    for (const sourceId of missing) {
      try {
        const document = await renderPage(browser, sourceId);
        result[sourceId] = document;
        await storage.put(documentKey(sourceId), {
          expiresAt: Date.now() + DOCUMENT_TTL_MS,
          document,
        } satisfies StoredDocument);
        await persistDebug(storage, sourceId, document);
      } catch (error) {
        result[sourceId] = null;
        await persistDebug(storage, sourceId, null, error);
      }
    }
    return result;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await settleBrowser(storage, reservation.usageKey, reservation.used, (Date.now() - startedAt) / 1000);
  }
}
