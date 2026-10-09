// Drift (engine doc section 6): a unit whose anchor set is a strict subset of an accepted group's shared
// anchors, covering at least 2/3 of them, with the same root shape, is role=drift: a copy that lost part
// of the check (typecheck-command.js:41-42 resolves `path.relative` and tests only `startsWith('..')`
// where the A4 windows also test `path.isAbsolute`). Drift is reported and becomes a decision hole; it
// is never healed automatically. Facet-ubiquitous anchors never count.
// Candidates come from an anchor index over the ledger: single rows for fn, stmt and expr groups (an expr
// group also hears statements, read through their initializer, test or expression), and windows of the
// group's length around a row for window groups. A candidate overlapping an instance is never drift.
// A drifted copy is still a copy: it weighs at least DRIFT_MIN_MASS_RATIO of the group's mass and at least
// the G1 mass floor, and of overlapping candidates (a statement and its own expression) only the heavier
// one is kept. Only groups with G2 evidence (E >= 30) are searched: a lighter group's anchors are too
// common for a subset of them to mean a lost check.
// The root shape is the caller's (lgg-stage.js reads it from the unit trees): context.shapeOf(rows) for a
// candidate, context.groupShapes() (a Set, asked only once a candidate survives the anchor tests).
import { pushTo, sharedAnchors } from './group-shape.js';
import { blocksOf } from './windows.js';
import { GATES } from './gates.js';

export const DRIFT_MIN_OVERLAP = 2 / 3;
export const DRIFT_MIN_MASS_RATIO = 0.5;
export const DRIFT_MIN_MASS = 8;

const CANDIDATE_KINDS = { fn: ['fn'], stmt: ['stmt'], expr: ['expr', 'stmt'], window: ['stmt'] };

const byLedgerOrder = (a, b) => Number(a.file_path > b.file_path) - Number(a.file_path < b.file_path) || a.start_line - b.start_line || a.start - b.start;

/** Anchor index over ledger rows: postings(facetKey, kind, anchor) and windowsAround(row, k). */
export const createDriftIndex = (rows) => {
  const byKey = new Map();
  for (const row of rows) {
    for (const anchor of row.anchors) pushTo(byKey, `${row.facet_key}|${row.kind}|${anchor}`, row);
  }
  const positions = new Map();
  for (const blockRows of blocksOf(rows, 'stmt').values()) blockRows.forEach((row, index) => positions.set(row.id, { blockRows, index }));
  const windowsAround = (row, k) => {
    const position = positions.get(row.id);
    if (!position) return [];
    const starts = Array.from({ length: k }, (_, offset) => position.index - offset).filter((start) => start >= 0 && start + k <= position.blockRows.length);
    return starts.map((start) => position.blockRows.slice(start, start + k));
  };
  return { postings: (facetKey, kind, anchor) => byKey.get(`${facetKey}|${kind}|${anchor}`) ?? [], windowsAround };
};

const overlapsInstance = (rows, instance) => rows.some((row) => row.file_path === instance.file && row.start < instance.end && instance.start < row.end);

const anchorsOf = (rows, ubiquitous) => [...new Set(rows.flatMap((row) => row.anchors))].filter((anchor) => !ubiquitous.has(anchor));

const isStrictSubsetOf = (anchors, shared) => anchors.length > 0 && anchors.length < shared.size && anchors.every((anchor) => shared.has(anchor));

const spanKeyOf = (rows) => rows.map((row) => row.id).join(',');

const massOf = (rows) => rows.reduce((total, row) => total + row.mass, 0);

const spansOverlap = (a, b) => a.some((row) => b.some((other) => row.file_path === other.file_path && row.start < other.end && other.start < row.end));

// Heaviest first, then ledger order; a span overlapping a kept one is dropped.
const heaviestDisjoint = (spans) => {
  const kept = [];
  const ordered = [...spans].sort((a, b) => massOf(b) - massOf(a) || byLedgerOrder(a[0], b[0]));
  for (const rows of ordered) {
    const isFree = !kept.some((other) => spansOverlap(rows, other));
    if (isFree) kept.push(rows);
  }
  return kept;
};

// A drift span carries only shared anchors, so each of its rows does too.
const isWithin = (row, shared, ubiquitous) => row.anchors.every((anchor) => shared.has(anchor) || ubiquitous.has(anchor));

// A survivor carries at least `minimum` of the shared anchors, so it carries one of any
// (shared.size - minimum + 1) of them: only the postings of that many rarest anchors are walked, which
// finds the same spans as walking all of them (heaviestDisjoint orders them, so visit order is moot).
const rarestAnchors = (shared, minimum, postingsOf) => {
  const needed = shared.size - minimum + 1;
  return [...shared].sort((a, b) => postingsOf(a).length - postingsOf(b).length || Number(a > b) - Number(a < b)).slice(0, Math.max(needed, 1));
};

// Candidate spans (row lists) built only from rows whose anchors all belong to the group.
const candidateSpans = (group, shared, minimum, context) => {
  const k = group.instances[0]?.unitIds.length ?? 1;
  const isWindow = group.kind === 'window';
  const seen = new Set();
  const spans = [];
  const fits = (row) => isWithin(row, shared, context.ubiquitous);
  for (const kind of CANDIDATE_KINDS[group.kind] ?? []) {
    const postingsOf = (anchor) => context.index.postings(group.facetKey, kind, anchor);
    for (const anchor of rarestAnchors(shared, minimum, postingsOf)) {
      for (const row of context.index.postings(group.facetKey, kind, anchor).filter(fits)) {
        const around = isWindow ? context.index.windowsAround(row, k).filter((rows) => rows.every(fits)) : [[row]];
        around.filter((rows) => !seen.has(spanKeyOf(rows))).forEach((rows) => {
          seen.add(spanKeyOf(rows));
          spans.push(rows);
        });
      }
    }
  }
  return spans;
};

/**
 * Drift spans of one accepted group. context: { index (createDriftIndex), ubiquitous, groupShapes(),
 * shapeOf(rows) }. Returns row lists in ledger order of their first row.
 */
export const findDrift = (group, context) => {
  const shared = new Set(sharedAnchors(group.instances).filter((anchor) => !context.ubiquitous.has(anchor)));
  const minimum = Math.ceil(shared.size * DRIFT_MIN_OVERLAP);
  const hasEvidence = shared.size >= 2 && group.evidence >= GATES.G2.minEvidence;
  if (!hasEvidence) return [];
  const minimumMass = Math.max(DRIFT_MIN_MASS, group.mass * DRIFT_MIN_MASS_RATIO);
  const survivors = candidateSpans(group, shared, minimum, context)
    .filter((rows) => {
      const anchors = anchorsOf(rows, context.ubiquitous);
      return isStrictSubsetOf(anchors, shared) && anchors.length >= minimum && massOf(rows) >= minimumMass;
    })
    .filter((rows) => !group.instances.some((instance) => overlapsInstance(rows, instance)));
  const hasSurvivors = survivors.length > 0;
  if (!hasSurvivors) return [];
  const shapes = context.groupShapes();
  return heaviestDisjoint(survivors.filter((rows) => shapes.has(context.shapeOf(rows)))).sort((a, b) => byLedgerOrder(a[0], b[0]));
};
