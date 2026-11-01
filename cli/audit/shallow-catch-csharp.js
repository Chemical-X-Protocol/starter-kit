/**
 * C# shallow catches. findCSharpShallowCatches scans masked content (comments and strings
 * blanked, offsets and newlines kept) for a catch clause, with an optional (type) and an optional
 * when (filter), whose body is empty once comments are blanked, so a comment-only body counts and
 * catch text inside a string or a comment never does.
 *
 * Annotation window for a C# shallow catch, in the shape suppressions.js reads: the catch's
 * own lines (line..endLine) and 0-based columns of the catch keyword (catchColumn, which is
 * also the finding's column, so two catches on one line are two findings), its closing brace
 * (endColumn), the try that owns it (tryLine, tryColumn, and tryBraceLine/tryBraceColumn just
 * past the try block's closing brace) and where a trailing annotation stops being this catch's
 * (trailEndColumn). Severity stays at the registry MEDIUM with no escalation, because C#
 * definite assignment (CS0165) already rejects reading an unset local.
 */
const BRACE_DEPTH_STEP = Object.freeze({ '}': 1, '{': -1 });
const FORWARD_DEPTH_STEP = Object.freeze({ '{': 1, '}': -1 });
const PAREN_DEPTH_STEP = Object.freeze({ '(': 1, ')': -1 });
const TRY_KEYWORD = /\btry\b/;
const CATCH_KEYWORD = /\bcatch\b/g;
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

const skipSpace = (text, index) => {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
};

// Index just past the ')' that balances a '(' at index; index itself when no '(' is there, and
// -1 when it never closes.
const skipParens = (text, index) => {
  const isParen = text[index] === '(';
  if (!isParen) return index;
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    depth += PAREN_DEPTH_STEP[text[i]] ?? 0;
    const isBalanced = depth === 0;
    if (isBalanced) return i + 1;
  }
  return -1;
};

// Index just past a when (filter) at index, index itself when there is none, or -1 when its
// parentheses never close.
const skipFilter = (text, index) => {
  const filter = /when\s*(?=\()/y;
  filter.lastIndex = index;
  const hasFilter = filter.test(text);
  return hasFilter ? skipParens(text, filter.lastIndex) : index;
};

// Offset just past the body's closing brace of a catch clause at catchIndex whose type, filter
// and body are balanced and whose body is blank in masked content; -1 for any other clause.
const findEmptyClauseEnd = (maskedContent, catchIndex) => {
  const afterType = skipParens(maskedContent, skipSpace(maskedContent, catchIndex + 'catch'.length));
  const afterFilter = afterType === -1 ? -1 : skipFilter(maskedContent, skipSpace(maskedContent, afterType));
  const isUnclosed = afterFilter === -1;
  if (isUnclosed) return -1;
  const openIndex = skipSpace(maskedContent, afterFilter);
  const closeIndex = skipSpace(maskedContent, openIndex + 1);
  const isBlankBody = maskedContent[openIndex] === '{' && maskedContent[closeIndex] === '}';
  return isBlankBody ? closeIndex + 1 : -1;
};

/** Empty or comment-only catch clauses in masked content, as { index, text } spans of the keyword through its closing brace. */
export const findCSharpShallowCatches = (maskedContent) => [...maskedContent.matchAll(CATCH_KEYWORD)].flatMap((match) => {
  const end = findEmptyClauseEnd(maskedContent, match.index);
  return end === -1 ? [] : [{ index: match.index, text: maskedContent.slice(match.index, end) }];
});

/** Span fields for one findCSharpShallowCatches clause starting at lineNum (see the header for each one). */
export const resolveCSharpCatchSpan = (match, { content, maskedContent }, lineNum) => {
  const matchEnd = match.index + match.text.length;
  const endLine = lineNum + (match.text.match(/\n/g) || []).length;
  const catchColumn = columnAt(content, match.index);
  const span = { endLine, column: catchColumn, catchColumn, endColumn: columnAt(content, matchEnd) };
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
