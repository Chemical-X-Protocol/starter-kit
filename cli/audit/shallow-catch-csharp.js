/**
 * C# shallow catches. findCSharpShallowCatches scans masked content (comments and strings
 * blanked, offsets and newlines kept) for a catch clause, with an optional (type) and an optional
 * when (filter), whose body is empty once comments are blanked, so a comment-only body counts and
 * catch text inside a string or a comment never does.
 *
 * Annotation window for a C# shallow catch, in the shape suppressions.js reads: the catch's
 * own lines (line..endLine) and 0-based columns of the catch keyword (catchColumn; the finding's
 * column is the same, except that a catch at the line start reports 1 as the JS catch rules do,
 * so the reporter keeps it and two catches on one line stay two findings), its closing brace
 * (endColumn), the try that owns it (tryLine, tryColumn, and tryBraceLine/tryBraceColumn just
 * past the try block's closing brace), where a trailing annotation stops being this catch's
 * (trailEndColumn) and, when a try nested in the catch's own try statement stops it before that
 * statement ends on the line, where it resumes and stops again (statementEndColumn,
 * statementTrailEndColumn), and where every try and catch keyword starts on the catch's line
 * (keywordColumns) and on its last line when that is another (endKeywordColumns). A try with no
 * catch clause takes no part in ownership: it is no keyword, and none of its parts ends a window.
 * Severity stays at the registry MEDIUM with no escalation, because C# definite assignment
 * (CS0165) already rejects reading an unset local.
 */
