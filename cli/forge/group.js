// Cross-file grouping paths over ledger rows (engine doc section 5). Every bucket is keyed by
// (kind, facet, fp), so units of different facets never meet, and must span at least 2 files:
//   N1  exact buckets. fp1 for fn, stmt and expr (an expression statement's own expression is matched
//       through the stmt row's inner_fp1, see unit-floor.js), gated by G1; fp2 for fn and stmt (G2);
//       fp3 for fn and stmt (G3, then LGG: needsLgg).
//   N2  windows of k = 2..6 consecutive statements over per-block fp2 sequences, maximal windows only,
//       gated by G2.
//   N3  fn units with the same declared name and equal fp3; gated by G1 (the name is the extra evidence),
//       LGG then allows one variant hole (needsLgg).
// A statement instance (N1) or window (N2) that returns from its function must end its block (exits.js);
// one that returns from the middle cannot be cut out as a piece and is dropped before the gates.
// context: { contentHashes, ubiquitousOf, returnsAt(file, start, end), isBlockEnd(row), reject(draft, reason, finish) };
// reject hears every group that failed its gate or instance rules; finish() builds it in full.
import { draftGroup, finishGroup, instanceOfRow, instanceOfRows, pushTo, spansFiles } from './group-shape.js';
import { admitGroup, labelIdiom } from './gates.js';
import { blocksOf, runsOf, windowsOfRuns, windowKeyOf, nonOverlapping, dropDominated } from './windows.js';

export const N1_LEVELS = Object.freeze([
  Object.freeze({ path: 'N1-fp1', level: 1, kinds: new Set(['fn', 'stmt', 'expr']), withInner: true, needsLgg: false }),
  Object.freeze({ path: 'N1-fp2', level: 2, kinds: new Set(['fn', 'stmt']), withInner: false, needsLgg: false }),
  Object.freeze({ path: 'N1-fp3', level: 3, kinds: new Set(['fn', 'stmt']), withInner: false, needsLgg: true })
]);

export const N2_WINDOW = Object.freeze({ minK: 2, maxK: 6 });

const N2_SPEC = Object.freeze({ path: 'N2', level: 2, needsLgg: false });
const N3_SPEC = Object.freeze({ path: 'N3', level: 3, needsLgg: true });

const asIs = (member) => member;

/**
 * Gates members (ledger rows or instances) as one group and builds it only when admitted:
 * options.toInstance turns a member into its instance. A failing group goes to context.reject with the
 * reason (prefixed by options.reasonPrefix); null is returned.
 */
export const admitted = (spec, members, context, { reasonPrefix = '', toInstance = asIs } = {}) => {
  const draft = draftGroup(spec, members, context);
  const verdict = admitGroup(draft);
  const finish = () => finishGroup(draft, members.map(toInstance), context);
  const isAdmitted = verdict.ok;
  if (isAdmitted) return labelIdiom(finish());
  context.reject?.(draft, `${reasonPrefix}${verdict.reason}`, finish);
  return null;
};

// Calls visit(kind, fp, row) for each fp a row offers at this level: its own (for the level's kinds) and,
// at fp1, its expression statement's inner expression as an expr.
const forEachFp = (rows, spec, visit) => {
  const ownColumn = `fp${spec.level}`;
  const innerColumn = `inner_fp${spec.level}`;
  for (const row of rows) {
    const hasOwn = spec.kinds.has(row.kind);
    if (hasOwn) visit(row.kind, row[ownColumn], row);
    const innerFp = spec.withInner ? row[innerColumn] : null;
    if (innerFp) visit('expr', innerFp, row);
  }
};

// Two passes: count each fp, then bucket only the fps seen more than once (most are unique).
const exactBuckets = (rows, spec) => {
  const counts = new Map();
  forEachFp(rows, spec, (kind, fp) => counts.set(fp, (counts.get(fp) ?? 0) + 1));
  const buckets = new Map();
  forEachFp(rows, spec, (kind, fp, row) => {
    const isShared = counts.get(fp) > 1;
    if (isShared) pushTo(buckets, `${kind}|${row.facet_key}|${fp}`, row);
  });
  return [...buckets].filter(([, members]) => spansFiles(members)).map(([key, members]) => ({ kind: key.slice(0, key.indexOf('|')), rows: members }));
};

