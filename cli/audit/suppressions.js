/**
 * Central post-filters for auditCode:
 * - `chemx-allow: <token> <reason>` annotations (token is a RULE_ID or `best-effort`
 *   for the catch-rule family). The marker counts only inside a comment (line, block,
 *   HTML or # comment), never in a string literal. A reason is mandatory and needs a letter or
 *   a digit; a block comment may carry it on its following lines. The annotation applies
 *   on its own line, from a comment-only annotation that ends on the line above, anywhere
 *   inside a flagged catch clause (violations carry `endLine`), and after the try block's
 *   closing brace when the catch keyword sits below it (violations carry `tryBraceLine`).
 *   A covering annotation without a reason leaves the finding with a note that says so.
 * - duplicate reports of one finding (same file, line, column and rule), plus the
 *   AI_SLOP_SHALLOW_CATCH twin of an ERROR_SWALLOWED_EXCEPTION at the same site.
 */
import { scanCommentRegions, INITIAL_SCAN_STATE } from './comment-regions.js';

const ALLOW_MARKER = 'chemx-allow:';
const ANNOTATION_BODY = /^\s*([A-Za-z_-]+)(?=\s|$)\s*(.*)$/;
const COMMENT_CLOSERS = /\*\/|-->/;
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|\/\*|\*|<!--|#)/;
const BLOCK_GUTTER = /^[\s*]+/;
const MEANINGFUL_REASON = /[\p{L}\p{N}]/u;
const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const BEST_EFFORT_TOKEN = 'best-effort';

const buildAnnotation = (token, reason, extra) => ({ ...extra, token, reason, hasReason: MEANINGFUL_REASON.test(reason) });

/**
 * Parses `<token> <reason>` after the marker on one line of comment text; null when there is
 * no marker or the token runs into another word (best-effort-ish). The reason may be empty.
 */
export const parseAllowAnnotation = (lineText) => {
  const markerIndex = lineText.indexOf(ALLOW_MARKER);
  const hasMarker = markerIndex !== -1;
  if (!hasMarker) return null;
  const afterMarker = lineText.slice(markerIndex + ALLOW_MARKER.length).split(COMMENT_CLOSERS)[0].trim();
  const match = ANNOTATION_BODY.exec(afterMarker);
  if (!match) return null;
  return buildAnnotation(match[1], match[2].trim(), { isCommentOnly: COMMENT_ONLY_LINE.test(lineText), markerIndex });
};

// A reasonless annotation in a still-open block comment reads its reason from the comment's
// following lines, each without its leading `*` gutter, up to the closer.
const readBlockContinuation = (lines, startIdx, closer) => {
  const parts = [];
  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const closeAt = lines[idx].indexOf(closer);
    const isClosed = closeAt !== -1;
    const text = isClosed ? lines[idx].slice(0, closeAt) : lines[idx];
    parts.push(text.replace(BLOCK_GUTTER, '').trim());
    if (isClosed) return { reason: parts.filter(Boolean).join(' '), lastIdx: idx };
  }
  return { reason: parts.filter(Boolean).join(' '), lastIdx: lines.length - 1 };
};

const withContinuation = (annotation, lines, idx, scan) => {
  const isOpenBlock = scan.state.inBlock && annotation.reason === '';
  if (!isOpenBlock) return { ...annotation, lastLine: idx + 1 };
  const { reason, lastIdx } = readBlockContinuation(lines, idx + 1, scan.state.blockCloser);
  return { ...buildAnnotation(annotation.token, reason, annotation), lastLine: lastIdx + 1 };
};

/** Map of 1-based marker line number to the allow annotation written in a comment there. */
export const parseAllowAnnotations = (lines) => {
  const annotations = new Map();
  let state = INITIAL_SCAN_STATE;
  lines.forEach((lineText, idx) => {
    const scan = scanCommentRegions(lineText, state);
    state = scan.state;
    const annotation = parseAllowAnnotation(lineText);
    if (!annotation) return;
    const isInComment = scan.regions.some(([start, end]) => annotation.markerIndex >= start && annotation.markerIndex < end);
    if (isInComment) annotations.set(idx + 1, withContinuation(annotation, lines, idx, scan));
  });
  return annotations;
};

const doesTokenCover = (token, rule) => {
  const isBestEffort = token === BEST_EFFORT_TOKEN;
  if (isBestEffort) return CATCH_FAMILY.has(rule);
  return token === rule;
};

const isAnnotationInRange = (annotationLine, annotation, violation) => {
  const endLine = violation.endLine ?? violation.line;
  const isWithin = annotationLine >= violation.line && annotationLine <= endLine;
  const isLineAbove = annotation.isCommentOnly && annotation.lastLine === violation.line - 1;
  const isAfterTryBrace = annotationLine === violation.tryBraceLine && annotation.markerIndex >= violation.tryBraceColumn;
  return isWithin || isLineAbove || isAfterTryBrace;
};

const listCoveringAnnotations = (violation, annotations) => [...annotations]
  .filter(([line, annotation]) => doesTokenCover(annotation.token, violation.rule) && isAnnotationInRange(line, annotation, violation))
  .map(([, annotation]) => annotation);

export const isSuppressedByAnnotation = (violation, annotations) =>
  listCoveringAnnotations(violation, annotations).some((annotation) => annotation.hasReason);

const withMissingReasonNote = (violation, annotations) => {
  const reasonless = listCoveringAnnotations(violation, annotations)[0];
  if (!reasonless) return violation;
  const note = `the chemx-allow: ${reasonless.token} annotation needs a reason (reason is mandatory)`;
  return { ...violation, hazard: `${violation.hazard}; ${note}` };
};

const siteKey = (v) => `${v.filePath}:${v.line}`;

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
export const applyAuditPostFilters = (violations, lines) => {
  const annotations = parseAllowAnnotations(lines);
  const hasAnnotations = annotations.size > 0;
  const allowed = hasAnnotations
    ? violations.filter((v) => !isSuppressedByAnnotation(v, annotations)).map((v) => withMissingReasonNote(v, annotations))
    : violations;
  return dedupeViolations(allowed);
};
