/**
 * Proven skips for shallow-catch escalation (truth spec 4.2). A write of the binding before the
 * try, or after it and before the read, gives the read a value as on main, except in three shapes
 * where a path provably reaches the read without it:
 * (1) the write is in a function that nothing calls, or in a callback that a deferring API runs
 *     later (shallow-catch-invocation.js);
 * (2) the write is the consequent of an if with no else, or a statement of that consequent's
 *     block, and the test is not always true and reads no name, besides the binding, that appears
 *     anywhere outside the if (which could tie the test to the try, an exit or another write);
 * (3) the write runs only while the binding is set, by readUnsetOutcome: a part of an if, or the
 *     right side of an && or || statement, that runs on the outcome the test lacks while the
 *     binding is unset (if (v) v = v.trim(), if (v != null), the else of if (!v), v && (v = d)).
 * Each holds only in the simple position: the if, the && or || statement, or the statement of the
 * deferring call is a statement of a block that holds the read in a later statement, both in the
 * try's own function; it holds no try itself and has no loop or label around it inside the
 * binding's scope; nothing between it and the read returns, breaks, continues, throws or pauses
 * (await, yield), nor, for a deferred callback, calls anything; and no function that may still be
 * called writes the binding after the read. For (2) and (3) the read also runs whenever its own
 * statement does. Every other shape keeps main's result.
 * A try whose block holds a plain write of the binding as a statement and whose catch holds an
 * exit statement, or whose finally holds such a write, guards the reads in the statements after
 * it in the same block: a way out of it that skips the write skips those statements too.
 */
import * as t from '@babel/types';
import { EXIT_TYPES, isWithinNode, readUnsetOutcome } from './shallow-catch-reads.js';
import { findDeferringCall, isDeferringCall, isInUncalledFunction } from './shallow-catch-invocation.js';

/** Assignments that leave the binding set however it started. */
export const DEFAULTING_ASSIGNMENTS = new Set(['=', '??=', '||=']);
const LOGICAL_ASSIGNMENTS = new Set(['&&=', '||=', '??=']);
const GUARD_OPERATORS = new Set(['&&', '||']);
const PART_KEYS = new Set(['consequent', 'alternate']);
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression', 'ParenthesizedExpression']);
const JUMP_TYPES = new Set(['ReturnStatement', 'BreakStatement', 'ContinueStatement']);
const PAUSE_TYPES = new Set(['AwaitExpression', 'YieldExpression']);
const CALL_TYPES = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression', 'TaggedTemplateExpression']);
// Parents that evaluate each child every time they run, and those that do so only for one child.
const EVALUATING_TYPES = new Set([
  'ExpressionStatement', 'ReturnStatement', 'ThrowStatement', 'VariableDeclaration', 'VariableDeclarator', 'MemberExpression',
  'CallExpression', 'NewExpression', 'BinaryExpression', 'UnaryExpression', 'UpdateExpression', 'SequenceExpression',
  'ArrayExpression', 'ObjectExpression', 'ObjectProperty', 'SpreadElement', 'TemplateLiteral', 'TaggedTemplateExpression',
  'AwaitExpression', ...TS_WRAPPERS
]);
const EVALUATED_KEYS = Object.freeze({
  IfStatement: 'test',
  ConditionalExpression: 'test',
  LogicalExpression: 'left',
  SwitchStatement: 'discriminant',
  OptionalMemberExpression: 'object',
  OptionalCallExpression: 'callee'
});

/** The function (or program) scope a scope belongs to. */
export const resolveFunctionScope = (scope) => scope.getFunctionParent() || scope.getProgramParent();
const isInFunction = (path, fnScope) => resolveFunctionScope(path.scope) === fnScope;

const isDefaultingWrite = (path) => path.isAssignmentExpression() && DEFAULTING_ASSIGNMENTS.has(path.node.operator);

/** What the checks below share for one binding and try. */
export const createSkipContext = (binding, tryNode, fnScope) => ({
  binding,
  tryNode,
  fnScope,
  defaultingNodes: new Set(binding.constantViolations.filter(isDefaultingWrite).map((path) => path.node))
});

