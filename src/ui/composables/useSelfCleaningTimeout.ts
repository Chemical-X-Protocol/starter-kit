import { onScopeDispose, getCurrentScope } from 'vue';

export function useSelfCleaningTimeout(fn: () => void | Promise<void>, delayMs: number) {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;

  const stop = () => {
    const hasTimer = timerId !== null;
    if (hasTimer) {
      clearTimeout(timerId);
      timerId = null;
    }
    isRunning = false;
  };

  const start = () => {
    stop();
    isRunning = true;
    timerId = setTimeout(async () => {
      timerId = null;
      if (isRunning) {
        await fn();
      }
    }, delayMs);
    return stop;
  };

  const hasScope = Boolean(getCurrentScope());
  if (hasScope) {
    onScopeDispose(() => {
      stop();
    });
  }

  return {
    start,
    stop,
    isActive: () => isRunning
  };
}
