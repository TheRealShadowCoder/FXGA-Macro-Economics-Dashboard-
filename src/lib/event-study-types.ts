import type { CurrencyBias } from './types';

export const EVENT_STUDY_HORIZONS = ['1m','5m','15m','30m','1h','2h','4h','8h','24h'] as const;
export type EventStudyHorizon = typeof EVENT_STUDY_HORIZONS[number];
export type EventReactionAlignment = 'aligned' | 'opposed' | 'muted' | 'neutral-bias' | 'unavailable';

export interface EventStudyReaction {
  assetId: string;
  polarity?: number;
  available: boolean;
  quality?: string;
  baselineAt?: string | null;
  observationAt?: string | null;
  targetAt?: string | null;
  baselinePrice: number | null;
  currentPrice?: number | null;
  observationPrice?: number | null;
  rawMove?: number | null;
  rawMovePct: number | null;
  baseCurrencyMovePct?: number | null;
  noiseThresholdPct?: number;
  alignment?: EventReactionAlignment;
  aligned?: boolean;
  opposed?: boolean;
  reactionStrength?: number;
  observationLagSeconds?: number | null;
  direction?: 'up' | 'down' | 'flat';
  maxUpsidePct?: number | null;
  maxDownsidePct?: number | null;
  maxAbsoluteExcursionPct?: number | null;
  rangePct?: number | null;
  barsObserved?: number;
  tickVolume?: number;
  averageSpread?: number | null;
  peakAt?: string | null;
  troughAt?: string | null;
}

export interface EventStudyMeasurement {
  horizon: EventStudyHorizon;
  offsetSeconds: number;
  capturedAt: string;
  releaseAt: string | null;
  source?: string;
  currency?: string;
  currencyBias?: CurrencyBias;
  biasConfidence?: number | null;
  baselineAt?: string | null;
  currentAt?: string | null;
  baselineLagSeconds?: number | null;
  observationLagSeconds?: number | null;
  quality: 'measured' | 'baseline-too-old' | 'baseline-unavailable' | 'observation-delayed' | 'observation-unavailable' | 'market-data-unavailable' | string;
  usableAssets: number;
  totalAssets?: number;
  aligned?: number;
  opposed?: number;
  muted?: number;
  positive?: number;
  negative?: number;
  flat?: number;
  directionalAgreement?: number | null;
  meanBaseCurrencyMovePct?: number | null;
  averageAbsoluteMovePct?: number | null;
  crossAssetBreadth?: number | null;
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
  outcome?: string | null;
  currencyBias: CurrencyBias;
  currencyBiasScore?: number;
  biasConfidence?: number | null;
  surpriseValue?: number | null;
  surprisePercent?: number | null;
  interpretationFamily?: string | null;
  priceSource?: string;
  sourceTimeframe?: string;
  priceUniverse?: string[];
  horizonOrder?: EventStudyHorizon[];
  horizons: Partial<Record<EventStudyHorizon, EventStudyMeasurement>>;
  backfilledAt?: string;
  updatedAt: string;
}

export interface EventStudySummary {
  studies: number;
  measuredHorizons: number;
  assetMeasurements?: number;
  byHorizon: Record<string, {
    observations: number;
    assetObservations?: number;
    averageUsableAssets?: number | null;
    meanDirectionalAgreement: number | null;
    meanAbsoluteMovePct?: number | null;
    aligned: number;
    opposed: number;
  }>;
}

export interface EventStudiesPayload {
  generatedAt: string | null;
  days: number;
  currency: string | null;
  source?: string;
  priceUniverse?: string[];
  horizons?: EventStudyHorizon[];
  summary: EventStudySummary;
  studies: EconomicEventStudy[];
}
