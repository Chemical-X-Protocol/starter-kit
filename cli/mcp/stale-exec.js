// Chooses where one MCP call runs. A current server runs it in-process. A stale server runs it in a
// fresh process that loads the code on disk; if that code does not load, mutating calls are refused
// and read-only calls run from the loaded (old) code under a warning.
export const FRESH_NOTICE = 'chemx MCP server code is stale; this call ran in a fresh process with the code on disk (slower). Reconnect via /mcp to restore speed.';

const loadWarning = (message, staleNotice) => `WARNING: ${staleNotice}. The code on disk does not load (${message}), so this read-only call ran on the old loaded code. Fix the load error, then reconnect via /mcp.`;

const refusal = (message) => `Refusing a mutating call: the chemx MCP server code is stale and the code on disk does not load (${message}). The code did not finish loading, so the call did not start. Fix the load error, or reconnect via /mcp.`;

const crashMessage = (message) => `The fresh process for this stale-server call died after the code loaded (${message}). The outcome is unknown and the call may have partly run: check the files it targeted before retrying.`;

const TIMEOUT_MESSAGE = 'the fresh process for this stale-server call timed out and was killed';

// Returns { execute, banners }. banners is filled while execute runs; read it after the call.
export const prepareExecution = ({ staleness, runFresh, runLoaded, isMutating, env }) => {
  const banners = [];
  const staleNotice = staleness?.check() ?? null;
  const isCurrent = staleNotice === null;
  if (isCurrent) return { execute: runLoaded, banners };
  let loadFailure = null;
  const addBanner = (text) => {
    const isFirst = banners.length === 0;
    if (isFirst) banners.push(text);
  };
  const onLoadFailure = (message, call) => {
    if (isMutating) throw new Error(refusal(message));
    loadFailure = message;
    addBanner(loadWarning(message, staleNotice));
    return runLoaded(...call);
  };
  const onFresh = (fresh) => {
    const isTimeout = fresh.kind === 'timeout';
    const isToolError = fresh.kind === 'error';
    const isCrash = fresh.kind === 'crash';
    if (isCrash) throw new Error(crashMessage(fresh.message));
    if (isTimeout) throw new Error(TIMEOUT_MESSAGE);
    addBanner(FRESH_NOTICE);
    if (isToolError) throw new Error(fresh.error);
    return fresh.output;
  };
  const execute = async (toolName, toolArgs, root) => {
    const hasFailedToLoad = loadFailure !== null;
    const fresh = hasFailedToLoad ? { kind: 'load', message: loadFailure } : await runFresh({ toolName, toolArgs, root, env });
    const isLoadFailure = fresh.kind === 'load';
    return isLoadFailure ? onLoadFailure(fresh.message, [toolName, toolArgs, root]) : onFresh(fresh);
  };
  return { execute, banners };
};