const listChildNodes = (node) => (t.VISITOR_KEYS[node.type] ?? [])
  .flatMap((key) => [node[key]].flat())
  .filter((child) => Boolean(child?.type));

const isListedStatement = (path) => path.listKey === 'body' && (path.parentPath.isBlockStatement() || path.parentPath.isProgram());

// A BigInt literal's digits (0x1f, 0b1, 1_000) hold something other than zeros.
const isNonZeroBigInt = (digits) => /[^0_]/.test(digits.replace(/^0[box]/i, ''));

// What a test always gives, or null: a constant once TS wrappers are dropped (true as boolean,
// <boolean>true, true!), a BigInt literal (1n is true), the ! of one, or what Babel evaluates
// confidently (1, 'x', !0).
const readConstantTruth = (testPath) => {
  if (TS_WRAPPERS.has(testPath.type)) return readConstantTruth(testPath.get('expression'));
  if (testPath.isBigIntLiteral()) return isNonZeroBigInt(testPath.node.value);
  const isNegation = testPath.isUnaryExpression({ operator: '!' });
  if (isNegation) {
    const truth = readConstantTruth(testPath.get('argument'));
    return truth === null ? null : !truth;
  }
  const { confident, value } = testPath.evaluate();
  return confident ? Boolean(value) : null;
};

// Whether a node other than the if itself, anywhere in the try's function, matches.
const hasMatchOutside = (fnScope, ifNode, isMatch) => {
  let isFound = false;
  t.traverseFast(fnScope.block, (node) => {
    const isOutsideMatch = isMatch(node) && !isWithinNode(node, ifNode);
    if (isOutsideMatch) isFound = true;
  });
  return isFound;
};

// Whether a name the test reads appears again outside the if: any read or write of its binding,
// wherever it is, or for a global (or this) the same name anywhere in the try's function.
const appearsOutsideIf = (namePath, ifNode, fnScope) => {
  if (namePath.isThisExpression()) return hasMatchOutside(fnScope, ifNode, (node) => t.isThisExpression(node));
  const binding = namePath.scope.getBinding(namePath.node.name);
  if (!binding) return hasMatchOutside(fnScope, ifNode, (node) => t.isIdentifier(node, { name: namePath.node.name }));
  return [...binding.referencePaths, ...binding.constantViolations].some((path) => !isWithinNode(path.node, ifNode));
};

// Whether the names an if's test reads, besides the binding, appear nowhere outside the if: a
// name used elsewhere may tie the test to the try's outcome (if (!ok) after ok = true in the try),
// to an earlier exit (if (!c) return;), to another write (if (c) v = 1; if (!c) v = 2;) or to an
// assertion (assert(c)).
const hasOwnTest = (ifPath, context) => {
  const testPath = ifPath.get('test');
  const namePaths = [];
  const collect = (path) => {
    const isName = path.isReferencedIdentifier() || path.isThisExpression();
    if (isName) namePaths.push(path);
  };
  collect(testPath);
  testPath.traverse({ enter: collect });
  const isOtherName = (path) => path.isThisExpression() || path.scope.getBinding(path.node.name) !== context.binding;
  return namePaths.filter(isOtherName).every((path) => !appearsOutsideIf(path, ifPath.node, context.fnScope));
};

// What runs in node before the read: a return, break or continue outside nested functions, or a
// throw anywhere, leaves; an await, a yield or a for await outside nested functions pauses; a
// call, new or tagged template anywhere, other than a deferring call, may run other code. A node
// that holds the read evaluates it before it finishes.
const scanBeforeRead = (node, refNode, found, isNested = false) => {
  const isAfterRead = node.start >= refNode.start;
  if (isAfterRead) return;
  const holdsRead = isWithinNode(refNode, node);
  const isLeaving = !holdsRead && (t.isThrowStatement(node) || (!isNested && JUMP_TYPES.has(node.type)));
  const isPausing = !isNested && (t.isForOfStatement(node, { await: true }) || (PAUSE_TYPES.has(node.type) && !holdsRead));
  const isCalling = CALL_TYPES.has(node.type) && !holdsRead && !isDeferringCall(node);
  if (isLeaving) found.leaves = true;
  if (isPausing) found.pauses = true;
  if (isCalling) found.calls = true;
  const isNestedBelow = isNested || t.isFunction(node);
  for (const child of listChildNodes(node)) scanBeforeRead(child, refNode, found, isNestedBelow);
};

