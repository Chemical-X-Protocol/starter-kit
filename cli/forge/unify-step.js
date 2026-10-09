// W's unify step (engine doc section 5, W: same-block buckets merge through LGG). siblings.js offers two
// buckets' first instances; they merge when the LGG of the two passes the reject codes as a W group.
// Parsing is the cost, so a pair is parsed only when it can unify at all:
//   equal fp3     their differences are anchor-free expressions
//   1-2 anchors   their anchors (literals and keys aside, L2 erases them) differ in 1 to
//                 UNIFY_ANCHOR_SLACK places, as a transform or ref hole does (parseInt; an imported const)
// Decisions are memoized by instance pair (content-derived keys) and handed back for group-store.js, so
// a warm run parses only pairs it has never judged.
import { antiUnify } from './lgg.js';
import { judgeLgg } from './rejects.js';
import { memberKeyOf } from './group-shape.js';
import { unifyPairKeyOf } from './group-store.js';

export const UNIFY_ANCHOR_SLACK = 2;

const LOOSE_ANCHOR = /^(str|num|key):/;

const anchorDistance = (a, b) => {
  const left = new Set(a.anchors.filter((anchor) => !LOOSE_ANCHOR.test(anchor)));
  const right = new Set(b.anchors.filter((anchor) => !LOOSE_ANCHOR.test(anchor)));
  return [...left].filter((anchor) => !right.has(anchor)).length + [...right].filter((anchor) => !left.has(anchor)).length;
};

/**
 * context: { reader (unit-trees.js), rowsById, ubiquitousOf, contentHashes, cache (Map pairKey -> bool) }.
 * Returns { unify(instanceA, instanceB) => boolean, decisions (Map pairKey -> bool, every pair judged or
 * reused this run) }.
 */
export const createUnifyStep = ({ reader, rowsById, ubiquitousOf, contentHashes, cache = new Map() }) => {
  const decisions = new Map();
  const fp3Of = (instance) => instance.unitIds.map((id) => rowsById.get(id)?.fp3).join(',');

  const mayUnify = (a, b) => {
    const distance = anchorDistance(a, b);
    const isSkeletonEqual = fp3Of(a) === fp3Of(b);
    return isSkeletonEqual ? distance <= UNIFY_ANCHOR_SLACK : distance >= 1 && distance <= UNIFY_ANCHOR_SLACK;
  };

  const judgePair = (a, b) => {
    const trees = [reader.treeOf(a), reader.treeOf(b)];
    const isResolved = trees.every(Boolean);
    if (!isResolved) return false;
    const ubiquitous = ubiquitousOf(rowsById.get(a.unitIds[0])?.facet_key);
    const lgg = antiUnify(trees, { ubiquitous, examples: false });
    return Boolean(lgg) && judgeLgg(lgg, { path: 'W', kind: a.kind }).ok;
  };

  const unify = (a, b) => {
    const isHopeless = !mayUnify(a, b);
    if (isHopeless) return false;
    const pairKey = unifyPairKeyOf(memberKeyOf(a, contentHashes), memberKeyOf(b, contentHashes));
    const isKnown = cache.has(pairKey);
    const ok = isKnown ? cache.get(pairKey) : judgePair(a, b);
    decisions.set(pairKey, ok);
    return ok;
  };

  return { unify, decisions };
};
