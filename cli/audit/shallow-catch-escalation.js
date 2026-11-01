/**
 * Truth spec 4.2 escalation for the catch-rule family (ERROR_SWALLOWED_EXCEPTION and
 * AI_SLOP_SHALLOW_CATCH): a swallowed catch is MEDIUM by default and HIGH only when a let/var
 * assigned in its try is read after the try while it may still be unset, because that is where
 * a swallowed error silently propagates as undefined. Reads that supply their own default or
 * check the binding first (shallow-catch-reads.js) do not escalate. A later or earlier write
 * is a default only when it always runs, so not inside a nested function or under a branch,
 * loop, switch case or catch that may skip it.
 */
import * as t from '@babel/types';
import { isShallowCatchClause } from './rules-predicates.js';
import { isSwallowedCatch } from './catch-predicates.js';
import { isCheckOfBinding, isCoveredRead, isUndefinedValue, isWithinNode } from './shallow-catch-reads.js';

const SWALLOWABLE_KINDS = new Set(['let', 'var']);
const DEFAULTING_ASSIGNMENTS = new Set(['=', '??=', '||=']);
// Parts of a node that run on some paths only: branches, the right side of a logical, and
// loop bodies. A do-while body always runs once, and a for loop always runs its init.
const SKIPPABLE_PARTS = Object.freeze({
  IfStatement: ['consequent', 'alternate'],
  ConditionalExpression: ['consequent', 'alternate'],
  LogicalExpression: ['right'],
  WhileStatement: ['body'],
  ForStatement: ['body', 'update'],
  ForInStatement: ['body'],
  ForOfStatement: ['body']
});
// Nodes that may skip every part of themselves: a switch case runs only when it matches, and a
// catch clause only when its try throws.
const SKIPPABLE_NODES = new Set(['SwitchCase', 'CatchClause']);

const resolveFunctionScope = (scope) => scope.getFunctionParent() || scope.getProgramParent();

// Names written directly in the try block. Writes inside callbacks are skipped, and `var`
// initialisers count because a var binding outlives the block it is declared in.
const collectTryWrites = (blockPath) => {
  const writes = [];
  const record = (p) => {
    for (const name of Object.keys(p.getBindingIdentifiers())) writes.push({ name, scope: p.scope });
  };
  blockPath.traverse({
    Function(p) {
      p.skip();
    },
    AssignmentExpression(p) {
      const isPlainWrite = p.node.operator === '=';
      if (isPlainWrite) record(p);
    },
    VariableDeclarator(p) {
      const isVarInit = p.parent.kind === 'var' && Boolean(p.node.init);
      if (isVarInit) record(p);
    }
  });
  return writes;
};

// Offset from which a write guarantees the binding a value, so reads nested inside the write
// (v = normalize(v)) are still unguarded. Compound and update writes (v += x, v++) read the
// old value first and never stand in for a default, so they guard nothing.
const resolveGuardedFrom = (writePath) => {
  const node = writePath.node;
  if (writePath.isUpdateExpression()) return Infinity;
  if (writePath.isForXStatement()) return node.body.start;
  if (!writePath.isAssignmentExpression()) return node.end;
  return DEFAULTING_ASSIGNMENTS.has(node.operator) ? node.end : Infinity;
};

// Any catch the audit reports as swallowed, not only an empty or console-only one.
const hasSwallowingHandler = (tryPath) => {
  const handler = tryPath.node.handler;
  if (!handler) return false;
  return isShallowCatchClause(handler, t) || isSwallowedCatch(tryPath.get('handler'));
};

// A write inside the block of another try whose catch swallows may never have run, so it
// cannot count as a default. A try that also encloses this one does not qualify: reaching
// this try means the statements before it in that shared block already ran.
const isInOtherSwallowedTry = (writePath, tryNode) => {
  const swallowingTry = writePath.findParent((p) => {
    if (!p.isTryStatement()) return false;
    if (!hasSwallowingHandler(p)) return false;
    if (isWithinNode(tryNode, p.node)) return false;
    return isWithinNode(writePath.node, p.node.block);
  });
  return Boolean(swallowingTry);
};

// The test that decides whether a skippable part runs: the left side of a logical, otherwise
// the test of the branch or loop (none for for-in and for-of).
const readSkipTest = (node) => (t.isLogicalExpression(node) ? node.left : node.test);

