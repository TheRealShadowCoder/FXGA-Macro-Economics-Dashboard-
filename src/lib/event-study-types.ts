import type { CurrencyBias } from './types';

export type EventReactionAlignment = 'aligned' | 'opposed' | 'muted' | 'neutral-bias' | 'unavailable';

export interface EventStudyReaction {
  assetId: string;
  polarity: number;
  available: boolean;
  baselinePrice: number | null;
  currentPrice: number | null;
  rawMovePct: number | null;
  baseCurrencyMovePct: number | null;
  noiseThresholdPct?: number;
  alignment: EventReactionAlignment;
  aligned?: boolean;
  opposed?: boolean;
  reactionStrength?: number;
}

export interface EventStudyMeasurement {
  horizon: '5m' | '15m' | '1h' | '4h';
  offsetSeconds: number;
  capturedAt: string;
  releaseAt: string | null;
  currency: string;
  currencyBias: CurrencyBias;
  biasConfidence: number | null;
  baselineAt: string | null;
  currentAt: string | null;
  baselineLagSeconds: number | null;
  observationLagSeconds: number | null;
  quality: 'measured' | 'baseline-too-old' | 'observation-delayed' | 'market-data-unavailable';
  usableAssets: number;
  aligned: number;
  opposed: number;
  muted: number;
  directionalAgreement: number | null;
  meanBaseCurrencyMovePct: number | null;
  reactions: EventStudyReaction[];
}

export interface EconomicEventStudy {
  eventId: string;
  event: string;
  currency: string;
  country: string;
  category: string;
  importance: number;
  releaseAt: string;
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
  revised?: string | null;
  currencyBias: CurrencyBias;
  currencyBiasScore?: number;
  biasConfidence?: number | null;
  interpretationFamily?: string | null;
  horizons: Partial<Record<'5m' | '15m' | '1h' | '4h', EventStudyMeasurement>>;
  updatedAt: string;
}

export interface EventStudySummary {
  studies: number;
  measuredHorizons: number;
  byHorizon: Record<string, {
    observations: number;
    meanDirectionalAgreement: number | null;
    aligned: number;
    opposed: number;
  }>;
}

export interface EventStudiesPayload {
  generatedAt: string | null;
  days: number;
  currency: string | null;
  summary: EventStudySummary;
  studies: EconomicEventStudy[];
}
