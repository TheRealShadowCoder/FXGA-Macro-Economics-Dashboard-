import { DurableObject } from 'cloudflare:workers';
import { acquireSource, getBrowserBudgetStatus } from './acquisition/engine';
import { ACQUISITION_SOURCES, getAcquisitionSource } from './acquisition/registry';
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
      server.send(JSON.stringify({
        type: 'connected',
        channel: 'fxga-macro-live',
        timestamp: new Date().toISOString(),
      }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/status') {
      const browserBudget = await getBrowserBudgetStatus(this.ctx.storage, this.env);
      return Response.json({
        websocketClients: this.ctx.getWebSockets().length,
        inFlightSources: this.inflight.size,
        browserBudget,
        sources: ACQUISITION_SOURCES.length,
      });
    }

    if (url.pathname === '/acquire') {
      const sourceId = url.searchParams.get('source')?.trim() ?? '';
      if (!sourceId) return Response.json({ error: 'source is required' }, { status: 400 });
      try {
        const document = await this.acquire(sourceId);
        return Response.json(document);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Acquisition failed' }, { status: 502 });
      }
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    if (message === 'status') {
      const browserBudget = await getBrowserBudgetStatus(this.ctx.storage, this.env);
      socket.send(JSON.stringify({
        type: 'status',
        timestamp: new Date().toISOString(),
        websocketClients: this.ctx.getWebSockets().length,
        browserBudget,
      }));
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    try { socket.close(code, reason); } catch { /* runtime may already have completed close handshake */ }
  }

  async webSocketError(socket: WebSocket) {
    try { socket.close(1011, 'WebSocket error'); } catch { /* already closed */ }
  }
}
