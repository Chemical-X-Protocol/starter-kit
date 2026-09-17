export interface FileLeaseRecord {
  readonly filePath: string;
  readonly lockedBy: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly purpose?: string;
  readonly waitingCount?: number;
}

export interface LockChipProps {
  readonly lease: FileLeaseRecord;
}
