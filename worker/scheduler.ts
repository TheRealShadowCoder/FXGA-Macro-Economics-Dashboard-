import { enrichCalendarWithCalibration, recordReleaseCalibration } from './analysis/calibration';
import { ANALYSIS_SERIES, buildMacroAnalysis } from './analysis/macro';
import { DEFAULT_DASHBOARD_SERIES, getFredInternalSeries } from './providers/fred';
import { getScrapedEconomicCalendar, refreshScrapedReleaseWindow } from './providers/scraped-calendar';
import type { CalendarEvent, Env, MacroObservation } from './types';

const SCHEDULER_KEY = 'scheduler:state:v2';
const BASELINE_KEY = 'macro:baseline:v1';
const SNAPSHOT_PREFIX = 'release:snapshots:';
const CALENDAR_HORIZON_DAYS = 14;
const CALENDAR_REFRESH_MS = 24 * 60 * 60 * 1000;
const BASELINE_REFRESH_GUARD_MS = 30 * 60 * 1000;
const MAX_RECENT_RELEASES = 80;
const MAX_RELEASE_SNAPSHOTS = 12;

export type ReleaseStatus = 'scheduled' | 'monitoring' | 'settled' | 'missed';

export interface ReleaseRuntime {
  id: string;
  event: CalendarEvent;
  releaseAt: number;
  status: ReleaseStatus;
  pollIndex: number;
  nextPollAt: number | null;
  lastCheckedAt?: number;
  lastSignature?: string;
  baselineId?: string;
  actualSeenAt?: number;
  changedAt?: number;
}

export interface SchedulerState {
  version: 2;
  initializedAt: number;
  calendarSyncedAt: number;
  nextCalendarSyncAt: number;
  baselineUpdatedAt?: number;
  lastPostReleaseBaselineRefreshAt?: number;
  events: ReleaseRuntime[];
  recentReleaseIds: string[];
  stats: {
    calendarSyncs: number;
    releaseChecks: number;
    releaseChanges: number;
    baselineRefreshes: number;
  };
}

export interface MacroBaseline {
  id: string;
  generatedAt: string;
  observations: MacroObservation[];
  analysis: ReturnType<typeof buildMacroAnalysis>;
}

function uniqueBaselineSeries() {
  return [...new Set([...ANALYSIS_SERIES, ...DEFAULT_DASHBOARD_SERIES])];
}

function pollOffsetsSeconds(importance: number) {
  if (importance >= 3) return [0, 5, 15, 30, 60, 120, 300];
  if (importance === 2) return [0, 15, 60, 180];
  return [0, 60, 180];
}

function eventSignature(event: CalendarEvent) {
  return JSON.stringify([
    event.date,
    event.actual ?? '',
    event.previous ?? '',
    event.forecast ?? '',
    event.revised ?? '',
    event.deviation ?? '',
    event.lastUpdate ?? '',
    event.source ?? '',
  ]);
}

function nextUtcCalendarSync(now = Date.now()) {
  const date = new Date(now);
  date.setUTCHours(0, 5, 0, 0);
  if (date.getTime() <= now) date.setUTCDate(date.getUTCDate() + 1);
  return date.getTime();
}

function findNextPollAt(runtime: ReleaseRuntime, now: number) {
  const offsets = pollOffsetsSeconds(runtime.event.importance);
  for (let index = runtime.pollIndex + 1; index < offsets.length; index += 1) {
    const candidate = runtime.releaseAt + offsets[index] * 1000;
    if (candidate > now + 250) return { index, at: candidate };
  }
  return null;
}

