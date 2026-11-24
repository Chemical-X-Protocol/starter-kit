/**
 * Read classification for shallow-catch escalation (truth spec 4.2): whether a read of a
 * binding that a swallowed try may leave unset is already covered, either by a default the
 * read supplies itself, by an explicit check of the binding, by a branch whose test rules
 * out the unset binding, or by an early exit after the try that only an unset binding takes.
 */
import * as t from '@babel/types';

const DEFAULTING_OPERATORS = new Set(['??', '||']);
const EQUALITY_OPERATORS = new Set(['==', '===', '!=', '!==']);
const NEGATED_EQUALITY_OPERATORS = new Set(['!=', '!==']);
const LOOSE_EQUALITY_OPERATORS = new Set(['==', '!=']);
const CHECKING_UNARIES = new Set(['typeof', '!']);
const BRANCHING_TYPES = new Set(['IfStatement', 'ConditionalExpression']);
export const EXIT_TYPES = new Set(['ReturnStatement', 'ThrowStatement', 'ContinueStatement', 'BreakStatement']);
// The outcome that settles a chain on its own: one failing link fails an && chain, and one
// holding link holds an || chain.
const SETTLING_OUTCOMES = Object.freeze({ '&&': false, '||': true });

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

const isReferenceOf = (node, binding) => Boolean(node) && binding.referencePaths.some((ref) => ref.node === node);

const isTypeofOf = (node, binding) => t.isUnaryExpression(node, { operator: 'typeof' }) && isReferenceOf(node.argument, binding);

// The operand across a comparison from the side isMatch picks, or undefined when neither side matches.
const readOtherSide = (node, isMatch) => {
  if (isMatch(node.left)) return node.right;
  return isMatch(node.right) ? node.left : undefined;
};

// What v == x or v === x gives while v is unset: typeof v against a string literal, or v against
// undefined, void 0 or null (where only the loose == holds). Any other comparison gives null.
const readUnsetEquality = (node, binding) => {
  const typeofOther = readOtherSide(node, (side) => isTypeofOf(side, binding));
  if (typeofOther) return t.isStringLiteral(typeofOther) ? typeofOther.value === 'undefined' : null;
  const other = readOtherSide(node, (side) => isReferenceOf(side, binding));
  if (!other) return null;
  if (isUndefinedValue(other)) return true;
  return t.isNullLiteral(other) ? LOOSE_EQUALITY_OPERATORS.has(node.operator) : null;
};

const negateOutcome = (outcome) => (outcome === null ? null : !outcome);

const readComparisonOutcome = (node, binding) => {
  const equality = readUnsetEquality(node, binding);
  return NEGATED_EQUALITY_OPERATORS.has(node.operator) ? negateOutcome(equality) : equality;
};

const isChain = (node) => t.isLogicalExpression(node) && Object.hasOwn(SETTLING_OUTCOMES, node.operator);

// An && or || chain settles on one link's settling outcome, takes the other outcome only when
// every link has it, and depends on something else otherwise.
const readChainOutcome = (node, binding) => {
  const settling = SETTLING_OUTCOMES[node.operator];
  const outcomes = [readUnsetOutcome(node.left, binding), readUnsetOutcome(node.right, binding)];
  if (outcomes.includes(settling)) return settling;
  const isEveryOther = outcomes.every((outcome) => outcome === !settling);
  return isEveryOther ? !settling : null;
};

/**
 * What a test gives while the binding is unset: true for an unset check (!v, v == null,
 * v === undefined, typeof v === 'undefined'), false for a set check (v, !!v, v != null,
 * v !== undefined, typeof v !== 'undefined'), combined through ! and && or || chains, and null
 * when it depends on anything else.
 */
export const readUnsetOutcome = (test, binding) => {
  if (isChain(test)) return readChainOutcome(test, binding);
  const isNegation = t.isUnaryExpression(test, { operator: '!' });
  if (isNegation) return negateOutcome(readUnsetOutcome(test.argument, binding));
  if (isReferenceOf(test, binding)) return false;
  return isEqualityComparison(test) ? readComparisonOutcome(test, binding) : null;
};

// The parts of a node that run on one outcome of its test, with that outcome: the right side of
// && and the consequent of an if or a conditional once the test held, the right side of || and
// the alternate once it failed.
const readGuardShape = (node) => {
  if (isChain(node)) return { test: node.left, parts: [{ node: node.right, runsOn: node.operator === '&&' }] };
  const isBranching = BRANCHING_TYPES.has(node.type);
  if (!isBranching) return null;
  return { test: node.test, parts: [{ node: node.consequent, runsOn: true }, { node: node.alternate, runsOn: false }] };
};

// A read in a part that never runs while the binding is unset, because its test then has the
// other outcome: v && v.a, if (v != null) use(v.a), v == null || v.a, but not !v && v.a.
const isInCheckedBranch = (refPath, binding) => {
  const guard = refPath.findParent((ancestor) => {
    const shape = readGuardShape(ancestor.node);
    if (!shape) return false;
    const part = shape.parts.find((candidate) => Boolean(candidate.node) && isWithinNode(refPath.node, candidate.node));
    return Boolean(part) && readUnsetOutcome(shape.test, binding) === !part.runsOn;
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
  return isExitStatement(statement.consequent) && readUnsetOutcome(statement.test, binding) === true;
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
