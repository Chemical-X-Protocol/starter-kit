// MCP roots: the client-declared workspace directories (roots/list), plus legacy initialize fields.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExistingDir } from './context.js';

const toDirPath = (uriOrPath) => {
  const isString = typeof uriOrPath === 'string' && uriOrPath.length > 0;
  if (!isString) return null;
  const isFileUri = uriOrPath.startsWith('file://');
  const candidate = isFileUri ? fileURLToPath(uriOrPath) : uriOrPath;
  return isExistingDir(candidate) ? path.resolve(candidate) : null;
};

export const rootsFromList = (result) => (Array.isArray(result?.roots) ? result.roots : [])
  .map((root) => toDirPath(root?.uri))
  .filter(Boolean);

// LSP-style fields some clients still send on initialize.
export const rootsFromInitialize = (params = {}) => {
  const folders = Array.isArray(params?.workspaceFolders) ? params.workspaceFolders.map((f) => f?.uri) : [];
  return [params?.rootPath, params?.rootUri, ...folders].map(toDirPath).filter(Boolean);
};

export const clientSupportsRoots = (params = {}) => Boolean(params?.capabilities?.roots);

// Tracks roots and refreshes them over roots/list whenever the client says they changed.
export const createRootsTracker = ({ sendRequest = null, timeoutMs = 3000 } = {}) => {
  let roots = [];
  let isSupported = false;
  let refreshing = null;
  const refresh = () => {
    const canAsk = isSupported && typeof sendRequest === 'function';
    if (!canAsk) return Promise.resolve(roots);
    refreshing = sendRequest('roots/list', {}, timeoutMs)
      .then((result) => { roots = rootsFromList(result); return roots; })
      .catch((err) => { process.stderr.write(`[mcp] roots/list failed: ${err.message}\n`); return roots; })
      .finally(() => { refreshing = null; });
    return refreshing;
  };
  return {
    initialize: (params) => { isSupported = clientSupportsRoots(params); roots = rootsFromInitialize(params); },
    refresh,
    settled: async () => { if (refreshing) await refreshing; return roots; },
    current: () => roots
  };
};
