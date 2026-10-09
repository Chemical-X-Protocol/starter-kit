// In-flight tools/call tracking: cancellation (notifications/cancelled) and progress heartbeats
// (notifications/progress when the client sent params._meta.progressToken).
import { runWithRequestContext } from '../request-context.js';

const DEFAULT_PROGRESS_INTERVAL_MS = 5000;

export const createInflight = ({ notify = null, progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS } = {}) => {
  const controllers = new Map();

  const startHeartbeat = (progressToken, label) => {
    const canReport = typeof notify === 'function' && progressToken !== undefined && progressToken !== null;
    if (!canReport) return () => {};
    const startedAt = Date.now();
    let beats = 0;
    const beat = () => {
      beats += 1;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      notify('notifications/progress', { progressToken, progress: beats, message: `${label} running (${seconds}s)` });
    };
    beat();
    const timer = setInterval(beat, progressIntervalMs);
    return () => clearInterval(timer);
  };

  // Runs fn under a cancellable request context. Resolves to { cancelled, value }.
  const run = async (id, params, fn) => {
    const controller = new AbortController();
    controllers.set(id, controller);
    const label = params?.arguments?.action || params?.arguments?.command || params?.name || 'chemx';
    const stopHeartbeat = startHeartbeat(params?._meta?.progressToken, label);
    try {
      const value = await runWithRequestContext({ signal: controller.signal }, fn);
      return { cancelled: controller.signal.aborted, value };
    } finally {
      stopHeartbeat();
      controllers.delete(id);
    }
  };

  const cancel = (requestId) => {
    const controller = controllers.get(requestId);
    if (controller) controller.abort();
    return Boolean(controller);
  };

  return { run, cancel, size: () => controllers.size };
};
