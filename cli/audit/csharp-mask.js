/**
 * Masks C# comments and string and char literals with spaces, keeping newlines and offsets, so the
 * C# scans (catch clauses, try and catch keywords, braces, methods) never read quoted or
 * commented text. Literals: 'c' chars, "regular" and @"verbatim" ("" is a quote in it) strings,
 * $"interpolated" and $@"..." or @$"..." verbatim interpolated strings, and raw """...""" strings
 * with any $ prefix. In an interpolated string {{ and }} are text and a {hole} is code. The mask
 * blanks the string's text, each hole's braces and format (from a colon outside any bracket to the
 * closing braces), and the comments and literals in the hole's code, whose other code stays, so a
 * try/catch in a lambda there is still read and a quote or a brace in the hole's own literals
 * never ends the string. A raw string's hole opens with as many braces as it has dollars. A
 * regular string, interpolated or not, still ends at its line's end when it is unterminated.
 * maskWholeStrings blanks each string with its holes, for the method scans (complexity, nesting),
 * whose counts read no hole code; listCommentPositions gives where each masked comment sits.
 */
const BACKSLASH = '\\';
const QUOTE = '"';
const APOSTROPHE = "'";
const RAW_MIN_QUOTES = 3;
const FORMAT_COLON = ':';
const BRACE_STEP = Object.freeze({ '{': 1, '}': -1 });
const BRACKET_STEP = Object.freeze({ '(': 1, ')': -1, '[': 1, ']': -1 });

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
  return isClosed ? cursor + 1 : Math.min(cursor, code.length);
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

// Records [start, end) as masked text and returns end.
const finishText = (spans, start, end) => {
  const hasText = end > start;
  if (hasText) spans.blanks.push([start, end]);
  return end;
};

// Where a hole's code ends: at its closing braces, at a format colon outside any brace or bracket,
// or at the newline of a one-line string. The comments and literals in it go to spans.
const scanHoleCode = (code, index, closer, isOneLine, spans) => {
  let braceDepth = 0;
  let bracketDepth = 0;
  let cursor = index;
  while (cursor < code.length) {
    const char = code[cursor];
    const isLineEnd = char === '\n' && isOneLine;
    if (isLineEnd) return cursor;
    const maskedEnd = scanMaskedAt(code, cursor, spans);
    const isMasked = maskedEnd !== -1;
    const isOutermost = !isMasked && braceDepth === 0;
    const opensFormat = isOutermost && bracketDepth === 0 && char === FORMAT_COLON;
    const closesHole = isOutermost && code.startsWith(closer, cursor);
    const endsCode = opensFormat || closesHole;
    if (endsCode) return cursor;
    if (!isMasked) {
      braceDepth = Math.max(0, braceDepth + (BRACE_STEP[char] ?? 0));
      bracketDepth = Math.max(0, bracketDepth + (BRACKET_STEP[char] ?? 0));
    }
    cursor = isMasked ? maskedEnd : cursor + 1;
  }
  return cursor;
};

// Past a hole's format text and closing braces from where its code ends; a hole of a one-line
// string stops at the newline.
const skipHoleTail = (code, index, closer, isOneLine) => {
  let cursor = index;
  while (cursor < code.length && !code.startsWith(closer, cursor)) {
    const isLineEnd = code[cursor] === '\n' && isOneLine;
    if (isLineEnd) return cursor;
    cursor += 1;
  }
  return Math.min(cursor + closer.length, code.length);
};

// A hole whose code starts at codeStart: the text from runStart through its opening braces is
// masked, then its code is scanned. Returns where that code ends and the index past the hole.
const scanHole = (code, { runStart, codeStart, closer, isOneLine }, spans) => {
  finishText(spans, runStart, codeStart);
  const codeEnd = scanHoleCode(code, codeStart, closer, isOneLine, spans);
  return { codeEnd, end: skipHoleTail(code, codeEnd, closer, isOneLine) };
};

// Past an interpolated body at index whose literal starts at start: regular ones end at their
// line's end when unterminated and take backslash escapes, verbatim ones may span lines and hold a
// quote as "". Its text outside the holes' code goes to spans.
const scanInterpolated = (code, start, index, isVerbatim, spans) => {
  const isOneLine = !isVerbatim;
  let runStart = start;
  let cursor = index;
  while (cursor < code.length) {
    const char = code[cursor];
    const isLineEnd = char === '\n' && isOneLine;
    if (isLineEnd) return finishText(spans, runStart, cursor);
    const isEscape = isVerbatim ? code.startsWith('""', cursor) : char === BACKSLASH;
    const isTextBrace = code.startsWith('{{', cursor) || code.startsWith('}}', cursor);
    const isPair = isEscape || isTextBrace;
    const isClosingQuote = !isPair && char === QUOTE;
    if (isClosingQuote) return finishText(spans, runStart, cursor + 1);
    const opensHole = !isPair && char === '{';
    if (!opensHole) {
      cursor += isPair ? 2 : 1;
      continue;
    }
    const hole = scanHole(code, { runStart, codeStart: cursor + 1, closer: '}', isOneLine }, spans);
    runStart = hole.codeEnd;
    cursor = hole.end;
  }
  return finishText(spans, runStart, cursor);
};

