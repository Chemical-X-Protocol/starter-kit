export interface SavingsSummary {
  readonly baselineTokens: number;
  readonly actualTokens: number;
  readonly tokensSaved: number;
  readonly dollarsSaved: number;
  readonly reductionPct: number;
  readonly actualCost: number;
  readonly latencyReductionRatio?: string;
  readonly contextOverflowErrorsAvoided?: number;
}

export interface SavingsBadgeProps {
  readonly savings?: SavingsSummary;
}

export interface SavingsBadgeEmits {
  (e: 'click'): void;
}
