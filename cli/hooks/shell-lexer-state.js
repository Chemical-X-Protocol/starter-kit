// Mutable cursor shared by the shell-lexer scanners: current word, emitted tokens, pending heredocs.

const newWord = () => ({ type: 'word', value: '', raw: '', quoted: false, subs: [] });

// Consume heredoc bodies that start after a newline; returns the index after the last body.
const readHeredocBodies = (source, start, pending) => {
  let index = start;
  for (const redirect of pending) {
    const lines = [];
    while (index < source.length) {
      const lineEnd = source.indexOf('\n', index);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(index, stop);
      index = Math.min(stop + 1, source.length);
      const candidate = redirect.stripTabs ? line.replace(/^\t+/, '') : line;
      const isDelimiter = candidate.trim() === redirect.delim;
      if (isDelimiter) break;
      lines.push(line);
    }
    redirect.body = lines.join('\n');
  }
  return index;
};

export const createLexState = (source) => {
  const pendingHeredocs = [];
  let awaitingDelimiter = null;
  const state = { source, index: 0, tokens: [], word: null };
  Object.assign(state, {
    peek: (offset = 0) => source[state.index + offset],
    append: (value, raw, quoted = false, subs = []) => {
      state.word ??= newWord();
      state.word.value += value;
      state.word.raw += raw;
      state.word.quoted ||= quoted;
      state.word.subs.push(...subs);
    },
    flushWord: () => {
      const hasWord = state.word !== null;
      if (!hasWord) return;
      state.tokens.push(state.word);
      const isDelimiterWord = awaitingDelimiter !== null;
      if (isDelimiterWord) {
        awaitingDelimiter.delim = state.word.value;
        pendingHeredocs.push(awaitingDelimiter);
        awaitingDelimiter = null;
      }
      state.word = null;
    },
    expectHeredocDelimiter: (token, stripTabs) => {
      token.stripTabs = stripTabs;
      awaitingDelimiter = token;
    },
    readHeredocBodies: () => {
      state.index = readHeredocBodies(source, state.index, pendingHeredocs.splice(0));
    },
  });
  return state;
};
