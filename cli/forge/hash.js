// Merkle fingerprints of a canonical unit (engine doc sections 3-4): h(node) = mix(type, label, children)
// over two murmur3-32 lanes (16 hex chars), computed for L1, L2 and L3 in one walk, plus the
// unit's mass (canonical node count) and its distinct L1 anchors. Binder numbers (#k for binders the
// unit declares, @k for outer file bindings) are assigned in first-use order, so they never depend on
// names, file order or anything outside the unit.
import { hashLabelPair, mixPair, pairHex } from './murmur.js';
import { childRole, describeNode, SKIP_ALL_KIDS } from './hash-labels.js';

const WINDOW_TYPE = 'Window';
const ERASED = mixPair(hashLabelPair('E', ''), []);
const NULL_MARK = 0x6e756c6c;
const LIST_MARK = 0x6c697374;

const childList = (value) => (Array.isArray(value) ? value : [value]);

const collectDeclared = (scopeRoots) => {
  const declared = new Set();
  const visit = (node) => {
    const isDeclaration = node.type === 'Identifier' && node.ident.isDecl && node.ident.bindingId !== null;
    if (isDeclaration) declared.add(node.ident.bindingId);
    for (const value of Object.values(node.kids)) {
      for (const child of childList(value)) child && visit(child);
    }
  };
  for (const root of scopeRoots) visit(root);
  return declared;
};

const createBinderNumbering = () => {
  const labels = new Map();
  const counters = { local: 0, capture: 0 };
  const prefixes = { local: '#', capture: '@' };
  return (node, kind) => {
    const key = node.ident.bindingId;
    const isNumbered = labels.has(key);
    if (isNumbered) return labels.get(key);
    const label = `${prefixes[kind]}${counters[kind]}`;
    counters[kind] += 1;
    labels.set(key, label);
    return label;
  };
};

const mix = (type, label, ints) => mixPair(hashLabelPair(type, label), ints);

const pushPair = (ints, pair) => {
  ints.push(pair[0], pair[1]);
};

const NULL_PAIR = [NULL_MARK, NULL_MARK];
const NULL_RESULT = { l1: NULL_PAIR, l2: NULL_PAIR, l3: NULL_PAIR, isAnchored: false };

const skipsKey = (skip, key) => skip === SKIP_ALL_KIDS || Boolean(skip?.has(key));

/**
 * Fingerprints one canonical unit. root: a canonical node, or an array of statements (a window).
 * declScope: node(s) whose declarations count as unit-local (default: the root itself); a fn unit
 * passes the whole function so its params are local while only its body is hashed.
 * Returns { fp1, fp2, fp3, mass, anchors } with anchors sorted and distinct.
 */
export const hashUnit = (root, { declScope } = {}) => {
  const isWindow = Array.isArray(root);
  const top = isWindow ? { type: WINDOW_TYPE, label: '', kids: { body: root }, isExpr: false, lit: null } : root;
  const scopeRoots = childList(declScope ?? top);
  const declared = collectDeclared(scopeRoots);
  const binderLabel = createBinderNumbering();
  const anchors = new Set();
  let mass = 0;

  const walk = (node, role) => {
    mass += node.type === WINDOW_TYPE ? 0 : 1;
    const info = describeNode(node, { role, declared, binderLabel });
    const hasAnchor = Boolean(info.anchor);
    if (hasAnchor) anchors.add(info.anchor);
    const ints1 = [];
    const ints2 = [];
    const ints3 = [];
    let isAnchored = info.isL3Anchor;
    // A level whose labels and child digests equal the level below hashes to the same value: reuse it.
    let isSame12 = info.t1 === info.t2 && info.v1 === info.v2 && info.skip === null;
    let isSame23 = true;
    for (const key of Object.keys(node.kids)) {
      const value = node.kids[key];
      const role2 = childRole(node, key, role, declared);
      const isList = Array.isArray(value);
      const results = childList(value).map((child) => (child ? walk(child, role2) : NULL_RESULT));
      const isSkipped = skipsKey(info.skip, key);
      const listHeader = isList ? [LIST_MARK, results.length] : [];
      ints1.push(...listHeader);
      if (!isSkipped) ints2.push(...listHeader);
      if (!isSkipped) ints3.push(...listHeader);
      for (const result of results) {
        isAnchored = isAnchored || result.isAnchored;
        isSame12 = isSame12 && result.l2 === result.l1;
        isSame23 = isSame23 && result.l3 === result.l2;
        pushPair(ints1, result.l1);
        if (!isSkipped) pushPair(ints2, result.l2);
        if (!isSkipped) pushPair(ints3, result.l3);
      }
    }
    const isErased = node.isExpr && !isAnchored;
    const l1 = mix(info.t1, info.v1, ints1);
    const l2 = isSame12 ? l1 : mix(info.t2, info.v2, ints2);
    const l3Unerased = isSame23 ? l2 : mix(info.t2, info.v2, ints3);
    return { l1, l2, l3: isErased ? ERASED : l3Unerased, isAnchored };
  };

  const result = walk(top, 'plain');
  const [fp1, fp2, fp3] = [result.l1, result.l2, result.l3].map(pairHex);
  return { fp1, fp2, fp3, mass, anchors: [...anchors].sort() };
};
