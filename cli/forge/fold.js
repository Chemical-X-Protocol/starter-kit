// Maximality folding for ranking (engine doc section 8): the top N shows one slot per repeated shape, and
// every group a slot stands for is listed as a member of it (group.folded), never dropped. Folding only
// decides what is surfaced; it never changes a group's members, LGG or verdict, and every group is stored.
// Pass 1 walks groups by score (highest first). A group joins the family of a higher-scored group when
//   inside    every one of its instances lies inside an instance of that family (A23's expression in A21)
//   overlap   at least half of its instances cross an instance of that family (they overlap and neither
//             contains the other): windows of different lengths over the same statements, such as A1's
//             sibling windows in team-flags.js
//   block     (W only) at least half of its instances meet (overlap in any way, containment included) the
//             W instances of that family: W groups are sibling repeats inside one block, so W groups
//             that share statements there are one table of that block (A1's two-form flags)
//   wrapper   every one of its instances strictly contains an instance of that family that is lighter by
//             less than the G1 mass floor (8): `const reason = <A12-like expr>` adds a binding to the
//             expression group, nothing a piece of its own would carry. A fn group never folds this way:
//             a re-declared helper is the finding, even when its body is a known expression
//   variant   it has one skeleton (equal fp3 on every instance, as skeletonOf reads it), the same kind,
//             facet and skeleton as that group, and shares at least half of their anchors (Jaccard): fp2
//             variants of one statement, such as the violations.push records of ast-visitors.js
// Pass 2 folds fragments into the family that holds them, whatever its score: a family whose instances
// strictly contain all of a group's instances but its residual (at most FOLD_SLACK: 1 for cross-file
// paths, whose groups need 2 instances, and 2 for W, whose groups need 3) takes the group's family in.
// The residual sites stay listed through the folded member. Pass 1 families are the only hosts, so the
// order in which fragments are visited never changes a decision.
import { pushTo, sharedAnchors } from './group-shape.js';
import { GATES } from './gates.js';

export const FOLD_SLACK = Object.freeze({ W: 2, other: 1 });
export const VARIANT_MIN_JACCARD = 0.5;
export const OVERLAP_MIN_SHARE = 0.5;

const contains = (outer, inner) => outer.file === inner.file && outer.start <= inner.start && inner.end <= outer.end;

const lengthOf = (instance) => instance.end - instance.start;

const strictlyContains = (outer, inner) => contains(outer, inner) && lengthOf(outer) > lengthOf(inner);

const crosses = (a, b) => a.file === b.file && a.start < b.end && b.start < a.end && !contains(a, b) && !contains(b, a);

const meets = (a, b) => a.file === b.file && a.start < b.end && b.start < a.end;

// Relations of an indexed entry to an instance; meetsW counts only W entries.
const RELATIONS = Object.freeze({
  inside: (entry, instance) => contains(entry.instance, instance),
  strict: (entry, instance) => strictlyContains(entry.instance, instance),
  crossing: (entry, instance) => crosses(entry.instance, instance),
  meetsW: (entry, instance) => entry.path === 'W' && meets(entry.instance, instance),
  wraps: (entry, instance, group) => strictlyContains(instance, entry.instance) && group.mass - entry.mass < GATES.G1.minMass
});

const EMPTY_TALLY = Object.freeze({ inside: 0, strict: 0, crossing: 0, meetsW: 0, wraps: 0 });

const slackOf = (group) => (group.path === 'W' ? FOLD_SLACK.W : FOLD_SLACK.other);

const jaccard = (left, right) => {
  const a = new Set(left);
  const b = new Set(right);
  const common = [...a].filter((item) => b.has(item)).length;
  const union = a.size + b.size - common;
  return union === 0 ? 0 : common / union;
};

const NO_SKELETON = () => null;

// Instances of every family member by file: entries { instance, family } for the containment tests.
const createIndex = () => {
  const byFile = new Map();
  return {
    add: (group, family) => group.instances.forEach((instance) => pushTo(byFile, instance.file, { instance, family, path: group.path, mass: group.mass })),
    near: (instance) => byFile.get(instance.file) ?? []
  };
};

// Families one instance relates to, per relation (an instance counts once per family and relation).
const relationsOf = (instance, group, index, ownFamily) => {
  const found = Object.fromEntries(Object.keys(RELATIONS).map((relation) => [relation, new Set()]));
  const others = index.near(instance).filter((entry) => entry.family !== ownFamily);
  for (const [relation, holds] of Object.entries(RELATIONS)) {
    others.filter((entry) => holds(entry, instance, group)).forEach((entry) => found[relation].add(entry.family));
  }
  return found;
};

// Per family: how many of the group's instances lie inside, strictly inside or across its instances.
const tally = (group, index, ownFamily = null) => {
  const counts = new Map();
  for (const instance of group.instances) {
    for (const [relation, families] of Object.entries(relationsOf(instance, group, index, ownFamily))) {
      families.forEach((family) => {
        const row = counts.get(family) ?? { family, ...EMPTY_TALLY };
        row[relation] += 1;
        counts.set(family, row);
      });
    }
  }
  return [...counts.values()];
};

// The family of the best row that passes isWanted: most instances by weight, then the higher-scored family.
const bestFamily = (rows, isWanted, weight) => rows.filter(isWanted).sort((a, b) => weight(b) - weight(a) || a.family.order - b.family.order)[0]?.family ?? null;

const skeletonKeyOf = (group, skeleton) => `${group.kind}|${group.facetKey}|${skeleton}`;

