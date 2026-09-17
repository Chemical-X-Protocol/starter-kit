import type { FileLeaseRecord } from '../m-lock-chip/types';

export interface LockRowProps {
  readonly lease: FileLeaseRecord;
}

export interface LockRowEmits {
  (e: 'release', filePath: string, agentId: string): void;
}
