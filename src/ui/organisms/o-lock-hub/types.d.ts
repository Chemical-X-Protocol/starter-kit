import type { FileLeaseRecord } from '../../molecules/m-lock-chip/types';

export interface LockHubProps {
  readonly leases: FileLeaseRecord[];
  readonly waitingCount?: number;
}

export interface LockHubEmits {
  (e: 'acquire', filePath: string, agentId: string): void;
  (e: 'release', filePath: string, agentId: string): void;
}
