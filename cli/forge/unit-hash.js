// One-pass fingerprints of the units of one canonical Program (#2554). hash.js fingerprints a unit by
// walking it, so a node inside k units was walked k times (about 2.2 walks per program node for the fn
// and stmt units of 400 kit files), plus one more walk per unit for its declared set. Here one
// post-order walk of the Program gives
// every node a shape digest per level: the hash.js Merkle digest with each binder (an identifier
// bound in the file) written as `#`, or `#:name` where canonicalization keeps the name. The same walk
// lists, in preorder, the binder occurrences, the anchors and the declaration sites.
// A unit's fp at each level is mix(shape of its top, its binder labels in preorder). Labels are
// numbered as hash.js numbers them: #k for binders the unit declares, @k for the others, both in
// first-use order. L2 leaves out binders under kids that L2 skips; L3 also leaves out those inside an
// expression that L3 erases (they still take a number, as in hash.js).
// Guarantee: for the same unit tops, at each level two units get equal fps exactly when hash.js gives
// them equal fps, barring a hash collision (unit-hash.equivalence.spec.js checks this on the non-spec
// Forge modules and a few snippets). The fp values differ from hash.js values. lgg.js still walks
// member trees with hash.js, because it needs per-node digests.
import { childRole, describeNode } from './hash-labels.js';
import { ERASED, LIST_MARK, NULL_RESULT, pushPair, skipsKey } from './hash.js';
import { hashLabelPair, mixPair, pairHex } from './murmur.js';

const WINDOW_TYPE = 'Window';
const PLAIN_ROLE = 'plain';
const LOCAL = 0;
const CAPTURE = 1;
// hash-labels.js reads the declared set only for file-bound identifiers, and those are binders here,
// which never reach describeNode.
const NO_DECLARED = new Set();
const binderUnreached = () => {
  throw new Error('unit-hash: a binder reached describeNode');
};
const BINDER_INFO = Object.freeze({ t1: 'Identifier', v1: '#', t2: 'Identifier', v2: '#', skip: null, anchor: null, isL3Anchor: false });

const isBinder = (node) => node.type === 'Identifier' && node.ident.origin === 'local';
const isDeclaration = (node) => node.type === 'Identifier' && node.ident.isDecl && node.ident.bindingId !== null;

const binderInfoOf = (node) => {
  const isNameKept = Boolean(node.keepsName);
  if (!isNameKept) return BINDER_INFO;
  const label = `#:${node.label}`;
  return { ...BINDER_INFO, v1: label, v2: label };
};

// One context object for every describeNode call: it is read synchronously and never kept.
const DESCRIBE_CONTEXT = { role: PLAIN_ROLE, declared: NO_DECLARED, binderLabel: binderUnreached };
const describe = (node, role) => {
  DESCRIBE_CONTEXT.role = role;
  return describeNode(node, DESCRIBE_CONTEXT);
};

/** Sets each unset depth in depths[from..] to depth: post-order visits deeper nodes first, so the deepest wins. */
const markFrom = (depths, from, depth) => {
  for (let i = from; i < depths.length; i += 1) depths[i] = depths[i] < 0 ? depth : depths[i];
};

/** The binding-site index of one Program: dense binding numbers and the preorder of each declaration. */
const createDeclarations = () => {
  const dense = new Map();
  const first = [];
  const more = [];
  const denseOf = (bindingId) => {
    const known = dense.get(bindingId);
    const isKnown = known !== undefined;
    if (isKnown) return known;
    dense.set(bindingId, first.length);
    first.push(-1);
    more.push(null);
    return first.length - 1;
  };
  const note = (bindingId, pre) => {
    const index = denseOf(bindingId);
    const isFirst = first[index] < 0;
    if (isFirst) first[index] = pre;
    if (!isFirst) more[index] = [...(more[index] ?? []), pre];
  };
  const isInside = (index, from, to) => {
    const isFirstInside = first[index] >= from && first[index] < to;
    return isFirstInside || (more[index] ?? []).some((pre) => pre >= from && pre < to);
  };
  return { denseOf, note, isInside, size: () => first.length };
};

/**
 * Hashes the units of one canonical Program. wanted: every Program node that is a unit top or a part of
 * a synthetic top, plus each unit's declScope node; only those keep a record (hashTop throws on a
 * Program node without one). Returns { sizeOf(node), hashTop(top, scopeNode) }:
 * sizeOf is a wanted node's canonical node count; hashTop fingerprints top (a wanted node, or a
 * synthetic Window / FnSignature / SloppyScript tree over wanted nodes) with scopeNode's declarations
 * as unit-local, and returns { fp1, fp2, fp3, mass, anchors } like hash.js hashUnit.
 */