const variantHost = (group, context) => {
  const skeleton = context.skeletonOf(group);
  const hasSkeleton = skeleton !== null;
  const peers = hasSkeleton ? context.bySkeleton.get(skeletonKeyOf(group, skeleton)) ?? [] : [];
  const anchors = context.anchorsOf(group);
  return peers.find((peer) => jaccard(anchors, context.anchorsOf(peer.group)) >= VARIANT_MIN_JACCARD)?.family ?? null;
};

// Pass 1: the family of a higher-scored group this one joins, with the reason, or null.
const pass1Host = (group, context) => {
  const rows = tally(group, context.index);
  const size = group.instances.length;
  const inside = bestFamily(rows, (row) => row.inside === size, (row) => row.inside);
  const overlap = bestFamily(rows, (row) => row.crossing > 0 && row.crossing >= size * OVERLAP_MIN_SHARE, (row) => row.crossing);
  const isW = group.path === 'W';
  const block = isW ? bestFamily(rows, (row) => row.meetsW > 0 && row.meetsW >= size * OVERLAP_MIN_SHARE, (row) => row.meetsW) : null;
  const isDeclaredPiece = group.kind === 'fn';
  const wrapper = isDeclaredPiece ? null : bestFamily(rows, (row) => row.wraps === size, (row) => row.wraps);
  const isPlaced = Boolean(inside || overlap || block || wrapper);
  const variant = isPlaced ? null : variantHost(group, context);
  const reasons = [['inside', inside], ['overlap', overlap], ['block', block], ['wrapper', wrapper], ['variant', variant]];
  const [reason, family] = reasons.find(([, candidate]) => candidate) ?? [null, null];
  return family ? { family, reason } : null;
};

// The family member a pass-1 member actually relates to (most of its instances by the reason's relation),
// or null when that is the family root itself or the reason (variant) is not a span relation.
const RELATION_OF_REASON = Object.freeze({ inside: 'inside', overlap: 'crossing', block: 'meetsW', wrapper: 'wraps' });

const viaOf = (group, family, reason) => {
  const relation = RELATION_OF_REASON[reason];
  if (!relation) return null;
  const holds = (member) => group.instances.filter((instance) => member.instances.some((held) => RELATIONS[relation]({ instance: held, path: member.path, mass: member.mass }, instance, group))).length;
  const scored = [...family.members.keys()].filter((member) => member !== group).map((member) => ({ member, hits: holds(member) }));
  const best = scored.reduce((top, row) => (row.hits > top.hits ? row : top), { member: family.root, hits: -1 });
  return best.member === family.root ? null : best.member.id;
};

const finalOf = (family) => {
  let current = family;
  while (current.into) current = current.into;
  return current;
};

// Pass 2: a root's family joins the family that strictly holds all of its instances but the slack. Folds
// never chain: a host is a family that is itself a slot (not folded yet), and a family that already took
// a fragment or holds a member of its own is a host, so it stays a slot. Otherwise a group held by the host would end up under the
// host's own host, which need not hold any of its sites.
const fragmentHost = (group, own, index) => {
  const size = group.instances.length;
  const isHost = own.isHost || own.members.size > 1;
  if (isHost) return null;
  const rows = tally(group, index, own).filter((row) => row.family.into === null && finalOf(row.family) !== own);
  return bestFamily(rows, (row) => row.strict >= 2 && size - row.strict <= slackOf(group), (row) => row.strict);
};

/**
 * Folds ranked groups (sorted by score, highest first) in place: foldedInto, foldedVia (the family
 * root the group hit, when that is not the slot) and foldReason on folded groups, folded ([{ id, reason }],
 * by score) on every root. options: { skeletonOf(group) => string | null, anchorsOf(group) => anchors
 * (default: the anchors every instance shares) }. Returns the roots in score order.
 */
export const foldGroups = (ranked, { skeletonOf = NO_SKELETON, anchorsOf = (group) => sharedAnchors(group.instances) } = {}) => {
  const context = { index: createIndex(), bySkeleton: new Map(), skeletonOf, anchorsOf };
  const familyOf = new Map();
  ranked.forEach((group, order) => {
    const host = pass1Host(group, context);
    const family = host?.family ?? { root: group, order, into: null, members: new Map() };
    family.members.set(group, host?.reason ?? null);
    familyOf.set(group, family);
    context.index.add(group, family);
    const skeleton = skeletonOf(group);
    const hasSkeleton = skeleton !== null;
    if (hasSkeleton) pushTo(context.bySkeleton, skeletonKeyOf(group, skeleton), { group, family });
  });
  const roots = ranked.filter((group) => familyOf.get(group).root === group);
  roots.forEach((group) => {
    const own = familyOf.get(group);
    own.into = fragmentHost(group, own, context.index);
    const hasHost = own.into !== null;
    if (hasHost) own.into.isHost = true;
  });
  const folded = new Map();
  for (const group of ranked) {
    const own = familyOf.get(group);
    const target = finalOf(own);
    const reason = own.root === group ? 'fragment' : own.members.get(group);
    const isSurfacing = target.root === group;
    if (isSurfacing) continue;
    const via = own.root === group ? null : viaOf(group, own, reason);
    Object.assign(group, { foldedInto: target.root.id, foldedVia: via, foldReason: reason });
    pushTo(folded, target.root.id, { id: group.id, reason });
  }
  const surfacing = roots.filter((group) => finalOf(familyOf.get(group)).root === group);
  surfacing.forEach((group) => Object.assign(group, { foldedInto: null, foldedVia: null, foldReason: null, folded: folded.get(group.id) ?? [] }));
  return surfacing;
};
