/**
 * Multi-range line number parsing and merging utilities for Chemical X reader.
 */

/**
 * Parses comma-separated line ranges such as "10-20,30-40,55" or "10:20,30".
 * Returns an array of { start: number, end: number } objects, or null if invalid.
 *
 * @param {string} rangeStr Raw range string.
 * @returns {{ start: number, end: number }[] | null}
 */
export const parseLineRanges = (rangeStr) => {
  const hasRangeStr = Boolean(rangeStr) && typeof rangeStr === 'string';
  if (!hasRangeStr) return null;

  const parts = rangeStr.split(',').map((p) => p.trim()).filter(Boolean);
  const ranges = [];

  for (const part of parts) {
    const match = part.match(/^(\d+)(?:[-:](\d+))?$/);
    if (!match) return null;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    ranges.push({
      start: Math.min(start, end),
      end: Math.max(start, end)
    });
  }

  const hasRanges = ranges.length > 0;
  return hasRanges ? ranges : null;
};

/**
 * Extracts line range specifications following the last colon in a file path,
 * e.g. "path/to/file.ts:10-20,30-40" -> { cleanPath: "path/to/file.ts", ranges: [...] }.
 * Safely ignores Windows drive letters (e.g. "C:\\...").
 *
 * @param {string} filePath Raw path potentially carrying range suffix.
 * @returns {{ cleanPath: string, ranges: { start: number, end: number }[] | null }}
 */
export const extractColonRanges = (filePath) => {
  const hasPath = Boolean(filePath) && typeof filePath === 'string';
  if (!hasPath) return { cleanPath: filePath, ranges: null };

  const lastColon = filePath.lastIndexOf(':');
  const hasNoColon = lastColon === -1;
  if (hasNoColon) return { cleanPath: filePath, ranges: null };

  const isWindowsDrive = lastColon === 1 && /^[a-zA-Z]$/.test(filePath[0]);
  if (isWindowsDrive) return { cleanPath: filePath, ranges: null };

  const potentialRanges = filePath.slice(lastColon + 1);
  const parsed = parseLineRanges(potentialRanges);
  const hasParsedRanges = Boolean(parsed);

  if (hasParsedRanges) {
    return {
      cleanPath: filePath.slice(0, lastColon),
      ranges: parsed
    };
  }

  return { cleanPath: filePath, ranges: null };
};

/**
 * Merges overlapping or contiguous line ranges into non-overlapping spans.
 *
 * @param {{ start: number, end: number }[]} ranges
 * @returns {{ start: number, end: number }[]}
 */
