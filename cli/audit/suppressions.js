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
 *   trailEndColumn, and keywordColumns/endKeywordColumns, where a try or catch keyword starts
 *   on its first and last line) is read by column (C4) only when one of those lines holds a try
 *   or catch keyword other than its own and its try's. Then it owns the annotations between its
 *   try block's closing brace and its own closing brace, one after that brace on the same line
 *   up to trailEndColumn (where a later try starts or an enclosing try block, catch or finally
 *   closes), one whose comment ends before the catch keyword on its line (a block comment may
 *   open above) with no other try or catch keyword in between, and one ending on the line above
 *   when its comment opened on a comment-only line and no other try or catch precedes its try
 *   on that line. The keywords are the parser's try statements and catch clauses for JS and
 *   masked code for C#, so a comment, a string, a member, a key, a method, a $, # or @ name, a
 *   regex or JSX text spelled try or catch is none. For JS, TS, JSX and Vue the comment
 *   positions come from the parser's comments (parserComments), so code the line scanner reads
 *   as a comment (a # name, a regex holding // or /*, JSX text) cannot move them. Every other
 *   catch, and an annotation no parser comment holds, keeps 4ea6eb2's window: its own lines, a
 *   comment-only marker line whose reading ends on the line above (reasonEndLine), and the text
 *   after its try brace. SC-4 adds a block comment opened on a comment-only line that closes on
 *   the line above or on the catch's line. The post-filters drop the keyword columns from what
 *   they return. Any other finding (and PHP) uses its lines (line..endLine), an annotation on a
 *   comment-only line through the line below its closer (so the rest of its comment and a
 *   closer line that code shares count, whatever line opened the comment), and the text after
 *   a try brace on the line above (`tryBraceLine`). A covering annotation without a reason
 *   leaves a note that says so.
 * - Rules outside the catch family have no revision for per-marker reading, so they also keep
 *   the line reading 4ea6eb2 gave: one annotation at a line's first marker, whose reason runs
 *   past any later marker to the comment closer and, when that leaves it empty, comes from the
 *   following lines of a block comment still open at the end of the line. Either reading
 *   suppresses such a finding, so its count never rises over main's.
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

// `<token> <reason>` after the marker at markerIndex, up to the next marker (unless
// readsPastMarkers) or the comment closer.
const parseMarkerAt = (lineText, markerIndex, { readsPastMarkers = false } = {}) => {
  const bodyStart = markerIndex + ALLOW_MARKER.length;
  const nextMarker = readsPastMarkers ? -1 : lineText.indexOf(ALLOW_MARKER, bodyStart);
  const bodyEnd = nextMarker === -1 ? lineText.length : nextMarker;
  const body = lineText.slice(bodyStart, bodyEnd).split(COMMENT_CLOSERS)[0].trim();
  const match = ANNOTATION_BODY.exec(body);
  if (!match) return null;
  const reason = match[2].replace(REASON_SEPARATORS, '').trim();
  const isCommentOnly = COMMENT_ONLY_LINE.test(lineText);
  return buildAnnotation(match[1], reason, { isCommentOnly, opensCommentOnly: isCommentOnly, markerIndex });
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
// reasonEndLine is where 4ea6eb2's reading of the annotation ended: the marker line when that
// carries the reason, else the closer's line.
const continueBlock = (annotation, lines, idx, closer) => {
  const continuation = readBlockContinuation(lines, idx + 1, closer);
  const isReasonBelow = annotation.reason === '';
  const reason = isReasonBelow ? continuation.reason : annotation.reason;
  const lastLine = continuation.lastIdx + 1;
  const end = { lastLine, lastEnd: continuation.lastEnd, reasonEndLine: isReasonBelow ? lastLine : annotation.line };
  return { ...buildAnnotation(annotation.token, reason, annotation), ...end };
};

const findRegion = (regions, index) => regions.find(([start, end]) => index >= start && index < end);

const placeAnnotation = (parsed, idx, region) => ({
  ...parsed, line: idx + 1, lastLine: idx + 1, reasonEndLine: idx + 1, lastEnd: region[1], commentStart: region[0], commentEnd: region[1]
});

// Every annotation on line idx whose marker sits in one of its comment regions.
const annotateLine = (lines, idx, regions, finish) => listMarkerIndexes(lines[idx]).flatMap((markerIndex) => {
  const region = findRegion(regions, markerIndex);
  const parsed = region ? parseMarkerAt(lines[idx], markerIndex) : null;
  if (!parsed) return [];
  return [finish(placeAnnotation(parsed, idx, region))];
});

// The line readings: per line, the first marker when it sits in a comment, with its
// reason read past later markers. An empty reason is read from the block comment closerAt
// names (the closer of a block still open at the end of the line, or null for none).
const collectLineReadings = (lines, regionsByLine, closerAt) => lines.flatMap((lineText, idx) => {
  const [markerIndex] = listMarkerIndexes(lineText);
  const region = markerIndex === undefined ? null : findRegion(regionsByLine[idx], markerIndex);
  const parsed = region ? parseMarkerAt(lineText, markerIndex, { readsPastMarkers: true }) : null;
  if (!parsed) return [];
  const annotation = placeAnnotation(parsed, idx, region);
  const closer = parsed.reason === '' ? closerAt(annotation, idx) : null;
  return [closer ? continueBlock(annotation, lines, idx, closer) : annotation];
});

// Line-scanner regions per line, plus the block comment each line carries in from above
// (it ends at carriedEnd, and carriedCommentOnly says whether the line that opened it is
// comment-only) and the start of the block comment still open at its end (openFrom).
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

// Every allow annotation written in a comment, in line order, each with its 1-based line,
// lastLine (the closer of its block comment), lastEnd (the column just past that closer),
// markerIndex and commentStart columns, isCommentOnly (its marker line starts with a comment) and
// opensCommentOnly (so does the line where its comment opened), plus the line readings.
// collectWithRegions builds the same from per-line [start, end) comment regions.
const collectWithScanner = (lines) => {
  const scans = scanLines(lines);
  const annotations = lines.flatMap((_, idx) => {
    const scan = scans[idx];
    return annotateLine(lines, idx, scan.regions, (annotation) => {
      const isInCarriedBlock = annotation.markerIndex < scan.carriedEnd;
      const located = isInCarriedBlock ? { ...annotation, opensCommentOnly: scan.carriedCommentOnly } : annotation;
      return annotation.markerIndex >= scan.openFrom ? continueBlock(located, lines, idx, scan.closer) : located;
    });
  });
  const regionsByLine = scans.map((scan) => scan.regions);
  const lineReadings = collectLineReadings(lines, regionsByLine, (_, idx) => scans[idx].closer);
  return { annotations, lineReadings };
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
  const isOpenAt = (annotation, idx) => isOpenBlockAt(lines[idx], annotation, [annotation.commentStart, annotation.commentEnd]);
  const lineReadings = collectLineReadings(lines, regionsByLine, (annotation, idx) => (isOpenAt(annotation, idx) ? '*/' : null));
  return { annotations, lineReadings };
};

const doesTokenCover = (token, rule) => {
  const isBestEffort = token === BEST_EFFORT_TOKEN;
  if (isBestEffort) return CATCH_FAMILY.has(rule);
  return token === rule;
};

const comparePosition = (lineA, columnA, lineB, columnB) => (lineA === lineB ? columnA - columnB : lineA - lineB);

// The column of this catch's own try keyword when it shares the catch's line, else -1.
const ownTryColumnOf = (violation) => (violation.tryLine === violation.line ? violation.tryColumn : -1);

// Whether a try or catch keyword other than this catch's own try starts on the catch's line at a
// column in [from, to). The PHP regions path has no catch columns, so it never asks.
const hasOtherKeywordBetween = (violation, from, to) => {
  const ownTryColumn = ownTryColumnOf(violation);
  const keywordColumns = violation.keywordColumns ?? [];
  return keywordColumns.some((column) => column >= from && column < to && column !== ownTryColumn);
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

// An annotation ending right above the catch's line counts when its comment opened on a
// comment-only line (one that trails code there belongs to that code) and no other try or
// catch keyword comes before this catch's try on the catch's line.
const isAboveOwnTry = (annotation, violation) => {
  const isLineAbove = annotation.opensCommentOnly && annotation.lastLine === violation.line - 1;
  if (!isLineAbove) return false;
  const isTryOnCatchLine = violation.tryLine === violation.line;
  if (!isTryOnCatchLine) return true;
  return !hasOtherKeywordBetween(violation, 0, violation.tryColumn);
};

// A comment that ends before the catch keyword on the catch's own line (in or before a one-line
// try, or the closer of a block comment opened above, `*/ try { a(); } catch {}`) counts when
// no other try or catch keyword sits between it and this catch's try or the line start, or
// between it and the catch keyword. A block opened above must open on a comment-only line: one
// that trails code there (try { a(); } catch {} /* ...) belongs to that code.
const isBeforeCatchOnItsLine = (annotation, violation) => {
  const isOnCatchLine = annotation.lastLine === violation.line && annotation.lastEnd <= violation.catchColumn;
  if (!isOnCatchLine) return false;
  const opensAbove = annotation.line !== violation.line;
  const trailsCodeAbove = opensAbove && !annotation.opensCommentOnly;
  if (trailsCodeAbove) return false;
  const commentStart = opensAbove ? 0 : annotation.commentStart;
  const isTryBefore = violation.tryLine === violation.line && violation.tryColumn < commentStart;
  const leadFrom = isTryBefore ? violation.tryColumn : 0;
  const hasKeywordInLead = hasOtherKeywordBetween(violation, leadFrom, commentStart);
  const hasKeywordInTail = hasOtherKeywordBetween(violation, annotation.lastEnd, violation.catchColumn);
  return !hasKeywordInLead && !hasKeywordInTail;
};

const isOwnedByCatch = (annotation, violation) => isInOwnClause(annotation, violation)
  || isTrailingCatch(annotation, violation)
  || isBeforeCatchOnItsLine(annotation, violation)
  || isAboveOwnTry(annotation, violation);

// Whether a try or catch keyword other than this catch's own and its try's starts on the catch's
// line or on its last line. Only there can another catch claim one of its annotations, so only
// there is ownership read by column (C4).
const sharesLineWithOtherKeyword = (violation) => {
  const ownTryColumn = ownTryColumnOf(violation);
  const isOtherKeyword = (column) => column !== violation.catchColumn && column !== ownTryColumn;
  const hasOtherOnCatchLine = (violation.keywordColumns ?? []).some(isOtherKeyword);
  const hasKeywordOnEndLine = (violation.endKeywordColumns ?? []).length > 0;
  return hasOtherOnCatchLine || hasKeywordOnEndLine;
};

// 4ea6eb2's window for a catch that no other try or catch shares a line with: its own lines, a
// comment-only marker line whose reading ends right above it, and the text after its try brace.
// SC-4 adds the placed comment (null when there is none) when it opened on a comment-only line
// and closes on the line above or on the catch's line.
const isInCatchLineWindow = (annotation, violation, placed) => {
  const endLine = violation.endLine ?? violation.line;
  const isWithin = annotation.line >= violation.line && annotation.line <= endLine;
  const isMarkerAbove = annotation.isCommentOnly && annotation.reasonEndLine === violation.line - 1;
  const closesAboveOrOnLine = placed?.lastLine === violation.line - 1 || placed?.lastLine === violation.line;
  const isBlockAbove = Boolean(placed?.opensCommentOnly) && closesAboveOrOnLine;
  const isAfterTryBrace = annotation.line === violation.tryBraceLine && annotation.markerIndex >= violation.tryBraceColumn;
  return isWithin || isMarkerAbove || isBlockAbove || isAfterTryBrace;
};

const holdsPosition = (span, line, column) => comparePosition(span.start.line, span.start.column, line, column) <= 0
  && comparePosition(line, column, span.end.line, span.end.column) < 0;

// Whether the first code on a line sits in a parser comment, as COMMENT_ONLY_LINE asks of the text.
const startsWithParserComment = (lines, spans, line) => {
  const firstColumn = (lines[line - 1] ?? '').search(/\S/);
  return firstColumn !== -1 && spans.some((span) => holdsPosition(span, line, firstColumn));
};

// The annotation with its comment's positions as the parser reads them (commentStart is 0 when the
// comment opened above the marker line), or null when no parser comment holds its marker.
const placeByParser = (annotation, spans, lines) => {
  const span = spans.find((candidate) => holdsPosition(candidate, annotation.line, annotation.markerIndex));
  if (!span) return null;
  const opensOnMarkerLine = span.start.line === annotation.line;
  return {
    ...annotation,
    commentStart: opensOnMarkerLine ? span.start.column : 0,
    lastLine: span.end.line,
    lastEnd: span.end.column,
    opensCommentOnly: startsWithParserComment(lines, spans, span.start.line)
  };
};

// Where an annotation's comment sits for catch ownership and SC-4: the parser's comment when the
// file has parser comments (JS, TS, JSX, Vue), else the line scanner's region (C#).
const buildPlacer = (lines, parserComments) => {
  if (!parserComments) return (annotation) => annotation;
  const placements = new Map();
  return (annotation) => {
    const isPlaced = placements.has(annotation);
    if (!isPlaced) placements.set(annotation, placeByParser(annotation, parserComments, lines));
    return placements.get(annotation);
  };
};

// A catch is read by column only where another try or catch shares its lines, and only with an
// annotation it can place; an annotation the parser does not see as a comment keeps main's window.
const isInCatchWindow = (annotation, violation, context) => {
  const placed = context.place(annotation);
  const isReadByColumn = Boolean(placed) && sharesLineWithOtherKeyword(violation);
  if (isReadByColumn) return isOwnedByCatch(placed, violation);
  return isInCatchLineWindow(annotation, violation, placed);
};

// An annotation on a comment-only line covers every line after it through the line below its
// closer: the rest of its own comment, a closer line that code shares (`*/ code`), the line below.
// That holds when its comment opened after code on an earlier line too, as on 4ea6eb2, which
// tested the marker line itself; only catch ownership asks where the comment opened.
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
  const isInWindow = hasColumns ? isInCatchWindow(annotation, violation, context) : isInLineWindow(annotation, violation);
  return isInHeader || isInWindow;
};

// The catch family reads each marker alone (C4, under its rule revisions); any other rule also
// keeps the line readings, so an annotation main honoured for it still counts.
const listCandidateAnnotations = (violation, context) => {
  const isCatchFamily = CATCH_FAMILY.has(violation.rule);
  return isCatchFamily ? context.annotations : [...context.annotations, ...context.lineReadings];
};

const listCoveringAnnotations = (violation, context) => listCandidateAnnotations(violation, context)
  .filter((annotation) => doesTokenCover(annotation.token, violation.rule) && isAnnotationInRange(annotation, violation, context));

/** context: { annotations, lineReadings, headerEndLine, place }, as applyAuditPostFilters builds it. */
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

// The keyword columns serve catch ownership only, so a returned finding leaves them out.
const withoutKeywordColumns = (violation) => {
  const hasKeywordColumns = Object.hasOwn(violation, 'keywordColumns') || Object.hasOwn(violation, 'endKeywordColumns');
  if (!hasKeywordColumns) return violation;
  const { keywordColumns, endKeywordColumns, ...finding } = violation;
  return finding;
};

/**
 * Applies annotations (suppression and missing-reason notes) and dedup; returns a new array.
 * parserComments: the parser's comments as { start, end } positions (1-based lines, 0-based
 * columns), which place annotations for catch ownership where tries share a line.
 */
export const applyAuditPostFilters = (violations, lines, { commentRegions = null, fileHeaderEndLine = 0, parserComments = null } = {}) => {
  const collected = commentRegions ? collectWithRegions(lines, commentRegions) : collectWithScanner(lines);
  const context = { ...collected, headerEndLine: fileHeaderEndLine, place: buildPlacer(lines, parserComments) };
  const hasAnnotations = collected.annotations.length > 0 || collected.lineReadings.length > 0;
  const allowed = hasAnnotations
    ? violations.filter((v) => !isSuppressedByAnnotation(v, context)).map((v) => withMissingReasonNote(v, context))
    : violations;
  return dedupeViolations(allowed).map(withoutKeywordColumns);
};
