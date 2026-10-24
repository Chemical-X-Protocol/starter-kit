// PHP catch rules (design spec 4): ERROR_SWALLOWED_EXCEPTION and AI_SLOP_SHALLOW_CATCH.
// A pass is (ctx) => void and reports through ctx.report only. Dark until the language flip registers .php.
import { walk, callName } from './php-walk.js';

export const RULE_DEFAULTS = {
  // heldOut is labelled hits judged correct over labelled hits (spec 2.6); labels are in the task #6473 comment.
  ERROR_SWALLOWED_EXCEPTION: { defaultOn: true, corpus: '9/9', heldOut: '12/13', measured: '2026-10-24' },
  // 7 held-out hits exist; 6 were labelled.
  AI_SLOP_SHALLOW_CATCH: { defaultOn: true, corpus: '3/3', heldOut: '5/6', measured: '2026-10-24' },
};

const SHALLOW_CALLS = new Set(['error_log', 'trigger_error', 'var_dump', 'print_r', 'var_export', 'dump', 'dd']);
const HANDLING_KINDS = new Set(['throw', 'call', 'new', 'exit', 'echo', 'print', 'include']);
const NESTED_SCOPE_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc', 'class']);

const meaningfulStatements = (catchNode) => {
  const children = (catchNode.body && catchNode.body.children) || [];
  return children.filter((stmt) => stmt.kind !== 'noop');
};

const isCatchVariableAssign = (node, catchVar) => {
  const left = node.left;
  const isVariable = Boolean(left) && left.kind === 'variable';
  return isVariable && left.name === catchVar;
};

const isHandlingNode = (node, catchVar) => {
  const isHandlingKind = HANDLING_KINDS.has(node.kind);
  const isValueReturn = node.kind === 'return' && Boolean(node.expr);
  const isForeignAssign = node.kind === 'assign' && !isCatchVariableAssign(node, catchVar);
  return isHandlingKind || isValueReturn || isForeignAssign;
};

/** True when the catch body (not nested functions) throws, calls, creates, prints, exits, returns a value or assigns elsewhere. */
function hasHandling(statements, catchVar) {
  let handled = false;
  const visit = (node) => {
    const skip = handled || NESTED_SCOPE_KINDS.has(node.kind);
    handled = handled || (!skip && isHandlingNode(node, catchVar));
    return skip || handled ? false : undefined;
  };
  for (const stmt of statements) walk(stmt, visit);
  return handled;
}

/** The single plain-function shallow call of a one-statement catch body, or null. */
function shallowCallName(statements) {
  const only = statements.length === 1 ? statements[0] : null;
  const expression = only && only.kind === 'expressionstatement' ? only.expression : null;
  const isCall = Boolean(expression) && expression.kind === 'call';
  const callee = isCall ? callName(expression) : null;
  const isPlain = Boolean(callee) && callee.kind === 'function';
  return isPlain && SHALLOW_CALLS.has(callee.name) ? callee.name : null;
}

/** { tryBraceLine, tryBraceColumn } when the previous brace closes on an earlier line than the catch; else {}. */
function tryBraceSpan(tryNode, index) {
  const previous = index === 0 ? tryNode.body : tryNode.catches[index - 1].body;
  const end = previous && previous.loc && previous.loc.end;
  const catchLine = tryNode.catches[index].loc.start.line;
  const onEarlierLine = Boolean(end) && end.line < catchLine;
  return onEarlierLine ? { tryBraceLine: end.line, tryBraceColumn: end.column } : {};
}

function classifyCatch(statements, catchVar) {
  const isEmpty = statements.length === 0;
  const swallowed = isEmpty || !hasHandling(statements, catchVar);
  const why = isEmpty ? 'is empty or holds only comments' : 'neither rethrows, calls, returns a value, nor records the error';
  const shallow = swallowed ? null : shallowCallName(statements);
  const swallowedFinding = ['ERROR_SWALLOWED_EXCEPTION', `catch block ${why}; the exception is swallowed`];
  const shallowFinding = shallow && ['AI_SLOP_SHALLOW_CATCH', `catch block only calls ${shallow}() and does nothing to recover or propagate`];
  return swallowed ? swallowedFinding : shallowFinding;
}

function reportCatch(ctx, tryNode, index) {
  const catchNode = tryNode.catches[index];
  const catchVar = catchNode.variable ? catchNode.variable.name : null;
  const finding = classifyCatch(meaningfulStatements(catchNode), catchVar);
  if (finding) ctx.report(finding[0], catchNode, finding[1], tryBraceSpan(tryNode, index));
}

/** Pass entry: at most one finding per catch (swallowed wins over shallow). */
export function catchPass(ctx) {
  walk(ctx.ast, (node) => {
    const catches = node.kind === 'try' ? node.catches || [] : [];
    catches.forEach((_catch, index) => reportCatch(ctx, node, index));
  });
}
