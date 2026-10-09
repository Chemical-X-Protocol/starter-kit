// The read cards (connections, trace, backtrace, context) need the index stack, about 130ms of
// CPU to load. A plain `chemx read` must not pay for it (wrappers-startup.spec), so reader-cards.js
// loads only when a card is requested: callers await loadReadCards() before the synchronous read.

const EMPTY_CARDS = Object.freeze({ connection: '', context: '', trace: '', backtrace: '', freshness: '' });
const CARD_FLAG = /^--(connections$|trace=|backtrace=)/;

let loadedBuilder = null;

export const wantsReadCards = (flags = {}) => {
  const wantsContext = Boolean(flags.context && flags.symbol);
  return Boolean(flags.connections || wantsContext || flags.traceSymbol || flags.backtraceSymbol);
};

// argv form of wantsReadCards, for the CLI router before it calls runReaderCli.
export const argsWantReadCards = (args = []) => args.some((arg) => CARD_FLAG.test(String(arg)));

export const loadReadCards = async () => {
  loadedBuilder = loadedBuilder ?? (await import('./reader-cards.js')).buildReadCards;
  return loadedBuilder;
};

export const buildRequestedReadCards = (cwd, targetPath, flags = {}) => {
  const isNothingRequested = !wantsReadCards(flags);
  if (isNothingRequested) return { ...EMPTY_CARDS };
  const isBuilderMissing = loadedBuilder === null;
  if (isBuilderMissing) throw new Error('read cards were requested before loadReadCards() resolved');
  return loadedBuilder(cwd, targetPath, flags);
};
