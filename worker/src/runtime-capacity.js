const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});

const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

async function readCounts(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM state_snapshots) AS state_snapshots,
      (SELECT COUNT(*) FROM mt5_batches) AS mt5_batches,
      (SELECT COUNT(*) FROM live_signals) AS live_signals,
      (SELECT COUNT(*) FROM gemini_cache) AS gemini_cache,
      (SELECT COUNT(*) FROM security_events) AS security_events,
      (SELECT COUNT(*) FROM runtime_meta) AS runtime_meta,
      (SELECT MAX(updated_at) FROM state_snapshots) AS state_updated_at,
      (SELECT MAX(received_at) FROM mt5_batches) AS mt5_updated_at,
      (SELECT MAX(updated_at) FROM live_signals) AS signals_updated_at
  `).first();

  return {
    stateSnapshots: finite(row?.state_snapshots),
    mt5Batches: finite(row?.mt5_batches),
    liveSignals: finite(row?.live_signals),
    geminiCacheEntries: finite(row?.gemini_cache),
    securityEvents: finite(row?.security_events),
    runtimeMetaEntries: finite(row?.runtime_meta),
    stateUpdatedAt: row?.state_updated_at || null,
    mt5UpdatedAt: row?.mt5_updated_at || null,
    signalsUpdatedAt: row?.signals_updated_at || null,
  };
}

function legacyMetric() {
  return { used: 0, limit: 0, remaining: 0, percent: 0 };
}

export async function runtimeCapacityResponse(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== 'GET') return null;
  if (path !== '/api/runtime/capacity' && path !== '/api/tradingview/firestore-usage') return null;

  try {
    const counts = await readCounts(env);
    const generatedAt = new Date().toISOString();
    const latest = [counts.stateUpdatedAt, counts.mt5UpdatedAt, counts.signalsUpdatedAt]
      .filter(Boolean)
      .map((value) => Date.parse(value))
      .filter(Number.isFinite);
    const lastDataAt = latest.length ? new Date(Math.max(...latest)).toISOString() : null;

    // This response intentionally retains the previous Firestore-shaped fields
    // so cached pre-R0 frontends receive a valid fallback instead of a 404.
    return json({
      generatedAt,
      metricTimestamp: generatedAt,
      monitoringAvailable: false,
      monitoringMode: 'cloudflare-d1-ledger',
      monitoringNotice: 'Cloudflare D1 is the primary FXGA database. Legacy Firestore quota telemetry is disabled in R0 mode.',
      monitoringDiagnostic: null,
      projectId: 'fxga-cloudflare-r0',
      databaseId: 'fxga-free-db',
      databaseName: 'Cloudflare D1 Free',
      architecture: 'cloudflare-r0',
      runtime: 'Cloudflare Workers + D1',
      status: 'live',
      quotaTimezone: 'UTC',
      quotaDayStart: generatedAt.slice(0, 10),
      storage: { ...legacyMetric(), usedGiB: 0, limitGiB: 0, remainingGiB: 0, growthBytesPerDay: null, projectedDaysRemaining: null },
      reads: legacyMetric(),
      writes: legacyMetric(),
      deletes: legacyMetric(),
      outbound: { limitBytes: 0, limitGiB: 0, usedBytes: null, note: 'Legacy Firestore egress quota is not applicable to the R0 D1 runtime.' },
      signalPipeline: {
        totalEvents: counts.mt5Batches,
        mt5Events: counts.mt5Batches,
        totalSignals: counts.liveSignals,
        mt5Signals: counts.liveSignals,
        estimatedWritesPerAcceptedEvent: 1,
        remainingAcceptedEventsAtCurrentWriteHeadroom: null,
      },
      counts,
      lastDataAt,
      notes: [
        'Primary persistence is Cloudflare D1.',
        'Counts are read directly from the production D1 database.',
        'No Firestore or Google Cloud runtime is required for this ledger.',
      ],
    });
  } catch (error) {
    return json({
      generatedAt: new Date().toISOString(),
      architecture: 'cloudflare-r0',
      status: 'degraded',
      error: 'runtime_capacity_unavailable',
      message: String(error?.message || error),
    }, 503);
  }
}
