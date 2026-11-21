/**
 * Shared rendering for `chemx read` (CLI text and MCP): `N|` line numbers on verbatim
 * content, and a header that states where the slice sits in the file.
 */

const VERBATIM_MODES = new Set(['range', 'symbol', 'template', 'full', 'multi-range']);

export const isVerbatimMode = (mode) => VERBATIM_MODES.has(mode);

/**
 * Prefixes each line with its file line number.
 *
 * @param {string} content Slice text.
 * @param {number} firstLine Line number of the first slice line.
 * @param {number[]} [lineNumbers] Explicit numbers when lines were dropped (compact).
 * @returns {string}
 */
export const numberLines = (content, firstLine, lineNumbers = null) => {
  const lines = content.split('\n');
  const numbers = lineNumbers || lines.map((_, i) => firstLine + i);
  const width = String(numbers[numbers.length - 1] || firstLine).length;
  return lines.map((line, i) => `${String(numbers[i]).padStart(width, ' ')}|${line}`).join('\n');
};

/**
 * @param {object} res readTokenOptimized result.
 * @returns {string} One-line header without decoration, e.g. `src/a.ts:L12-30 of 490 (~80 tokens)`.
 */
export const formatReadHeader = (res) => {
  const enrichNote = res.tokensEnriched > 0 ? ` +${res.tokensEnriched} enriched` : '';
  const notes = (res.notes || []).map((n) => ` [${n}]`).join('');
  const isMultiRange = res.mode === 'multi-range' && Boolean(res.ranges);
  if (isMultiRange) {
    const rangeList = res.ranges.map((r) => `L${r.start}-${r.end}`).join(', ');
    return `${res.file}:[${rangeList}] of ${res.totalLines} (~${res.tokensEst} tokens${enrichNote})${notes}`;
  }
  const hasRange = isVerbatimMode(res.mode) && typeof res.startLine === 'number';
  const location = hasRange ? `${res.file}:L${res.startLine}-${res.endLine} of ${res.totalLines}` : `${res.file} (${res.totalLines} lines, ${res.mode})`;
  const others = (res.matches || []).slice(1).map((m) => `${m.name} L${m.startLine}-${m.endLine}`);
  const alsoNote = others.length > 0 ? ` [also matches: ${others.join(', ')}]` : '';
  return `${location} (~${res.tokensEst} tokens${enrichNote})${notes}${alsoNote}`;
};

/**
 * @param {object} res readTokenOptimized result.
 * @returns {string} Body text: numbered when verbatim, as-is otherwise.
 */
export const formatReadBody = (res) => {
  const isMultiRange = res.mode === 'multi-range' && Boolean(res.slices);
  if (isMultiRange) {
    return res.slices.map((sl) => {
      const numbered = numberLines(sl.content, sl.startLine, sl.lineNumbers || null);
      return `--- lines ${sl.startLine}-${sl.endLine} of ${res.totalLines} ---\n${numbered}`;
    }).join('\n\n');
  }
  const shouldNumber = isVerbatimMode(res.mode) && typeof res.startLine === 'number';
  if (!shouldNumber) return res.content;
  const body = numberLines(res.content, res.startLine, res.lineNumbers || null);
  return res.trailer ? `${body}\n${res.trailer}` : body;
};
