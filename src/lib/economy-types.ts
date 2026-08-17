import type { MacroObservation } from './types';

export type EconomyId = 'USA' | 'EUROPE' | 'UK' | 'SOUTH_AFRICA' | 'JAPAN';

export interface GlobalMacroPayload {
  generatedAt: string | null;
  mode: string;
  targetEconomies: EconomyId[];
  totalObservations: number;
  counts: Record<EconomyId, number>;
  economies: Record<EconomyId, MacroObservation[]>;
  global: MacroObservation[];
  structuralUsAnalysis?: unknown;
}

export interface EconomyDimension {
  id: 'inflation' | 'growth' | 'labour' | 'policy' | 'financial';
  label: string;
  score: number;
  coverage: number;
  contributors: Array<{ seriesId: string; title: string; score: number; category: string }>;
}

export interface EconomyMacroState {
  id: EconomyId;
  label: string;
  currency: string;
  centralBank: string;
  observationCount: number;
  confidence: number;
  regime: string;
  policyStance: string;
  currencyBias: string;
  currencyScore: number;
  dimensions: EconomyDimension[];
  topSignals: Array<{ seriesId: string; title: string; score: number; value: number | null; date: string | null }>;
  summary: string;
}

export interface EconomyAnalysisPayload {
  generatedAt: string;
  methodology: string;
  minimumCoverageNote: string;
  collectorMode: string;
  observationCount: number;
  economies: EconomyMacroState[];
}
