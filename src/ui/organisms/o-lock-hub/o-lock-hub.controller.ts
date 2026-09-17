import { ref, computed } from 'vue';
import type { LockHubProps, LockHubEmits } from './types';

export function useLockHubController(props: LockHubProps, emit: LockHubEmits) {
  const targetPath = ref('src/ui/test-lock.ts');
  const agentId = ref('@coordinator');

  const hasPath = computed(() => targetPath.value.trim().length > 0);
  const hasAgent = computed(() => agentId.value.trim().length > 0);
  const canAcquire = computed(() => hasPath.value && hasAgent.value);

  const handleAcquire = () => {
    if (!canAcquire.value) return;
    emit('acquire', targetPath.value.trim(), agentId.value.trim());
  };

  const handleRelease = (filePath: string, agent: string) => {
    emit('release', filePath, agent);
  };

  return {
    targetPath,
    agentId,
    canAcquire,
    handleAcquire,
    handleRelease
  };
}
