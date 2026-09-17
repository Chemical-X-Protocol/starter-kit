import { computed } from 'vue';
import type { LockRowProps, LockRowEmits } from './types';

export function useLockRowController(props: LockRowProps, emit: LockRowEmits) {
  const hasAgent = computed(() => Boolean(props.lease.lockedBy));
  const expiresAtText = computed(() => {
    if (!props.lease.expiresAt) return 'Active Lease';
    const remainingMs = props.lease.expiresAt - Date.now();
    if (remainingMs <= 0) return 'Expired';
    return `TTL: ${Math.round(remainingMs / 1000)}s`;
  });

  const handleRelease = () => {
    emit('release', props.lease.filePath, props.lease.lockedBy);
  };

  return {
    hasAgent,
    expiresAtText,
    handleRelease
  };
}
