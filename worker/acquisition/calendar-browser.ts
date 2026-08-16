import { launch } from '@cloudflare/playwright';
import { extractDocument } from './extract';
import { getAcquisitionSource } from './registry';
import type { Env } from '../types';

const DAILY_SOFT_CAP_SECONDS = 480;
const RESERVATION_SECONDS = 45;
const MIN_LAUNCH_GAP_MS = 22_000;
const CACHE_VERSION = 'v2';
const DOCUMENT_TTL_MS = 6 * 60 * 60 * 1000;

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

async function renderPage(
  browser: Awaited<ReturnType<typeof launch>>,
  sourceId: string,
): Promise<RenderedCalendarDocument> {
  const source = getAcquisitionSource(sourceId);
  if (!source) throw new Error(`Unknown calendar browser source: ${sourceId}`);

  const page = await browser.newPage();
  const captured: Array<{ kind: string; value: unknown }> = [];
  const networkTrace: Array<{ url: string; status: number; contentType: string }> = [];
  const captures: Promise<void>[] = [];

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
      } catch {
        // Ignore non-JSON, inaccessible, or already-consumed responses.
      }
    })();
    captures.push(task);
  });

  try {
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const settleMs = sourceId === 'fxstreet-calendar' ? 7_000 : 5_000;
    await page.waitForTimeout(settleMs);
    await Promise.allSettled(captures);

    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const extracted = await extractDocument(html.slice(0, 2_000_000), source.url, bodyText.slice(0, 150_000));
    const embeddedJson = [...extracted.embeddedJson, ...captured];

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
    networkTrace: document.networkTrace.slice(0, 60),
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
