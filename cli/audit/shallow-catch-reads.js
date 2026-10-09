/**
 * Read classification for shallow-catch escalation (truth spec 4.2): whether a read of a
 * binding that a swallowed try may leave unset is already covered, either by a default the
 * read supplies itself or by an explicit check of the binding.
 */
import * as t from '@babel/types';

const DEFAULTING_OPERATORS = new Set(['??', '||']);
const EQUALITY_OPERATORS = new Set(['==', '===', '!=', '!==']);
const CHECKING_UNARIES = new Set(['typeof', '!']);
const BRANCHING_TYPES = new Set(['IfStatement', 'ConditionalExpression']);

export const isUndefinedValue = (node) => {
  const isUndefinedId = t.isIdentifier(node, { name: 'undefined' });
  return isUndefinedId || t.isUnaryExpression(node, { operator: 'void' });
};

const isNullishValue = (node) => t.isNullLiteral(node) || isUndefinedValue(node);

export const isWithinNode = (inner, outer) => {
  const startsInside = inner.start >= outer.start;
  return startsInside && inner.end <= outer.end;
};

const isOptionalChainLink = (path) => {
  const parent = path.parent;
  const isChainObject = t.isOptionalMemberExpression(parent) && parent.object === path.node;
  const isChainCallee = t.isOptionalCallExpression(parent) && parent.callee === path.node;
  return isChainObject || isChainCallee;
};

// Climb an optional chain that starts at the read: in data?.name ?? 'anon' the default also
// covers data, because the chain short-circuits to undefined when data is unset. A plain
// member access (data.name) throws first, so it is never climbed.
const climbOptionalChain = (refPath) => {
  let chain = refPath;
  while (isOptionalChainLink(chain)) chain = chain.parentPath;
  return chain;
};

const isDefaultedRead = (refPath) => {
  const chain = climbOptionalChain(refPath);
  const parent = chain.parent;
  const isDefaultingLogical = t.isLogicalExpression(parent) && DEFAULTING_OPERATORS.has(parent.operator);
  return isDefaultingLogical && parent.left === chain.node;
};

const isCheckingUnary = (node) => t.isUnaryExpression(node) && CHECKING_UNARIES.has(node.operator);

const isEqualityComparison = (node) => t.isBinaryExpression(node) && EQUALITY_OPERATORS.has(node.operator);

// The identifier an equality test checks: the operand of a typeof on either side, otherwise
// the identifier compared with null, undefined or void 0. Any other comparison checks nothing.
const readComparedIdentifier = (node) => {
  const sides = [node.left, node.right];
  const typeofSide = sides.find((side) => t.isUnaryExpression(side, { operator: 'typeof' }));
  if (typeofSide) return typeofSide.argument;
  const isNullishComparison = sides.some(isNullishValue);
  if (!isNullishComparison) return null;
  return sides.find((side) => t.isIdentifier(side) && !isNullishValue(side)) || null;
};

// The identifier a test expression checks directly: a bare binding, !v, typeof v, or v
// compared with null or undefined. Compound tests such as v && v.a or v === 5 check nothing.
const readCheckedIdentifier = (node) => {
  if (t.isIdentifier(node)) return node;
  if (isCheckingUnary(node)) return readCheckedIdentifier(node.argument);
  return isEqualityComparison(node) ? readComparedIdentifier(node) : null;
};

const isBareTest = (refPath) => {
  const isBranchTest = refPath.key === 'test' && BRANCHING_TYPES.has(refPath.parent.type);
  const isAndLeft = refPath.key === 'left' && t.isLogicalExpression(refPath.parent, { operator: '&&' });
  return isBranchTest || isAndLeft;
};

// A read that is itself a check of the binding (typeof v, !v, v == null, or the bare v as
// the test of an if, a conditional or the left side of &&) shows the unset case is handled.
const isCheckRead = (refPath) => {
  if (isBareTest(refPath)) return true;
  const parent = refPath.parent;
  const isCheckOperand = isCheckingUnary(parent) || isEqualityComparison(parent);
  return isCheckOperand && readCheckedIdentifier(parent) === refPath.node;
};

// The parts of a node that run only once its test has been evaluated: both branches of an
// if or a conditional, and the right side of &&.
const readGuardShape = (node) => {
  if (t.isLogicalExpression(node, { operator: '&&' })) return { test: node.left, branches: [node.right] };
  const isBranching = BRANCHING_TYPES.has(node.type);
  if (!isBranching) return null;
  return { test: node.test, branches: [node.consequent, node.alternate].filter(Boolean) };
};

const isCheckOfBinding = (test, binding) => {
  const checked = readCheckedIdentifier(test);
  return Boolean(checked) && binding.referencePaths.some((ref) => ref.node === checked);
};

const isInCheckedBranch = (refPath, binding) => {
  const guard = refPath.findParent((ancestor) => {
    const shape = readGuardShape(ancestor.node);
    if (!shape) return false;
    const isInBranch = shape.branches.some((branch) => isWithinNode(refPath.node, branch));
    return isInBranch && isCheckOfBinding(shape.test, binding);
  });
  return Boolean(guard);
};

// A covered read never lets a swallowed error surface as a silent undefined: it supplies a
// default (left of ?? or ||), checks the binding itself, or sits in a branch that checked it.
export const isCoveredRead = (refPath, binding) => {
  if (isDefaultedRead(refPath)) return true;
  if (isCheckRead(refPath)) return true;
  return isInCheckedBranch(refPath, binding);
};
