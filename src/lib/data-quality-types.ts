export interface MacroCoverageQuality {
  requested?: number;
  liveFetched?: number;
  retainedLastKnownGood?: number;
  usableObservations?: number;
  unresolved?: number;
  liveCoveragePercent?: number | null;
  effectiveCoveragePercent?: number | null;
  status?: 'strong' | 'acceptable' | 'degraded' | 'unknown' | string;
}

export interface MacroFailureSeries {
  seriesId: string;
  title: string;
  economy: string;
  category: string;
  type: string;
  retryable: boolean;
}

export interface DataQualityPayload {
  generatedAt: string | null;
  macro: {
    coverage: MacroCoverageQuality;
    failures: {
      total: number;
      retryable: number;
      nonRetryable: number;
      unresolved: number;
      byType: Record<string, number>;
      byEconomy: Record<string, number>;
      byCategory: Record<string, number>;
      series: MacroFailureSeries[];
    };
  };
  market: { assets: number; priced: number; stale: number };
  technical: { assets: number; confirmed: number; warming: number };
  calendar: { events: number; sourceHealth: Record<string, unknown> };
  publicPolicy: string;
}
