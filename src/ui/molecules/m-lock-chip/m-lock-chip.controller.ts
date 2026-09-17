import { computed } from 'vue';
import type { LockChipProps } from './types';
import type { BadgeTone } from '../../atoms/a-badge/types';

export const formatShortPath = (fullPath: string = ''): string => {
  const parts = fullPath.split('/');
  if (parts.length <= 2) return fullPath;
  return parts.slice(-2).join('/');
};

export function useLockChipController(props: LockChipProps) {
  const shortPath = computed((): string => formatShortPath(props.lease.filePath));

  const remainingSeconds = computed((): number => {
    const diff = Math.floor((props.lease.expiresAt - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  const isExpired = computed((): boolean => remainingSeconds.value <= 0);
  const isExpiringSoon = computed((): boolean => remainingSeconds.value < 60 && !isExpired.value);
  const hasWaiters = computed((): boolean => Boolean((props.lease.waitingCount || 0) > 0));
  const isUrgent = computed((): boolean => isExpiringSoon.value || hasWaiters.value);

  const ttlLabel = computed((): string => {
    if (isExpired.value) return 'Expired';
    const m = Math.floor(remainingSeconds.value / 60);
    const s = remainingSeconds.value % 60;
    return `${m}m ${s}s`;
  });

  const ttlTone = computed((): BadgeTone => {
    if (isExpired.value) return 'error';
    if (isExpiringSoon.value) return 'warning';
    return 'sky';
  });

  return {
    shortPath,
    ttlLabel,
    ttlTone,
    isUrgent,
    hasWaiters
  };
}
