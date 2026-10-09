import { ref } from 'vue';

export function useSwarmSettings() {
  const lastMessage = ref<string>('');
  const isSuccess = ref<boolean>(true);
  const isExecuting = ref<boolean>(false);

  const executeAction = async (action: string, payload: Record<string, any> = {}) => {
    const isFetchMissing = typeof fetch !== 'function';
    if (isFetchMissing) return;
    try {
      isExecuting.value = true;
      const res = await fetch('/api/swarm/settings/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
      });
      const data = await res.json();
      const isSuccessResult = Boolean(data.success);
      lastMessage.value = data.message || (isSuccessResult ? 'Success' : data.error || 'Action failed');
      isSuccess.value = Boolean(data.success);
    } catch (err: unknown) {
      const isErrorInstance = err instanceof Error;
      const message = isErrorInstance ? err.message : 'Action request failed';
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
