/**
 * Masks C# comments and string and char literals with spaces, keeping newlines and offsets, so the
 * C# scans (catch clauses, try and catch keywords, braces, methods) never read quoted or
 * commented text. Literals: 'c' chars, "regular" and @"verbatim" ("" is a quote in it) strings,
 * $"interpolated" and $@"..." or @$"..." verbatim interpolated strings, and raw """...""" strings
 * with any $ prefix. In an interpolated string {{ and }} are text and a {hole} is code: its own
 * literals and comments are skipped whole and its braces counted, so a quote or a brace inside a
 * hole never ends the string. A raw string's hole opens with as many braces as it has dollars. A
 * regular string, interpolated or not, still ends at its line's end when it is unterminated.
 */
const BACKSLASH = '\\';
const QUOTE = '"';
const APOSTROPHE = "'";
const RAW_MIN_QUOTES = 3;
const BRACE_STEP = Object.freeze({ '{': 1, '}': -1 });

const countRun = (code, index, char) => {
  let end = index;
  while (code[end] === char) end += 1;
  return end - index;
};

// Index just past a // or /* comment at index (a line comment stops before its newline, an
// unterminated block runs to the end), or -1 when none starts there.
const findCommentEnd = (code, index) => {
  const isLineComment = code.startsWith('//', index);
  if (isLineComment) {
    const newline = code.indexOf('\n', index);
    return newline === -1 ? code.length : newline;
  }
  const isBlockComment = code.startsWith('/*', index);
  if (!isBlockComment) return -1;
  const closeAt = code.indexOf('*/', index + 2);
  return closeAt === -1 ? code.length : closeAt + 2;
};

// Past a body that ends at quote, with backslash escapes, stopping before a newline when it is
// unterminated (a regular string or a char literal).
const skipQuoted = (code, index, quote) => {
  let cursor = index;
  while (cursor < code.length && code[cursor] !== quote && code[cursor] !== '\n') {
    cursor += code[cursor] === BACKSLASH ? 2 : 1;
  }
  const isClosed = cursor < code.length && code[cursor] === quote;
  return isClosed ? cursor + 1 : cursor;
};

// Past a verbatim body, which may span lines and holds a quote as "".
const skipVerbatim = (code, index) => {
  let cursor = index;
  while (cursor < code.length) {
    const isEscapedQuote = code.startsWith('""', cursor);
    const isClosingQuote = !isEscapedQuote && code[cursor] === QUOTE;
    if (isClosingQuote) return cursor + 1;
    cursor += isEscapedQuote ? 2 : 1;
  }
  return cursor;
};

// Past the braces that close a hole whose code starts at index. A literal or comment in it is
// skipped whole and its own braces are counted; a hole of a one-line string stops at the newline.
const skipHole = (code, index, braces, isOneLine) => {
  const closer = '}'.repeat(braces);
  let depth = 0;
  let cursor = index;
  while (cursor < code.length) {
    const char = code[cursor];
    const isLineEnd = char === '\n' && isOneLine;
    if (isLineEnd) return cursor;
    const skippedEnd = findMaskedEnd(code, cursor);
    const isSkipped = skippedEnd !== -1;
    const closesHole = !isSkipped && depth === 0 && code.startsWith(closer, cursor);
    if (closesHole) return cursor + braces;
    if (!isSkipped) depth = Math.max(0, depth + (BRACE_STEP[char] ?? 0));
    cursor = isSkipped ? skippedEnd : cursor + 1;
  }
  return cursor;
};

// Past an interpolated body: regular ones end at their line's end when unterminated and take
// backslash escapes, verbatim ones may span lines and hold a quote as "".
const skipInterpolated = (code, index, isVerbatim) => {
  let cursor = index;
  while (cursor < code.length) {
    const char = code[cursor];
    const isLineEnd = char === '\n' && !isVerbatim;
    if (isLineEnd) return cursor;
    const isEscape = isVerbatim ? code.startsWith('""', cursor) : char === BACKSLASH;
    const isTextBrace = code.startsWith('{{', cursor) || code.startsWith('}}', cursor);
    const isPair = isEscape || isTextBrace;
    const isClosingQuote = !isPair && char === QUOTE;
    if (isClosingQuote) return cursor + 1;
    const opensHole = !isPair && char === '{';
    if (opensHole) cursor = skipHole(code, cursor + 1, 1, !isVerbatim);
    else cursor += isPair ? 2 : 1;
  }
  return cursor;
};

// Past a raw body that ends at the same run of quotes that opened it. With dollars, a run of at
// least that many braces opens a hole (the braces before its last ones are text).
const skipRaw = (code, index, quotes, dollars) => {
  const closer = QUOTE.repeat(quotes);
  let cursor = index;
  while (cursor < code.length) {
    const isClosed = code.startsWith(closer, cursor);
    if (isClosed) return cursor + quotes;
    const braceRun = dollars > 0 ? countRun(code, cursor, '{') : 0;
    const opensHole = braceRun > 0 && braceRun >= dollars;
    if (opensHole) cursor = skipHole(code, cursor + braceRun, dollars, false);
    else cursor += Math.max(braceRun, 1);
  }
  return cursor;
};

// Index just past the string or char literal that starts at index, or -1 when none starts there.
const findLiteralEnd = (code, index) => {
  const isChar = code[index] === APOSTROPHE;
  if (isChar) return skipQuoted(code, index + 1, APOSTROPHE);
  const isVerbatim = code.startsWith('@"', index);
  if (isVerbatim) return skipVerbatim(code, index + 2);
  const isVerbatimInterpolated = code.startsWith('@$"', index) || code.startsWith('$@"', index);
  if (isVerbatimInterpolated) return skipInterpolated(code, index + 3, true);
  const dollars = countRun(code, index, '$');
  const quotes = countRun(code, index + dollars, QUOTE);
  const isRaw = quotes >= RAW_MIN_QUOTES;
  if (isRaw) return skipRaw(code, index + dollars + quotes, quotes, dollars);
  const isQuoted = quotes > 0;
  if (!isQuoted) return -1;
  const isRegular = dollars === 0;
  if (isRegular) return skipQuoted(code, index + 1, QUOTE);
  return dollars === 1 ? skipInterpolated(code, index + 2, false) : -1;
};

// Index just past the comment or literal at index, or -1 when code starts there.
const findMaskedEnd = (code, index) => {
  const commentEnd = findCommentEnd(code, index);
  return commentEnd === -1 ? findLiteralEnd(code, index) : commentEnd;
};

const blank = (text) => text.replace(/[^\n]/g, ' ');

export const maskCommentsAndStrings = (code) => {
  const parts = [];
  let copiedTo = 0;
  let cursor = 0;
  while (cursor < code.length) {
    const maskedEnd = findMaskedEnd(code, cursor);
    const isCode = maskedEnd === -1;
    if (isCode) {
      cursor += 1;
      continue;
    }
    const end = Math.min(maskedEnd, code.length);
    parts.push(code.slice(copiedTo, cursor), blank(code.slice(cursor, end)));
    copiedTo = end;
    cursor = end;
  }
  parts.push(code.slice(copiedTo));
  return parts.join('');
};
