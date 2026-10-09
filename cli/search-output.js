// Shared envelope for index-backed answers: every payload says which root and scope it
// searched, how fresh that was, and whether the answer is pass or inconclusive.
import { STATUS, toExitCode, combineStatuses } from './result-status.js';
import { INDEX_VERSION } from './search-index-meta.js';
import { scopeSqlFilter } from './search-root.js';

export const describeIndexFromSync = (syncRes) => {
  const hasSync = Boolean(syncRes);
  if (!hasSync) return null;
  const isStale = syncRes.status !== 'fresh';
  const filter = scopeSqlFilter('path', syncRes.scopeDirs);
  const fileCount = Number(syncRes.db?.prepare(`SELECT COUNT(*) AS c FROM files WHERE ${filter.sql}`).get(...filter.params)?.c || 0);
  const hasWiderIndex = Boolean(syncRes.indexedScopes) && syncRes.indexedScopes !== syncRes.scope;
  return {
    root: syncRes.root,
    scope: syncRes.scope,
    scopeDirs: syncRes.scopeDirs,
    files: fileCount,
    indexedScopes: hasWiderIndex ? syncRes.indexedScopes : undefined,
    version: INDEX_VERSION,
    status: isStale ? STATUS.INCONCLUSIVE : STATUS.PASS,
    reason: isStale ? syncRes.staleReason : null,
    notice: syncRes.versionNotice || null,
    skipped: (syncRes.skippedFiles || []).length
  };
};

export const withIndex = (payload, index) => {
  const hasIndex = Boolean(index) && payload && typeof payload === 'object';
  if (!hasIndex) return payload;
  const status = combineStatuses([payload.status || STATUS.PASS, index.status]);
  return { ...payload, status, index };
};

export const indexStatusOf = (index) => (index ? index.status : STATUS.PASS);

// CLI exit code follows the answer's status; library callers (isCli false) are untouched.
export const applyExitStatus = (status, isCli) => {
  if (!isCli) return;
  process.exitCode = toExitCode(status);
};

export const formatIndexLine = (index) => {
  const hasIndex = Boolean(index);
  if (!hasIndex) return '';
  const wider = index.indexedScopes ? `; index holds ${index.indexedScopes} (rows outside ${index.scope} are re-checked on disk; graph, def and semantic answers may include them)` : '';
  const base = `index: scope ${index.scope} (${index.files} files) under ${index.root}${wider}`;
  const notice = index.notice ? `; ${index.notice}` : '';
  const isInconclusive = index.status === STATUS.INCONCLUSIVE;
  const verdict = isInconclusive ? `; INCONCLUSIVE: ${index.reason}` : '';
  return `${base}${notice}${verdict}`;
};
