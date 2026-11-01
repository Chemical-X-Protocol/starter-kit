/**
 * Truth spec 4.2 escalation for the catch-rule family (ERROR_SWALLOWED_EXCEPTION and
 * AI_SLOP_SHALLOW_CATCH): a swallowed catch is MEDIUM by default and HIGH only when a let/var
 * assigned in its try is read after the try while it may still be unset, because that is where
 * a swallowed error silently propagates as undefined. Reads that supply their own default or
 * check the binding first (shallow-catch-reads.js) do not escalate. A later or earlier write
 * is a default only when it always runs, so not inside a nested function or under a branch,
 * loop, switch case or catch that may skip it, unless that part runs whenever the binding is
 * unset (if (!v) v = d) or a node around it writes on every path that can still reach the read,
 * leaving instead on the others: the if, conditional, switch or invoked function around it
 * (if (c) v = 1; else v = 2, or else return), or further out a loop that always runs its body
 * (for (;;) { if (c) { v = 1; break; } }; see shallow-catch-writes.js). A write in a try whose
 * catch swallows but never runs off its end (catch { return; }) is a default where that try
 * covers it, and such a try guards its own reads. A for-in or for-of head writes only for
 * a non-empty iterable, so it is a default only inside its own loop.
 */
import * as t from '@babel/types';
import { isShallowCatchClause } from './rules-predicates.js';
import { isSwallowedCatch } from './catch-predicates.js';
import { isCoveredRead, isUndefinedValue, isWithinNode, readUnsetOutcome } from './shallow-catch-reads.js';
import { mayRunOffEnd, writesOnEveryPath } from './shallow-catch-writes.js';

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

// A try whose catch swallows, other than one that also encloses this try: reaching this try
// means the statements before it in that shared block already ran.
const isOtherSwallowingTry = (p, tryNode) => p.isTryStatement() && hasSwallowingHandler(p) && !isWithinNode(tryNode, p.node);

// A catch that never runs off its end (catch { return; }) lets the code after its try run only
// once the block ran, so a write there may still be a default (isSkippableStep).
const hasLeavingCatch = (tryPath) => !mayRunOffEnd(tryPath.get('handler.body'));

// A write inside the block of another try whose catch swallows and may run off its end may never
// have run, so it cannot count as a default.
const isInOtherSwallowedTry = (writePath, tryNode) => {
  const swallowingTry = writePath.findParent((p) => {
    const isOther = isOtherSwallowingTry(p, tryNode);
    return isOther && isWithinNode(writePath.node, p.node.block) && !hasLeavingCatch(p);
  });
  return Boolean(swallowingTry);
};

// The test that decides whether a skippable part runs, and the outcome it runs on: the right
// side of && once the left held, of || and ?? once it failed (an unset binding is nullish as
// well as falsy), an alternate once its test failed, and any other part while its test holds.
// A for-in or for-of body has no test.
const readPartCondition = (node, key) => {
  if (t.isLogicalExpression(node)) return { test: node.left, runsOn: node.operator === '&&' };
  return { test: node.test ?? null, runsOn: key !== 'alternate' };
};

// Whether stepping from childPath up to its parent leaves a part that may not run. A function
// body runs only when called, and the catch of another swallowing try may start before a write
// in its block. A branch or loop part that runs whenever the binding is unset
// (if (!v) v = d, v || (v = d)) is there to supply the value, so it still counts as a default;
// one that runs only while the binding is set (if (v) v = v.trim()) does not.
const isSkippableStep = (childPath, context) => {
  const parentPath = childPath.parentPath;
  const isSkippableNode = parentPath.isFunction() || SKIPPABLE_NODES.has(parentPath.type);
  if (isSkippableNode) return true;
  const isSwallowedBlock = childPath.key === 'block' && isOtherSwallowingTry(parentPath, context.tryNode);
  if (isSwallowedBlock) return true;
  const parts = Object.hasOwn(SKIPPABLE_PARTS, parentPath.type) ? SKIPPABLE_PARTS[parentPath.type] : [];
  const isSkippablePart = parts.includes(childPath.key);
  if (!isSkippablePart) return false;
  const { test, runsOn } = readPartCondition(parentPath.node, childPath.key);
  return readUnsetOutcome(test, context.binding) !== runsOn;
};

