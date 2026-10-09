// Runners are spawned in their own process group so a timeout can kill `npm run x` and the
// runner it started. The cost: a signal aimed at chemx (Ctrl+C, `timeout`, a harness kill)
// no longer reaches them. This registry forwards those signals to every live runner group,
// and kills them when chemx exits, so a runner can never outlive the chemx that started it.

export const canSignalGroups = process.platform !== 'win32';

const FORWARDED_SIGNALS = canSignalGroups ? ['SIGINT', 'SIGTERM', 'SIGHUP'] : ['SIGINT'];
const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });

const activeChildren = new Set();

// Returns whether the group signal landed; on failure it falls back to the direct child.
export const killTree = (child, signal) => {
  try {
    if (canSignalGroups) process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    child.kill(signal);
    return error.code !== 'ESRCH';
  }
};

const killAll = (signal) => {
  for (const child of activeChildren) killTree(child, signal);
};

// chemx exits with the conventional 128+n code unless the host (MCP server, UI server) has its
// own handler for this signal; then the host decides when to exit.
const onSignal = (signal) => {
  killAll(signal);
  const hasHostHandler = process.listenerCount(signal) > 1;
  if (hasHostHandler) return;
  process.exit(SIGNAL_EXIT_CODES[signal]);
};

const onExit = () => killAll('SIGTERM');
const signalHandlers = Object.fromEntries(FORWARDED_SIGNALS.map((signal) => [signal, () => onSignal(signal)]));

const setListening = (shouldListen) => {
  const method = shouldListen ? 'on' : 'removeListener';
  for (const signal of FORWARDED_SIGNALS) process[method](signal, signalHandlers[signal]);
  process[method]('exit', onExit);
};

export const trackChild = (child) => {
  const isFirstChild = activeChildren.size === 0;
  activeChildren.add(child);
  if (isFirstChild) setListening(true);
};

export const untrackChild = (child) => {
  const wasTracked = activeChildren.delete(child);
  const isLastChild = wasTracked && activeChildren.size === 0;
  if (isLastChild) setListening(false);
};
