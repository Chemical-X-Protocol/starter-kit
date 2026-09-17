import type { SavingsSummary } from '../../molecules/m-savings-badge/types';

export interface AppHeaderProps {
  readonly activePage?: string;
  readonly savings?: SavingsSummary;
}

export interface AppHeaderEmits {
  (e: 'toggle-menu'): void;
  (e: 'open-savings'): void;
}