const BRACE_DEPTH_STEP = Object.freeze({ '}': 1, '{': -1 });
const FORWARD_DEPTH_STEP = Object.freeze({ '{': 1, '}': -1 });
const PAREN_DEPTH_STEP = Object.freeze({ '(': 1, ')': -1 });
const CATCH_KEYWORD = /\bcatch\b/g;
// What opens a try block or a finally (its keyword captured), and what opens a catch clause (with
// its type and when-filter); a keyword here, as below, is a whole word that is not a member
// (o.catch) or a verbatim identifier (@catch).
const TRY_OR_FINALLY_OPENER = /(?<![.@\p{L}\p{N}_])(try|finally)$/u;
const CATCH_PART_OPENER = /(?<![.@\p{L}\p{N}_])catch(?![\p{L}\p{N}_])[^{};]*$/u;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const KEYWORD_CANDIDATE = /(?<![.@\p{L}\p{N}_])(?:try|catch)(?![\p{L}\p{N}_])/gu;
// What a keyword is followed by, past whitespace: a try block, or a catch's type, filter or body.
const KEYWORD_FOLLOWER = Object.freeze({ try: /^\{/, catch: /^(?:[({]|when(?![\p{L}\p{N}_]))/u });
const KEYWORD_FOLLOWER_LENGTH = 'when'.length + 1;

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

const skipSpace = (text, index) => {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
};

const isKeywordAt = (maskedContent, index, keyword) => {
  const followerStart = skipSpace(maskedContent, index + keyword.length);
  return KEYWORD_FOLLOWER[keyword].test(maskedContent.slice(followerStart, followerStart + KEYWORD_FOLLOWER_LENGTH));
};

const isWordAt = (maskedContent, index, word) => maskedContent.startsWith(word, index) && !WORD_CHAR.test(maskedContent[index + word.length] ?? '');

const isCatchAt = (maskedContent, index) => isWordAt(maskedContent, index, 'catch') && isKeywordAt(maskedContent, index, 'catch');

// Offset just past the brace that closes the block opening at openIndex, or -1 when there is none.
const findBlockEnd = (maskedContent, openIndex) => {
  const isBlock = maskedContent[openIndex] === '{';
  if (!isBlock) return -1;
  let depth = 0;
  for (let i = openIndex; i < maskedContent.length; i += 1) {
    depth += FORWARD_DEPTH_STEP[maskedContent[i]] ?? 0;
    const isClosed = depth === 0;
    if (isClosed) return i + 1;
  }
  return -1;
};

// Whether the try whose block closes at closeIndex has a catch clause: catch follows the block.
const isFollowedByCatch = (maskedContent, closeIndex) => isCatchAt(maskedContent, skipSpace(maskedContent, closeIndex + 1));

const hasCatchClause = (maskedContent, tryIndex) => {
  const blockEnd = findBlockEnd(maskedContent, skipSpace(maskedContent, tryIndex + 'try'.length));
  return blockEnd !== -1 && isFollowedByCatch(maskedContent, blockEnd - 1);
};

// The try and catch keywords in masked content (comments and strings blanked) from offset from
// up to to, as { index, keyword }, so a quoted, member or verbatim name is not one, and a try with
// no catch clause is left out.
const findKeywords = (maskedContent, from, to) => [...maskedContent.slice(from, to).matchAll(KEYWORD_CANDIDATE)]
  .map((candidate) => ({ index: from + candidate.index, keyword: candidate[0] }))
  .filter(({ index, keyword }) => isKeywordAt(maskedContent, index, keyword))
  .filter(({ index, keyword }) => keyword === 'catch' || hasCatchClause(maskedContent, index));

const findLineEnd = (maskedContent, index) => {
  const newline = maskedContent.indexOf('\n', index);
  return newline === -1 ? maskedContent.length : newline;
};

// 0-based columns of every try and catch keyword on the line that holds index.
const listKeywordColumns = (maskedContent, index) => {
  const lineStart = maskedContent.lastIndexOf('\n', index - 1) + 1;
  return findKeywords(maskedContent, lineStart, findLineEnd(maskedContent, index)).map((found) => found.index - lineStart);
};

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

// The masked text before the brace that opens the block closing at closeIndex, or '' when no
// block closes there.
const findBlockOpening = (maskedContent, closeIndex) => {
  const openIndex = closeIndex === -1 ? -1 : findOpeningBrace(maskedContent, closeIndex);
  return openIndex === -1 ? '' : maskedContent.slice(0, openIndex).trimEnd();
};

const closesCatchBlock = (maskedContent, closeIndex) => CATCH_PART_OPENER.test(findBlockOpening(maskedContent, closeIndex));

// Whether the brace at closeIndex closes a try block, catch or finally of a try statement with a
// catch clause: a finally's statement has one when the block before finally is a catch's.
const closesTryPart = (maskedContent, closeIndex) => {
  const opening = findBlockOpening(maskedContent, closeIndex);
  const keyword = TRY_OR_FINALLY_OPENER.exec(opening)?.[1];
  const isCatchBlock = CATCH_PART_OPENER.test(opening);
  const isTryBlockWithCatch = keyword === 'try' && isFollowedByCatch(maskedContent, closeIndex);
  const finallyIndex = opening.length - 'finally'.length;
  const isFinallyWithCatch = keyword === 'finally' && closesCatchBlock(maskedContent, findBraceBefore(maskedContent, finallyIndex));
  return isCatchBlock || isTryBlockWithCatch || isFinallyWithCatch;
};

// Offset just past the catch clause or finally that starts at index, or -1 when neither does.
const findClauseEnd = (maskedContent, index) => {
  const isCatch = isCatchAt(maskedContent, index);
  if (isCatch) return findBlockEnd(maskedContent, findCatchBodyStart(maskedContent, index));
  const isFinally = isWordAt(maskedContent, index, 'finally');
  return isFinally ? findBlockEnd(maskedContent, skipSpace(maskedContent, index + 'finally'.length)) : -1;
};

// Offset just past the try statement whose catch clause ends at endIndex: past every catch clause
// and the finally that follow it.
const findStatementEnd = (maskedContent, endIndex) => {
  let statementEnd = endIndex;
  let clauseEnd = findClauseEnd(maskedContent, skipSpace(maskedContent, statementEnd));
  while (clauseEnd !== -1) {
    statementEnd = clauseEnd;
    clauseEnd = findClauseEnd(maskedContent, skipSpace(maskedContent, statementEnd));
  }
  return statementEnd;
};

// Offset on the catch's last line, from endIndex on, where a trailing annotation stops being this
// catch's: a later try keyword, or the brace of an enclosing try block, catch or finally; -1 when
// neither occurs.
const findTrailEnd = (maskedContent, endIndex) => {
  const lineEnd = findLineEnd(maskedContent, endIndex);
  const laterTry = findKeywords(maskedContent, endIndex, lineEnd).find((found) => found.keyword === 'try');
  const limit = laterTry ? laterTry.index : lineEnd;
  let depth = 0;
  for (let i = endIndex; i < limit; i += 1) {
    const isUnmatchedClose = maskedContent[i] === '}' && depth === 0;
    const isTryPartClose = isUnmatchedClose && closesTryPart(maskedContent, i);
    if (isTryPartClose) return i;
    depth = Math.max(0, depth + (FORWARD_DEPTH_STEP[maskedContent[i]] ?? 0));
  }
  return laterTry ? limit : -1;
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

// Offset of the body of a catch clause at catchIndex, past its type and filter, or -1 when their
// parentheses never close.
const findCatchBodyStart = (maskedContent, catchIndex) => {
  const afterType = skipParens(maskedContent, skipSpace(maskedContent, catchIndex + 'catch'.length));
  const afterFilter = afterType === -1 ? -1 : skipFilter(maskedContent, skipSpace(maskedContent, afterType));
  const isUnclosed = afterFilter === -1;
  return isUnclosed ? -1 : skipSpace(maskedContent, afterFilter);
};

// Offset just past the body's closing brace of a catch clause at catchIndex whose type, filter
// and body are balanced and whose body is blank in masked content; -1 for any other clause.
const findEmptyClauseEnd = (maskedContent, catchIndex) => {
  const openIndex = findCatchBodyStart(maskedContent, catchIndex);
  const isUnclosed = openIndex === -1;
  if (isUnclosed) return -1;
  const closeIndex = skipSpace(maskedContent, openIndex + 1);
  const isBlankBody = maskedContent[openIndex] === '{' && maskedContent[closeIndex] === '}';
  return isBlankBody ? closeIndex + 1 : -1;
};

// When a try nested in the catch's own statement (a later catch clause or its finally) stops the
// trailing window at trailEnd before that statement ends on the line, the window resumes at the
// statement's end: statementEndColumn, and statementTrailEndColumn where it stops again.
const resolveStatementTrail = ({ content, maskedContent }, endIndex, trailEnd) => {
  const hasTrailEnd = trailEnd !== -1;
  if (!hasTrailEnd) return {};
  const statementEnd = findStatementEnd(maskedContent, endIndex);
  const isOnCatchLine = statementEnd <= findLineEnd(maskedContent, endIndex);
  const isStoppedInStatement = trailEnd < statementEnd && isOnCatchLine;
  if (!isStoppedInStatement) return {};
  const statementTrail = { statementEndColumn: columnAt(content, statementEnd) };
  const statementTrailEnd = findTrailEnd(maskedContent, statementEnd);
  const hasStatementTrailEnd = statementTrailEnd !== -1;
  if (hasStatementTrailEnd) statementTrail.statementTrailEndColumn = columnAt(content, statementTrailEnd);
  return statementTrail;
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
  const endColumn = columnAt(content, matchEnd);
  const keywordColumns = listKeywordColumns(maskedContent, match.index);
  const isOneLine = endLine === lineNum;
  const endKeywordColumns = isOneLine ? [] : listKeywordColumns(maskedContent, matchEnd - 1);
  const span = { endLine, column: catchColumn || 1, catchColumn, endColumn, keywordColumns, endKeywordColumns };
  const trailEnd = findTrailEnd(maskedContent, matchEnd);
  const hasTrailEnd = trailEnd !== -1;
  if (hasTrailEnd) span.trailEndColumn = columnAt(content, trailEnd);
  Object.assign(span, resolveStatementTrail({ content, maskedContent }, matchEnd, trailEnd));
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