function runtimeFromCalendar(event: CalendarEvent, previous: ReleaseRuntime | undefined, now: number, baselineId?: string): ReleaseRuntime {
  const releaseAt = Date.parse(event.date);
  const safeReleaseAt = Number.isFinite(releaseAt) ? releaseAt : now;

  if (previous) {
    const moved = Math.abs(previous.releaseAt - safeReleaseAt) > 1000;
    return {
      ...previous,
      event,
      releaseAt: safeReleaseAt,
      baselineId: previous.baselineId ?? baselineId,
      nextPollAt: moved && previous.status === 'scheduled' ? Math.max(safeReleaseAt, now + 1000) : previous.nextPollAt,
      lastSignature: previous.lastSignature ?? eventSignature(event),
    };
  }

  if (event.actual) {
    return {
      id: event.id, event, releaseAt: safeReleaseAt, status: 'settled',
      pollIndex: pollOffsetsSeconds(event.importance).length - 1, nextPollAt: null,
      lastSignature: eventSignature(event), baselineId, actualSeenAt: now,
    };
  }

  const ageMs = now - safeReleaseAt;
  if (ageMs > 10 * 60 * 1000) {
    return {
      id: event.id, event, releaseAt: safeReleaseAt, status: 'missed',
      pollIndex: pollOffsetsSeconds(event.importance).length - 1, nextPollAt: null,
      lastSignature: eventSignature(event), baselineId,
    };
  }

  return {
    id: event.id, event, releaseAt: safeReleaseAt,
    status: safeReleaseAt <= now ? 'monitoring' : 'scheduled',
    pollIndex: -1, nextPollAt: safeReleaseAt <= now ? now + 250 : safeReleaseAt,
    lastSignature: eventSignature(event), baselineId,
  };
}

async function getState(storage: DurableObjectStorage) {
  return (await storage.get<SchedulerState>(SCHEDULER_KEY)) ?? null;
}

async function putState(storage: DurableObjectStorage, state: SchedulerState) {
  await storage.put(SCHEDULER_KEY, state);
}

export async function getBaseline(storage: DurableObjectStorage) {
  return (await storage.get<MacroBaseline>(BASELINE_KEY)) ?? null;
}

export async function refreshMacroBaseline(env: Env, storage: DurableObjectStorage, state?: SchedulerState | null) {
  const observations = await getFredInternalSeries(env, uniqueBaselineSeries());
  const analysis = buildMacroAnalysis(observations);
  const generatedAt = new Date().toISOString();
  const baseline: MacroBaseline = { id: `baseline-${Date.now()}`, generatedAt, observations, analysis };
  await storage.put(BASELINE_KEY, baseline);
  if (state) {
    state.baselineUpdatedAt = Date.now();
    state.stats.baselineRefreshes += 1;
  }
  return baseline;
}

async function scheduleNextAlarm(storage: DurableObjectStorage, state: SchedulerState) {
  const candidates = [state.nextCalendarSyncAt, ...state.events.map((event) => event.nextPollAt).filter((value): value is number => typeof value === 'number')]
    .filter((value) => value > Date.now() - 1000)
    .sort((a, b) => a - b);
  if (candidates.length) await storage.setAlarm(Math.max(Date.now() + 250, candidates[0]));
}

async function seedReleasedCalibration(storage: DurableObjectStorage, events: ReleaseRuntime[]) {
  const released = events.filter((runtime) => Boolean(runtime.event.actual)).slice(-40);
  for (const runtime of released) runtime.event = await recordReleaseCalibration(storage, runtime.event);
}

export async function bootstrapScheduler(env: Env, storage: DurableObjectStorage, force = false) {
  const existing = await getState(storage);
  if (existing && !force) {
    await scheduleNextAlarm(storage, existing);
    return existing;
  }

  const now = Date.now();
  let baseline = await getBaseline(storage);
  if (!baseline && env.FRED_API_KEY) baseline = await refreshMacroBaseline(env, storage, null);
  const calendar = await getScrapedEconomicCalendar(env, storage, CALENDAR_HORIZON_DAYS);
  const state: SchedulerState = {
    version: 2,
    initializedAt: existing?.initializedAt ?? now,
    calendarSyncedAt: now,
    nextCalendarSyncAt: nextUtcCalendarSync(now),
    baselineUpdatedAt: baseline ? Date.parse(baseline.generatedAt) : existing?.baselineUpdatedAt,
    lastPostReleaseBaselineRefreshAt: existing?.lastPostReleaseBaselineRefreshAt,
    events: calendar.map((event) => runtimeFromCalendar(event, existing?.events.find((item) => item.id === event.id), now, baseline?.id)),
    recentReleaseIds: existing?.recentReleaseIds ?? [],
    stats: existing?.stats ?? { calendarSyncs: 0, releaseChecks: 0, releaseChanges: 0, baselineRefreshes: baseline ? 1 : 0 },
  };
  state.stats.calendarSyncs += 1;
  await seedReleasedCalibration(storage, state.events);
  await putState(storage, state);
  await scheduleNextAlarm(storage, state);
  return state;
}

