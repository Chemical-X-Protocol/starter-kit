import type { DatabaseMetrics, QueryResult } from '../../composables/useSwarmDatabase';

export interface DbStudioProps {
  readonly metrics?: DatabaseMetrics | null;
  readonly queryResult?: QueryResult | null;
  readonly activeQuery?: string;
  readonly isLoading?: boolean;
  readonly error?: string | null;
}

export interface DbStudioEmits {
  (e: 'run', sql: string): void;
  (e: 'select-preset', sql: string): void;
}
