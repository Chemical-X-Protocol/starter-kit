import { onScopeDispose, getCurrentScope } from 'vue';

export function useSelfCleaningTimeout(fn: () => void | Promise<void>, delayMs: number) {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;

  const stop = () => {
    if (timerId !== null) {
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

  if (getCurrentScope()) {
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
