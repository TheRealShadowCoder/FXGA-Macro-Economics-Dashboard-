import { DurableObject } from 'cloudflare:workers';
import { acquireSource, getBrowserBudgetStatus } from './acquisition/engine';
import { ACQUISITION_SOURCES, getAcquisitionSource } from './acquisition/registry';
import { buildMacroAnalysis } from './analysis/macro';
import { getCalendarSourceStatus } from './providers/scraped-calendar';
import { bootstrapScheduler, getReleaseSnapshots, getSchedulerView, processSchedulerAlarm, syncCalendarSchedule } from './scheduler';
import type { CalendarEvent, Env, MacroObservation } from './types';

const COLLECTOR_CALENDAR_KEY = 'external-collector:calendar';
const COLLECTOR_BASELINE_KEY = 'external-collector:baseline';
const COLLECTOR_META_KEY = 'external-collector:meta';
const COLLECTOR_REPLAY_KEY = 'external-collector:recent-request-ids';

export class FxgaCoordinator extends DurableObject<Env> {
  private inflight = new Map<string, Promise<unknown>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private broadcast(payload: unknown) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(message); } catch { /* stale connection */ }
      }
    }
  }

  private externalMode() {
    return this.env.COLLECTOR_MODE === 'external-webhook';
  }

  private async acquire(sourceId: string) {
    const source = getAcquisitionSource(sourceId);
    if (!source) throw new Error('Unknown acquisition source');
    const existing = this.inflight.get(sourceId);
    if (existing) return existing;

    const task = acquireSource(this.env, this.ctx.storage, source)
      .then((document) => {
        this.broadcast({ type: 'source-update', sourceId,
          fetchedAt: (document as { fetchedAt?: string }).fetchedAt ?? new Date().toISOString(),
          changed: (document as { changed?: boolean }).changed ?? true });
        return document;
      })
      .finally(() => this.inflight.delete(sourceId));
    this.inflight.set(sourceId, task);
    return task;
  }

  private async externalStateView() {
    const calendar = await this.ctx.storage.get<Record<string, any>>(COLLECTOR_CALENDAR_KEY);
    const baseline = await this.ctx.storage.get<Record<string, any>>(COLLECTOR_BASELINE_KEY);
    const meta = await this.ctx.storage.get<Record<string, any>>(COLLECTOR_META_KEY);
    const events = Array.isArray(calendar?.events) ? calendar.events as CalendarEvent[] : [];
    const now = Date.now();
    const upcoming = events.filter((event) => Date.parse(event.date) >= now).slice(0, 200).map((event) => ({ event, releaseAt: event.date }));
    const active = events.filter((event) => Math.abs(Date.parse(event.date) - now) <= 10 * 60_000).map((event) => ({ event, releaseAt: event.date }));
    const recent = events.filter((event) => Date.parse(event.date) < now && Date.parse(event.date) >= now - 6 * 60 * 60_000)
      .slice(-80).map((event) => ({ event, releaseAt: event.date }));
    const nextReleaseAt = upcoming[0]?.event?.date ?? null;
    return {
      initialized: Boolean(calendar?.events?.length),
      mode: 'external-cloud-run-webhook',
      calendarSources: ['Myfxbook', 'FXStreet', 'CNBC'],
      calendarSyncedAt: calendar?.generatedAt ?? meta?.lastWebhookAt ?? null,
      nextCalendarSyncAt: null,
      nextReleaseAt,
      nextAlarmAt: null,
      active,
      upcoming,
      recent,
      baseline: baseline ?? null,
      stats: {
        upstreamCalendarRequestsFromCloudflare: 0,
        upstreamFredRequestsFromCloudflare: 0,
        externalWebhookUpdates: meta?.updates ?? 0,
      },
      calendarSourceStatus: calendar?.sourceHealth ? { sources: calendar.sourceHealth, mergedEvents: events.length } : null,
      externalCollector: meta ?? null,
    };
  }

  private async schedulerView(bootstrap = false) {
    if (this.externalMode()) return this.externalStateView();
    let scheduler = await getSchedulerView(this.env, this.ctx.storage, bootstrap);
    let calendarSourceStatus = await getCalendarSourceStatus(this.ctx.storage);
    if (bootstrap && scheduler.initialized && !calendarSourceStatus) {
      try { await syncCalendarSchedule(this.env, this.ctx.storage); } catch { /* source status is persisted even when all sources fail */ }
      scheduler = await getSchedulerView(this.env, this.ctx.storage, false);
      calendarSourceStatus = await getCalendarSourceStatus(this.ctx.storage);
    }
    return { ...scheduler, calendarSourceStatus };
  }

  private async rememberRequestId(requestId: string) {
    const recent = (await this.ctx.storage.get<string[]>(COLLECTOR_REPLAY_KEY)) ?? [];
    if (recent.includes(requestId)) return false;
    await this.ctx.storage.put(COLLECTOR_REPLAY_KEY, [...recent, requestId].slice(-500));
    return true;
  }

  private normalizeObservations(input: any[]): MacroObservation[] {
    return input.filter((item) => item && typeof item.seriesId === 'string').map((item) => ({
      seriesId: item.seriesId,
      title: item.title ?? item.seriesId,
      value: typeof item.value === 'number' ? item.value : null,
      date: typeof item.date === 'string' ? item.date : null,
      previous: typeof item.previous === 'number' ? item.previous : null,
      change: typeof item.change === 'number' ? item.change : null,
      units: item.units ?? '', frequency: item.frequency ?? '', categories: Array.isArray(item.categories) ? item.categories : [],
      history: Array.isArray(item.history) ? item.history.filter((row: any) => row && typeof row.date === 'string' && typeof row.value === 'number') : [],
    }));
  }

  private async applyCollectorWebhook(requestId: string, envelope: Record<string, any>) {
    if (!(await this.rememberRequestId(requestId))) return { duplicate: true };
    const type = String(envelope.type ?? '');
    const payload = envelope.payload as Record<string, any>;
    let changedEvents = 0;

    if (type === 'calendar-snapshot') {
      if (!Array.isArray(payload.events)) throw new Error('calendar-snapshot is missing events');
      await this.ctx.storage.put(COLLECTOR_CALENDAR_KEY, payload);
    } else if (type === 'release-delta') {
      const existing = (await this.ctx.storage.get<Record<string, any>>(COLLECTOR_CALENDAR_KEY)) ?? { events: [] };
      const incoming = Array.isArray(payload.events) ? payload.events as CalendarEvent[] : [];
      const byId = new Map<string, CalendarEvent>((existing.events ?? []).map((event: CalendarEvent) => [event.id, event]));
      for (const event of incoming) {
        if (!event?.id) continue;
        byId.set(event.id, { ...(byId.get(event.id) ?? {}), ...event } as CalendarEvent);
        changedEvents += 1;
        const historyKey = `external-release:${event.id}`;
        const history = (await this.ctx.storage.get<any[]>(historyKey)) ?? [];
        await this.ctx.storage.put(historyKey, [...history, { capturedAt: envelope.generatedAt ?? new Date().toISOString(), event }].slice(-20));
      }
      await this.ctx.storage.put(COLLECTOR_CALENDAR_KEY, { ...existing, generatedAt: envelope.generatedAt ?? new Date().toISOString(), events: [...byId.values()] });
    } else if (type === 'macro-snapshot') {
      const observations = this.normalizeObservations(Array.isArray(payload.observations) ? payload.observations : []);
      if (!observations.length) throw new Error('macro-snapshot is missing observations');
      await this.ctx.storage.put(COLLECTOR_BASELINE_KEY, {
        generatedAt: payload.generatedAt ?? envelope.generatedAt ?? new Date().toISOString(),
        observations,
        analysis: buildMacroAnalysis(observations),
        importantOnly: true,
      });
    } else {
      throw new Error(`Unsupported collector webhook type: ${type}`);
    }

    const previousMeta = (await this.ctx.storage.get<Record<string, any>>(COLLECTOR_META_KEY)) ?? {};
    const meta = { ...previousMeta, lastWebhookAt: new Date().toISOString(), lastType: type,
      lastRequestId: requestId, updates: Number(previousMeta.updates ?? 0) + 1 };
    await this.ctx.storage.put(COLLECTOR_META_KEY, meta);
    const view = await this.externalStateView();
    this.broadcast({ type: 'external-collector-update', updateType: type, timestamp: meta.lastWebhookAt, changedEvents,
      nextReleaseAt: view.nextReleaseAt, active: view.active, recent: view.recent });
    return { accepted: true, type, changedEvents, state: view };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ connectedAt: Date.now() });
      server.send(JSON.stringify({ type: 'connected', channel: 'fxga-macro-live', timestamp: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/collector/webhook' && request.method === 'POST') {
      if (request.headers.get('X-FXGA-Verified') !== '1') return Response.json({ error: 'Unverified internal collector request' }, { status: 403 });
      const requestId = request.headers.get('X-FXGA-Request-Id')?.trim() ?? '';
      try { return Response.json(await this.applyCollectorWebhook(requestId, await request.json() as Record<string, any>)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Collector update failed' }, { status: 400 }); }
    }

    if (url.pathname === '/collector/state') return Response.json(await this.externalStateView());

    if (url.pathname === '/status') {
      const browserBudget = await getBrowserBudgetStatus(this.ctx.storage, this.env);
      const scheduler = await this.schedulerView(false);
      return Response.json({ websocketClients: this.ctx.getWebSockets().length, inFlightSources: this.inflight.size,
        browserBudget, sources: ACQUISITION_SOURCES.length, scheduler, calendarSourceStatus: scheduler.calendarSourceStatus,
        collectorMode: this.externalMode() ? 'external-webhook' : 'cloudflare-native' });
    }

    if (url.pathname === '/scheduler/state') {
      const shouldBootstrap = url.searchParams.get('bootstrap') === '1';
      try { return Response.json(await this.schedulerView(shouldBootstrap)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Scheduler state failed' }, { status: 502 }); }
    }

    if (url.pathname === '/scheduler/bootstrap') {
      if (this.externalMode()) return Response.json(await this.externalStateView());
      try {
        const state = await bootstrapScheduler(this.env, this.ctx.storage, url.searchParams.get('force') === '1');
        this.broadcast({ type: 'scheduler-bootstrap', timestamp: new Date().toISOString(), events: state.events.length });
        return Response.json(await this.schedulerView(false));
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Scheduler bootstrap failed' }, { status: 502 }); }
    }

    if (url.pathname === '/scheduler/sync') {
      if (this.externalMode()) return Response.json(await this.externalStateView());
      try {
        const state = await syncCalendarSchedule(this.env, this.ctx.storage);
        const calendarSourceStatus = await getCalendarSourceStatus(this.ctx.storage);
        this.broadcast({ type: 'calendar-synced', timestamp: new Date().toISOString(), events: state.events.length, calendarSourceStatus });
        return Response.json(await this.schedulerView(false));
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Calendar sync failed' }, { status: 502 }); }
    }

    if (url.pathname === '/scheduler/release') {
      const id = url.searchParams.get('id')?.trim() ?? '';
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      if (this.externalMode()) return Response.json({ id, snapshots: (await this.ctx.storage.get<any[]>(`external-release:${id}`)) ?? [] });
      return Response.json({ id, snapshots: await getReleaseSnapshots(this.ctx.storage, id) });
    }

    if (url.pathname === '/acquire') {
      if (this.externalMode()) return Response.json({ error: 'Direct acquisition disabled in external collector mode' }, { status: 409 });
      const sourceId = url.searchParams.get('source')?.trim() ?? '';
      if (!sourceId) return Response.json({ error: 'source is required' }, { status: 400 });
      try { return Response.json(await this.acquire(sourceId)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Acquisition failed' }, { status: 502 }); }
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm() {
    if (this.externalMode()) return;
    const before = await this.schedulerView(false);
    const state = await processSchedulerAlarm(this.env, this.ctx.storage);
    const after = await this.schedulerView(false);
    this.broadcast({ type: 'release-scheduler-update', timestamp: new Date().toISOString(), checks: state.stats.releaseChecks,
      changes: state.stats.releaseChanges, nextReleaseAt: 'nextReleaseAt' in after ? after.nextReleaseAt : null,
      active: 'active' in after ? after.active : [], recent: 'recent' in after ? after.recent : [],
      previousNextReleaseAt: 'nextReleaseAt' in before ? before.nextReleaseAt : null, calendarSourceStatus: after.calendarSourceStatus });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    if (message === 'status') {
      const browserBudget = await getBrowserBudgetStatus(this.ctx.storage, this.env);
      const scheduler = await this.schedulerView(false);
      socket.send(JSON.stringify({ type: 'status', timestamp: new Date().toISOString(), websocketClients: this.ctx.getWebSockets().length, browserBudget, scheduler }));
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) { try { socket.close(code, reason); } catch {} }
  async webSocketError(socket: WebSocket) { try { socket.close(1011, 'WebSocket error'); } catch {} }
}
