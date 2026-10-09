import { onScopeDispose, getCurrentScope } from 'vue';

export function useSelfCleaningTimeout(fn: () => void | Promise<void>, delayMs: number) {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let isRunning = false;

  const stop = () => {
    clearTimeout(timerId);
    timerId = undefined;
    isRunning = false;
  };

  const start = () => {
    stop();
    isRunning = true;
    timerId = setTimeout(async () => {
      timerId = undefined;
      if (isRunning) {
        await fn();
      }
    }, delayMs);
    return stop;
  };

  const hasActiveScope = Boolean(getCurrentScope());
  if (hasActiveScope) {
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