// Whether stepping from childPath up to its parent leaves a part that may not run. A function
// body runs only when called. A branch or loop part whose test checks the binding (if (!v)
// v = d) is there to supply the value, so it still counts as a default.
const isSkippableStep = (childPath, binding) => {
  const parentPath = childPath.parentPath;
  const isSkippableNode = parentPath.isFunction() || SKIPPABLE_NODES.has(parentPath.type);
  if (isSkippableNode) return true;
  const parts = Object.hasOwn(SKIPPABLE_PARTS, parentPath.type) ? SKIPPABLE_PARTS[parentPath.type] : [];
  const isSkippablePart = parts.includes(childPath.key);
  if (!isSkippablePart) return false;
  return !isCheckOfBinding(readSkipTest(parentPath.node), binding);
};

// A write supplies a default only if nothing can skip it on the way to its anchors (the try,
// and for a later write the read). Climbing from the write, the first ancestor that holds an
// anchor ends the walk; a function, branch, loop, switch case or catch crossed before it may
// skip the write (setTimeout(() => { v = d; }), if (cond) v = d, while (false) v = d).
const isGuaranteedWrite = (writePath, binding, anchors) => {
  for (let childPath = writePath; childPath.parentPath; childPath = childPath.parentPath) {
    const holdsAnchor = anchors.some((anchor) => isWithinNode(anchor, childPath.node));
    if (holdsAnchor) return true;
    const isSkippable = isSkippableStep(childPath, binding);
    if (isSkippable) return false;
  }
  return true;
};

const hasRealInit = (declaratorPath) => {
  const init = declaratorPath.node.init;
  return Boolean(init) && !isUndefinedValue(init);
};

// A bare `var v;` redeclaration is recorded as a constant violation but assigns nothing.
const isValueWrite = (writePath) => !writePath.isVariableDeclarator() || hasRealInit(writePath);

// Every write that gives the binding a value: each reassignment, plus a declared initialiser
// that is not undefined, or a for-in/for-of head that assigns it.
const listValueWrites = (binding, tryNode) => {
  const writePaths = binding.constantViolations.filter(isValueWrite);
  const isLoopHead = Boolean(binding.path.parentPath?.parentPath?.isForXStatement());
  const isDeclarationWrite = hasRealInit(binding.path) || isLoopHead;
  if (isDeclarationWrite) writePaths.push(binding.path);
  return writePaths
    .filter((writePath) => !isInOtherSwallowedTry(writePath, tryNode))
    .map((writePath) => ({ path: writePath, start: writePath.node.start, guardedFrom: resolveGuardedFrom(writePath) }));
};

// Babel lists the bare head of for (v of xs) among the references, but it is the write.
const isLoopHeadTarget = (refPath) => refPath.parentPath.isForXStatement() && refPath.key === 'left';

// Only a plain let/var declared in the same function as the try can be left unset by it.
const isSwallowableBinding = (binding, fnScope) => {
  if (!binding) return false;
  const isLetOrVar = SWALLOWABLE_KINDS.has(binding.kind);
  const isDeclarator = binding.path.isVariableDeclarator();
  const isSameFunction = resolveFunctionScope(binding.scope) === fnScope;
  return isLetOrVar && isDeclarator && isSameFunction;
};

const isReadUnsetAfterTry = (binding, tryNode, fnScope) => {
  const isCandidate = isSwallowableBinding(binding, fnScope);
  if (!isCandidate) return false;

  const writes = listValueWrites(binding, tryNode);
  const isEarlierValue = (write) => write.start < tryNode.start && isGuaranteedWrite(write.path, binding, [tryNode]);
  const hasEarlierValue = writes.some(isEarlierValue);
  if (hasEarlierValue) return false;
  const laterWrites = writes.filter((write) => write.start > tryNode.end);
  // A later write guards a read from its guardedFrom offset on, if it always runs before it.
  const isGuardedByWrite = (ref) => laterWrites.some((write) => {
    const isPastGuard = ref.node.start >= write.guardedFrom;
    return isPastGuard && isGuaranteedWrite(write.path, binding, [tryNode, ref.node]);
  });

  return binding.referencePaths.some((ref) => {
    if (isLoopHeadTarget(ref)) return false;
    const isAfterTry = ref.node.start > tryNode.end;
    if (!isAfterTry) return false;
    const isGuarded = isGuardedByWrite(ref) || isCoveredRead(ref, binding, tryNode);
    return !isGuarded;
  });
};