const isStrandedRow = (kind, row, context) => {
  const isMidBlockStmt = kind === 'stmt' && !context.isBlockEnd(row);
  return isMidBlockStmt && context.returnsAt(row.file_path, row.start, row.end);
};

const exactGroup = (spec, bucket, context) => {
  const { kind } = bucket;
  const kept = bucket.rows.filter((row) => !isStrandedRow(kind, row, context));
  const isStillCrossFile = spansFiles(kept);
  if (!isStillCrossFile) return null;
  const toInstance = (row) => ({ ...instanceOfRow(row), kind });
  return admitted({ ...spec, kind, facetKey: kept[0].facet_key }, kept, context, { toInstance });
};

/** N1: exact fp buckets at fp1, fp2 and fp3, in that order. */
export const groupExact = (rows, context) =>
  N1_LEVELS.flatMap((spec) => exactBuckets(rows, spec).map((entries) => exactGroup(spec, entries, context)).filter(Boolean));

const hasStrandedReturn = (window, context) => {
  const isInner = !context.isBlockEnd(window.rows.at(-1));
  const first = window.rows[0];
  return isInner && context.returnsAt(first.file_path, first.start, window.rows.at(-1).end);
};

const blockOfWindow = (window) => `${window.rows[0].file_path}#${window.rows[0].block_id}`;

// One bucket's windows: the return rule, then non-overlapping per block.
const windowInstances = (windows, context) => {
  const byBlock = new Map();
  for (const window of windows) {
    const isKept = !hasStrandedReturn(window, context);
    if (isKept) pushTo(byBlock, blockOfWindow(window), window);
  }
  return [...byBlock.values()].flatMap((blockWindows) => nonOverlapping(blockWindows)).map((window) => instanceOfRows(window.rows));
};

// A statement whose fp2 occurs in only one file of its facet can be in no cross-file window.
const createRepeatTest = (rows) => {
  const files = new Map();
  for (const row of rows) {
    const isStmt = row.kind === 'stmt';
    if (isStmt) pushTo(files, `${row.facet_key}|${row.fp2}`, row.file_path);
  }
  const repeated = new Set([...files].filter(([, paths]) => new Set(paths).size >= 2).map(([key]) => key));
  return (row) => repeated.has(`${row.facet_key}|${row.fp2}`);
};

/** N2: maximal cross-file statement windows (k = 2..6) over fp2 sequences. */
export const groupWindows = (rows, context) => {
  const buckets = new Map();
  const isRepeated = createRepeatTest(rows);
  for (const blockRows of blocksOf(rows).values()) {
    for (const window of windowsOfRuns(runsOf(blockRows, isRepeated), N2_WINDOW)) {
      pushTo(buckets, `${window.k}|${window.rows[0].facet_key}|${windowKeyOf(window.rows, 2)}`, window);
    }
  }
  const candidates = [...buckets.values()]
    .filter((windows) => spansFiles(windows.map((window) => window.rows[0])))
    .map((windows) => ({ k: windows[0].k, facetKey: windows[0].rows[0].facet_key, instances: windowInstances(windows, context) }))
    .filter((bucket) => new Set(bucket.instances.map((instance) => instance.file)).size >= 2);
  return dropDominated(candidates)
    .map((bucket) => admitted({ ...N2_SPEC, kind: 'window', facetKey: bucket.facetKey }, bucket.instances, context))
    .filter(Boolean);
};

/** N3: same declared name, same facet, equal fp3, in at least 2 files. */
export const groupNamed = (rows, context) => {
  const buckets = new Map();
  for (const row of rows) {
    const isNamedFn = row.kind === 'fn' && Boolean(row.decl_name);
    if (isNamedFn) pushTo(buckets, `${row.facet_key}|${row.decl_name}|${row.fp3}`, row);
  }
  return [...buckets.values()]
    .filter(spansFiles)
    .map((named) => admitted({ ...N3_SPEC, kind: 'fn', facetKey: named[0].facet_key }, named, context, { toInstance: instanceOfRow }))
    .filter(Boolean);
};