export async function syncCalendarSchedule(env: Env, storage: DurableObjectStorage) {
  const state = (await getState(storage)) ?? await bootstrapScheduler(env, storage, true);
  const now = Date.now();
  const baseline = await getBaseline(storage);
  const calendar = await getScrapedEconomicCalendar(env, storage, CALENDAR_HORIZON_DAYS);
  const previousById = new Map(state.events.map((event) => [event.id, event]));
  const refreshed = calendar.map((event) => runtimeFromCalendar(event, previousById.get(event.id), now, baseline?.id));
  const stillRecent = state.events.filter((event) => event.releaseAt < now && now - event.releaseAt <= 24 * 60 * 60 * 1000 && !refreshed.some((item) => item.id === event.id));
  state.events = [...refreshed, ...stillRecent].sort((a, b) => a.releaseAt - b.releaseAt);
  state.calendarSyncedAt = now;
  state.nextCalendarSyncAt = nextUtcCalendarSync(now);
  state.stats.calendarSyncs += 1;
  await seedReleasedCalibration(storage, state.events);

  if (env.FRED_API_KEY && (!state.baselineUpdatedAt || now - state.baselineUpdatedAt >= CALENDAR_REFRESH_MS)) {
    await refreshMacroBaseline(env, storage, state);
  }

  await putState(storage, state);
  await scheduleNextAlarm(storage, state);
  return state;
}

async function appendReleaseSnapshot(storage: DurableObjectStorage, runtime: ReleaseRuntime, event: CalendarEvent, checkedAt: number) {
  const key = `${SNAPSHOT_PREFIX}${runtime.id}`;
  const current = (await storage.get<Array<{ checkedAt: number; baselineId?: string; event: CalendarEvent }>>(key)) ?? [];
  current.push({ checkedAt, baselineId: runtime.baselineId, event });
  await storage.put(key, current.slice(-MAX_RELEASE_SNAPSHOTS));
}

async function maybePostReleaseBaselineRefresh(env: Env, storage: DurableObjectStorage, state: SchedulerState, due: ReleaseRuntime[], now: number) {
  const majorReleased = due.some((runtime) => runtime.event.importance >= 3 && runtime.event.actual);
  if (!majorReleased || !env.FRED_API_KEY) return;
  if (state.lastPostReleaseBaselineRefreshAt && now - state.lastPostReleaseBaselineRefreshAt < BASELINE_REFRESH_GUARD_MS) return;
  const matureMajor = due.some((runtime) => now - runtime.releaseAt >= 120_000);
  if (!matureMajor) return;
  await refreshMacroBaseline(env, storage, state);
  state.lastPostReleaseBaselineRefreshAt = now;
}

