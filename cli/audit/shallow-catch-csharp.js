/**
 * Annotation window for a C# shallow catch, in the shape suppressions.js reads: the catch's
 * own lines (line..endLine) and, Stroustrup style, the text after the try block's closing
 * brace on the line above. Severity stays at the registry MEDIUM with no escalation, because
 * C# definite assignment (CS0165) already rejects reading an unset local.
 */
const CLOSING_BRACE_LINE = /^\s*\}/;
const BRACE_DEPTH_STEP = Object.freeze({ '}': 1, '{': -1 });

// Backward brace match over masked content (comments and strings blanked, same offsets), so
// braces quoted in strings never shift it.
const findOpeningBrace = (maskedContent, closeIndex) => {
  let depth = 0;
  for (let i = closeIndex - 1; i >= 0; i -= 1) {
    const ch = maskedContent[i];
    const isOpen = ch === '{';
    const isMatchingOpen = isOpen && depth === 0;
    if (isMatchingOpen) return i;
    depth += BRACE_DEPTH_STEP[ch] ?? 0;
  }
  return -1;
};

const isOpenedByTry = (maskedContent, openIndex) => /\btry$/.test(maskedContent.slice(0, openIndex).trimEnd());

// The brace on the line above qualifies only when the catch keyword starts its own line and
// the block that brace closes was opened by a try keyword (not an inner catch or an if).
const findTryBraceAbove = (match, content, maskedContent) => {
  const catchLineStart = content.lastIndexOf('\n', match.index - 1) + 1;
  const isCatchLeading = content.slice(catchLineStart, match.index).trim() === '';
  const hasLineAbove = catchLineStart > 0;
  const canTrailTryBrace = isCatchLeading && hasLineAbove;
  if (!canTrailTryBrace) return null;
  const lineAboveStart = content.lastIndexOf('\n', catchLineStart - 2) + 1;
  const lineAbove = content.slice(lineAboveStart, catchLineStart - 1);
  const isBraceLine = CLOSING_BRACE_LINE.test(lineAbove);
  if (!isBraceLine) return null;
  const braceColumn = lineAbove.indexOf('}');
  const openIndex = findOpeningBrace(maskedContent, lineAboveStart + braceColumn);
  const isTryBrace = openIndex >= 0 && isOpenedByTry(maskedContent, openIndex);
  return isTryBrace ? { tryBraceColumn: braceColumn + 1 } : null;
};

/** { endLine, tryBraceLine?, tryBraceColumn? } for one regex catch match starting at lineNum. */
export const resolveCSharpCatchSpan = (match, { content, maskedContent }, lineNum) => {
  const endLine = lineNum + (match[0].match(/\n/g) || []).length;
  const tryBrace = findTryBraceAbove(match, content, maskedContent);
  return tryBrace ? { endLine, tryBraceLine: lineNum - 1, ...tryBrace } : { endLine };
};
