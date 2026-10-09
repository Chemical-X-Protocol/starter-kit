/**
 * Single-pass SQL masker for the UI console guard.
 * Walks the input left to right the way the SQLite tokenizer does, so the guard
 * sees the same statement boundaries SQLite sees. Comments become a space,
 * quoted strings and identifiers become an empty placeholder of the same quote.
 * Returns { code, isWellFormed }: unterminated quotes or a NUL byte are not well formed.
 */

const QUOTE_CLOSERS = { "'": "'", '"': '"', '`': '`', '[': ']' };

const findQuoteEnd = (sql, start, closer) => {
  const allowsDoubling = closer !== ']';
  let i = start + 1;
  while (i < sql.length) {
    const isCloser = sql[i] === closer;
    const isDoubled = isCloser && allowsDoubling && sql[i + 1] === closer;
    if (isDoubled) { i += 2; continue; }
    if (isCloser) return i;
    i += 1;
  }
  return -1;
};

const findLineCommentEnd = (sql, start) => {
  const newline = sql.indexOf('\n', start);
  return newline === -1 ? sql.length : newline;
};

const findBlockCommentEnd = (sql, start) => {
  const close = sql.indexOf('*/', start + 2);
  return close === -1 ? sql.length : close + 2;
};

export const maskSqlLiteralsAndComments = (sql = '') => {
  const text = String(sql);
  const hasNul = text.includes('\u0000');
  if (hasNul) return { code: '', isWellFormed: false };
  let code = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const pair = text.slice(i, i + 2);
    const isLineComment = pair === '--';
    const isBlockComment = pair === '/*';
    const closer = QUOTE_CLOSERS[ch];
    const isQuoteStart = Boolean(closer);
    if (isLineComment) { code += ' '; i = findLineCommentEnd(text, i); continue; }
    if (isBlockComment) { code += ' '; i = findBlockCommentEnd(text, i); continue; }
    if (isQuoteStart) {
      const end = findQuoteEnd(text, i, closer);
      const isUnterminated = end === -1;
      if (isUnterminated) return { code, isWellFormed: false };
      code += ch + closer;
      i = end + 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  return { code, isWellFormed: true };
};
