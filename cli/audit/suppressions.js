/**
 * Central post-filters for auditCode:
 * - `chemx-allow: <token> <reason>` annotations (token is a RULE_ID or `best-effort`
 *   for the catch-rule family). The marker counts only inside a comment (line, block,
 *   HTML or # comment), never in a string literal, and each marker on a line is its own
 *   annotation. Any separator may follow the token (`best-effort, reason`); separators are
 *   not part of the reason. A reason is mandatory and needs a letter or a digit; a block
 *   comment may carry it on its following lines, and it lasts to its closer either way.
 * - Where an annotation applies. A catch-family finding with columns (JS and C#: catchColumn,
 *   endColumn, tryLine, tryColumn, tryBraceLine/tryBraceColumn at the end of the try block,
 *   trailEndColumn) owns the annotations between its try block's closing brace and its own
 *   closing brace, one after that brace on the same line up to trailEndColumn (where a later
 *   try starts or an enclosing try block, catch or finally closes), one whose comment ends
 *   before the catch keyword on its line (a block comment may open above) with no other try
 *   or catch keyword in between, and a comment-only one ending on the line above when no
 *   other try or catch precedes its try on that line. Any other finding (and PHP) uses its
 *   lines (line..endLine), a comment-only annotation through the line below its closer (so
 *   the rest of its comment and a closer line that code shares count), and the text after a
 *   try brace on the line above (`tryBraceLine`). A covering annotation without a reason
 *   leaves a note that says so.
 * - duplicate reports of one finding (same file, line, column and rule), plus the
 *   AI_SLOP_SHALLOW_CATCH twin of an ERROR_SWALLOWED_EXCEPTION at the same catch.
 */
import { scanCommentRegions, INITIAL_SCAN_STATE } from './comment-regions.js';

