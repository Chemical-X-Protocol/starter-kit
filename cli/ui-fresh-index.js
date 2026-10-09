// Studio codebase answers read index rows, so they sync first (#2552): the project scope for the
// index and tree, the one file for a file view. A stale or busy index is not hidden: the payload
// carries `index`, whose status and reason say so.
import { ensureFresh } from './index-freshness.js';

export const withFreshIndex = (cwd, options, answer) => {
  const session = ensureFresh(cwd, options);
  const payload = answer();
  const isObject = Boolean(payload) && typeof payload === 'object';
  return isObject ? { ...payload, index: session.index } : payload;
};
