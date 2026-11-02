/**
 * Truth spec 4.2 escalation for the catch-rule family (ERROR_SWALLOWED_EXCEPTION and
 * AI_SLOP_SHALLOW_CATCH): a swallowed catch is MEDIUM by default and HIGH only when a let/var
 * assigned in its try is read after the try while it may still be unset, because that is where
 * a swallowed error silently propagates as undefined. Reads that supply their own default or
 * check the binding first (shallow-catch-reads.js) do not escalate. A write before the try, or
 * after it and before the read, is a default as on main unless shallow-catch-writes.js proves
 * that a path to the read skips it. No proof holds for a read after a write that main leaves
 * uncounted because it sits in another swallowed try, since that write may still always run
 * (try { try { g(); } finally { v = d; } } catch {}). A try that writes the binding before every
 * way out that goes on to the read guards that read.
 */
import * as t from '@babel/types';
import { isShallowCatchClause } from './rules-predicates.js';
import { isSwallowedCatch } from './catch-predicates.js';
import { isCoveredRead, isUndefinedValue, isWithinNode } from './shallow-catch-reads.js';
import { DEFAULTING_ASSIGNMENTS, createSkipContext, isGuardedByTry, isSkippedBeforeRead, resolveFunctionScope } from './shallow-catch-writes.js';

const SWALLOWABLE_KINDS = new Set(['let', 'var']);

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

const hasRealInit = (declaratorPath) => {
  const init = declaratorPath.node.init;
  return Boolean(init) && !isUndefinedValue(init);
};

// A bare `var v;` redeclaration is recorded as a constant violation but assigns nothing.
const isValueWrite = (writePath) => !writePath.isVariableDeclarator() || hasRealInit(writePath);

// Every write that gives the binding a value: each reassignment, plus a declared initialiser
// that is not undefined, or a for-in/for-of head that assigns it.
const listValueWritePaths = (binding) => {
  const writePaths = binding.constantViolations.filter(isValueWrite);
  const isLoopHead = Boolean(binding.path.parentPath?.parentPath?.isForXStatement());
  const isDeclarationWrite = hasRealInit(binding.path) || isLoopHead;
  if (isDeclarationWrite) writePaths.push(binding.path);
  return writePaths;
};

