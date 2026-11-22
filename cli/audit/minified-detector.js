/**
 * Fast O(N) detector for minified or bundled script sources (e.g. single-file esbuild bundles
 * or inline vendored libraries). Lets audit and reader short-circuit before AST traversal.
 */
const LONG_LINE_MIN_CHARS = 2000;
const SINGLE_MEGA_LINE_CHARS = 8000;
const COMBINED_LONG_CHARS = 10000;
const LONG_CHAR_RATIO = 0.35;

const EMPTY_RESULT = Object.freeze({
  isMinified: false,
  maxLineLength: 0,
  longLineCount: 0,
  longLineChars: 0,
  totalChars: 0,
  firstLongLine: 0
});

/** Detects whether source code is predominantly minified or contains a bundled mega-line. */
export const detectMinifiedSource = (code = '') => {
  const isNotString = typeof code !== 'string';
  const isEmptyString = isNotString || code.length === 0;
  if (isEmptyString) return { ...EMPTY_RESULT };

  let maxLineLength = 0;
  let longLineCount = 0;
  let longLineChars = 0;
  let totalChars = 0;
  let firstLongLine = 0;
  let lineStart = 0;
  let lineNum = 0;

  while (lineStart <= code.length) {
    const nextBreak = code.indexOf('\n', lineStart);
    const hasNoBreak = nextBreak === -1;
    const lineEnd = hasNoBreak ? code.length : nextBreak;
    lineNum += 1;

    const lineLen = lineEnd - lineStart;
    const hasLineContent = lineLen > 0;
    if (hasLineContent) {
      const trimmedLen = code.slice(lineStart, lineEnd).trim().length;
      totalChars += trimmedLen;
      const isNewMax = trimmedLen > maxLineLength;
      if (isNewMax) maxLineLength = trimmedLen;
      const isLongLine = trimmedLen >= LONG_LINE_MIN_CHARS;
      if (isLongLine) {
        longLineCount += 1;
        longLineChars += trimmedLen;
        const isFirstLong = firstLongLine === 0;
        if (isFirstLong) firstLongLine = lineNum;
      }
    }

    if (hasNoBreak) break;
    lineStart = nextBreak + 1;
  }

  const hasSingleMegaLine = maxLineLength >= SINGLE_MEGA_LINE_CHARS;
  const longRatio = totalChars > 0 ? longLineChars / totalChars : 0;
  const hasLongLines = longLineCount >= 1;
  const hasEnoughLongChars = longLineChars >= COMBINED_LONG_CHARS;
  const hasHighLongRatio = longRatio >= LONG_CHAR_RATIO;
  const hasDominantLongLines = hasLongLines && hasEnoughLongChars && hasHighLongRatio;
  const isMinified = hasSingleMegaLine || hasDominantLongLines;
  return { isMinified, maxLineLength, longLineCount, longLineChars, totalChars, firstLongLine };
};
