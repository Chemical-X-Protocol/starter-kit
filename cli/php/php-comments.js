// PHP comment regions and file-header range, built from php-parser comments (design spec 3.6).
// Columns are 0-based string indexes, the shape applyAuditPostFilters takes as commentRegions.
// A `#[Attribute]` is not a comment, and php-parser does not report it as one.

const lineLength = (lines, lineNumber) => (lines[lineNumber - 1] ?? "").length;

// A line comment value ends in a newline, so php-parser ends it at column 0 of the next line.
const effectiveEnd = (comment, lines) => {
  const { start, end } = comment.loc;
  const spillsToNextLine = end.line > start.line && end.column === 0;
  if (spillsToNextLine) return { line: end.line - 1, column: lineLength(lines, end.line - 1) };
  return { line: end.line, column: end.column };
};

const addRegion = (regions, lineNumber, startColumn, endColumn) => {
  const index = lineNumber - 1;
  const isInRange = index >= 0 && index < regions.length;
  const isNonEmpty = endColumn > startColumn;
  const isRecordable = isInRange && isNonEmpty;
  if (isRecordable) regions[index].push([startColumn, endColumn]);
};

/**
 * Per-line comment regions: an array with one entry per line (index 0 is line 1), each a list of
 * [start, end) columns. Comments without a position are skipped.
 */
export function buildPhpCommentRegions(comments, lines) {
  const regions = lines.map(() => []);
  for (const comment of comments ?? []) {
    const hasPosition = Boolean(comment?.loc?.start) && Boolean(comment.loc.end);
    if (!hasPosition) continue;
    const start = comment.loc.start;
    const end = effectiveEnd(comment, lines);
    for (let line = start.line; line <= end.line; line += 1) {
      const from = line === start.line ? start.column : 0;
      const to = line === end.line ? end.column : lineLength(lines, line);
      addRegion(regions, line, from, to);
    }
  }
  return regions;
}

/**
 * Last line of the comments that precede the first statement of the file, or 0 when there are none.
 * A comment is in the header when it ends before the first top-level node starts.
 */
export function phpHeaderEndLine(ast, comments, lines = []) {
  const first = (ast?.children ?? []).find((node) => node?.loc?.start);
  const limit = first ? first.loc.start.offset : Infinity;
  let last = 0;
  for (const comment of comments ?? []) {
    const hasPosition = Boolean(comment?.loc?.start) && Boolean(comment.loc.end);
    if (!hasPosition) continue;
    const isBeforeFirst = comment.loc.end.offset <= limit;
    if (isBeforeFirst) last = Math.max(last, effectiveEnd(comment, lines).line);
  }
  return last;
}
