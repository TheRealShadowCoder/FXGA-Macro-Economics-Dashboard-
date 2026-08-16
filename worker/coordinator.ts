import { DurableObject } from 'cloudflare:workers';
import { acquireSource, getBrowserBudgetStatus } from './acquisition/engine';
import { ACQUISITION_SOURCES, getAcquisitionSource } from './acquisition/registry';
import { getCalendarSourceStatus } from './providers/scraped-calendar';
import { bootstrapScheduler, getReleaseSnapshots, getSchedulerView, processSchedulerAlarm, syncCalendarSchedule } from './scheduler';
import type { Env } from './types';

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

  private async acquire(sourceId: string) {
    const source = getAcquisitionSource(sourceId);
    if (!source) throw new Error('Unknown acquisition source');
    const existing = this.inflight.get(sourceId);
    if (existing) return existing;

    const task = acquireSource(this.env, this.ctx.storage, source)
      .then((document) => {
        this.broadcast({
          type: 'source-update',
          sourceId,
          fetchedAt: (document as { fetchedAt?: string }).fetchedAt ?? new Date().toISOString(),
          changed: (document as { changed?: boolean }).changed ?? true,
        });
        return document;
      })
      .finally(() => this.inflight.delete(sourceId));
    this.inflight.set(sourceId, task);
    return task;
  }

  private async schedulerView(bootstrap = false) {
    let scheduler = await getSchedulerView(this.env, this.ctx.storage, bootstrap);
    let calendarSourceStatus = await getCalendarSourceStatus(this.ctx.storage);

    // Older v2 scheduler state may predate per-source status persistence. Bootstrap
    // requests perform one safe resync to initialize that metadata, then normal reads
    // return to the event-driven/no-polling path.
    if (bootstrap && scheduler.initialized && !calendarSourceStatus) {
      try { await syncCalendarSchedule(this.env, this.ctx.storage); } catch { /* source status is persisted even when all sources fail */ }
      scheduler = await getSchedulerView(this.env, this.ctx.storage, false);
      calendarSourceStatus = await getCalendarSourceStatus(this.ctx.storage);
    }

    return { ...scheduler, calendarSourceStatus };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ connectedAt: Date.now() });
      server.send(JSON.stringify({ type: 'connected', channel: 'fxga-macro-live', timestamp: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/status') {
      const browserBudget = await getBrowserBudgetStatus(this.ctx.storage, this.env);
      const scheduler = await this.schedulerView(false);
      return Response.json({
        websocketClients: this.ctx.getWebSockets().length,
        inFlightSources: this.inflight.size,
        browserBudget,
        sources: ACQUISITION_SOURCES.length,
        scheduler,
        calendarSourceStatus: scheduler.calendarSourceStatus,
      });
    }

    if (url.pathname === '/scheduler/state') {
      const shouldBootstrap = url.searchParams.get('bootstrap') === '1';
      try { return Response.json(await this.schedulerView(shouldBootstrap)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Scheduler state failed' }, { status: 502 }); }
    }

    if (url.pathname === '/scheduler/bootstrap') {
      try {
        const state = await bootstrapScheduler(this.env, this.ctx.storage, url.searchParams.get('force') === '1');
        this.broadcast({ type: 'scheduler-bootstrap', timestamp: new Date().toISOString(), events: state.events.length });
        return Response.json(await this.schedulerView(false));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Scheduler bootstrap failed' }, { status: 502 });
      }
    }

    if (url.pathname === '/scheduler/sync') {
      try {
        const state = await syncCalendarSchedule(this.env, this.ctx.storage);
        const calendarSourceStatus = await getCalendarSourceStatus(this.ctx.storage);
        this.broadcast({ type: 'calendar-synced', timestamp: new Date().toISOString(), events: state.events.length, calendarSourceStatus });
        return Response.json(await this.schedulerView(false));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Calendar sync failed' }, { status: 502 });
      }
    }

    if (url.pathname === '/scheduler/release') {
      const id = url.searchParams.get('id')?.trim() ?? '';
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      return Response.json({ id, snapshots: await getReleaseSnapshots(this.ctx.storage, id) });
    }

    if (url.pathname === '/acquire') {
      const sourceId = url.searchParams.get('source')?.trim() ?? '';
      if (!sourceId) return Response.json({ error: 'source is required' }, { status: 400 });
      try { return Response.json(await this.acquire(sourceId)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Acquisition failed' }, { status: 502 }); }
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm() {
    const before = await this.schedulerView(false);
    const state = await processSchedulerAlarm(this.env, this.ctx.storage);
    const after = await this.schedulerView(false);
    this.broadcast({
      type: 'release-scheduler-update',
      timestamp: new Date().toISOString(),
      checks: state.stats.releaseChecks,
      changes: state.stats.releaseChanges,
      nextReleaseAt: 'nextReleaseAt' in after ? after.nextReleaseAt : null,
      active: 'active' in after ? after.active : [],
      recent: 'recent' in after ? after.recent : [],
      previousNextReleaseAt: 'nextReleaseAt' in before ? before.nextReleaseAt : null,
      calendarSourceStatus: after.calendarSourceStatus,
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    if (message === 'status') {
      const browserBudget = await getBrowserBudgetStatus(this.ctx.storage, this.env);
      const scheduler = await this.schedulerView(false);
      socket.send(JSON.stringify({ type: 'status', timestamp: new Date().toISOString(), websocketClients: this.ctx.getWebSockets().length, browserBudget, scheduler }));
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    try { socket.close(code, reason); } catch { /* runtime may already have completed close handshake */ }
  }

  async webSocketError(socket: WebSocket) {
    try { socket.close(1011, 'WebSocket error'); } catch { /* already closed */ }
  }
}
