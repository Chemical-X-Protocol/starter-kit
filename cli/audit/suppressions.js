/**
 * Central post-filters for auditCode:
 * - `chemx-allow: <token> <reason>` annotations (token is a RULE_ID or `best-effort`
 *   for the catch-rule family). A reason is mandatory. The annotation applies on its
 *   own line, the line after a comment-only annotation line, and anywhere inside a
 *   flagged catch clause (violations carry `endLine` for that).
 * - duplicate reports of one finding (same file, line, column and rule), plus the
 *   AI_SLOP_SHALLOW_CATCH twin of an ERROR_SWALLOWED_EXCEPTION at the same site.
 */

const ALLOW_MARKER = 'chemx-allow:';
const ANNOTATION_BODY = /^\s*([A-Za-z_-]+)\s+(\S.*)$/;
const COMMENT_CLOSERS = /\*\/|-->/;
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|\/\*|\*|<!--)/;
const CATCH_FAMILY = new Set(['ERROR_SWALLOWED_EXCEPTION', 'AI_SLOP_SHALLOW_CATCH']);
const BEST_EFFORT_TOKEN = 'best-effort';

/** Parses `<token> <reason>` after the marker; null when the reason is missing. */
export const parseAllowAnnotation = (lineText) => {
  const markerIndex = lineText.indexOf(ALLOW_MARKER);
  if (markerIndex === -1) return null;
  const afterMarker = lineText.slice(markerIndex + ALLOW_MARKER.length).split(COMMENT_CLOSERS)[0].trim();
  const match = ANNOTATION_BODY.exec(afterMarker);
  if (!match) return null;
  return { token: match[1], reason: match[2].trim(), isCommentOnly: COMMENT_ONLY_LINE.test(lineText) };
};

/** Map of 1-based line number to the allow annotation on that line. */
export const parseAllowAnnotations = (lines) => {
  const annotations = new Map();
  lines.forEach((lineText, idx) => {
    const annotation = parseAllowAnnotation(lineText);
    if (annotation) annotations.set(idx + 1, annotation);
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
  const isLineAbove = annotation.isCommentOnly && annotationLine === violation.line - 1;
  return isWithin || isLineAbove;
};

export const isSuppressedByAnnotation = (violation, annotations) => {
  for (const [annotationLine, annotation] of annotations) {
    const isCovered = doesTokenCover(annotation.token, violation.rule) &&
      isAnnotationInRange(annotationLine, annotation, violation);
    if (isCovered) return true;
  }
  return false;
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

/** Applies annotations and dedup; returns a new array. */
export const applyAuditPostFilters = (violations, lines) => {
  const annotations = parseAllowAnnotations(lines);
  const hasAnnotations = annotations.size > 0;
  const allowed = hasAnnotations
    ? violations.filter((v) => !isSuppressedByAnnotation(v, annotations))
    : violations;
  return dedupeViolations(allowed);
};
