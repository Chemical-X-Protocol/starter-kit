import type { FileLeaseRecord } from '../../molecules/m-lock-chip/types';

export interface TaskSummaryRecord {
  readonly id: number;
  readonly title: string;
  readonly status: string;
  readonly priority?: number;
  readonly assignedAgentId?: string | null;
}

export interface TokenTelemetrySummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly totalCost: number;
}

export interface WorkloadRailProps {
  readonly leases?: readonly FileLeaseRecord[];
  readonly tasks?: readonly TaskSummaryRecord[];
  readonly telemetry?: TokenTelemetrySummary;
  readonly waitingLocksCount?: number;
}