const ALLOW_MARKER = 'chemx-allow:';
// The token ends at the first character that is not a letter, digit or underscore, except a
// hyphen that joins two words: best-effort-ish, best-effort_x and best-effort2 are other tokens.
const ANNOTATION_BODY = /^\s*([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)(?![\p{L}\p{N}_])(.*)$/u;
const REASON_SEPARATORS = /^[\s\p{Pd}\p{Ps}\p{Pe}:;,.!?\/]+/u;
const COMMENT_CLOSERS = /\*\/|-->/;
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|\/\*|\*|<!--|#)/;
const LINE_COMMENT_OPENER = /^(?:\/\/|#)/;
const BLOCK_GUTTER = /^[\s*]+/;
const MEANINGFUL_REASON = /[\p{L}\p{N}]/u;
const TRY_OR_CATCH = /\b(?:try|catch)\b/;
const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const BEST_EFFORT_TOKEN = 'best-effort';

const buildAnnotation = (token, reason, extra) => ({ ...extra, token, reason, hasReason: MEANINGFUL_REASON.test(reason) });

const listMarkerIndexes = (lineText) => {
  const indexes = [];
  let at = lineText.indexOf(ALLOW_MARKER);
  while (at !== -1) {
    indexes.push(at);
    at = lineText.indexOf(ALLOW_MARKER, at + ALLOW_MARKER.length);
  }
  return indexes;
};

// `<token> <reason>` after the marker at markerIndex, up to the next marker or comment closer.
const parseMarkerAt = (lineText, markerIndex) => {
  const bodyStart = markerIndex + ALLOW_MARKER.length;
  const nextMarker = lineText.indexOf(ALLOW_MARKER, bodyStart);
  const bodyEnd = nextMarker === -1 ? lineText.length : nextMarker;
  const body = lineText.slice(bodyStart, bodyEnd).split(COMMENT_CLOSERS)[0].trim();
  const match = ANNOTATION_BODY.exec(body);
  if (!match) return null;
  const reason = match[2].replace(REASON_SEPARATORS, '').trim();
  return buildAnnotation(match[1], reason, { isCommentOnly: COMMENT_ONLY_LINE.test(lineText), markerIndex });
};

/**
 * Parses `<token> <reason>` after the first marker on one line of comment text; null when
 * there is no marker or no token. A token that runs into another word (best-effort-ish) is
 * returned as that token. The reason may be empty.
 */
export const parseAllowAnnotation = (lineText) => {
  const [markerIndex] = listMarkerIndexes(lineText);
  return markerIndex === undefined ? null : parseMarkerAt(lineText, markerIndex);
};

// The following lines of a block comment, each without its leading `*` gutter, up to the closer,
// with the index of the closer's line and the column just past the closer.
const readBlockContinuation = (lines, startIdx, closer) => {
  const parts = [];
  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const closeAt = lines[idx].indexOf(closer);
    const isClosed = closeAt !== -1;
    const text = isClosed ? lines[idx].slice(0, closeAt) : lines[idx];
    parts.push(text.replace(BLOCK_GUTTER, '').trim());
    if (isClosed) return { reason: parts.filter(Boolean).join(' '), lastIdx: idx, lastEnd: closeAt + closer.length };
  }
  return { reason: parts.filter(Boolean).join(' '), lastIdx: lines.length - 1, lastEnd: lines.at(-1).length };
};

// A block comment still open at the end of the marker line lasts to its closer; its later lines
// give the reason only when the marker line has none.
const continueBlock = (annotation, lines, idx, closer) => {
  const continuation = readBlockContinuation(lines, idx + 1, closer);
  const reason = annotation.reason === '' ? continuation.reason : annotation.reason;
  const end = { lastLine: continuation.lastIdx + 1, lastEnd: continuation.lastEnd };
  return { ...buildAnnotation(annotation.token, reason, annotation), ...end };
};

const findRegion = (regions, index) => regions.find(([start, end]) => index >= start && index < end);

// Every annotation on line idx whose marker sits in one of its comment regions.
const annotateLine = (lines, idx, regions, finish) => listMarkerIndexes(lines[idx]).flatMap((markerIndex) => {
  const region = findRegion(regions, markerIndex);
  const parsed = region ? parseMarkerAt(lines[idx], markerIndex) : null;
  if (!parsed) return [];
  return [finish({ ...parsed, line: idx + 1, lastLine: idx + 1, lastEnd: region[1], commentStart: region[0], commentEnd: region[1] })];
});

// Line-scanner regions per line, plus the block comment each line carries in from above
// (it ends at carriedEnd, and the line that opened it decides isCommentOnly) and the start
// of the block comment still open at its end (openFrom).
const scanLines = (lines) => {
  let state = INITIAL_SCAN_STATE;
  let isOpenerCommentOnly = false;
  return lines.map((lineText) => {
    const isCarried = state.inBlock;
    const carriedCommentOnly = isOpenerCommentOnly;
    const scan = scanCommentRegions(lineText, state);
    state = scan.state;
    const isStillCarried = isCarried && scan.regions.length === 1;
    const opensBlock = scan.state.inBlock && !isStillCarried;
    if (opensBlock) isOpenerCommentOnly = COMMENT_ONLY_LINE.test(lineText);
    const carriedEnd = isCarried ? scan.regions[0][1] : 0;
    const openFrom = scan.state.inBlock ? scan.regions.at(-1)[0] : Infinity;
    return { regions: scan.regions, carriedEnd, carriedCommentOnly, openFrom, closer: scan.state.blockCloser };
  });
};

const collectWithScanner = (lines) => {
  const scans = scanLines(lines);
  const annotations = lines.flatMap((_, idx) => {
    const scan = scans[idx];
    return annotateLine(lines, idx, scan.regions, (annotation) => {
      const isInCarriedBlock = annotation.markerIndex < scan.carriedEnd;
      const located = isInCarriedBlock ? { ...annotation, isCommentOnly: scan.carriedCommentOnly } : annotation;
      return annotation.markerIndex >= scan.openFrom ? continueBlock(located, lines, idx, scan.closer) : located;
    });
  });
  return { annotations, regionsByLine: scans.map((scan) => scan.regions) };
};

// An annotation whose comment region runs to the end of its line with no closer after the marker.
const isOpenBlockAt = (lineText, annotation, region) => {
  const runsToLineEnd = region[1] >= lineText.length;
  return runsToLineEnd && !COMMENT_CLOSERS.test(lineText.slice(annotation.markerIndex));
};

const isLineCommentAt = (lineText, region) => LINE_COMMENT_OPENER.test(lineText.slice(region[0]));

// commentRegions: one entry per line (index 0 is line 1), each a list of [start, end) columns.
// A block comment open at the end of the marker line lasts to its closer, as on the scanner
// path (SC-4). A line comment ends with its line, except that a reasonless one still reads on
// into the lines below: the PHP reasonless-annotation bug that #257 recorded, left for its own fix.
const collectWithRegions = (lines, commentRegions) => {
  const regionsByLine = lines.map((_, idx) => commentRegions[idx] ?? []);
  const annotations = lines.flatMap((lineText, idx) => annotateLine(lines, idx, regionsByLine[idx], (annotation) => {
    const region = findRegion(regionsByLine[idx], annotation.markerIndex);
    const isOpen = isOpenBlockAt(lineText, annotation, region);
    const isContinued = isOpen && (annotation.reason === '' || !isLineCommentAt(lineText, region));
    return isContinued ? continueBlock(annotation, lines, idx, '*/') : annotation;
  }));
  return { annotations, regionsByLine };
};

/**
 * Every allow annotation written in a comment, in line order, each with its 1-based `line`,
 * `lastLine` (the closer of its block comment), `lastEnd` (the column just past that closer),
 * `markerIndex` and `commentStart` columns.
 * `commentRegions` (per-line [start, end) column pairs) replaces the line scanner when given.
 */
export const parseAllowAnnotations = (lines, commentRegions = null) =>
  (commentRegions ? collectWithRegions(lines, commentRegions) : collectWithScanner(lines)).annotations;

const doesTokenCover = (token, rule) => {
  const isBestEffort = token === BEST_EFFORT_TOKEN;
  if (isBestEffort) return CATCH_FAMILY.has(rule);
  return token === rule;
};

const comparePosition = (lineA, columnA, lineB, columnB) => (lineA === lineB ? columnA - columnB : lineA - lineB);

// Code on one line between two columns, with its comments left out.
const codeBetween = (context, line, from, to) => {
  const lineText = context.lines[line - 1] ?? '';
  const regions = context.regionsByLine[line - 1] ?? [];
  return lineText.slice(from, to).split('').filter((_, offset) => !findRegion(regions, from + offset)).join('');
};

// From the try block's closing brace (else the catch keyword) to the catch's closing brace.
const isInOwnClause = (annotation, violation) => {
  const hasTryBrace = Number.isInteger(violation.tryBraceLine);
  const fromLine = hasTryBrace ? violation.tryBraceLine : violation.line;
  const fromColumn = hasTryBrace ? violation.tryBraceColumn : violation.catchColumn;
  const isAfterStart = comparePosition(annotation.line, annotation.markerIndex, fromLine, fromColumn) >= 0;
  const isBeforeEnd = comparePosition(annotation.line, annotation.markerIndex, violation.endLine, violation.endColumn) < 0;
  return isAfterStart && isBeforeEnd;
};

// After the catch's closing brace on its last line, stopping at trailEndColumn when one is set.
const isTrailingCatch = (annotation, violation) => {
  const isOnEndLine = annotation.line === violation.endLine;
  const isAfterEnd = annotation.commentStart >= violation.endColumn;
  const isBeforeLimit = annotation.commentStart < (violation.trailEndColumn ?? Infinity);
  return isOnEndLine && isAfterEnd && isBeforeLimit;
};

// A comment-only annotation ending right above the catch's line counts when no other try or
// catch keyword comes before this catch's try on that line.
const isAboveOwnTry = (annotation, violation, context) => {
  const isLineAbove = annotation.isCommentOnly && annotation.lastLine === violation.line - 1;
  if (!isLineAbove) return false;
  const isTryOnCatchLine = violation.tryLine === violation.line;
  if (!isTryOnCatchLine) return true;
  return !TRY_OR_CATCH.test(codeBetween(context, violation.tryLine, 0, violation.tryColumn));
};

// A comment that ends before the catch keyword on the catch's own line (in or before a one-line
// try, or the closer of a block comment opened above, `*/ try { a(); } catch {}`) counts when
// no other try or catch keyword sits between it and this catch's try or the line start, or
// between it and the catch keyword. A block opened above must open on a comment-only line: one
// that trails code there (try { a(); } catch {} /* ...) belongs to that code.
const isBeforeCatchOnItsLine = (annotation, violation, context) => {
  const isOnCatchLine = annotation.lastLine === violation.line && annotation.lastEnd <= violation.catchColumn;
  if (!isOnCatchLine) return false;
  const opensAbove = annotation.line !== violation.line;
  const trailsCodeAbove = opensAbove && !annotation.isCommentOnly;
  if (trailsCodeAbove) return false;
  const commentStart = opensAbove ? 0 : annotation.commentStart;
  const commentEnd = annotation.lastEnd;
  const isTryOnLine = violation.tryLine === violation.line;
  const tryEnd = violation.tryColumn + 'try'.length;
  const isTryBefore = isTryOnLine && tryEnd <= commentStart;
  const isTryAfter = isTryOnLine && !isTryBefore;
  const lead = codeBetween(context, violation.line, isTryBefore ? tryEnd : 0, commentStart);
  const tailFrom = isTryAfter ? tryEnd : commentEnd;
  const gapToTry = isTryAfter ? codeBetween(context, violation.line, commentEnd, violation.tryColumn) : '';
  const tail = `${gapToTry} ${codeBetween(context, violation.line, tailFrom, violation.catchColumn)}`;
  return !TRY_OR_CATCH.test(lead) && !TRY_OR_CATCH.test(tail);
};

const isOwnedByCatch = (annotation, violation, context) => isInOwnClause(annotation, violation)
  || isTrailingCatch(annotation, violation)
  || isBeforeCatchOnItsLine(annotation, violation, context)
  || isAboveOwnTry(annotation, violation, context);

// A comment-only annotation covers every line after its marker line through the line below its
// closer: the rest of its own comment, a closer line that code shares (`*/ code`), the line below.
const isInLineWindow = (annotation, violation) => {
  const endLine = violation.endLine ?? violation.line;
  const isWithin = annotation.line >= violation.line && annotation.line <= endLine;
  const isPastMarker = violation.line > annotation.line && violation.line <= annotation.lastLine + 1;
  const isBelowCommentOnly = annotation.isCommentOnly && isPastMarker;
  const isAfterTryBrace = annotation.line === violation.tryBraceLine && annotation.markerIndex >= violation.tryBraceColumn;
  return isWithin || isBelowCommentOnly || isAfterTryBrace;
};

const isAnnotationInRange = (annotation, violation, context) => {
  const isInHeader = violation.line === 1 && annotation.line >= 1 && annotation.line <= context.headerEndLine;
  const hasColumns = Number.isInteger(violation.catchColumn);
  const isInWindow = hasColumns ? isOwnedByCatch(annotation, violation, context) : isInLineWindow(annotation, violation);
  return isInHeader || isInWindow;
};

const listCoveringAnnotations = (violation, context) => context.annotations
  .filter((annotation) => doesTokenCover(annotation.token, violation.rule) && isAnnotationInRange(annotation, violation, context));

/** context: { annotations, lines, regionsByLine, headerEndLine }, as applyAuditPostFilters builds it. */
export const isSuppressedByAnnotation = (violation, context) =>
  listCoveringAnnotations(violation, context).some((annotation) => annotation.hasReason);

const withMissingReasonNote = (violation, context) => {
  const reasonless = listCoveringAnnotations(violation, context)[0];
  if (!reasonless) return violation;
  const note = `the chemx-allow: ${reasonless.token} annotation needs a reason (reason is mandatory)`;
  return { ...violation, hazard: `${violation.hazard}; ${note}` };
};

const siteKey = (v) => `${v.filePath}:${v.line}:${v.column}`;

export const dedupeViolations = (violations) => {
  const seen = new Set();
  const swallowedSites = new Set(
    violations.filter((v) => v.rule === 'ERROR_SWALLOWED_EXCEPTION').map(siteKey)
  );
  return violations.filter((v) => {
    const isShallowTwin = v.rule === 'AI_SLOP_SHALLOW_CATCH' && swallowedSites.has(siteKey(v));
    if (isShallowTwin) return false;
    const key = `${v.filePath}:${v.line}:${v.column}:${v.rule}`;
    const isDuplicate = seen.has(key);
    seen.add(key);
    return !isDuplicate;
  });
};

/** Applies annotations (suppression and missing-reason notes) and dedup; returns a new array. */
export const applyAuditPostFilters = (violations, lines, { commentRegions = null, fileHeaderEndLine = 0 } = {}) => {
  const collected = commentRegions ? collectWithRegions(lines, commentRegions) : collectWithScanner(lines);
  const context = { ...collected, lines, headerEndLine: fileHeaderEndLine };
  const hasAnnotations = collected.annotations.length > 0;
  const allowed = hasAnnotations
    ? violations.filter((v) => !isSuppressedByAnnotation(v, context)).map((v) => withMissingReasonNote(v, context))
    : violations;
  return dedupeViolations(allowed);
};
