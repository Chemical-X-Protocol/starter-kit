import { ref } from 'vue';
import type { AttentionItem } from '../molecules/m-attention-card/types';
import { useSelfCleaningTimeout } from './useSelfCleaningTimeout';

export function useSwarmAttention() {
  const items = ref<AttentionItem[]>([]);
  const antigravityRunning = ref<boolean>(false);
  const conversationId = ref<string | null>(null);
  const pendingCount = ref<number>(0);
  const errorMessage = ref<string | null>(null);

  const fetchAttention = async () => {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch('/api/swarm/attention');
      if (!res.ok) {
        errorMessage.value = `Server responded with ${res.status}`;
        return;
      }
      const data = await res.json();
      items.value = data.items || [];
      antigravityRunning.value = Boolean(data.antigravityRunning);
      conversationId.value = data.conversationId || null;
      pendingCount.value = data.pendingCount || 0;
      errorMessage.value = null;
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Failed to fetch attention items';
    } finally {
      poller.start();
    }
  };

  const poller = useSelfCleaningTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      poller.start();
      return;
    }
    fetchAttention();
  }, 3000);

  const confirmItem = async (itemId: string, action: 'approve' | 'reject') => {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch('/api/swarm/attention/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action })
      });
      if (!res.ok) {
        errorMessage.value = `Action failed with ${res.status}`;
        return;
      }
      await fetchAttention();
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Action request failed';
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
