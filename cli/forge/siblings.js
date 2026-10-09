// W: within-block siblings (engine doc section 5; replaces N5). Instances need not be contiguous, so a
// repeated form is found across interleaved statements (team-flags.js :69-73, :100-104, :123-124).
//   - For each block, its windows of k = 1..6 statements are bucketed by fp2.
//   - A bucket is kept with at least 3 non-overlapping instances, each of mass >= 8, totalling >= 36.
//   - Only maximal buckets survive: a bucket whose every instance sits inside a longer kept bucket with
//     as many instances is dropped.
//   - Same-block buckets of equal k and similar mass (the lighter at least 3/4 of the heavier) are offered
//     to options.unify (the LGG of lgg.js), the most repeated buckets first, and merged when it accepts,
//     at most UNIFY_BUDGET calls per block (design doc, BUDGETS: LGG on at most 50 pairs). Equal
//     fp3 is not required: the int and string flag forms of A1 differ at fp3 (parseInt is an anchor) and
//     merge only through a transform hole. Without unify nothing merges, since no fp level alone tells a
//     transform hole from shapes whose LGG fails R1/R2.
//   - Template siblings under one parent are handled the same way at tmpl fp2 (k = 1), and also need G4.
import { instanceOfRow, instanceOfRows, makeGroup, pushTo } from './group-shape.js';
import { checkGate, labelIdiom } from './gates.js';
import { blocksOf, runsOf, windowsOfRuns, windowKeyOf, nonOverlapping, dropDominated } from './windows.js';

export const W_FLOOR = Object.freeze({ minInstances: 3, minInstanceMass: 8, minTotalMass: 36, maxK: 6 });

export const UNIFY_BUDGET = 50;

const MERGE_MASS_RATIO = 0.75;

const W_SPEC = Object.freeze({ path: 'W', level: 2, needsLgg: false });

/** The W floor on one bucket's instances: at least 3, each of mass >= 8, totalling >= 36. */
export const passesWFloor = (instances) => {
  const isEnough = instances.length >= W_FLOOR.minInstances;
  const isEachHeavy = instances.every((instance) => instance.mass >= W_FLOOR.minInstanceMass);
  const isTotalHeavy = instances.reduce((total, instance) => total + instance.mass, 0) >= W_FLOOR.minTotalMass;
  return isEnough && isEachHeavy && isTotalHeavy;
};

// Without unify a bucket holds one fp2 sequence, so a statement whose fp2 occurs fewer than 3 times in
// its block is in no kept window. With unify, buckets of different fp2 may merge, so every row counts.
const eligibilityOf = (blockRows, unify) => {
  const counts = new Map();
  for (const row of blockRows) counts.set(row.fp2, (counts.get(row.fp2) ?? 0) + 1);
  return unify ? () => true : (row) => counts.get(row.fp2) >= W_FLOOR.minInstances;
};

const bucketBlock = (blockRows, unify) => {
  const buckets = new Map();
  const runs = runsOf(blockRows, eligibilityOf(blockRows, unify));
  for (const window of windowsOfRuns(runs, { minK: 1, maxK: W_FLOOR.maxK })) {
    pushTo(buckets, `${window.k}|${windowKeyOf(window.rows, 2)}`, window);
  }
  return [...buckets.values()].map((windows) => {
    const chosen = nonOverlapping(windows);
    return { k: chosen[0].k, windows: chosen, instances: chosen.map((window) => instanceOfRows(window.rows)) };
  });
};

const overlaps = (a, b) => a.file === b.file && a.start < b.end && b.start < a.end;

const isMassSimilar = (a, b) => {
  const [lighter, heavier] = [a.instances[0].mass, b.instances[0].mass].sort((x, y) => x - y);
  return lighter >= heavier * MERGE_MASS_RATIO;
};

const byRepetition = (a, b) => b.instances.length - a.instances.length || a.instances[0].start - b.instances[0].start || a.k - b.k;

// Merges each bucket into the first earlier bucket that unify accepts (most repeated first, then source
// order), spending at most UNIFY_BUDGET unify calls on candidates of equal k and similar mass.
const mergeByUnify = (buckets, unify) => {
  const merged = [];
  let calls = 0;
  const accepts = (target, bucket) => {
    const hasBudget = calls < UNIFY_BUDGET;
    const isCandidate = Boolean(unify) && hasBudget && target.k === bucket.k && isMassSimilar(target, bucket);
    if (!isCandidate) return false;
    calls += 1;
    return unify(target.instances[0], bucket.instances[0]);
  };
  const ordered = unify ? [...buckets].sort(byRepetition) : buckets;
  for (const bucket of ordered) {
    const target = merged.find((candidate) => accepts(candidate, bucket));
    if (target) {
      target.instances = [...target.instances, ...bucket.instances.filter((instance) => !target.instances.some((kept) => overlaps(kept, instance)))];
      target.isMerged = true;
      continue;
    }
    merged.push({ ...bucket });
  }
  return merged;
};

const toGroup = (bucket, facetKey, context, extra = {}) => {
  const spec = { ...W_SPEC, kind: bucket.k === 1 ? bucket.kind : 'window', facetKey, needsLgg: Boolean(bucket.isMerged), ...extra };
  return labelIdiom(makeGroup(spec, bucket.instances, context));
};

const statementGroups = (blockRows, context, unify) => {
  const facetKey = blockRows[0].facet_key;
  const buckets = bucketBlock(blockRows, unify).map((bucket) => ({ ...bucket, kind: 'stmt' }));
  const kept = dropDominated(mergeByUnify(buckets, unify).filter((bucket) => passesWFloor(bucket.instances)));
  return kept.map((bucket) => toGroup(bucket, facetKey, context));
};

/** W over statement blocks. options.unify(instanceA, instanceB) => boolean merges same-block buckets. */
export const groupSiblings = (rows, context, { unify = null } = {}) =>
  [...blocksOf(rows, 'stmt').values()].flatMap((blockRows) => statementGroups(blockRows, context, unify));

const templateGroups = (siblings, context) => {
  const facetKey = siblings[0].facet_key;
  const buckets = new Map();
  for (const row of siblings) pushTo(buckets, row.fp2, instanceOfRow(row));
  return [...buckets.values()]
    .filter((instances) => passesWFloor(instances) && checkGate('G4', { mass: Math.min(...instances.map((instance) => instance.mass)) }).ok)
    .map((instances) => toGroup({ k: 1, kind: 'tmpl', instances }, facetKey, context, { level: 2 }));
};

/** W over template siblings: tmpl units under one parent element, bucketed by fp2. */
export const groupTemplateSiblings = (rows, context) =>
  [...blocksOf(rows, 'tmpl').values()].flatMap((siblings) => templateGroups(siblings, context));
