// Bash lexer for hook guards: words (quotes removed), operators, redirections, comments, heredoc bodies.
// Command substitutions ($(...), backticks, <(...)) are captured per word so callers can recurse into them.
// Each scanner below consumes one construct and returns true, or returns false to let the next one try.

import { readBalanced, readBacktick, readDoubleQuoted, readSingleQuoted } from './shell-lexer-readers.js';
import { createLexState } from './shell-lexer-state.js';

const OPERATORS = ['&&', '||', ';;', '|&', '|', ';', '&', '(', ')'];
const REDIRECTS = ['<<<', '<<-', '&>>', '<<', '>>', '>&', '<&', '&>', '>|', '<>', '>', '<'];
const HEREDOC_OPS = new Set(['<<', '<<-']);
const BLANKS = new Set([' ', '\t', '\r']);
const FD_PATTERN = /^\d+$/;

const matchAt = (source, index, candidates) => candidates.find((candidate) => source.startsWith(candidate, index));

const scanBlank = (state) => {
  const char = state.peek();
  const isContinuation = char === '\\' && state.peek(1) === '\n';
  if (isContinuation) { state.index += 2; return true; }
  const isBlank = BLANKS.has(char);
  if (isBlank) { state.flushWord(); state.index += 1; }
  return isBlank;
};

const scanNewline = (state) => {
  const isNewline = state.peek() === '\n';
  if (!isNewline) return false;
  state.flushWord();
  state.tokens.push({ type: 'op', value: '\n' });
  state.index += 1;
  state.readHeredocBodies();
  return true;
};

const scanComment = (state) => {
  const isCommentStart = state.peek() === '#' && state.word === null;
  if (!isCommentStart) return false;
  const end = state.source.indexOf('\n', state.index);
  const stop = end === -1 ? state.source.length : end;
  state.tokens.push({ type: 'comment', value: state.source.slice(state.index + 1, stop) });
  state.index = stop;
  return true;
};

const scanQuoted = (state) => {
  const char = state.peek();
  const isAnsiC = char === '$' && state.peek(1) === "'";
  const quoteStart = isAnsiC ? state.index + 1 : state.index;
  const isEscape = char === '\\';
  if (isEscape) { state.append(state.peek(1) ?? '', state.source.slice(state.index, state.index + 2), true); state.index += 2; return true; }
  const isSingle = char === "'" || isAnsiC;
  if (isSingle) { const read = readSingleQuoted(state.source, quoteStart); state.append(read.value, read.raw, true); state.index = read.end; return true; }
  const isDouble = char === '"';
  if (!isDouble) return false;
  const read = readDoubleQuoted(state.source, state.index);
  state.append(read.value, read.raw, true, read.subs);
  state.index = read.end;
  return true;
};

const scanSubstitution = (state) => {
  const char = state.peek();
  const isBacktick = char === '`';
  if (isBacktick) { const read = readBacktick(state.source, state.index); state.append(read.raw, read.raw, false, [read.inner]); state.index = read.end; return true; }
  const isSubstitution = (char === '$' || char === '<' || char === '>') && state.peek(1) === '(';
  if (!isSubstitution) return false;
  const isArithmetic = state.peek(2) === '(';
  const read = readBalanced(state.source, state.index + 1);
  state.append(read.raw, state.source.slice(state.index, read.end), false, isArithmetic ? [] : [read.inner]);
  state.index = read.end;
  return true;
};

const scanRedirect = (state) => {
  const redirect = matchAt(state.source, state.index, REDIRECTS);
  if (!redirect) return false;
  const isFdPrefix = state.word !== null && !state.word.quoted && FD_PATTERN.test(state.word.value);
  const fd = isFdPrefix ? state.word.value : null;
  if (isFdPrefix) state.word = null;
  state.flushWord();
  const token = { type: 'redir', op: redirect, fd };
  state.tokens.push(token);
  const isHeredoc = HEREDOC_OPS.has(redirect);
  if (isHeredoc) state.expectHeredocDelimiter(token, redirect === '<<-');
  state.index += redirect.length;
  return true;
};

const scanOperator = (state) => {
  const operator = matchAt(state.source, state.index, OPERATORS);
  if (!operator) return false;
  state.flushWord();
  state.tokens.push({ type: 'op', value: operator });
  state.index += operator.length;
  return true;
};

const SCANNERS = [scanBlank, scanNewline, scanComment, scanQuoted, scanSubstitution, scanRedirect, scanOperator];

export const lexShell = (source) => {
  const state = createLexState(source);
  while (state.index < source.length) {
    const isConsumed = SCANNERS.some((scan) => scan(state));
    if (isConsumed) continue;
    state.append(state.peek(), state.peek());
    state.index += 1;
  }
  state.flushWord();
  return state.tokens;
};
