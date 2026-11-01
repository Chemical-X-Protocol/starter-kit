/**
 * Annotation window for a C# shallow catch, in the shape suppressions.js reads: the catch's
 * own lines (line..endLine) and 0-based columns of the catch keyword (catchColumn), its closing
 * brace (endColumn), the try that owns it (tryLine, tryColumn, and tryBraceLine/tryBraceColumn
 * just past the try block's closing brace) and where a trailing annotation stops being this
 * catch's (trailEndColumn). Severity stays at the registry MEDIUM with no escalation, because
 * C# definite assignment (CS0165) already rejects reading an unset local.
 */
const BRACE_DEPTH_STEP = Object.freeze({ '}': 1, '{': -1 });
const FORWARD_DEPTH_STEP = Object.freeze({ '{': 1, '}': -1 });
const TRY_KEYWORD = /\btry\b/;
// What opens a try block, a finally or a catch clause (with its type and when-filter).
const TRY_PART_OPENER = /\b(?:try|finally)$|\bcatch\b[^{};]*$/;

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

const lineAt = (content, index) => (content.slice(0, index).match(/\n/g) || []).length + 1;
const columnAt = (content, index) => index - (content.lastIndexOf('\n', index - 1) + 1);

// The closing brace right before the catch keyword, past masked comments and blank lines.
const findBraceBefore = (maskedContent, index) => {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(maskedContent[cursor])) cursor -= 1;
  return maskedContent[cursor] === '}' ? cursor : -1;
};

// The try keyword and try block brace that own this catch, when the brace right before the
// catch keyword closes a block opened by try (not an earlier catch, an if or another block).
const findOwningTry = (match, maskedContent) => {
  const braceIndex = findBraceBefore(maskedContent, match.index);
  const openIndex = braceIndex === -1 ? -1 : findOpeningBrace(maskedContent, braceIndex);
  const hasOpeningBrace = openIndex !== -1;
  if (!hasOpeningBrace) return null;
  const beforeOpen = maskedContent.slice(0, openIndex).trimEnd();
  const isTryBlock = /\btry$/.test(beforeOpen);
  return isTryBlock ? { braceIndex, tryIndex: beforeOpen.length - 'try'.length } : null;
};

const closesTryPart = (maskedContent, closeIndex) => {
  const openIndex = findOpeningBrace(maskedContent, closeIndex);
  return openIndex !== -1 && TRY_PART_OPENER.test(maskedContent.slice(0, openIndex).trimEnd());
};

// Offset on the catch's last line where a trailing annotation stops being this catch's: a later
// try keyword, or the brace of an enclosing try block, catch or finally; -1 when neither occurs.
const findTrailEnd = (maskedContent, endIndex) => {
  const newline = maskedContent.indexOf('\n', endIndex);
  const lineEnd = newline === -1 ? maskedContent.length : newline;
  const tryAt = maskedContent.slice(endIndex, lineEnd).search(TRY_KEYWORD);
  const limit = tryAt === -1 ? lineEnd : endIndex + tryAt;
  let depth = 0;
  for (let i = endIndex; i < limit; i += 1) {
    const isUnmatchedClose = maskedContent[i] === '}' && depth === 0;
    const isTryPartClose = isUnmatchedClose && closesTryPart(maskedContent, i);
    if (isTryPartClose) return i;
    depth = Math.max(0, depth + (FORWARD_DEPTH_STEP[maskedContent[i]] ?? 0));
  }
  return tryAt === -1 ? -1 : limit;
};

/** Span fields for one regex catch match starting at lineNum (see the header for each one). */
export const resolveCSharpCatchSpan = (match, { content, maskedContent }, lineNum) => {
  const matchEnd = match.index + match[0].length;
  const endLine = lineNum + (match[0].match(/\n/g) || []).length;
  const span = { endLine, catchColumn: columnAt(content, match.index), endColumn: columnAt(content, matchEnd) };
  const trailEnd = findTrailEnd(maskedContent, matchEnd);
  const hasTrailEnd = trailEnd !== -1;
  if (hasTrailEnd) span.trailEndColumn = columnAt(content, trailEnd);
  const owner = findOwningTry(match, maskedContent);
  if (!owner) return span;
  return {
    ...span,
    tryLine: lineAt(content, owner.tryIndex),
    tryColumn: columnAt(content, owner.tryIndex),
    tryBraceLine: lineAt(content, owner.braceIndex),
    tryBraceColumn: columnAt(content, owner.braceIndex) + 1
  };
};
