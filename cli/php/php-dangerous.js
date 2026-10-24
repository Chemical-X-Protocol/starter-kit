// PHP dangerous-function rules (design spec 4): SECURITY_DYNAMIC_CODE_EXECUTION,
// SECURITY_PHP_OBJECT_INJECTION, SECURITY_PHP_COMMAND_EXECUTION. A pass is (ctx) => void and reports with
// ctx.report(rule, node, hazard). The request-taint guard is intra-function only (php-taint.js): a value
// that reaches a sink through another function is not seen. eval and the shell functions stay silent when
// their code or command is fixed text with no runtime part; anything built at runtime is reported, whether
// or not a request value is involved.
import { walk, scopeOf, callName, literalString } from './php-walk.js';
import { createScopeIndex, isRequestDerived } from './php-taint.js';

// Section 2.6 measurement (labels in the task comment of #6474). Corpus: the 11 raw hits, 2 real (one per
// id above; the 9 stored-meta maybe_unserialize calls are silent). Held-out: H2 plugins at PHP 8.3 after the
// fixed-text rule; card vault H1 (650b4aa) has 0 hits. Labels judge the construct, not exploitability.
export const RULE_DEFAULTS = {
  SECURITY_DYNAMIC_CODE_EXECUTION: { defaultOn: true, corpus: '1/1', heldOut: '11/11', measured: '2026-10-24' },
  SECURITY_PHP_OBJECT_INJECTION: { defaultOn: true, corpus: '1/1', heldOut: '7/8', measured: '2026-10-24' },
  SECURITY_PHP_COMMAND_EXECUTION: { defaultOn: true, corpus: '0/0', heldOut: '19/19', measured: '2026-10-24' },
};

const SHELL_FUNCTIONS = new Set(['shell_exec', 'exec', 'system', 'passthru', 'proc_open', 'popen', 'pcntl_exec']);
const CALLBACK_FUNCTIONS = new Set(['call_user_func', 'call_user_func_array']);
const REGEX_EVAL_MODIFIER = /^(.).*\1[a-zA-Z]*e[a-zA-Z]*$/s;
const STRING_ARGUMENT_KINDS = new Set(['string', 'encapsed']);

const HAZARDS = {
  eval: 'eval() runs a string as PHP. Replace it with a call to a named function or a data lookup (Directive 9.D).',
  create: 'create_function() evaluates code at runtime and is removed in PHP 8. Use a closure (Directive 9.D).',
  regexEval: 'preg_replace with the /e modifier evaluates the replacement as PHP and is removed in PHP 7. Use preg_replace_callback (Directive 9.D).',
  assert: 'assert() with a string argument evaluates it as PHP before PHP 8. Pass an expression, not a string (Directive 9.D).',
  unserialize: 'unserialize() without allowed_classes can instantiate any class. Pass [\'allowed_classes\' => false] or a class list (Directive 9.D).',
  derived: 'A request value reaches a function that unserializes, imports variables, picks a callback or includes a file. Validate it against a fixed list first (Directive 9.D).',
  shell: 'A shell command runs from PHP. Prefer a PHP API, and escape every argument with escapeshellarg (Directive 9.D).',
};

/** True for text with no runtime part: a plain string, a string with only literal parts, or a concatenation of those. */
const FIXED_TEXT_TESTS = {
  string: () => true,
  encapsed: (node) => (node.value || []).every((part) => isFixedText(part.expression)),
  bin: (node) => node.type === '.' && isFixedText(node.left) && isFixedText(node.right),
};

function isFixedText(node) {
  const test = node ? FIXED_TEXT_TESTS[node.kind] : null;
  return Boolean(test) && test(node);
}

function reportUnlessFixed(ctx, rule, node, text, hazard) {
  if (!isFixedText(text)) ctx.report(rule, node, hazard);
}

function phpMajor(ctx) {
  return Number.parseInt(String(ctx.phpTarget || '8.3').split('.')[0], 10);
}

