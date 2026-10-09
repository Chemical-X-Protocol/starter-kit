import { onScopeDispose, getCurrentScope } from 'vue';

/**
 * A restartable one-shot timer that clears itself when the owning effect scope is disposed.
 * The handle is cleared by name with no guarding branch: clearTimeout(undefined) is a no-op.
 */
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
