/**
 * Uncapped unified diff between two texts (line based, LCS on the changed middle).
 */

const MAX_LCS_CELLS = 4_000_000;

const splitLines = (text) => {
  if (text === '') return [];
  const lines = text.split('\n');
  const hasTrailingNewline = lines[lines.length - 1] === '';
  if (hasTrailingNewline) lines.pop();
  return lines;
};

const lcsOps = (a, b) => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const isTooLarge = rows * cols > MAX_LCS_CELLS;
  if (isTooLarge) return [...a.map((l) => ['-', l]), ...b.map((l) => ['+', l])];

  const table = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const isSame = a[i] === b[j];
      table[i][j] = isSame ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const isSame = a[i] === b[j];
    const prefersDelete = table[i + 1][j] >= table[i][j + 1];
    if (isSame) { ops.push([' ', a[i]]); i++; j++; }
    else if (prefersDelete) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  while (i < a.length) ops.push(['-', a[i++]]);
  while (j < b.length) ops.push(['+', b[j++]]);
  return ops;
};

const diffOps = (a, b) => {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const middle = lcsOps(a.slice(head, a.length - tail), b.slice(head, b.length - tail));
  return [
    ...a.slice(0, head).map((l) => [' ', l]),
    ...middle,
    ...a.slice(a.length - tail).map((l) => [' ', l])
  ];
};

const groupHunks = (ops, context) => {
  const changed = ops.map((op, idx) => (op[0] === ' ' ? -1 : idx)).filter((idx) => idx >= 0);
  const hunks = [];
  for (const idx of changed) {
    const last = hunks[hunks.length - 1];
    const isAdjacent = Boolean(last) && idx - last.end <= context * 2;
    if (isAdjacent) last.end = idx;
    else hunks.push({ start: idx, end: idx });
  }
  return hunks.map((h) => ({ from: Math.max(0, h.start - context), to: Math.min(ops.length - 1, h.end + context) }));
};

/**
 * @param {string} before Old text ('' for a new file).
 * @param {string} after New text ('' for a deleted file).
 * @param {object} [options] { path, context, isNew, isDeleted }
 * @returns {string} Unified diff, '' when the texts are equal.
 */
export const buildUnifiedDiff = (before, after, options = {}) => {
  const isUnchanged = before === after;
  if (isUnchanged) return '';
  const context = options.context ?? 3;
  const label = options.path || 'file';
  const ops = diffOps(splitLines(before), splitLines(after));
  const out = [
    `--- ${options.isNew ? '/dev/null' : `a/${label}`}`,
    `+++ ${options.isDeleted ? '/dev/null' : `b/${label}`}`
  ];
  for (const hunk of groupHunks(ops, context)) {
    const before0 = ops.slice(0, hunk.from);
    const slice = ops.slice(hunk.from, hunk.to + 1);
    const oldStart = before0.filter((op) => op[0] !== '+').length + 1;
    const newStart = before0.filter((op) => op[0] !== '-').length + 1;
    const oldCount = slice.filter((op) => op[0] !== '+').length;
    const newCount = slice.filter((op) => op[0] !== '-').length;
    out.push(`@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`);
    slice.forEach((op) => out.push(`${op[0]}${op[1]}`));
  }
  const hasNoTrailingChange = out.length === 2;
  if (hasNoTrailingChange) out.push('\\ whitespace-only change at end of file');
  return out.join('\n');
};