// Whether nothing between a statement and the binding's scope repeats or labels it: a loop
// carries the binding from one round into the next, so a write it skips may have run before.
const isOutsideLoops = (statementPath, binding) => {
  for (let path = statementPath.parentPath; path; path = path.parentPath) {
    const isRepeatedOrLabeled = path.isLoop() || path.isLabeledStatement();
    if (isRepeatedOrLabeled) return false;
    const isBindingScope = path.node === binding.scope.path.node;
    if (isBindingScope) return true;
  }
  return true;
};

// A write in a nested function placed after the read may still run before it, through a call in
// between (a helper declared at the end of the function), unless nothing calls that function.
const hasLateNestedWrite = (refPath, context) => context.binding.constantViolations.some((writePath) => {
  const isLateNested = writePath.node.start > refPath.node.start && !isInFunction(writePath, context.fnScope);
  return isLateNested && !isInUncalledFunction(writePath, context.fnScope);
});

// The later statement of statementPath's block that holds the read, when statementPath stands in
// the simple position for it (see the module comment), or null. A deferred callback also needs no
// call in between (isCallFree), since a call may run it (jest.runAllTimers(), emitter.emit()).
const findQuietReadStatement = (statementPath, refPath, context, isCallFree) => {
  const isPlaced = isListedStatement(statementPath) && isInFunction(statementPath, context.fnScope);
  if (!isPlaced) return null;
  const readStatement = refPath.findParent((path) => path.parentPath?.node === statementPath.parent && path.listKey === 'body');
  const isLater = Boolean(readStatement) && readStatement.key > statementPath.key;
  const isClear = isLater && !isWithinNode(context.tryNode, statementPath.node) && isOutsideLoops(statementPath, context.binding);
  if (!isClear) return null;
  const found = { leaves: false, pauses: false, calls: false };
  for (const statement of statementPath.container.slice(statementPath.key + 1, readStatement.key + 1)) {
    scanBeforeRead(statement, refPath.node, found);
  }
  const isQuiet = !found.leaves && !found.pauses && !(isCallFree && found.calls);
  return isQuiet && !hasLateNestedWrite(refPath, context) ? readStatement : null;
};

const isEvaluatingParent = (parentPath) => {
  if (parentPath.isAssignmentExpression()) return !LOGICAL_ASSIGNMENTS.has(parentPath.node.operator);
  return EVALUATING_TYPES.has(parentPath.type);
};

// Whether the read runs whenever its statement does: each part between them is evaluated every
// time its parent is (an argument, an operand, an if's test, the left side of && or ||), so no
// branch, loop, default value or optional chain stands between.
const isRunOnArrival = (refPath, statementPath) => {
  for (let path = refPath; path.node !== statementPath.node; path = path.parentPath) {
    const parentPath = path.parentPath;
    const hasEvaluatedKey = Object.hasOwn(EVALUATED_KEYS, parentPath.type);
    const isEvaluated = hasEvaluatedKey ? path.key === EVALUATED_KEYS[parentPath.type] : isEvaluatingParent(parentPath);
    if (!isEvaluated) return false;
  }
  return true;
};

