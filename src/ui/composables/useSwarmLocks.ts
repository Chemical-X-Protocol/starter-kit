import { ref } from 'vue';
import type { FileLeaseRecord } from '../molecules/m-lock-chip/types';

export function useSwarmLocks() {
  const leases = ref<FileLeaseRecord[]>([]);
  const waitingLocksCount = ref(0);
  const error = ref<Error | null>(null);

  const fetchLocks = async () => {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch('/api/swarm/status');
      if (res.ok) {
        const data = await res.json();
        if (data.leases) leases.value = data.leases;
        if (data.waitingLocksCount !== undefined) waitingLocksCount.value = data.waitingLocksCount;
      }
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  const acquireLock = async (filePath: string, agentId = '@coordinator') => {
    if (typeof fetch !== 'function') return;
    try {
      await fetch('/api/swarm/locks/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, agentId, purpose: 'molecular edit' })
      });
      await fetchLocks();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  const releaseLock = async (filePath: string, agentId = '@coordinator') => {
    if (typeof fetch !== 'function') return;
    try {
      await fetch('/api/swarm/locks/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, agentId })
      });
      await fetchLocks();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  };

  fetchLocks();

  return {
    leases,
    waitingLocksCount,
    acquireLock,
    releaseLock,
    error
  };
}
