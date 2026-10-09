import { ref } from 'vue';
import type { AttentionItem } from '../molecules/m-attention-card/types';
import { useSelfCleaningTimeout } from './useSelfCleaningTimeout';

export function useSwarmAttention() {
  const items = ref<AttentionItem[]>([]);
  const antigravityRunning = ref<boolean>(false);
  const conversationId = ref<string | null>(null);
  const pendingCount = ref<number>(0);
  const errorMessage = ref<string | null>(null);

  const fetchAttention = async (): Promise<[AttentionItem[] | null, Error | null]> => {
    const isFetchAvailable = typeof fetch === 'function';
    if (!isFetchAvailable) return [null, new Error('fetch is not available')];
    try {
      const res = await fetch('/api/swarm/attention');
      const isResponseOk = res.ok;
      if (!isResponseOk) {
        const error = new Error(`Server responded with ${res.status}`);
        errorMessage.value = error.message;
        return [null, error];
      }
      const data = await res.json();
      items.value = data.items || [];
      antigravityRunning.value = Boolean(data.antigravityRunning);
      conversationId.value = data.conversationId || null;
      pendingCount.value = data.pendingCount || 0;
      errorMessage.value = null;
      return [items.value, null];
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch attention items');
      errorMessage.value = error.message;
      return [null, error];
    } finally {
      poller.start();
    }
  };

  const poller = useSelfCleaningTimeout(() => {
    const isDocumentAvailable = typeof document !== 'undefined';
    const isTabHidden = isDocumentAvailable && document.visibilityState === 'hidden';
    if (isTabHidden) {
      poller.start();
      return;
    }
    fetchAttention();
  }, 3000);

  const confirmItem = async (itemId: string, action: 'approve' | 'reject'): Promise<[boolean, Error | null]> => {
    const isFetchAvailable = typeof fetch === 'function';
    if (!isFetchAvailable) return [false, new Error('fetch is not available')];
    try {
      const res = await fetch('/api/swarm/attention/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action })
      });
      const isResponseOk = res.ok;
      if (!isResponseOk) {
        const error = new Error(`Action failed with ${res.status}`);
        errorMessage.value = error.message;
        return [false, error];
      }
      await fetchAttention();
      return [true, null];
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Action request failed');
      errorMessage.value = error.message;
      return [false, error];
    }
  };

  fetchAttention();

  return {
    items,
    antigravityRunning,
    pendingCount,
    confirmItem,
    refresh: fetchAttention
  };
}
