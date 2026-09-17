import type { SavingsSummary } from '../m-savings-badge/types';

export interface SavingsModalProps {
  readonly open?: boolean;
  readonly savings?: SavingsSummary;
}

export interface SavingsModalEmits {
  (e: 'close'): void;
}
