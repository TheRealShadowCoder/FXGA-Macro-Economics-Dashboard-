import type { DashboardPayload, FredCatalogPayload, MacroObservation } from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(): Promise<DashboardPayload> {
  return getJson<DashboardPayload>('/api/dashboard');
}

export function fetchFredCatalog(): Promise<FredCatalogPayload> {
  return getJson<FredCatalogPayload>('/api/fred/catalog');
}

export async function fetchFredCategory(category: string, limit = 16): Promise<MacroObservation[]> {
  const params = new URLSearchParams({ category, limit: String(limit) });
  const payload = await getJson<{ series: MacroObservation[] }>(`/api/fred?${params.toString()}`);
  return payload.series;
}
