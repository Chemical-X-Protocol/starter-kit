// Self-disposing timers: every scheduled callback hands back its own cancel function.
export const scheduleTimeout = (fn, ms, { unref = false } = {}) => {
  const handle = setTimeout(fn, ms);
  if (unref) handle.unref?.();
  return () => clearTimeout(handle);
};