// A skippable step still leads to a default when a node around it writes the binding on every
// path that can reach the last anchor, the read (or for an earlier write the try), and holds no
// anchor, which could run first. The nearest such node is the cover, as a path: the if in
// if (c) v = 1; else v = 2 or else return, the switch around a case, the call that invokes a
// function, the try whose catch returns, or a loop that always runs around
// if (c) { v = 1; break; }. Null when the walk reaches an anchor first. Each node's unwritten
// paths are worked out once per binding (context.paths).
const findCover = (childPath, context, anchors) => {
  for (let coverPath = childPath.parentPath; coverPath; coverPath = coverPath.parentPath) {
    const holdsAnchor = anchors.some((anchor) => isWithinNode(anchor, coverPath.node));
    if (holdsAnchor) return null;
    const isCover = writesOnEveryPath(coverPath, anchors.at(-1), context);
    if (isCover) return coverPath;
  }
  return null;
};

// The for-in or for-of loop whose head writes the binding (for (v of xs), for (var v in o)).
const findHeadLoop = (writePath) => {
  if (writePath.isForXStatement()) return writePath;
  const declaration = writePath.parentPath;
  const isHeadDeclarator = writePath.isVariableDeclarator() && declaration.key === 'left' && declaration.parentPath.isForXStatement();
  return isHeadDeclarator ? declaration.parentPath : null;
};