const listValueWrites = (writePaths, tryNode) => writePaths
  .filter((writePath) => !isInOtherSwallowedTry(writePath, tryNode))
  .map((writePath) => ({ path: writePath, start: writePath.node.start, guardedFrom: resolveGuardedFrom(writePath) }));

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

  const writePaths = listValueWritePaths(binding);
  const writes = listValueWrites(writePaths, tryNode);
  const context = createSkipContext(binding, tryNode, fnScope);
  const earlierWrites = writes.filter((write) => write.start < tryNode.start);
  const laterWrites = writes.filter((write) => write.start > tryNode.end);
  // Writes in another swallowed try, which count for nothing even when they always run (a finally).
  const uncountedStarts = writePaths.filter((writePath) => isInOtherSwallowedTry(writePath, tryNode)).map((writePath) => writePath.node.start);
  // An earlier write, or a later one the read follows, gives it a value unless it is proven
  // skipped. A proof needs every write before the read counted, or it could rest on that gap.
  const isGuardedByWrite = (ref) => {
    const hasUncountedWrite = uncountedStarts.some((start) => start < ref.node.start);
    const isDefault = (write) => hasUncountedWrite || !isSkippedBeforeRead(write.path, ref, context);
    const isBeforeRead = (write) => ref.node.start >= write.guardedFrom;
    return earlierWrites.some(isDefault) || laterWrites.some((write) => isBeforeRead(write) && isDefault(write));
  };

  return binding.referencePaths.some((ref) => {
    if (isLoopHeadTarget(ref)) return false;
    const isAfterTry = ref.node.start > tryNode.end;
    if (!isAfterTry) return false;
    const isGuarded = isGuardedByWrite(ref) || isGuardedByTry(ref, context) || isCoveredRead(ref, binding, tryNode);
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

const keywordStartsCache = new WeakMap();
const KEYWORD_OF_NODE = new Map([['TryStatement', 'try'], ['CatchClause', 'catch']]);
const NO_KEYWORD_STARTS = Object.freeze({ try: [], catch: [] });

// Start positions of every try keyword (a TryStatement with a catch clause; a try with none takes
// no part in ownership) and catch keyword (a CatchClause) in the program, by keyword. A plain node
// walk, so the visitor traversal that is running meanwhile keeps its path state.
const listKeywordStarts = (program) => {
  const isCached = keywordStartsCache.has(program);
  if (isCached) return keywordStartsCache.get(program);
  const starts = { try: [], catch: [] };
  t.traverseFast(program, (node) => {
    const keyword = KEYWORD_OF_NODE.get(node.type);
    const isCatchlessTry = node.type === 'TryStatement' && !node.handler;
    const isLocatedKeyword = Boolean(keyword) && Boolean(node.loc) && !isCatchlessTry;
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

const isTryPartWithCatch = (p) => TRY_PARTS.has(p.key) && p.parentPath.isTryStatement() && Boolean(p.parentPath.node.handler);

// The end of the innermost try block, catch clause or finally of another try with a catch that
// holds this one.
const findEnclosingTryPartEnd = (tryPath) => tryPath.findParent(isTryPartWithCatch)?.node.loc?.end;

// Column on line, from fromColumn on, where a trailing annotation stops being this catch's: where
// a later try starts, or the brace of an enclosing try part that closes on that line.
const findTrailLimit = (keywordStarts, enclosingEnd, line, fromColumn) => {
  const laterTryColumns = keywordStarts.try
    .filter((start) => start.line === line && start.column >= fromColumn)
    .map((start) => start.column);
  const closesOnLine = enclosingEnd?.line === line;
  const limits = closesOnLine ? [...laterTryColumns, enclosingEnd.column - 1] : laterTryColumns;
  return limits.length > 0 ? Math.min(...limits) : undefined;
};

// The trailing window on the catch's last line: up to trailEndColumn, and, when a try nested in
// the catch's own try statement (in its finally) stops it before that statement ends on the line,
// again from the statement's end (statementEndColumn) up to statementTrailEndColumn.
const resolveTrail = (catchPath, keywordStarts) => {
  const end = catchPath.node.loc.end;
  const enclosingEnd = findEnclosingTryPartEnd(catchPath.parentPath);
  const trailEndColumn = findTrailLimit(keywordStarts, enclosingEnd, end.line, end.column);
  const statementEnd = catchPath.parent.loc.end;
  const hasTrailEnd = trailEndColumn !== undefined;
  const isStoppedInStatement = hasTrailEnd && statementEnd.line === end.line && trailEndColumn < statementEnd.column;
  if (!isStoppedInStatement) return { trailEndColumn };
  const statementTrailEndColumn = findTrailLimit(keywordStarts, enclosingEnd, end.line, statementEnd.column);
  return { trailEndColumn, statementEndColumn: statementEnd.column, statementTrailEndColumn };
};

/**
 * Where a catch's annotations may sit (suppressions.js): its own lines, 0-based columns of the
 * catch keyword (catchColumn), its closing brace (endColumn), its try keyword (tryLine,
 * tryColumn) and the end of the try block (tryBraceLine, tryBraceColumn), the trailing window
 * (trailEndColumn, and statementEndColumn with statementTrailEndColumn), and where every try and
 * catch keyword starts on the catch's line (keywordColumns) and on its last line when that is
 * another (endKeywordColumns), read from the AST, so a key, method, name, regex, type member or
 * JSX text spelled try or catch is not one.
 */
export const resolveCatchSpan = (catchPath) => {
  const node = catchPath.node;
  const line = node.loc?.start.line || 1;
  const endLine = node.loc?.end.line || line;
  const span = { line, endLine, column: node.loc?.start.column || 1 };
  const tryNode = catchPath.parent;
  const tryBlockEnd = tryNode.block.loc?.end;
  const hasLocations = Boolean(node.loc) && Boolean(tryNode.loc) && Boolean(tryBlockEnd);
  if (!hasLocations) return span;
  const keywordStarts = readKeywordStarts(catchPath);
  const isOneLine = endLine === line;
  return {
    ...span,
    catchColumn: node.loc.start.column,
    endColumn: node.loc.end.column,
    tryLine: tryNode.loc.start.line,
    tryColumn: tryNode.loc.start.column,
    tryBraceLine: tryBlockEnd.line,
    tryBraceColumn: tryBlockEnd.column,
    ...resolveTrail(catchPath, keywordStarts),
    keywordColumns: listKeywordColumns(keywordStarts, line),
    endKeywordColumns: isOneLine ? [] : listKeywordColumns(keywordStarts, endLine)
  };
};
