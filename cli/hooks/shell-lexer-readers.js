// Quote and substitution readers for shell-lexer.js. Each returns { value|inner, raw, end } where
// end is the index just past the construct. Unterminated constructs run to the end of the source.

const DOUBLE_QUOTE_ESCAPES = new Set(['"', '\\', '$', '`', '\n']);

export const readSingleQuoted = (source, start) => {
  const close = source.indexOf("'", start + 1);
  const end = close === -1 ? source.length : close + 1;
  const value = source.slice(start + 1, close === -1 ? source.length : close);
  return { value, raw: source.slice(start, end), end };
};

export const readBacktick = (source, start) => {
  let index = start + 1;
  while (index < source.length && source[index] !== '`') {
    index += source[index] === '\\' ? 2 : 1;
  }
  const end = Math.min(index + 1, source.length);
  return { inner: source.slice(start + 1, Math.min(index, source.length)), raw: source.slice(start, end), end };
};

// Read a parenthesised region starting at `open` (the '(' index), honouring nested quotes and parens.
export const readBalanced = (source, open) => {
  let depth = 0;
  let index = open;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') { index += 2; continue; }
    if (char === "'") { index = readSingleQuoted(source, index).end; continue; }
    if (char === '"') { index = readDoubleQuoted(source, index).end; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    index += 1;
    const isClosed = depth === 0;
    if (isClosed) break;
  }
  const innerEnd = source[index - 1] === ')' ? index - 1 : index;
  return { inner: source.slice(open + 1, innerEnd), raw: source.slice(open - 1, index), end: index };
};

export const readDoubleQuoted = (source, start) => {
  let value = '';
  const subs = [];
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    const char = source[index];
    const isEscape = char === '\\' && DOUBLE_QUOTE_ESCAPES.has(source[index + 1]);
    if (isEscape) { value += source[index + 1] === '\n' ? '' : source[index + 1]; index += 2; continue; }
    const isSubstitution = char === '$' && source[index + 1] === '(';
    if (isSubstitution) {
      const read = readBalanced(source, index + 1);
      const isArithmetic = source[index + 2] === '(';
      if (!isArithmetic) subs.push(read.inner);
      value += source.slice(index, read.end);
      index = read.end;
      continue;
    }
    if (char === '`') {
      const read = readBacktick(source, index);
      subs.push(read.inner);
      value += read.raw;
      index = read.end;
      continue;
    }
    value += char;
    index += 1;
  }
  const end = Math.min(index + 1, source.length);
  return { value, subs, raw: source.slice(start, end), end };
};