export const mergeRanges = (ranges = []) => {
  const hasFewRanges = !ranges || ranges.length <= 1;
  if (hasFewRanges) return ranges ? [...ranges] : [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = merged[merged.length - 1];
    const isAdjacentOrOverlapping = current.start <= prev.end + 1;

    if (isAdjacentOrOverlapping) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
};

/**
 * Clusters a list of line numbers into contextual windows and merges nearby ranges.
 *
 * @param {number[]} lineNumbers
 * @param {object} [options]
 * @param {number} [options.before=2] Lines of context before each violation.
 * @param {number} [options.after=3] Lines of context after each violation.
 * @param {number} [options.mergeGap=4] Maximum gap between windows to merge.
 * @returns {{ start: number, end: number }[]}
 */
export const clusterViolationRanges = (lineNumbers = [], options = {}) => {
  const hasLines = Boolean(lineNumbers && lineNumbers.length > 0);
  if (!hasLines) return [];

  const { before = 2, after = 3, mergeGap = 4 } = options;
  const uniqueSorted = Array.from(new Set(lineNumbers.filter((n) => typeof n === 'number' && n > 0))).sort((a, b) => a - b);
  const hasValidLines = uniqueSorted.length > 0;
  if (!hasValidLines) return [];

  const rawWindows = uniqueSorted.map((line) => ({
    start: Math.max(1, line - before),
    end: line + after
  }));

  const merged = [rawWindows[0]];
  for (let i = 1; i < rawWindows.length; i++) {
    const current = rawWindows[i];
    const prev = merged[merged.length - 1];
    const isNearbyOrOverlapping = current.start <= prev.end + mergeGap;
    if (isNearbyOrOverlapping) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
};

/**
 * Partitions clustered ranges into token-bounded batches and generates ready-to-run chemx read commands.
 *
 * @param {string} filePath Relative file path.
 * @param {number[]} lineNumbers Array of violation line numbers.
 * @param {object} [options]
 * @param {number} [options.maxBatchLines=60] Maximum total lines per batch command (~450 tokens).
 * @returns {string[]} Array of command strings (e.g. `chemx read path:10-20,30-40 --bare`).
 */
export const buildBatchReadCommands = (filePath, lineNumbers = [], options = {}) => {
  const hasPath = Boolean(filePath);
  if (!hasPath) return [];

  const { maxBatchLines = 60 } = options;
  const clustered = clusterViolationRanges(lineNumbers, options);
  const hasClustered = clustered.length > 0;
  if (!hasClustered) return [];

  const batches = [];
  let currentBatch = [];
  let currentBatchLines = 0;

  for (const span of clustered) {
    const spanLines = span.end - span.start + 1;
    const wouldExceed = currentBatch.length > 0 && (currentBatchLines + spanLines > maxBatchLines);
    if (wouldExceed) {
      batches.push(currentBatch);
      currentBatch = [span];
      currentBatchLines = spanLines;
    } else {
      currentBatch.push(span);
      currentBatchLines += spanLines;
    }
  }
  const hasRemainingBatch = currentBatch.length > 0;
  if (hasRemainingBatch) {
    batches.push(currentBatch);
  }

  const isMultiBatch = batches.length > 1;
  return batches.map((batch, idx) => {
    const rangeStr = batch.map((r) => `${r.start}-${r.end}`).join(',');
    const batchSuffix = isMultiBatch ? ` (batch ${idx + 1} of ${batches.length})` : '';
    return `chemx read ${filePath}:${rangeStr} --bare${batchSuffix}`;
  });
};

/**
 * Slices multiple ranges from file content and formats them with delimiters.
 */
export const sliceMultiRanges = ({
  rawContent,
  resolvedPath,
  rawLines,
  mergedRanges,
  options,
  conflictNote,
  totalLines,
  rawPath,
  sliceFn
}) => {
  const slices = [];
  let totalSlicedLines = 0;
  const isBare = Boolean(options.bare);

  for (const r of mergedRanges) {
    const sIdx = Math.max(0, r.start - 1);
    const eIdx = Math.min(rawLines.length, r.end);
    const sl = sliceFn(rawContent, resolvedPath, sIdx, eIdx, options);
    slices.push({
      startLine: sIdx + 1,
      endLine: eIdx,
      lineCount: sl.lines.length,
      lines: sl.lines,
      content: sl.content,
      lineNumbers: sl.lineNumbers,
      notes: sl.notes
    });
    totalSlicedLines += sl.lines.length;
  }

  const content = slices.map((sl) => {
    if (isBare) {
      return `// --- lines ${sl.startLine}-${sl.endLine} ---\n${sl.content}`;
    }
    return `--- lines ${sl.startLine}-${sl.endLine} of ${totalLines} ---\n${sl.content}`;
  }).join('\n\n');

  return {
    file: rawPath,
    totalLines,
    mode: 'multi-range',
    ranges: mergedRanges,
    slices,
    startLine: mergedRanges[0].start,
    endLine: mergedRanges[mergedRanges.length - 1].end,
    lineCount: totalSlicedLines,
    tokensEst: Math.round(content.length / 3.8),
    content,
    ...(conflictNote ? { conflict: conflictNote } : {})
  };
};
