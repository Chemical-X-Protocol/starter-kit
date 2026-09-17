import type { BadgeTone } from '../../atoms/a-badge/types';

export interface TokenStatProps {
  readonly title: string;
  readonly count: number;
  readonly subtitle?: string;
  readonly costEstimate?: number;
  readonly tone?: BadgeTone;
}
