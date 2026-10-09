// Babel AST -> canonical tree (hashing only, never emitted as source). This pass builds fresh nodes and
// applies the purely local rewrites of engine doc section 2: parentheses, TS annotations, `as` and the
// non-null `!` are stripped; `x !== y` becomes `!(x === y)` (and `!=` becomes `!(==)`); an expressionless
// template literal becomes a string; an expression-bodied arrow becomes `{ return e }`; a bare `if` or
// loop body becomes a block. Member property names and object keys become PropName / KeyName leaves.
//
// Canonical node: { type, label, kids, isExpr, loc, ident, lit }
//   kids   insertion-ordered { [visitorKey]: node | null | node[] } (Babel VISITOR_KEYS order)
//   ident  binding entry for Identifier nodes (see bindings.js), else null
//   lit    literal kind for literal nodes ('string', 'number', ...), else null
import { lazyTypes as t } from '../babel-lazy.js';
import { UNKNOWN_IDENTIFIER } from './bindings.js';

const SKIPPED_KEYS = new Set([
  'typeAnnotation', 'returnType', 'typeParameters', 'superTypeParameters', 'typeArguments',
  'superTypeArguments', 'decorators', 'implements', 'predicate'
]);
const TRANSPARENT_WRAPPERS = new Set([
  'ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression',
  'TSTypeAssertion', 'TSInstantiationExpression'
]);
const LABEL_FLAGS = ['operator', 'kind', 'computed', 'async', 'generator', 'static', 'optional', 'prefix', 'delegate', 'await'];
const MEMBER_TYPES = new Set(['MemberExpression', 'OptionalMemberExpression']);
const KEYED_TYPES = new Set(['ObjectProperty', 'ObjectMethod', 'ClassMethod', 'ClassProperty', 'ClassAccessorProperty']);
const BLOCK_SLOTS = {
  IfStatement: new Set(['consequent', 'alternate']),
  ForStatement: new Set(['body']),
  ForInStatement: new Set(['body']),
  ForOfStatement: new Set(['body']),
  WhileStatement: new Set(['body']),
  DoWhileStatement: new Set(['body'])
};
const NEGATED_EQUALITY = { '!==': '===', '!=': '==' };

const LITERAL_LABELS = {
  StringLiteral: (node) => ['string', JSON.stringify(node.value)],
  NumericLiteral: (node) => ['number', String(node.value)],
  BooleanLiteral: (node) => ['boolean', String(node.value)],
  BigIntLiteral: (node) => ['bigint', `${node.value}n`],
  DecimalLiteral: (node) => ['number', `${node.value}m`],
  RegExpLiteral: (node) => ['regex', `/${node.pattern}/${node.flags}`],
  NullLiteral: () => ['null', 'null']
};

const TEXT_LABELS = {
  JSXIdentifier: (node) => node.name,
  JSXText: (node) => node.value.trim(),
  TemplateElement: (node) => node.value.cooked ?? node.value.raw,
  DirectiveLiteral: (node) => node.value
};

const locOf = (node) => {
  const loc = node?.loc;
  if (!loc) return null;
  return { start: loc.start.line, end: loc.end.line, startOffset: node.start, endOffset: node.end };
};

/** Builds a canonical node. `from` supplies loc; isExpr defaults to Babel's notion of an expression. */
export const makeNode = (type, label, kids, from, extra = {}) => ({
  type,
  label,
  kids,
  isExpr: extra.isExpr ?? Boolean(from && t.isExpression(from)),
  loc: extra.loc ?? locOf(from),
  ident: extra.ident ?? null,
  lit: extra.lit ?? null
});

const flagLabel = (node) => {
  const present = LABEL_FLAGS.filter((flag) => node[flag] !== undefined && node[flag] !== null && node[flag] !== false);
  return present.map((flag) => (node[flag] === true ? flag : `${flag}:${node[flag]}`)).join(' ');
};

const nameOfKey = (key) => {
  const isIdentifierKey = key.type === 'Identifier';
  if (isIdentifierKey) return key.name;
  const isPrivate = key.type === 'PrivateName';
  if (isPrivate) return `#${key.id.name}`;
  return String(key.value);
};

const nameLeaf = (type, key) => makeNode(type, nameOfKey(key), {}, key, { isExpr: false });

const isMemberPropertySlot = (node, key) => MEMBER_TYPES.has(node.type) && key === 'property' && !node.computed;
const isObjectKeySlot = (node, key) => KEYED_TYPES.has(node.type) && key === 'key' && !node.computed;

