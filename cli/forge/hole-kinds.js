// Hole kinds and hole facts of the LGG (engine doc section 6). A hole is one position where the members'
// canonical subtrees differ; members are { node, notes, paramIds } with notes from hashUnit's onNode.
//   literal    every side is a literal or an empty value (null, undefined, {}, [])   -> a param
//   key        every side is a member name or object key                          -> a param or table column
//   transform  one side is a call whose argument is L1-equal to another side       -> a coerce column
//   ref        every side is an identifier                                        -> a param
//   expr       every side is an expression                                        -> a value param
//   optional   some side is absent (a catch param, an else branch, an init)
//   stmt       anything else (statement structure differs)
// Facts feed the reject codes (rejects.js): hasLocal (R3: a binder the unit introduces, never a param of
// a fn unit), hasExit (R4: return, break, continue, yield or throw of the unit's own function) and
// anchoredMembers (R5: members whose hole side carries an import, global, member-call or regex anchor).
// A transform hole's shared argument is left out of every fact and of its size: only the wrapper counts.
import { anchorKind } from './anchors.js';

const CALL_TYPES = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression']);
const NAME_TYPES = new Set(['PropName', 'KeyName']);
const EMPTYABLE_TYPES = new Set(['ObjectExpression', 'ArrayExpression']);
const EXIT_TYPES = new Set(['ReturnStatement', 'BreakStatement', 'ContinueStatement', 'ThrowStatement', 'YieldExpression']);
const FUNCTION_TYPE = /Function|Method/;
const STRONG_ANCHOR_KINDS = new Set(['import', 'global', 'call', 'regex']);

const childList = (value) => (Array.isArray(value) ? value : [value]);

const kidsOf = (node) => Object.values(node.kids).flatMap(childList).filter(Boolean);

const isEmptyValue = (node) => EMPTYABLE_TYPES.has(node.type) && kidsOf(node).length === 0;

const isValueLeaf = (node) => {
  const isUndefined = node.type === 'Identifier' && node.label === 'undefined';
  const isTemplateText = node.type === 'TemplateElement';
  return node.lit !== null || isUndefined || isTemplateText || isEmptyValue(node);
};

const keyOf = (member) => member.notes.get(member.node)?.l1 ?? null;

const argumentKeys = (member) => {
  const isCall = CALL_TYPES.has(member.node.type);
  const args = isCall ? member.node.kids.arguments ?? [] : [];
  return args.map((arg) => member.notes.get(arg)?.l1 ?? null);
};

/** The L1 key a transform hole wraps, or null: every side is that key or a call taking it. */
export const transformBaseOf = (members) => {
  const candidates = [keyOf(members[0]), ...argumentKeys(members[0])].filter(Boolean);
  const covers = (base) => members.every((member) => keyOf(member) === base || argumentKeys(member).includes(base));
  const wraps = (base) => members.some((member) => keyOf(member) !== base);
  return candidates.find((base) => covers(base) && wraps(base)) ?? null;
};

const KIND_TESTS = [
  ['optional', (members) => members.some((member) => member.node === null)],
  ['literal', (members) => members.every((member) => isValueLeaf(member.node))],
  ['key', (members) => members.every((member) => NAME_TYPES.has(member.node.type))],
  ['transform', (members) => transformBaseOf(members) !== null],
  ['ref', (members) => members.every((member) => member.node.type === 'Identifier')],
  ['expr', (members) => members.every((member) => member.node.isExpr)]
];

/** The kind of a hole over its member sides. */
export const holeKindOf = (members) => KIND_TESTS.find(([, test]) => test(members))?.[0] ?? 'stmt';

// The wrapper of a transform side: its own nodes minus the shared argument subtree.
const baseNodeOf = (member, base) => {
  const isBase = keyOf(member) === base;
  if (isBase) return member.node;
  const args = member.node.kids.arguments ?? [];
  return args.find((arg) => member.notes.get(arg)?.l1 === base) ?? null;
};

// Preorder over a side, never entering the skipped subtree; nested functions are entered only for
// anchors and locals (an exit inside them is theirs, not the unit's). A local the side declares itself
// (a callback param) travels with it, so only locals declared elsewhere in the unit count.
const scanSide = (member, skipped, ubiquitous) => {
  const facts = { size: 0, hasLocal: false, hasExit: false, isAnchored: false };
  const isAbsent = member.node === null;
  if (isAbsent) return facts;
  const localRefs = new Set();
  const declaredHere = new Set();
  const noteLocal = (node, note) => {
    const isUnitBinder = node.type === 'Identifier' && Boolean(note?.v1?.startsWith('#')) && !member.paramIds.has(node.ident?.bindingId);
    if (!isUnitBinder) return;
    const bucket = node.ident.isDecl ? declaredHere : localRefs;
    bucket.add(node.ident.bindingId);
  };
  const visit = (node, isNested) => {
    const isSkipped = node === skipped;
    if (isSkipped) return;
    facts.size += 1;
    const note = member.notes.get(node);
    noteLocal(node, note);
    facts.hasExit = facts.hasExit || (!isNested && EXIT_TYPES.has(node.type));
    const anchor = note?.anchor ?? null;
    const isStrong = anchor !== null && STRONG_ANCHOR_KINDS.has(anchorKind(anchor)) && !ubiquitous.has(anchor);
    facts.isAnchored = facts.isAnchored || isStrong;
    const entersFunction = isNested || FUNCTION_TYPE.test(node.type);
    kidsOf(node).forEach((child) => visit(child, entersFunction));
  };
  visit(member.node, false);
  facts.hasLocal = [...localRefs].some((bindingId) => !declaredHere.has(bindingId));
  return facts;
};

const sidesWith = (sides, fact) => sides.map((side, index) => (side[fact] ? index : -1)).filter((index) => index >= 0);

/**
 * Facts of one hole occurrence: { kind, base, sizes (per member), hasLocal, hasExit, anchoredMembers,
 * localSides, exitSides, anchoredSides } (the *Sides are member indexes, for refinement).
 * ubiquitous: the facet's ubiquitous anchors (they never count for R5).
 */
export const holeFactsOf = (members, ubiquitous = new Set()) => {
  const kind = holeKindOf(members);
  const base = kind === 'transform' ? transformBaseOf(members) : null;
  const sides = members.map((member) => scanSide(member, base === null ? null : baseNodeOf(member, base), ubiquitous));
  return {
    kind,
    base,
    sizes: sides.map((side) => side.size),
    hasLocal: sides.some((side) => side.hasLocal),
    hasExit: sides.some((side) => side.hasExit),
    anchoredMembers: sides.filter((side) => side.isAnchored).length,
    localSides: sidesWith(sides, 'hasLocal'),
    exitSides: sidesWith(sides, 'hasExit'),
    anchoredSides: sidesWith(sides, 'isAnchored')
  };
};
