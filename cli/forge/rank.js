// Ranking (engine doc section 8):
//   score = (instances - 1) * mass * (1 - holeRatio) * placementOk * levelWeight * (spec ? 0.5 : 1) * (call idiom ? 0.1 : 1)
//   levelWeight  N1 fp1 (L1) 1.0, N1 fp2 and N2 (L2) 0.9, W 0.8, N3, N1 fp3 and T (L3) 0.6, N4 (name twins, review candidates) 0.4, library 1.2
//   placementOk  1 when the group's facet names a package root (every member then has a same-facet host
//                inside that root), else 0 and the group is an observation
// Maximality: fold.js folds every group that is not a shape of its own into the group that stands for
// it (inside, overlap, block, wrapper, variant and fragment; A23's expression inside A21's functions), so
// the top N holds distinct shapes and each slot lists what it folded. A group whose every instance
// contains an instance of a lower-scored group that also stands elsewhere, outside its own fold family,
// depends on it (A5's window on A4's check). Only accepted groups (status candidate) take part; the first
// TOP_SURFACED unfolded ones are surfaced, all are kept.
import { byCodePoint, pushTo, sharedAnchors } from './group-shape.js';
import { packageRootOfKey } from './facets.js';
import { foldGroups } from './fold.js';

export const TOP_SURFACED = 20;

export const LEVEL_WEIGHTS = Object.freeze({ 'N1-fp1': 1, 'N1-fp2': 0.9, N2: 0.9, W: 0.8, N3: 0.6, 'N1-fp3': 0.6, T: 0.6, N4: 0.4, LIB: 1.2 });

const SPEC_WEIGHT = 0.5;

// Call idioms (#5889): a group whose every member is one line made only of standard-library, framework or global calls (several may nest)
// (path.relative(...), fs.existsSync(...), fs.readFileSync(p, 'utf-8')) is a value-level idiom, not a
// reusable shape. Its site count would otherwise out-rank real duplicates, so its score is scaled down;
// the group is still kept, ranked and listed, just later. The test reads only the ledger facts a group
// carries (kinds, lines, mass, shared anchors), never source text, so it can misjudge: a one-call line
// that is a real duplicate is demoted too, and a call idiom wrapped in other calls is not.
export const CALL_IDIOM = Object.freeze({ weight: 0.1, maxMass: 25, kinds: Object.freeze(['expr', 'stmt']) });

const isOutsideModule = (anchor) => anchor.startsWith('import:') && anchor.slice('import:'.length).split('#')[0].includes('/');

/** True when the group is one single-line call of an imported library or a global, with no project-local anchor. */
export const isCallIdiom = (group) => {
  const isSimpleKind = group.instances.every((instance) => CALL_IDIOM.kinds.includes(instance.kind));
  const isOneLine = group.instances.every((instance) => instance.startLine === instance.endLine);
  const shared = sharedAnchors(group.instances);
  const isLibrary = shared.some((anchor) => anchor.startsWith('global:') || (anchor.startsWith('import:') && !isOutsideModule(anchor)));
  const isLocal = shared.some(isOutsideModule);
  return isSimpleKind && isOneLine && group.mass <= CALL_IDIOM.maxMass && isLibrary && !isLocal;
};

const isSpecFacet = (facetKey) => facetKey.split(':')[2] === 'spec';

/** placementOk of a group: its facet carries a package root. */
export const placementOkOf = (group) => (packageRootOfKey(group.facetKey ?? '') === '' ? 0 : 1);

/** The engine-doc score of one group (holeRatio from its LGG, 0 without one). */
export const scoreOf = (group) => {
  const holeRatio = group.lgg?.holeRatio ?? 0;
  const specWeight = isSpecFacet(group.facetKey ?? '') ? SPEC_WEIGHT : 1;
  const levelWeight = LEVEL_WEIGHTS[group.path] ?? 0;
  const idiomWeight = isCallIdiom(group) ? CALL_IDIOM.weight : 1;
  return (group.memberCount - 1) * group.mass * (1 - holeRatio) * placementOkOf(group) * levelWeight * specWeight * idiomWeight;
};

const contains = (outer, inner) => outer.file === inner.file && outer.start <= inner.start && inner.end <= outer.end;

const isInside = (inner, outer) => inner.instances.every((instance) => outer.instances.some((candidate) => contains(candidate, instance)));

const usesEverywhere = (outer, piece) => outer.instances.every((instance) => piece.instances.some((candidate) => contains(instance, candidate)));

const byScore = (a, b) => b.score - a.score || byCodePoint(a.id, b.id);

// Groups sharing a file with each group, so maximality never compares unrelated groups.
const neighboursOf = (groups) => {
  const byFile = new Map();
  for (const group of groups) {
    for (const file of new Set(group.instances.map((instance) => instance.file))) pushTo(byFile, file, group);
  }
  return (group) => [...new Set(byFile.get(group.instances[0].file) ?? [])].filter((other) => other !== group);
};

const familyIdOf = (group) => group.foldedInto ?? group.id;

/**
 * Scores, folds and links accepted groups in place: score, rank, foldedInto, foldReason, folded (on a
 * root), dependsOn and isSurfaced. options.skeletonOf(group) feeds fold.js's variant rule. Returns the
 * groups sorted by score (highest first, then id).
 */
export const rankGroups = (groups, { skeletonOf } = {}) => {
  for (const group of groups) Object.assign(group, { score: scoreOf(group), foldedInto: null, foldReason: null, folded: [], dependsOn: [], isSurfaced: false });
  const ranked = [...groups].sort(byScore);
  foldGroups(ranked, skeletonOf ? { skeletonOf } : {});
  const neighbours = neighboursOf(ranked);
  for (const group of ranked) {
    const isOtherFamily = (other) => familyIdOf(other) !== familyIdOf(group);
    const pieces = neighbours(group).filter((other) => isOtherFamily(other) && other.score < group.score && !isInside(other, group) && usesEverywhere(group, other));
    group.dependsOn = pieces.map((piece) => piece.id).sort(byCodePoint);
  }
  let rank = 0;
  for (const group of ranked) {
    const isFolded = group.foldedInto !== null;
    rank += isFolded ? 0 : 1;
    group.rank = isFolded ? null : rank;
    group.isSurfaced = !isFolded && rank <= TOP_SURFACED;
  }
  return ranked;
};

