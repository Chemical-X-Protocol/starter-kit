/**
 * The named-condition lexicon from AGENTS.md 3.A and 3.F, as AST predicates.
 * A conditional test passes when it is an identifier, its negation, a member
 * chain with no operators (a property read is already a name), or a call whose
 * callee name is an assertion, a standard predicate method, or carries a
 * predicate word (`fs.existsSync(p)`, `map.has(key)`).
 */
import * as t from '@babel/types';

export const ASSERTION_PREFIXES = [
  'is', 'are', 'has', 'have', 'can', 'could', 'should', 'would', 'does', 'did',
  'needs', 'must', 'allows', 'enables', 'contains', 'includes', 'supports',
  'requires', 'exceeds', 'matches', 'wants'
];

const ASSERTION_NAME = new RegExp(`^(?:${ASSERTION_PREFIXES.join('|')})[A-Z0-9_$]`);
const TRANSPARENT_MEMBERS = new Set(['value', 'current']);

/** Standard-library methods that return a boolean by name alone (`test` is deliberately absent). */
export const PREDICATE_METHODS = new Set([
  'has', 'includes', 'some', 'every', 'startsWith', 'endsWith',
  'isArray', 'isNaN', 'isFinite', 'isInteger', 'isSafeInteger'
]);

/** Words that make a verb-named call read as a question (`existsSync`, `isPathValid`). */
export const PREDICATE_WORDS = new Set([
  'exists', 'equals', 'matches', 'valid', 'ok', 'enabled', 'disabled', 'active',
  'visible', 'hidden', 'ready', 'empty', 'defined', 'present', 'loaded', 'done',
  'complete', 'dirty', 'stale', 'expired', 'pending', 'selected', 'checked',
  'open', 'closed', 'locked', 'found', 'known', 'allowed', 'blocked', 'accepted',
  'passed', 'failed'
]);
const ERRORISH_WORDS = new Set([
  'err', 'error', 'errors', 'fail', 'fails', 'failed', 'failure', 'exception',
  'invalid', 'rejected', 'fault', 'denied'
]);
const OUTCOME_WORDS = new Set(['ok', 'valid', 'success', 'succeeded', 'successful']);

const splitNameWords = (name) => String(name)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[\s_$]+/)
  .map((word) => word.toLowerCase())
  .filter(Boolean);

const isErrorishName = (name) => splitNameWords(name).some((word) => ERRORISH_WORDS.has(word));
const isOutcomeName = (name) => splitNameWords(name).some((word) => OUTCOME_WORDS.has(word));

export const isAssertionName = (name) => typeof name === 'string' && ASSERTION_NAME.test(name);

const unwrapExpression = (node) => {
  let current = node;
  const isWrapper = (n) => t.isTSNonNullExpression(n) || t.isTSAsExpression(n) ||
    t.isParenthesizedExpression(n) || t.isAwaitExpression(n) || t.isTSSatisfiesExpression?.(n);
  while (current && isWrapper(current)) current = current.expression ?? current.argument;
  return current;
};

const memberPropertyName = (member) => {
  const isNamedProperty = !member.computed && t.isIdentifier(member.property);
  return isNamedProperty ? member.property.name : '';
};

const isAssertionMember = (member) => {
  const propName = memberPropertyName(member);
  const isTransparent = TRANSPARENT_MEMBERS.has(propName);
  if (isTransparent) return isNamedCondition(member.object);
  return isAssertionName(propName);
};

const isMemberNode = (n) => t.isMemberExpression(n) || t.isOptionalMemberExpression(n);
const isCallNode = (n) => t.isCallExpression(n) || t.isOptionalCallExpression(n);

const isPredicateName = (name) => isAssertionName(name) || PREDICATE_METHODS.has(name) ||
  splitNameWords(name).some((word) => PREDICATE_WORDS.has(word));

const isPredicateCall = (call) => {
  const callee = unwrapExpression(call.callee);
  if (t.isIdentifier(callee)) return isPredicateName(callee.name);
  return isMemberNode(callee) && isPredicateName(memberPropertyName(callee));
};

/** A chain of reads and calls rooted at a name, with no operator anywhere along it. */
const isPlainChain = (node) => {
  const expr = unwrapExpression(node);
  if (!expr) return false;
  const isRoot = t.isIdentifier(expr) || t.isThisExpression(expr) || t.isSuper(expr) || t.isMetaProperty(expr);
  if (isRoot) return true;
  if (isMemberNode(expr)) return isPlainChain(expr.object);
  if (isCallNode(expr)) return isPlainChain(expr.callee);
  return false;
};

/** True when a test reads a named boolean per AGENTS.md 3.A. */
export const isNamedCondition = (node) => {
  const expr = unwrapExpression(node);
  if (!expr) return false;
  if (t.isIdentifier(expr)) return true;
  const isNegation = t.isUnaryExpression(expr, { operator: '!' });
  if (isNegation) return isNamedCondition(expr.argument);
  if (isMemberNode(expr)) return isPlainChain(expr) || isAssertionMember(expr);
  if (isCallNode(expr)) return isPredicateCall(expr);
  return false;
};

const collectTestNames = (node, names = []) => {
  const expr = unwrapExpression(node);
  if (!expr) return names;
  if (t.isIdentifier(expr)) names.push(expr.name);
  const isMember = t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr);
  if (isMember) {
    collectTestNames(expr.object, names);
    names.push(memberPropertyName(expr));
  }
  if (t.isUnaryExpression(expr)) collectTestNames(expr.argument, names);
  const isPair = t.isLogicalExpression(expr) || t.isBinaryExpression(expr);
  if (isPair) {
    collectTestNames(expr.left, names);
    collectTestNames(expr.right, names);
  }
  if (t.isCallExpression(expr)) collectTestNames(expr.callee, names);
  return names;
};

/**
 * True when a guard tests an error-ish condition: an error or failure name, or the
 * negation of an outcome (`!response.ok`, `!isValid`).
 */
export const isErrorishTest = (node) => {
  const expr = unwrapExpression(node);
  const isNegated = t.isUnaryExpression(expr, { operator: '!' });
  const hasNegatedOutcome = isNegated && collectTestNames(expr.argument).some(isOutcomeName);
  return hasNegatedOutcome || collectTestNames(node).some(isErrorishName);
};

/** Counts && / || / ?? operators; negation is not an operator here. */
export const countJunctionOperators = (node) => {
  const expr = unwrapExpression(node);
  if (t.isLogicalExpression(expr)) {
    return 1 + countJunctionOperators(expr.left) + countJunctionOperators(expr.right);
  }
  if (t.isUnaryExpression(expr, { operator: '!' })) return countJunctionOperators(expr.argument);
  return 0;
};

/** Length of the if / else-if chain that an IfStatement path belongs to. */
export const resolveIfChainLength = (ifPath) => {
  let root = ifPath;
  while (root.parentPath?.isIfStatement() && root.parentPath.node.alternate === root.node) root = root.parentPath;
  let length = 0;
  let node = root.node;
  while (t.isIfStatement(node)) {
    length += 1;
    node = node.alternate;
  }
  return length;
};
