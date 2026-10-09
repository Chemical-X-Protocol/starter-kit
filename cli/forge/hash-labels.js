// Per-node labels for the three Merkle levels (engine doc section 3) and the anchor each node carries.
//   L1: unit-local binders #k, outer file bindings @k (numbered by the caller), imports by module and
//       imported name (import:<source>#<imported>, never the local alias), globals by name; literals,
//       member names and keys kept.
//   L2: L1 plus literals -> STR/NUM/REGEX/TPL(n)/BOOL; null, undefined, {} and [] -> VAL; non-call member
//       names on non-anchor receivers and object keys -> KEY. Callee method names stay.
//   L3: L2 plus erasure of maximal anchor-free expressions (done by the walker in hash.js).
import { TRIVIAL_GLOBALS } from './anchors.js';

const CALL_TYPES = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression']);
const MEMBER_TYPES = new Set(['MemberExpression', 'OptionalMemberExpression']);
const LITERAL_L2 = { string: 'STR', number: 'NUM', bigint: 'NUM', boolean: 'BOOL', regex: 'REGEX' };
const EMPTY_VALUE_SLOTS = { ObjectExpression: 'properties', ArrayExpression: 'elements' };
const NO_SKIP = null;
const SKIP_ALL = 'all';

/** Kind of an Identifier inside a unit: local, capture, anchor (import/global), trivial or name. */
export const identifierKind = (node, declared) => {
  const { origin, bindingId } = node.ident;
  const isLocalOrigin = origin === 'local';
  if (isLocalOrigin) return declared.has(bindingId) ? 'local' : 'capture';
  const isTrivialGlobal = origin === 'global' && TRIVIAL_GLOBALS.has(node.label);
  if (isTrivialGlobal) return 'trivial';
  const isAnchorOrigin = origin === 'import' || origin === 'global';
  return isAnchorOrigin ? 'anchor' : 'name';
};

const receiverIsAnchor = (member, declared) => {
  let receiver = member.kids.object;
  while (receiver && MEMBER_TYPES.has(receiver.type)) receiver = receiver.kids.object;
  const isIdentifier = receiver?.type === 'Identifier';
  return isIdentifier && identifierKind(receiver, declared) === 'anchor';
};

/** Role of a child slot: callee position, or the property name of a member (call / anchored / plain). */
export const childRole = (node, key, role, declared) => {
  const isCallee = CALL_TYPES.has(node.type) && key === 'callee';
  if (isCallee) return 'callee';
  const isPropertyName = MEMBER_TYPES.has(node.type) && node.kids[key]?.type === 'PropName';
  if (!isPropertyName) return 'plain';
  const isMethodName = role === 'callee';
  if (isMethodName) return 'callName';
  return receiverIsAnchor(node, declared) ? 'anchorProp' : 'prop';
};

const same = (type, label, extra = {}) => ({ t1: type, v1: label, t2: type, v2: label, skip: NO_SKIP, anchor: null, isL3Anchor: false, ...extra });
const VALUE = { t2: 'Val', v2: 'VAL', skip: SKIP_ALL };

const describeIdentifier = (node, ctx) => {
  const kind = identifierKind(node, ctx.declared);
  const isBinder = kind === 'local' || kind === 'capture';
  if (isBinder) return same('Identifier', ctx.binderLabel(node, kind));
  const isUndefined = kind === 'trivial' && node.label === 'undefined';
  if (isUndefined) return same('Identifier', node.label, VALUE);
  const isAnchor = kind === 'anchor';
  if (!isAnchor) return same('Identifier', node.label);
  const importRef = node.ident.origin === 'import' ? node.ident.importRef : null;
  const anchor = importRef ? `import:${importRef}` : `${node.ident.origin}:${node.label}`;
  const label = importRef ? anchor : node.label;
  return same('Identifier', label, { anchor, isL3Anchor: true });
};

const describePropName = (node, ctx) => {
  const isCallName = ctx.role === 'callName';
  if (isCallName) return same('PropName', node.label, { anchor: `call:${node.label}`, isL3Anchor: true });
  const isKeyed = ctx.role === 'prop';
  return isKeyed ? same('PropName', node.label, { v2: 'KEY' }) : same('PropName', node.label);
};

const literalAnchor = (node) => {
  const isString = node.lit === 'string';
  if (isString) return `str:${node.label}`;
  const isRegex = node.lit === 'regex';
  if (isRegex) return `regex:${node.label}`;
  const isWeightedNumber = node.lit === 'number' && node.label !== '0' && node.label !== '1';
  return isWeightedNumber ? `num:${node.label}` : null;
};

const describeLiteral = (node) => {
  const isNull = node.lit === 'null';
  if (isNull) return same(node.type, node.label, VALUE);
  return same(node.type, node.label, { t2: 'Lit', v2: LITERAL_L2[node.lit], anchor: literalAnchor(node) });
};

const describeEmptyable = (node) => {
  const isEmpty = node.kids[EMPTY_VALUE_SLOTS[node.type]].length === 0;
  return isEmpty ? same(node.type, node.label, VALUE) : same(node.type, node.label);
};

const describeTemplate = (node) => same(node.type, node.label, { v2: `TPL(${node.kids.expressions.length})`, skip: new Set(['quasis']) });

const DESCRIBERS = {
  Identifier: describeIdentifier,
  PropName: describePropName,
  KeyName: (node) => same('KeyName', node.label, { v2: 'KEY', anchor: `key:${node.label}` }),
  ObjectExpression: describeEmptyable,
  ArrayExpression: describeEmptyable,
  TemplateLiteral: describeTemplate
};

/**
 * Labels for one node. ctx = { role, declared, binderLabel(node, kind) }.
 * Returns { t1, v1, t2, v2, skip, anchor, isL3Anchor }; skip is null, 'all' or a Set of kid keys
 * that L2/L3 leave out.
 */
export const describeNode = (node, ctx) => {
  const isLiteral = node.lit !== null;
  if (isLiteral) return describeLiteral(node);
  const describer = DESCRIBERS[node.type];
  return describer ? describer(node, ctx) : same(node.type, node.label);
};

export const SKIP_ALL_KIDS = SKIP_ALL;