const wrapInBlock = (statement, ctx) => {
  const converted = convertNode(statement, ctx);
  const isAlreadyBlock = !converted || converted.type === 'BlockStatement';
  const isElseIf = converted?.type === 'IfStatement';
  const keepsShape = isAlreadyBlock || isElseIf;
  if (keepsShape) return converted;
  return makeNode('BlockStatement', '', { directives: [], body: [converted] }, statement, { isExpr: false });
};

const convertSlot = (node, key, ctx) => {
  const value = node[key];
  const isList = Array.isArray(value);
  if (isList) return value.map((item) => convertNode(item, ctx)).filter(Boolean);
  if (!value) return null;
  const isPropertyName = isMemberPropertySlot(node, key);
  if (isPropertyName) return nameLeaf('PropName', value);
  const isKeyName = isObjectKeySlot(node, key);
  if (isKeyName) return nameLeaf('KeyName', value);
  const needsBlock = BLOCK_SLOTS[node.type]?.has(key) ?? false;
  if (needsBlock) return wrapInBlock(value, ctx);
  return convertNode(value, ctx);
};

const convertGeneric = (node, ctx) => {
  const kids = {};
  const keys = (t.VISITOR_KEYS[node.type] ?? []).filter((key) => !SKIPPED_KEYS.has(key));
  for (const key of keys) kids[key] = convertSlot(node, key, ctx);
  const textLabel = TEXT_LABELS[node.type]?.(node);
  return makeNode(node.type, textLabel ?? flagLabel(node), kids, node);
};

const convertLiteral = (node) => {
  const [lit, label] = LITERAL_LABELS[node.type](node);
  return makeNode(node.type, label, {}, node, { lit });
};

const convertIdentifier = (node, ctx) => {
  const ident = ctx.bindings.get(node) ?? UNKNOWN_IDENTIFIER;
  return makeNode('Identifier', node.name, {}, node, { ident, isExpr: true });
};

const convertTemplate = (node, ctx) => {
  const hasExpressions = node.expressions.length > 0;
  if (hasExpressions) return convertGeneric(node, ctx);
  const quasi = node.quasis[0];
  const value = quasi?.value.cooked ?? quasi?.value.raw ?? '';
  return makeNode('StringLiteral', JSON.stringify(value), {}, node, { lit: 'string' });
};

const convertBinary = (node, ctx) => {
  const positiveOperator = NEGATED_EQUALITY[node.operator];
  if (!positiveOperator) return convertGeneric(node, ctx);
  const kids = { left: convertNode(node.left, ctx), right: convertNode(node.right, ctx) };
  const equality = makeNode('BinaryExpression', `operator:${positiveOperator}`, kids, node);
  return makeNode('UnaryExpression', 'operator:! prefix', { argument: equality }, node);
};

const convertArrow = (node, ctx) => {
  const converted = convertGeneric(node, ctx);
  const isExpressionBody = node.body.type !== 'BlockStatement';
  if (!isExpressionBody) return converted;
  const returned = makeNode('ReturnStatement', '', { argument: converted.kids.body }, node.body, { isExpr: false });
  const block = makeNode('BlockStatement', '', { directives: [], body: [returned] }, node.body, { isExpr: false });
  converted.kids.body = { ...block, isArrowBody: true };
  return converted;
};

const SPECIAL = {
  Identifier: convertIdentifier,
  TemplateLiteral: convertTemplate,
  BinaryExpression: convertBinary,
  ArrowFunctionExpression: convertArrow,
  TSParameterProperty: (node, ctx) => convertNode(node.parameter, ctx),
  ...Object.fromEntries(Object.keys(LITERAL_LABELS).map((type) => [type, convertLiteral]))
};

/**
 * Converts one Babel node (and its subtree). ctx = { bindings: Map<IdentifierNode, entry> }.
 * Returns null for type-only TS nodes, which disappear from blocks and lists.
 */
export const convertNode = (node, ctx) => {
  if (!node) return null;
  const isWrapper = TRANSPARENT_WRAPPERS.has(node.type);
  if (isWrapper) return convertNode(node.expression, ctx);
  const special = SPECIAL[node.type];
  if (special) return special(node, ctx);
  const isTypeOnly = node.type.startsWith('TS');
  if (isTypeOnly) return null;
  return convertGeneric(node, ctx);
};
