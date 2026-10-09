// Statement windows (engine doc section 5, N2 and W). A block's stmt rows are split into runs of
// consecutive ordinals (the store floor never drops a statement of a block with 2 or more, so a gap only
// appears when a file hit its row cap); a window is k consecutive rows of one run, keyed by their fp
// sequence at one level. Shared by group.js (N2, cross-file) and siblings.js (W, within-block).
// A row that cannot repeat (its fp2 occurs too rarely for the path) splits a run: every window through it
// would be unique, so skipping it is exact and keeps the window count near the repeated rows only.
import { byCodePoint } from './group-shape.js';

const byStart = (a, b) => (a.start ?? 0) - (b.start ?? 0) || a.ordinal - b.ordinal;

const blockKeyOf = (row) => `${row.file_path}#${row.block_id}`;

// N2, W, sibling families and block ends all read the same blocks: computed once per rows array and kind.
const BLOCK_CACHE = new WeakMap();

/**
 * Map of `${file}#${blockId}` to that block's rows of one kind, in source order; keys in code-point order.
 * Memoized per rows array, so callers must not mutate the result.
 */
export const blocksOf = (rows, kind = 'stmt') => {
  const cached = BLOCK_CACHE.get(rows) ?? new Map();
  BLOCK_CACHE.set(rows, cached);
  const isKnown = cached.has(kind);
  if (!isKnown) cached.set(kind, collectBlocks(rows, kind));
  return cached.get(kind);
};

const collectBlocks = (rows, kind) => {
  const blocks = new Map();
  for (const row of rows) {
    const isKind = row.kind === kind && row.block_id !== null;
    if (!isKind) continue;
    const key = blockKeyOf(row);
    const list = blocks.get(key) ?? [];
    list.push(row);
    blocks.set(key, list);
  }
  const sortedKeys = [...blocks.keys()].sort(byCodePoint);
  return new Map(sortedKeys.map((key) => [key, blocks.get(key).sort(byStart)]));
};

const continuesRun = (previous, row) => {
  const isNextOrdinal = row.ordinal === previous.ordinal + 1;
  const isAfter = (row.start ?? 0) >= (previous.end ?? 0);
  return isNextOrdinal && isAfter;
};

const ANY_ROW = () => true;

/**
 * A block's rows split into runs of consecutive ordinals. isEligible(row) false splits a run there and
 * drops the row (a window through it could never repeat).
 */
export const runsOf = (blockRows, isEligible = ANY_ROW) => {
  const runs = [];
  let previous = null;
  for (const row of blockRows) {
    const isKept = isEligible(row);
    const current = runs.at(-1);
    const isContinued = isKept && Boolean(current) && current.at(-1) === previous && continuesRun(previous, row);
    if (isContinued) current.push(row);
    else if (isKept) runs.push([row]);
    previous = row;
  }
  return runs;
};

/** Key of a window of rows at one fp level: the fp sequence, comma-joined. */
export const windowKeyOf = (rows, level) => rows.map((row) => row[`fp${level}`]).join(',');

/**
 * Every window of k = minK..maxK rows of each run, as { k, rows, runIndex, offset, isRunEnd }.
 * isRunEnd: the window's last row is the run's last row.
 */
export const windowsOfRuns = (runs, { minK, maxK }) => {
  const windows = [];
  runs.forEach((run, runIndex) => {
    for (let k = minK; k <= Math.min(maxK, run.length); k += 1) {
      for (let offset = 0; offset + k <= run.length; offset += 1) {
        windows.push({ k, rows: run.slice(offset, offset + k), runIndex, offset, isRunEnd: offset + k === run.length });
      }
    }
  });
  return windows;
};

const overlapsAny = (chosen, window) => chosen.some((other) => {
  const isSameRun = other.runIndex === window.runIndex;
  return isSameRun && window.offset < other.offset + other.k && other.offset < window.offset + window.k;
});

/** Non-overlapping windows of one block, greedily from the first (windows arrive in source order). */
export const nonOverlapping = (windows) => {
  const chosen = [];
  for (const window of windows) {
    const isFree = !overlapsAny(chosen, window);
    if (isFree) chosen.push(window);
  }
  return chosen;
};

const contains = (outer, inner) => {
  const isSameFile = outer.file === inner.file;
  return isSameFile && outer.start <= inner.start && inner.end <= outer.end;
};

const isDominatedBy = (bucket, other) => {
  const isLonger = other.k > bucket.k;
  const isSameCount = other.instances.length === bucket.instances.length;
  return isLonger && isSameCount && bucket.instances.every((instance) => other.instances.some((outer) => contains(outer, instance)));
};

/**
 * Maximal buckets only: drops a bucket { k, instances } when a longer bucket has as many instances and
 * contains every one of them (the shorter window only ever occurs inside the longer one).
 */
export const dropDominated = (buckets) => {
  const byUnit = new Map();
  for (const bucket of buckets) {
    const unitIds = new Set(bucket.instances.flatMap((instance) => instance.unitIds));
    for (const unitId of unitIds) {
      const list = byUnit.get(unitId) ?? [];
      list.push(bucket);
      byUnit.set(unitId, list);
    }
  }
  const candidatesOf = (bucket) => byUnit.get(bucket.instances[0].unitIds[0]) ?? [];
  return buckets.filter((bucket) => !candidatesOf(bucket).some((other) => isDominatedBy(bucket, other)));
};
