/**
 * Truth spec 4.2 escalation for the catch-rule family (ERROR_SWALLOWED_EXCEPTION and
 * AI_SLOP_SHALLOW_CATCH): a swallowed catch is MEDIUM by default and HIGH only when a let/var
 * assigned in its try is read after the try while it may still be unset, because that is where
 * a swallowed error silently propagates as undefined. Reads that supply their own default or
 * check the binding first (shallow-catch-reads.js) do not escalate.
 */
import * as t from '@babel/types';
import { isShallowCatchClause } from './rules-predicates.js';
import { isSwallowedCatch } from './catch-predicates.js';
import { isCoveredRead, isUndefinedValue, isWithinNode } from './shallow-catch-reads.js';

const SWALLOWABLE_KINDS = new Set(['let', 'var']);
const DEFAULTING_ASSIGNMENTS = new Set(['=', '??=', '||=']);

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
    .map((writePath) => ({ start: writePath.node.start, guardedFrom: resolveGuardedFrom(writePath) }));
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
  const hasEarlierValue = writes.some((write) => write.start < tryNode.start);
  if (hasEarlierValue) return false;
  const laterWrites = writes.filter((write) => write.start > tryNode.end);
  const guardedFrom = Math.min(Infinity, ...laterWrites.map((write) => write.guardedFrom));

  return binding.referencePaths.some((ref) => {
    if (isLoopHeadTarget(ref)) return false;
    const isAfterTry = ref.node.start > tryNode.end;
    const isBeforeGuard = ref.node.start < guardedFrom;
    const isUnguardedWindow = isAfterTry && isBeforeGuard;
    return isUnguardedWindow && !isCoveredRead(ref, binding);
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

/**
 * Where a catch's annotation window lies: its own lines, plus (Stroustrup style, the catch
 * keyword below the try block's closing brace) the text after that brace.
 */
export const resolveCatchSpan = (catchPath) => {
  const node = catchPath.node;
  const line = node.loc?.start.line || 1;
  const span = { line, endLine: node.loc?.end.line || line, column: node.loc?.start.column || 1 };
  const tryBlockLoc = catchPath.parent.block.loc;
  const tryBlockEnd = tryBlockLoc && tryBlockLoc.end;
  const isBraceAbove = Boolean(tryBlockEnd) && tryBlockEnd.line < line;
  if (isBraceAbove) Object.assign(span, { tryBraceLine: tryBlockEnd.line, tryBraceColumn: tryBlockEnd.column });
  return span;
};