export const createUnitHasher = (program, wanted) => {
  const records = new Map();
  const declarations = createDeclarations();
  const occBinding = [];
  const occSkipDepth = [];
  const occEraseDepth = [];
  const anchorOcc = [];
  let preorder = 0;

  // The Merkle step of hash.js's walk for one node, given its labels; visitChild returns each kid's
  // digests. Built without per-kid arrays, since it runs once per node of every file.
  const combine = (node, info, role, depth, visitChild) => {
    const ints1 = [];
    const ints2 = [];
    const ints3 = [];
    let isAnchored = info.isL3Anchor;
    let isSame12 = info.t1 === info.t2 && info.v1 === info.v2 && info.skip === null;
    let isSame23 = true;
    for (const key of Object.keys(node.kids)) {
      const value = node.kids[key];
      const role2 = childRole(node, key, role, NO_DECLARED);
      const list = Array.isArray(value) ? value : null;
      const count = list ? list.length : 1;
      const isKept = !skipsKey(info.skip, key);
      const occFrom = occBinding.length;
      const hasHeader = list !== null;
      const keepsHeader = hasHeader && isKept;
      if (hasHeader) ints1.push(LIST_MARK, count);
      if (keepsHeader) ints2.push(LIST_MARK, count);
      if (keepsHeader) ints3.push(LIST_MARK, count);
      for (let i = 0; i < count; i += 1) {
        const child = list ? list[i] : value;
        const result = child ? visitChild(child, role2, depth + 1) : NULL_RESULT;
        isAnchored = isAnchored || result.isAnchored;
        isSame12 = isSame12 && result.l2 === result.l1;
        isSame23 = isSame23 && result.l3 === result.l2;
        pushPair(ints1, result.l1);
        if (isKept) pushPair(ints2, result.l2);
        if (isKept) pushPair(ints3, result.l3);
      }
      if (!isKept) markFrom(occSkipDepth, occFrom, depth);
    }
    const isErased = node.isExpr && !isAnchored;
    const labels1 = hashLabelPair(info.t1, info.v1);
    const hasSameLabels = info.t1 === info.t2 && info.v1 === info.v2;
    const labels2 = hasSameLabels ? labels1 : hashLabelPair(info.t2, info.v2);
    const l1 = mixPair(labels1, ints1);
    const l2 = isSame12 ? l1 : mixPair(labels2, ints2);
    const l3Unerased = isSame23 ? l2 : mixPair(labels2, ints3);
    return { l1, l2, l3: isErased ? ERASED : l3Unerased, isAnchored, isErased };
  };

  const walk = (node, role, depth) => {
    const pre = preorder;
    preorder += 1;
    const occStart = occBinding.length;
    const anchorStart = anchorOcc.length;
    if (isDeclaration(node)) declarations.note(node.ident.bindingId, pre);
    const binder = isBinder(node);
    if (binder) {
      occBinding.push(declarations.denseOf(node.ident.bindingId));
      occSkipDepth.push(-1);
      occEraseDepth.push(-1);
    }
    const info = binder ? binderInfoOf(node) : describe(node, role);
    const hasAnchor = Boolean(info.anchor);
    if (hasAnchor) anchorOcc.push(info.anchor);
    const result = combine(node, info, role, depth, walk);
    if (result.isErased) markFrom(occEraseDepth, occStart, depth);
    const isWanted = wanted.has(node);
    if (isWanted) records.set(node, { result, role, depth, pre, count: preorder - pre, occStart, occEnd: occBinding.length, anchorStart, anchorEnd: anchorOcc.length });
    return result;
  };

  walk(program, PLAIN_ROLE, 0);
  const labelStamp = new Int32Array(declarations.size());
  const labelValue = new Int32Array(declarations.size());
  let stamp = 0;

  const recordOf = (node) => {
    const record = records.get(node);
    if (!record) throw new Error(`unit-hash: no record for a ${node?.type} node (not in the wanted set)`);
    return record;
  };

  const hashTop = (top, scopeNode) => {
    const scope = recordOf(scopeNode);
    stamp += 1;
    const counters = [0, 0];
    const seq1 = [];
    const seq2 = [];
    const seq3 = [];
    const anchors = new Set();
    let mass = 0;

    const labelOf = (index) => {
      const isNumbered = labelStamp[index] === stamp;
      if (isNumbered) return labelValue[index];
      const kind = declarations.isInside(index, scope.pre, scope.pre + scope.count) ? LOCAL : CAPTURE;
      const value = (counters[kind] << 1) | kind;
      counters[kind] += 1;
      labelStamp[index] = stamp;
      labelValue[index] = value;
      return value;
    };

    const take = (record) => {
      mass += record.count;
      for (let i = record.anchorStart; i < record.anchorEnd; i += 1) anchors.add(anchorOcc[i]);
      for (let i = record.occStart; i < record.occEnd; i += 1) {
        const label = labelOf(occBinding[i]);
        const isKept2 = occSkipDepth[i] < record.depth;
        const isKept3 = isKept2 && occEraseDepth[i] < record.depth;
        seq1.push(label);
        if (isKept2) seq2.push(label);
        if (isKept3) seq3.push(label);
      }
      return record.result;
    };

    const visitTop = (node, role) => {
      const record = records.get(node);
      const isRoleMismatch = Boolean(record) && record.role !== role;
      if (isRoleMismatch) throw new Error(`unit-hash: a ${node.type} unit top was walked as ${record.role}, not ${role}`);
      if (record) return take(record);
      mass += node.type === WINDOW_TYPE ? 0 : 1;
      const info = describe(node, role);
      const hasAnchor = Boolean(info.anchor);
      if (hasAnchor) anchors.add(info.anchor);
      return combine(node, info, role, 0, visitTop);
    };

    const result = visitTop(top, PLAIN_ROLE);
    const fp1 = pairHex(mixPair(result.l1, seq1));
    const fp2 = pairHex(mixPair(result.l2, seq2));
    const fp3 = pairHex(mixPair(result.l3, seq3));
    return { fp1, fp2, fp3, mass, anchors: [...anchors].sort() };
  };

  return { sizeOf: (node) => recordOf(node).count, hashTop };
};