// The if, or the && or || statement, whose part holds the write as a statement of its own
// (if (c) v = 1, if (c) { log(); v = 1; }, v && (v = d)): its statement, its test, the outcome
// of the test the part runs on, and whether the part is the consequent of an if with no else.
const findGuard = (writePath) => {
  const logicalPath = writePath.parentPath;
  const isGuardedRight = writePath.key === 'right' && logicalPath.isLogicalExpression() && GUARD_OPERATORS.has(logicalPath.node.operator);
  if (isGuardedRight) {
    const isStatement = logicalPath.parentPath.isExpressionStatement();
    return isStatement ? { statementPath: logicalPath.parentPath, testPath: logicalPath.get('left'), runsOn: logicalPath.node.operator === '&&', isLoneConsequent: false } : null;
  }
  const statement = writePath.find((path) => path.isStatement());
  const isInPartBlock = statement.listKey === 'body' && statement.parentPath.isBlockStatement();
  const partPath = isInPartBlock ? statement.parentPath : statement;
  const ifPath = partPath.parentPath;
  const isPart = Boolean(ifPath?.isIfStatement()) && PART_KEYS.has(partPath.key);
  if (!isPart) return null;
  const runsOn = partPath.key === 'consequent';
  return { statementPath: ifPath, testPath: ifPath.get('test'), runsOn, isLoneConsequent: runsOn && !ifPath.node.alternate };
};

// Shapes (2) and (3): the write's part may not run on a path that reaches the read unset.
const isSkippedByGuard = (writePath, refPath, context) => {
  const guard = isInFunction(writePath, context.fnScope) ? findGuard(writePath) : null;
  if (!guard) return false;
  const outcome = readUnsetOutcome(guard.testPath.node, context.binding);
  const isSetOnly = outcome === !guard.runsOn;
  const mayFail = guard.isLoneConsequent && outcome === null && readConstantTruth(guard.testPath) !== true;
  const isCandidate = isSetOnly || mayFail;
  if (!isCandidate) return false;
  const readStatement = findQuietReadStatement(guard.statementPath, refPath, context, false);
  const isPlaced = Boolean(readStatement) && isRunOnArrival(refPath, readStatement);
  return isPlaced && (isSetOnly || hasOwnTest(guard.statementPath, context));
};

/**
 * Whether a write is proven not to give the binding its value before refPath's read, by one of
 * the shapes in the module comment. context comes from createSkipContext.
 */
export const isSkippedBeforeRead = (writePath, refPath, context) => {
  const isReadInFunction = isInFunction(refPath, context.fnScope);
  if (!isReadInFunction) return false;
  if (isInUncalledFunction(writePath, context.fnScope)) return true;
  const deferringCall = findDeferringCall(writePath, context.fnScope);
  if (deferringCall) return Boolean(findQuietReadStatement(deferringCall.getStatementParent(), refPath, context, true));
  return isSkippedByGuard(writePath, refPath, context);
};

// A plain write of the binding standing as a statement of its own: v = g(), v ??= d.
const isWriteStatement = (statement, context) => t.isExpressionStatement(statement) && context.defaultingNodes.has(statement.expression);

// Whether a try writes the binding on every way out that goes on to the statements after it: its
// finally holds a write statement, or its block does and its catch holds an exit statement, so a
// throw before the write leaves those statements along with the try.
const isCoveringTry = (node, context) => {
  if (!t.isTryStatement(node)) return false;
  const hasFinalWrite = Boolean(node.finalizer) && node.finalizer.body.some((statement) => isWriteStatement(statement, context));
  if (hasFinalWrite) return true;
  const hasBlockWrite = node.block.body.some((statement) => isWriteStatement(statement, context));
  const hasLeavingCatch = Boolean(node.handler) && node.handler.body.body.some((statement) => EXIT_TYPES.has(statement.type));
  return hasBlockWrite && hasLeavingCatch;
};

/**
 * Whether a covering try (the swallowing one or another) stands before the read as a statement of
 * a block that holds it, out to the read's own function, so the read runs only once it wrote the
 * binding: try { v = g(); } catch { return; } use(v.x).
 */
export const isGuardedByTry = (refPath, context) => {
  for (let path = refPath; path && !path.isFunction(); path = path.parentPath) {
    const isGuarded = isListedStatement(path) && path.container.slice(0, path.key).some((statement) => isCoveringTry(statement, context));
    if (isGuarded) return true;
  }
  return false;
};