export async function processSchedulerAlarm(env: Env, storage: DurableObjectStorage) {
  let state = await getState(storage);
  if (!state) state = await bootstrapScheduler(env, storage, true);
  const now = Date.now();
  if (now >= state.nextCalendarSyncAt - 1000) state = await syncCalendarSchedule(env, storage);

  const due = state.events.filter((event) => event.nextPollAt !== null && event.nextPollAt <= now + 1000).slice(0, 40);
  if (due.length) {
    const refreshed = await refreshScrapedReleaseWindow(env, storage, due.map((runtime) => runtime.event));
    const byId = new Map(refreshed.map((event) => [event.id, event]));

    for (const runtime of due) {
      let latest = byId.get(runtime.id) ?? runtime.event;
      const signature = eventSignature(latest);
      const changed = signature !== runtime.lastSignature;
      runtime.lastCheckedAt = now;
      runtime.status = 'monitoring';
      runtime.pollIndex += 1;
      state.stats.releaseChecks += 1;

      if (changed) {
        runtime.lastSignature = signature;
        runtime.changedAt = now;
        if (latest.actual) {
          if (!runtime.actualSeenAt) runtime.actualSeenAt = now;
          latest = await recordReleaseCalibration(storage, latest);
        }
        runtime.event = latest;
        state.stats.releaseChanges += 1;
        await appendReleaseSnapshot(storage, runtime, latest, now);
        state.recentReleaseIds = [runtime.id, ...state.recentReleaseIds.filter((id) => id !== runtime.id)].slice(0, MAX_RECENT_RELEASES);
      } else {
        runtime.event = latest;
      }

      const next = findNextPollAt(runtime, now);
      if (next) {
        runtime.pollIndex = next.index - 1;
        runtime.nextPollAt = next.at;
      } else {
        runtime.nextPollAt = null;
        runtime.status = latest.actual ? 'settled' : 'missed';
      }
    }

    await maybePostReleaseBaselineRefresh(env, storage, state, due, now);
    await putState(storage, state);
  }

  await scheduleNextAlarm(storage, state);
  return state;
}

export async function getSchedulerView(env: Env, storage: DurableObjectStorage, bootstrap = false) {
  let state = await getState(storage);
  if (!state && bootstrap) {
    try { state = await bootstrapScheduler(env, storage, true); } catch { /* surfaced below */ }
  }
  const baseline = await getBaseline(storage);
  if (!state) {
    return {
      initialized: false,
      reason: 'Scraped calendar consensus has not been bootstrapped yet or all calendar sources were temporarily unavailable.',
      baseline,
      upcoming: [], active: [], recent: [],
    };
  }

  const enrichedEvents = await enrichCalendarWithCalibration(storage, state.events.map((runtime) => runtime.event));
  const enrichedById = new Map(enrichedEvents.map((event) => [event.id, event]));
  const enrichedRuntime = (runtime: ReleaseRuntime) => ({ ...runtime, event: enrichedById.get(runtime.id) ?? runtime.event });
  const now = Date.now();
  const upcoming = state.events.filter((event) => event.releaseAt >= now && event.status === 'scheduled').slice(0, 120).map(enrichedRuntime);
  const active = state.events.filter((event) => event.status === 'monitoring').map(enrichedRuntime);
  const recent = state.recentReleaseIds
    .map((id) => state.events.find((event) => event.id === id))
    .filter((event): event is ReleaseRuntime => Boolean(event))
    .slice(0, 40)
    .map(enrichedRuntime);

  return {
    initialized: true,
    mode: 'scraped-calendar-consensus',
    calendarSources: ['Myfxbook', 'FXStreet', 'CNBC'],
    initializedAt: new Date(state.initializedAt).toISOString(),
    calendarSyncedAt: new Date(state.calendarSyncedAt).toISOString(),
    nextCalendarSyncAt: new Date(state.nextCalendarSyncAt).toISOString(),
    nextReleaseAt: upcoming[0] ? new Date(upcoming[0].releaseAt).toISOString() : null,
    nextAlarmAt: await storage.getAlarm().then((value) => value ? new Date(value).toISOString() : null),
    stats: state.stats,
    baseline: baseline ? { id: baseline.id, generatedAt: baseline.generatedAt, analysis: baseline.analysis, observations: baseline.observations } : null,
    upcoming, active, recent,
  };
}

export async function getReleaseSnapshots(storage: DurableObjectStorage, id: string) {
  return (await storage.get<Array<{ checkedAt: number; baselineId?: string; event: CalendarEvent }>>(`${SNAPSHOT_PREFIX}${id}`)) ?? [];
}