// Past a raw body at index that ends at the same run of quotes that opened it. With dollars, a run
// of at least that many braces opens a hole (the braces before its last ones are text).
const scanRaw = (code, start, index, { quotes, dollars }, spans) => {
  const closer = QUOTE.repeat(quotes);
  const holeCloser = '}'.repeat(dollars);
  let runStart = start;
  let cursor = index;
  while (cursor < code.length) {
    const isClosed = code.startsWith(closer, cursor);
    if (isClosed) return finishText(spans, runStart, cursor + quotes);
    const braceRun = dollars > 0 ? countRun(code, cursor, '{') : 0;
    const opensHole = braceRun > 0 && braceRun >= dollars;
    if (!opensHole) {
      cursor += Math.max(braceRun, 1);
      continue;
    }
    const hole = scanHole(code, { runStart, codeStart: cursor + braceRun, closer: holeCloser, isOneLine: false }, spans);
    runStart = hole.codeEnd;
    cursor = hole.end;
  }
  return finishText(spans, runStart, cursor);
};

// Index just past the string or char literal that starts at index, or -1 when none starts there.
const scanLiteralAt = (code, index, spans) => {
  const isChar = code[index] === APOSTROPHE;
  if (isChar) return finishText(spans, index, skipQuoted(code, index + 1, APOSTROPHE));
  const isVerbatim = code.startsWith('@"', index);
  if (isVerbatim) return finishText(spans, index, skipVerbatim(code, index + 2));
  const isVerbatimInterpolated = code.startsWith('@$"', index) || code.startsWith('$@"', index);
  if (isVerbatimInterpolated) return scanInterpolated(code, index, index + 3, true, spans);
  const dollars = countRun(code, index, '$');
  const quotes = countRun(code, index + dollars, QUOTE);
  const isRaw = quotes >= RAW_MIN_QUOTES;
  if (isRaw) return scanRaw(code, index, index + dollars + quotes, { quotes, dollars }, spans);
  const isQuoted = quotes > 0;
  if (!isQuoted) return -1;
  const isRegular = dollars === 0;
  if (isRegular) return finishText(spans, index, skipQuoted(code, index + 1, QUOTE));
  return dollars === 1 ? scanInterpolated(code, index, index + 2, false, spans) : -1;
};

// Index just past the comment or literal at index, or -1 when code starts there; what it masks
// goes to spans.blanks, and a comment also to spans.comments.
const scanMaskedAt = (code, index, spans) => {
  const commentEnd = findCommentEnd(code, index);
  const isComment = commentEnd !== -1;
  if (!isComment) return scanLiteralAt(code, index, spans);
  spans.comments.push([index, commentEnd]);
  return finishText(spans, index, commentEnd);
};

// In order: blanks, every [start, end) the mask covers (comments, literal text, the holes' braces
// and formats, and the comments and literals in hole code); comments, every comment, holes' ones
// included; wholes, each outermost comment or literal with its holes.
const scanMaskedSpans = (code) => {
  const spans = { blanks: [], comments: [], wholes: [] };
  let cursor = 0;
  while (cursor < code.length) {
    const maskedEnd = scanMaskedAt(code, cursor, spans);
    const isCode = maskedEnd === -1;
    if (!isCode) spans.wholes.push([cursor, maskedEnd]);
    cursor = isCode ? cursor + 1 : maskedEnd;
  }
  return spans;
};

const blank = (text) => text.replace(/[^\n]/g, ' ');

const blankSpans = (code, spans) => {
  const parts = [];
  let copiedTo = 0;
  for (const [start, end] of spans) {
    parts.push(code.slice(copiedTo, start), blank(code.slice(start, end)));
    copiedTo = end;
  }
  parts.push(code.slice(copiedTo));
  return parts.join('');
};

export const maskCommentsAndStrings = (code) => blankSpans(code, scanMaskedSpans(code).blanks);

export const maskWholeStrings = (code) => blankSpans(code, scanMaskedSpans(code).wholes);

// The 1-based line and 0-based column of each offset, for offsets in ascending order.
const locateOffsets = (code, offsets) => {
  let line = 1;
  let lineStart = 0;
  let scanned = 0;
  return offsets.map((offset) => {
    while (scanned < offset) {
      const isNewline = code[scanned] === '\n';
      if (isNewline) {
        line += 1;
        lineStart = scanned + 1;
      }
      scanned += 1;
    }
    return { line, column: offset - lineStart };
  });
};

/** Each comment the mask covers, as { start, end } with 1-based lines and 0-based columns, as Babel places a comment. */
export const listCommentPositions = (code) => {
  const { comments } = scanMaskedSpans(code);
  const positions = locateOffsets(code, comments.flat());
  return comments.map((_, i) => ({ start: positions[2 * i], end: positions[2 * i + 1] }));
};
