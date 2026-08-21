import type { MacroObservation } from './types';

// Economy IDs are data-driven so the backend can add economies without
// requiring another frontend type release.
export type EconomyId = string;

export interface GlobalMacroPayload {
  generatedAt: string | null;
  mode: string;
  targetEconomies: EconomyId[];
  totalObservations: number;
  counts: Record<string, number>;
  economies: Record<string, MacroObservation[]>;
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