// A write supplies a default only if nothing can skip it on the way to its anchors (the try,
// and for a later write the read). Climbing from the write, the first ancestor that holds an
// anchor ends the walk; a function, branch, loop, switch case or catch crossed before it may
// skip the write (setTimeout(() => { v = d; }), if (cond) v = d, while (false) v = d) unless
// a node around it covers every path, from which the walk goes on. A loop head runs only for an
// item, so it guards only anchors inside its own body.
const isGuaranteedWrite = (writePath, context, anchors) => {
  const headLoop = findHeadLoop(writePath);
  if (headLoop) return anchors.some((anchor) => isWithinNode(anchor, headLoop.node.body));
  let childPath = writePath;
  while (childPath.parentPath) {
    const holdsAnchor = anchors.some((anchor) => isWithinNode(anchor, childPath.node));
    if (holdsAnchor) return true;
    const isSkippable = isSkippableStep(childPath, context);
    const nextPath = isSkippable ? findCover(childPath, context, anchors) : childPath.parentPath;
    if (!nextPath) return false;
    childPath = nextPath;
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

// Writes that leave the binding set however it started (=, ??=, ||=), the ones that can cover a path.
const collectDefaultingNodes = (writes) => new Set(writes
  .filter((write) => write.path.isAssignmentExpression() && Number.isFinite(write.guardedFrom))
  .map((write) => write.path.node));

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

const isReadUnsetAfterTry = (binding, tryPath, fnScope) => {
  const isCandidate = isSwallowableBinding(binding, fnScope);
  if (!isCandidate) return false;

  const tryNode = tryPath.node;
  const writes = listValueWrites(binding, tryNode);
  const context = { binding, tryNode, writeNodes: collectDefaultingNodes(writes), paths: new Map() };
  const isEarlierValue = (write) => write.start < tryNode.start && isGuaranteedWrite(write.path, context, [tryNode]);
  const hasEarlierValue = writes.some(isEarlierValue);
  if (hasEarlierValue) return false;
  const laterWrites = writes.filter((write) => write.start > tryNode.end);
  // A later write guards a read from its guardedFrom offset on, if it always runs before it.
  const isGuardedByWrite = (ref) => laterWrites.some((write) => {
    const isPastGuard = ref.node.start >= write.guardedFrom;
    return isPastGuard && isGuaranteedWrite(write.path, context, [tryNode, ref.node]);
  });
  // The try itself guards a read that every path out of it writes first, as when its catch
  // leaves past the read (try { v = g(); } catch { return; }).
  const isGuardedByTry = (ref) => writesOnEveryPath(tryPath, ref.node, context);

  return binding.referencePaths.some((ref) => {
    if (isLoopHeadTarget(ref)) return false;
    const isAfterTry = ref.node.start > tryNode.end;
    if (!isAfterTry) return false;
    const isGuarded = isGuardedByWrite(ref) || isGuardedByTry(ref) || isCoveredRead(ref, binding, tryNode);
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
  const swallowed = writes.find(({ name, scope }) => isReadUnsetAfterTry(scope.getBinding(name), tryPath, fnScope));
  const result = swallowed?.name || null;
  swallowedBindingCache.set(catchPath.node, result);
  return result;
};

/** Severity and the escalating binding (or null) for one swallowed catch site. */
export const resolveCatchEscalation = (catchPath) => {
  const binding = findSwallowedBinding(catchPath);
  return { severity: binding ? 'HIGH' : 'MEDIUM', binding };
};

const keywordStartsCache = new WeakMap();
const KEYWORD_OF_NODE = new Map([['TryStatement', 'try'], ['CatchClause', 'catch']]);
const NO_KEYWORD_STARTS = Object.freeze({ try: [], catch: [] });

// Start positions of every try keyword (a TryStatement) and catch keyword (a CatchClause) in
// the program, by keyword. A plain node walk, so the visitor traversal that is running meanwhile
// keeps its path state.
const listKeywordStarts = (program) => {
  const isCached = keywordStartsCache.has(program);
  if (isCached) return keywordStartsCache.get(program);
  const starts = { try: [], catch: [] };
  t.traverseFast(program, (node) => {
    const keyword = KEYWORD_OF_NODE.get(node.type);
    const isLocatedKeyword = Boolean(keyword) && Boolean(node.loc);
    if (isLocatedKeyword) starts[keyword].push(node.loc.start);
  });
  keywordStartsCache.set(program, starts);
  return starts;
};

const readKeywordStarts = (catchPath) => {
  const programPath = catchPath.findParent((p) => p.isProgram());
  return programPath ? listKeywordStarts(programPath.node) : NO_KEYWORD_STARTS;
};

// 0-based columns of every try and catch keyword on a line, this catch's own included.
const listKeywordColumns = (keywordStarts, line) => [...keywordStarts.try, ...keywordStarts.catch]
  .filter((start) => start.line === line)
  .map((start) => start.column);

const TRY_PARTS = new Set(['block', 'handler', 'finalizer']);

// The end of the innermost try block, catch clause or finally of another try that holds this one.
const findEnclosingTryPartEnd = (tryPath) => {
  const part = tryPath.findParent((p) => TRY_PARTS.has(p.key) && p.parentPath.isTryStatement());
  return part?.node.loc?.end;
};

// Column on the catch's last line where a trailing annotation stops being this catch's: where
// a later try starts, or the brace of an enclosing try part that closes on that line.
const resolveTrailEndColumn = (catchPath, keywordStarts) => {
  const end = catchPath.node.loc.end;
  const laterTryColumns = keywordStarts.try
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
 * tryColumn) and the end of the try block (tryBraceLine, tryBraceColumn), trailEndColumn, and
 * keywordColumns: where every try and catch keyword on the catch's line starts, read from the
 * AST, so a key, method, name, regex, type member or JSX text spelled try or catch is not one.
 */
export const resolveCatchSpan = (catchPath) => {
  const node = catchPath.node;
  const line = node.loc?.start.line || 1;
  const span = { line, endLine: node.loc?.end.line || line, column: node.loc?.start.column || 1 };
  const tryNode = catchPath.parent;
  const tryBlockEnd = tryNode.block.loc?.end;
  const hasLocations = Boolean(node.loc) && Boolean(tryNode.loc) && Boolean(tryBlockEnd);
  if (!hasLocations) return span;
  const keywordStarts = readKeywordStarts(catchPath);
  return {
    ...span,
    catchColumn: node.loc.start.column,
    endColumn: node.loc.end.column,
    tryLine: tryNode.loc.start.line,
    tryColumn: tryNode.loc.start.column,
    tryBraceLine: tryBlockEnd.line,
    tryBraceColumn: tryBlockEnd.column,
    trailEndColumn: resolveTrailEndColumn(catchPath, keywordStarts),
    keywordColumns: listKeywordColumns(keywordStarts, line)
  };
};