const swallowedBindingCache = new WeakMap();

/** The name of a let/var the try assigns and the code reads unset after it, or null. */
export const findSwallowedBinding = (catchPath) => {
  const isCached = swallowedBindingCache.has(catchPath.node);
  if (isCached) return swallowedBindingCache.get(catchPath.node);
  const tryPath = catchPath.parentPath;
  const fnScope = resolveFunctionScope(tryPath.scope);
  const writes = collectTryWrites(tryPath.get('block'));
  const swallowed = writes.find(({ name, scope }) => isReadUnsetAfterTry(scope.getBinding(name), tryPath.node, fnScope));
  const result = swallowed?.name || null;
  swallowedBindingCache.set(catchPath.node, result);
  return result;
};

/** Severity and the escalating binding (or null) for one swallowed catch site. */
export const resolveCatchEscalation = (catchPath) => {
  const binding = findSwallowedBinding(catchPath);
  return { severity: binding ? 'HIGH' : 'MEDIUM', binding };
};

const tryStartsCache = new WeakMap();

// Start positions of every try statement in the program. A plain node walk, so the visitor
// traversal that is running meanwhile keeps its path state.
const listTryStarts = (program) => {
  const isCached = tryStartsCache.has(program);
  if (isCached) return tryStartsCache.get(program);
  const starts = [];
  t.traverseFast(program, (node) => {
    const isLocatedTry = t.isTryStatement(node) && Boolean(node.loc);
    if (isLocatedTry) starts.push(node.loc.start);
  });
  tryStartsCache.set(program, starts);
  return starts;
};

const TRY_PARTS = new Set(['block', 'handler', 'finalizer']);

// The end of the innermost try block, catch clause or finally of another try that holds this one.
const findEnclosingTryPartEnd = (tryPath) => {
  const part = tryPath.findParent((p) => TRY_PARTS.has(p.key) && p.parentPath.isTryStatement());
  return part?.node.loc?.end;
};

// Column on the catch's last line where a trailing annotation stops being this catch's: where
// a later try starts, or the brace of an enclosing try part that closes on that line.
const resolveTrailEndColumn = (catchPath) => {
  const end = catchPath.node.loc.end;
  const programPath = catchPath.findParent((p) => p.isProgram());
  const tryStarts = programPath ? listTryStarts(programPath.node) : [];
  const laterTryColumns = tryStarts
    .filter((start) => start.line === end.line && start.column >= end.column)
    .map((start) => start.column);
  const enclosingEnd = findEnclosingTryPartEnd(catchPath.parentPath);
  const closesOnLine = enclosingEnd?.line === end.line;
  const limits = closesOnLine ? [...laterTryColumns, enclosingEnd.column - 1] : laterTryColumns;
  return limits.length > 0 ? Math.min(...limits) : undefined;
};

/**
 * Where a catch's annotations may sit (suppressions.js): its own lines, 0-based columns of the
 * catch keyword (catchColumn), its closing brace (endColumn), its try keyword (tryLine,
 * tryColumn) and the end of the try block (tryBraceLine, tryBraceColumn), and trailEndColumn.
 */
export const resolveCatchSpan = (catchPath) => {
  const node = catchPath.node;
  const line = node.loc?.start.line || 1;
  const span = { line, endLine: node.loc?.end.line || line, column: node.loc?.start.column || 1 };
  const tryNode = catchPath.parent;
  const tryBlockEnd = tryNode.block.loc?.end;
  const hasLocations = Boolean(node.loc) && Boolean(tryNode.loc) && Boolean(tryBlockEnd);
  if (!hasLocations) return span;
  return {
    ...span,
    catchColumn: node.loc.start.column,
    endColumn: node.loc.end.column,
    tryLine: tryNode.loc.start.line,
    tryColumn: tryNode.loc.start.column,
    tryBraceLine: tryBlockEnd.line,
    tryBraceColumn: tryBlockEnd.column,
    trailEndColumn: resolveTrailEndColumn(catchPath)
  };
};