function indexFor(cache, node) {
  const scope = scopeOf(node);
  if (!cache.has(scope)) cache.set(scope, createScopeIndex(scope));
  return cache.get(scope);
}

function requestDerived(cache, node, expr) {
  return isRequestDerived(expr, indexFor(cache, node));
}

function hasAllowedClasses(options) {
  const isArray = Boolean(options) && options.kind === 'array';
  if (!isArray) return Boolean(options);
  const keys = (options.items || []).map((item) => literalString(item && item.key));
  return keys.includes('allowed_classes');
}

function checkAssert(ctx, node) {
  const first = node.arguments[0];
  const belowEight = phpMajor(ctx) < 8;
  const isCodeString = Boolean(first) && STRING_ARGUMENT_KINDS.has(first.kind);
  const evaluatesString = belowEight && isCodeString;
  if (evaluatesString) ctx.report('SECURITY_DYNAMIC_CODE_EXECUTION', node, HAZARDS.assert);
}

function checkPregReplace(ctx, node) {
  const pattern = literalString(node.arguments[0]);
  const evaluates = pattern !== null && REGEX_EVAL_MODIFIER.test(pattern);
  if (evaluates) ctx.report('SECURITY_DYNAMIC_CODE_EXECUTION', node, HAZARDS.regexEval);
}

function checkUnserialize(ctx, node) {
  const restricted = hasAllowedClasses(node.arguments[1]);
  if (!restricted) ctx.report('SECURITY_PHP_OBJECT_INJECTION', node, HAZARDS.unserialize);
}

// Functions that are dangerous only when their first argument comes from the request.
function checkRequestArgument(ctx, node, cache) {
  const tainted = requestDerived(cache, node, node.arguments[0]);
  if (tainted) ctx.report('SECURITY_PHP_OBJECT_INJECTION', node, HAZARDS.derived);
}

const FUNCTION_CHECKS = {
  create_function: (ctx, node) => ctx.report('SECURITY_DYNAMIC_CODE_EXECUTION', node, HAZARDS.create),
  assert: checkAssert,
  preg_replace: checkPregReplace,
  unserialize: checkUnserialize,
  maybe_unserialize: checkRequestArgument,
  extract: checkRequestArgument,
};

function checkCall(ctx, node, cache) {
  const info = callName(node);
  const isFunction = Boolean(info) && info.kind === 'function';
  const name = isFunction ? info.name.toLowerCase() : '';
  const check = FUNCTION_CHECKS[name];
  if (SHELL_FUNCTIONS.has(name)) reportUnlessFixed(ctx, 'SECURITY_PHP_COMMAND_EXECUTION', node, node.arguments[0], HAZARDS.shell);
  if (CALLBACK_FUNCTIONS.has(name)) checkRequestArgument(ctx, node, cache);
  if (check) check(ctx, node, cache);
}

function checkInclude(ctx, node, cache) {
  const tainted = requestDerived(cache, node, node.target);
  if (tainted) ctx.report('SECURITY_PHP_OBJECT_INJECTION', node, HAZARDS.derived);
}

function checkBacktick(ctx, node) {
  const isShell = node.type === 'shell';
  if (isShell) reportUnlessFixed(ctx, 'SECURITY_PHP_COMMAND_EXECUTION', node, node, HAZARDS.shell);
}

const NODE_CHECKS = {
  call: checkCall,
  eval: (ctx, node) => reportUnlessFixed(ctx, 'SECURITY_DYNAMIC_CODE_EXECUTION', node, node.source, HAZARDS.eval),
  include: checkInclude,
  encapsed: checkBacktick,
};

export function runDangerousPass(ctx) {
  const cache = new Map();
  walk(ctx.ast, (node) => {
    const check = NODE_CHECKS[node.kind];
    if (check) check(ctx, node, cache);
  });
}
