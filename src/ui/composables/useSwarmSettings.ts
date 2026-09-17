import { ref } from 'vue';

export function useSwarmSettings() {
  const lastMessage = ref<string>('');
  const isSuccess = ref<boolean>(true);
  const isExecuting = ref<boolean>(false);

  const executeAction = async (action: string, payload: Record<string, any> = {}) => {
    if (typeof fetch !== 'function') return;
    try {
      isExecuting.value = true;
      const res = await fetch('/api/swarm/settings/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
      });
      const data = await res.json();
      lastMessage.value = data.message || (data.success ? 'Success' : data.error || 'Action failed');
      isSuccess.value = Boolean(data.success);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action request failed';
      lastMessage.value = message;
      isSuccess.value = false;
    } finally {
      isExecuting.value = false;
    }
  };

  return {
    lastMessage,
    isSuccess,
    isExecuting,
    executeAction
  };
}
