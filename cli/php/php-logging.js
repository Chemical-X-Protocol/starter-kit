// PHP logging rule (design spec 4): UNGUARDED_LOGGING. Reports through ctx.report only.
// Dark until the language flip registers .php.
import { walk, callName } from './php-walk.js';

export const RULE_DEFAULTS = {
  // Held-out precision is 1/10 (below the 80% bar of spec 2.6), so the rule is not default-on: most held-out hits
  // were error_log calls behind a plugin-specific switch or inside a diagnostic branch with non-error wording.
  UNGUARDED_LOGGING: { defaultOn: false, corpus: '2/2', heldOut: '1/10', measured: '2026-10-24' },
};

const DUMP_FUNCS = new Set(['var_dump', 'print_r', 'var_export', 'dd', 'dump', 'debug_print_backtrace', 'debug_zval_dump']);
const RETURN_MODE_FUNCS = new Set(['print_r', 'var_export']);
const ERRORISH_WORDS = new Set(['err', 'error', 'errors', 'fail', 'fails', 'failed', 'failure', 'exception', 'invalid', 'rejected', 'fault', 'denied']);
const OUTCOME_WORDS = new Set(['ok', 'valid', 'success', 'succeeded', 'successful']);
const ERROR_WORDING = /error|fail|exception|could not|cannot|not found|denied|invalid|dropped|detected|abort|no wordpress user/i;
const DEBUG_CONSTANT = /DEBUG/i;
const FUNCTION_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);
const CONDITIONAL_KINDS = new Set(['if', 'retif']);
const NAMED_KINDS = new Set(['variable', 'name', 'identifier']);
const LOOKUP_KINDS = new Set(['propertylookup', 'nullsafepropertylookup', 'staticlookup']);

const sourceText = (ctx, node) => ctx.content.slice(node.loc.start.offset, node.loc.end.offset);

const wordsOf = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$\\]+/).map((w) => w.toLowerCase()).filter(Boolean);

function collectNames(node, out = []) {
  const isObject = Boolean(node) && typeof node === 'object';
  if (!isObject) return out;
  const isNamed = NAMED_KINDS.has(node.kind) && typeof node.name === 'string';
  const isLookup = LOOKUP_KINDS.has(node.kind);
  if (isNamed) out.push(node.name);
  if (isLookup) out.push(typeof node.offset?.name === 'string' ? node.offset.name : '');
  const children = [node.what, node.left, node.right, node.expression, node.offset].filter((c) => c && typeof c === 'object' && c.kind);
  children.forEach((child) => collectNames(child, out));
  return out;
}

function isErrorishTest(test) {
  const names = collectNames(test);
  const negated = test.kind === 'unary' && test.type === '!';
  const mentionsError = names.some((name) => wordsOf(name).some((w) => ERRORISH_WORDS.has(w)));
  const negatesOutcome = negated && collectNames(test.what).some((name) => wordsOf(name).some((w) => OUTCOME_WORDS.has(w)));
  return mentionsError || negatesOutcome;
}

function isReturnMode(callNode, name) {
  const second = callNode.arguments[1];
  const mayReturn = RETURN_MODE_FUNCS.has(name);
  const isFalseLiteral = Boolean(second) && second.kind === 'boolean' && second.value === false;
  return mayReturn && Boolean(second) && !isFalseLiteral;
}

function earlyDebugReturn(ctx, scope, callNode) {
  const body = (scope.body && scope.body.children) || [];
  const returnsBefore = (stmt) => stmt.kind === 'if' && stmt.loc.end.offset < callNode.loc.start.offset;
  const hasReturn = (stmt) => {
    let found = false;
    walk(stmt.body, (n) => { found = found || n.kind === 'return'; });
    return found;
  };
  return body.some((stmt) => returnsBefore(stmt) && DEBUG_CONSTANT.test(sourceText(ctx, stmt.test)) && hasReturn(stmt));
}

/** { guarded, inCatch, inErrorBranch, scope } from the ancestors up to the enclosing function. */
function contextOf(ctx, callNode) {
  const context = { guarded: false, inCatch: false, inErrorBranch: false, scope: null };
  for (let current = callNode.parent; current; current = current.parent) {
    if (FUNCTION_KINDS.has(current.kind)) { context.scope = current; break; }
    const isConditional = CONDITIONAL_KINDS.has(current.kind) && Boolean(current.test);
    const isAndGuard = current.kind === 'bin' && current.type === '&&' && DEBUG_CONSTANT.test(sourceText(ctx, current.left));
    context.guarded = context.guarded || isAndGuard || (isConditional && DEBUG_CONSTANT.test(sourceText(ctx, current.test)));
    context.inErrorBranch = context.inErrorBranch || (isConditional && isErrorishTest(current.test));
    context.inCatch = context.inCatch || current.kind === 'catch';
  }
  return context;
}

function isQuietErrorLog(ctx, callNode) {
  const context = contextOf(ctx, callNode);
  const guardedEarly = context.scope && !context.guarded && earlyDebugReturn(ctx, context.scope, callNode);
  const callText = sourceText(ctx, callNode).replace(/^\s*\\?error_log\s*\(/, '');
  const worded = ERROR_WORDING.test(callText);
  return context.guarded || guardedEarly || context.inCatch || context.inErrorBranch || worded;
}

function classify(ctx, callNode) {
  const callee = callName(callNode);
  const isPlain = Boolean(callee) && callee.kind === 'function';
  const name = isPlain ? callee.name : '';
  const isDump = DUMP_FUNCS.has(name) && !isReturnMode(callNode, name);
  const isLoudLog = name === 'error_log' && !isQuietErrorLog(ctx, callNode);
  return isDump || isLoudLog ? name : null;
}

/** Pass entry. */
export function loggingPass(ctx) {
  walk(ctx.ast, (node) => {
    const name = node.kind === 'call' ? classify(ctx, node) : null;
    if (name) ctx.report('UNGUARDED_LOGGING', node, `Unguarded ${name}() call left in code`);
  });
}
