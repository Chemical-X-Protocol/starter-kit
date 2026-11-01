/**
 * Read classification for shallow-catch escalation (truth spec 4.2): whether a read of a
 * binding that a swallowed try may leave unset is already covered, either by a default the
 * read supplies itself, by an explicit check of the binding, or by an early exit after the
 * try that only an unset binding takes.
 */
import * as t from '@babel/types';

const DEFAULTING_OPERATORS = new Set(['??', '||']);
const EQUALITY_OPERATORS = new Set(['==', '===', '!=', '!==']);
const UNSET_EQUALITY_OPERATORS = new Set(['==', '===']);
const CHECKING_UNARIES = new Set(['typeof', '!']);
const BRANCHING_TYPES = new Set(['IfStatement', 'ConditionalExpression']);
const EXIT_TYPES = new Set(['ReturnStatement', 'ThrowStatement', 'ContinueStatement', 'BreakStatement']);

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

// The identifier a comparison is true for while it is unset: == with null, undefined or void 0,
// === with undefined or void 0, or typeof compared with 'undefined'. v === null and v != null
// are false for an unset v, so they check nothing here.
const readUnsetComparedIdentifier = (node) => {
  const sides = [node.left, node.right];
  const typeofSide = sides.find((side) => t.isUnaryExpression(side, { operator: 'typeof' }));
  const comparesUndefinedType = sides.some((side) => t.isStringLiteral(side, { value: 'undefined' }));
  if (typeofSide) return comparesUndefinedType ? typeofSide.argument : null;
  const isLooseEquality = node.operator === '==';
  const matchesUnset = isLooseEquality ? isNullishValue : isUndefinedValue;
  const comparesUnset = sides.some(matchesUnset);
  if (!comparesUnset) return null;
  return sides.find((side) => t.isIdentifier(side) && !isNullishValue(side)) || null;
};

// The identifier a test checks for being unset: !v, or a comparison that holds for an unset v.
const readUnsetCheckedIdentifier = (node) => {
  const isNegatedIdentifier = t.isUnaryExpression(node, { operator: '!' }) && t.isIdentifier(node.argument);
  if (isNegatedIdentifier) return node.argument;
  const isUnsetComparison = t.isBinaryExpression(node) && UNSET_EQUALITY_OPERATORS.has(node.operator);
  return isUnsetComparison ? readUnsetComparedIdentifier(node) : null;
};

const isReferenceOf = (node, binding) => Boolean(node) && binding.referencePaths.some((ref) => ref.node === node);

/** Whether a test checks the binding itself (v, !v, typeof v, v == null), for either outcome. */
export const isCheckOfBinding = (test, binding) => isReferenceOf(readCheckedIdentifier(test), binding);

// A check of the binding anywhere in an && chain: every later link, and the branches the
// chain tests, run only once that check passed (v && v.a && v.b).
const isGuardOfBinding = (test, binding) => {
  const isAndChain = t.isLogicalExpression(test, { operator: '&&' });
  if (isAndChain) return isGuardOfBinding(test.left, binding) || isGuardOfBinding(test.right, binding);
  return isCheckOfBinding(test, binding);
};

// A test that holds while the binding is unset, alone or as any operand of an || chain. Code
// that runs only once it failed (the right side of ||, the block after an early exit) sees a
// value, so v || v.x and ok || v.x still escalate.
const isUnsetCheckOfBinding = (test, binding) => {
  const isOrChain = t.isLogicalExpression(test, { operator: '||' });
  if (isOrChain) return isUnsetCheckOfBinding(test.left, binding) || isUnsetCheckOfBinding(test.right, binding);
  return isReferenceOf(readUnsetCheckedIdentifier(test), binding);
};

const LOGICAL_GUARDS = Object.freeze({ '&&': isGuardOfBinding, '||': isUnsetCheckOfBinding });

// The parts of a node that run only once its test has been evaluated, and the check of the
// binding that test must make: both branches of an if or a conditional and the right side of
// && run after any check, the right side of || only after a check for unset failed.
const readGuardShape = (node) => {
  const isGuardingLogical = t.isLogicalExpression(node) && Object.hasOwn(LOGICAL_GUARDS, node.operator);
  if (isGuardingLogical) return { test: node.left, branches: [node.right], isGuard: LOGICAL_GUARDS[node.operator] };
  const isBranching = BRANCHING_TYPES.has(node.type);
  if (!isBranching) return null;
  return { test: node.test, branches: [node.consequent, node.alternate].filter(Boolean), isGuard: isGuardOfBinding };
};

const isInCheckedBranch = (refPath, binding) => {
  const guard = refPath.findParent((ancestor) => {
    const shape = readGuardShape(ancestor.node);
    if (!shape) return false;
    const isInBranch = shape.branches.some((branch) => isWithinNode(refPath.node, branch));
    return isInBranch && shape.isGuard(shape.test, binding);
  });
  return Boolean(guard);
};

// A statement that always leaves its block: return, throw, continue or break, or a block with
// one of those among its own statements.
const isExitStatement = (node) => {
  const isBlock = t.isBlockStatement(node);
  return isBlock ? node.body.some(isExitStatement) : EXIT_TYPES.has(node.type);
};

// if (!v) return; (or throw, continue, break): the rest of its block runs only once the check
// failed, so the binding holds a value there.
const isExitGuardOf = (statement, binding) => {
  const isIf = t.isIfStatement(statement);
  if (!isIf) return false;
  return isExitStatement(statement.consequent) && isUnsetCheckOfBinding(statement.test, binding);
};

// Whether an early exit after the try sits before the read in the read's own block or in a
// block that encloses it. An exit nested in another branch guards nothing after that branch.
const isAfterExitGuard = (refPath, binding, tryNode) => {
  const isGuardAfterTry = (sibling) => isExitGuardOf(sibling, binding) && sibling.start > tryNode.end;
  const guarded = refPath.findParent((ancestor) => {
    if (!ancestor.inList) return false;
    return ancestor.container.slice(0, ancestor.key).some(isGuardAfterTry);
  });
  return Boolean(guarded);
};

// A covered read never lets a swallowed error surface as a silent undefined: it supplies a
// default (left of ?? or ||), checks the binding itself, sits in a branch that checked it, or
// follows an early exit that an unset binding takes.
export const isCoveredRead = (refPath, binding, tryNode) => {
  if (isDefaultedRead(refPath)) return true;
  if (isCheckRead(refPath)) return true;
  if (isInCheckedBranch(refPath, binding)) return true;
  return isAfterExitGuard(refPath, binding, tryNode);
};
