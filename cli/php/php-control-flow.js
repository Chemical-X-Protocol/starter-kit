// PHP control-flow rules (design spec section 4): nested ternary, cascading guards and
// silent guards. Passes are (ctx) => void and report through ctx.report only. These are
// syntactic heuristics; the measured precision is recorded in RULE_DEFAULTS, and a hit is
// a prompt to look, not proof of a defect.
import { walk, callName } from './php-walk.js';

const FUNCTION_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);
const LOOKUP_KINDS = new Set(['propertylookup', 'nullsafepropertylookup', 'staticlookup']);
const GUARD_LIST_KINDS = new Set(['block', 'program']);
const METADATA_KEYS = new Set(['loc', 'parent', 'leadingComments', 'trailingComments']);
const MIN_CASCADE_GUARDS = 3;
const MODE_BRANCH_STATEMENTS = 3;

export const RULE_DEFAULTS = {
  CONTROL_FLOW_NESTED_TERNARY: { defaultOn: true, corpus: '12/12', heldOut: 'held up (spec 2.4)', measured: '2026-10-24' },
  CONTROL_FLOW_CASCADE_GUARDS: { defaultOn: false, corpus: '8/10', heldOut: '9/15', measured: '2026-10-24' },
  CONTROL_FLOW_SILENT_GUARD: { defaultOn: false, corpus: '1/1', heldOut: '5/7', measured: '2026-10-24' },
};

// ---------------------------------------------------------------- shared helpers

function isNodeLike(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.kind === 'string';
}

function nameOf(value) {
  const text = typeof value === 'string' ? value : value && value.name;
  return typeof text === 'string' ? text : '';
}

function statementsOf(body) {
  const isBlock = Boolean(body) && body.kind === 'block';
  const single = body ? [body] : [];
  return isBlock ? body.children : single;
}

function isThrowStatement(statement) {
  const isDirect = statement.kind === 'throw';
  const isWrapped = statement.kind === 'expressionstatement' && statement.expression.kind === 'throw';
  return isDirect || isWrapped;
}

function isBareReturn(statement) {
  return Boolean(statement) && statement.kind === 'return' && !statement.expr;
}

function nearestFunction(node) {
  let current = node.parent;
  while (current && !FUNCTION_KINDS.has(current.kind)) current = current.parent;
  return current || null;
}

function nearestNamedFunction(node) {
  let current = nearestFunction(node);
  while (current && !nameOf(current.name)) current = nearestFunction(current);
  return current || null;
}

function splitWords(identifier) {
  return String(identifier).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$\\]+/).map((word) => word.toLowerCase()).filter(Boolean);
}

function hasWord(identifier, vocabulary) {
  return splitWords(identifier).some((word) => vocabulary.has(word));
}

function childrenOf(node) {
  const entries = Object.entries(node).filter(([key]) => !METADATA_KEYS.has(key));
  return entries.flatMap(([, value]) => (Array.isArray(value) ? value : [value])).filter(isNodeLike);
}

function isTernary(node) {
  return isNodeLike(node) && node.kind === 'retif';
}

// ---------------------------------------------------------------- nested ternary

function ternaryChain(node) {
  const branches = [node.trueExpr, node.falseExpr].filter(isTernary);
  return [node, ...branches.flatMap(ternaryChain)];
}

function isBranchOfTernary(node) {
  const parent = node.parent;
  const isTernaryParent = Boolean(parent) && parent.kind === 'retif';
  return isTernaryParent && (parent.trueExpr === node || parent.falseExpr === node);
}

function hasNestedBranch(node) {
  return [node.trueExpr, node.falseExpr].some(isTernary);
}

function isPureElvisChain(node) {
  return ternaryChain(node).every((member) => member.trueExpr === null);
}

function isReportableTernary(node) {
  const isRoot = node.kind === 'retif' && !isBranchOfTernary(node);
  const isNested = isRoot && hasNestedBranch(node);
  return isNested && !isPureElvisChain(node);
}

export function nestedTernaryPass(ctx) {
  walk(ctx.ast, (node) => {
    const isReportable = isReportableTernary(node);
    if (!isReportable) return;
    ctx.report('CONTROL_FLOW_NESTED_TERNARY', node,
      'Nested ternary operator detected. Replace the chain with if/else, match, or a named helper.',
      { severity: 'MEDIUM' });
  });
}

// ---------------------------------------------------------------- cascade guards

function isGuardClause(statement) {
  const isPlainIf = statement.kind === 'if' && !statement.alternate;
  const last = statementsOf(statement.body).slice(-1)[0];
  const endsEarly = Boolean(last) && (isThrowStatement(last) || isBareReturn(last));
  return isPlainIf && endsEarly;
}

/** A branch with real work before its return is a mode switch, not a precondition. */
function isModeBranch(statement) {
  const body = statementsOf(statement.body);
  const isLong = body.length > MODE_BRANCH_STATEMENTS;
  return isLong && isBareReturn(body[body.length - 1]);
}

function isPlainAssignment(statement) {
  const expression = statement.kind === 'expressionstatement' ? statement.expression : null;
  return Boolean(expression) && expression.kind === 'assign' && expression.operator === '=';
}

function isFiller(statement) {
  const isBlankInline = statement.kind === 'inline' && !String(statement.value).trim();
  return statement.kind === 'noop' || isBlankInline;
}

function variableNames(node, found = new Set()) {
  const isVariable = isNodeLike(node) && node.kind === 'variable';
  if (isVariable) found.add(nameOf(node.name));
  if (isNodeLike(node)) childrenOf(node).forEach((child) => variableNames(child, found));
  return found;
}

/** `$x = load(); if (!$x) return;` : the guard only checks what the line before it loaded. */
function isLoadThenCheck(guard, previous) {
  const followsAssignment = Boolean(previous) && isPlainAssignment(previous);
  const loaded = followsAssignment ? variableNames(previous.expression.left) : new Set();
  const read = variableNames(guard.test);
  return followsAssignment && read.size > 0 && [...read].every((name) => loaded.has(name));
}

function classifyStatement(statement, previous) {
  const isGuard = isGuardClause(statement) && !isModeBranch(statement);
  const isLoadCheck = isGuard && isLoadThenCheck(statement, previous);
  if (isLoadCheck) return 'skip';
  if (isGuard) return 'guard';
  const isSkippable = isFiller(statement) || isPlainAssignment(statement);
  return isSkippable ? 'skip' : 'action';
}

function scanGuardList(ctx, list) {
  let run = [];
  const flush = (followedByAction) => {
    const isCascade = followedByAction && run.length >= MIN_CASCADE_GUARDS;
    if (isCascade) {
      ctx.report('CONTROL_FLOW_CASCADE_GUARDS', run[0],
        `Cascading guard clauses detected (${run.length} guards >= ${MIN_CASCADE_GUARDS}). Extract the checks into one named validator.`);
    }
    run = [];
  };
  const onGuard = (statement) => run.push(statement);
  const handlers = { skip: () => {}, guard: onGuard, action: () => flush(true) };
  list.forEach((statement, index) => handlers[classifyStatement(statement, list[index - 1])](statement));
  flush(false);
}

export function cascadeGuardsPass(ctx) {
  walk(ctx.ast, (node) => {
    const holdsStatements = GUARD_LIST_KINDS.has(node.kind) && Array.isArray(node.children);
    if (holdsStatements) scanGuardList(ctx, node.children);
  });
}

// ---------------------------------------------------------------- silent guard

const ERROR_WORDS = new Set(['err', 'error', 'errors', 'fail', 'fails', 'failed', 'failure', 'exception', 'invalid', 'rejected', 'fault', 'denied']);
const OUTCOME_WORDS = new Set(['ok', 'valid', 'success', 'succeeded', 'successful']);
const BENIGN_WORDS = new Set(['abort', 'signal', 'mounted', 'unmount', 'destroy', 'cleanup', 'timer', 'timeout', 'interval', 'debounce', 'throttle', 'callback', 'cb', 'handler']);
const MUTATION_NAME = /^(?:handle|on)(?:_|[A-Z])|^(?:save|update|delete|remove|create|add|insert|post|send|process|submit|dispatch|execute|mutate|checkout|charge|sync|write)/i;
const REPORTING_CALLS = new Set(['wp_send_json_error', 'wp_send_json', 'wp_send_json_success', 'wp_die', 'status_header', 'error_log', 'trigger_error', '_doing_it_wrong', 'add_settings_error', 'add_action', 'add_filter']);
const REPORTING_NAME = /log|warn|error|notice|report|redirect|respond|response|json|die|alert|notify/i;
const LOGGER_RECEIVERS = new Set(['console', 'logger', 'log']);
const HOOK_REGISTRARS = new Set(['add_action', 'add_filter']);
const NAME_KINDS = new Set(['variable', 'name', 'identifier']);
const WRAPPER_KINDS = new Set(['propertylookup', 'nullsafepropertylookup', 'staticlookup', 'offsetlookup', 'unary', 'cast', 'call']);
const SPEAKING_KINDS = new Set(['throw', 'echo', 'print', 'exit']);

/** Identifier names a test reads. String array keys are not identifiers and are never included. */
function testNames(node, out = []) {
  if (!isNodeLike(node)) return out;
  if (NAME_KINDS.has(node.kind)) out.push(nameOf(node.name));
  if (LOOKUP_KINDS.has(node.kind)) out.push(nameOf(node.offset));
  if (WRAPPER_KINDS.has(node.kind)) testNames(node.what, out);
  const isTwoSided = node.kind === 'bin' || node.kind === 'assign';
  if (isTwoSided) [node.left, node.right].forEach((side) => testNames(side, out));
  const isPresenceCheck = node.kind === 'isset' || node.kind === 'empty';
  if (isPresenceCheck) (node.variables || [node.expression]).forEach((item) => testNames(item, out));
  return out;
}

/** testNames plus call arguments, for the benign-name exemption. */
function allTestNames(node, out = []) {
  testNames(node, out);
  const isCall = isNodeLike(node) && node.kind === 'call';
  const isOperator = isNodeLike(node) && (node.kind === 'bin' || node.kind === 'unary');
  if (isCall) node.arguments.forEach((argument) => allTestNames(argument, out));
  if (isOperator) [node.left, node.right, node.what].forEach((side) => allTestNames(side, out));
  return out;
}

function isErrorishTest(test) {
  const isNegated = test.kind === 'unary' && test.type === '!';
  const negatesOutcome = isNegated && testNames(test.what).some((name) => hasWord(name, OUTCOME_WORDS));
  const mentionsError = testNames(test).some((name) => hasWord(name, ERROR_WORDS));
  return negatesOutcome || mentionsError;
}

function isBenignTest(test) {
  return allTestNames(test).some((name) => hasWord(name, BENIGN_WORDS));
}

function isReportingCall(call) {
  const callee = callName(call);
  const name = callee ? callee.name || '' : '';
  const isKnown = Boolean(callee) && callee.kind === 'function' && REPORTING_CALLS.has(name);
  const isLogger = Boolean(callee) && LOGGER_RECEIVERS.has(callee.receiver);
  return isKnown || isLogger || REPORTING_NAME.test(name);
}

/** `$this->errors[] = ...`, `$out['error'] = ...`: writing to an error-named target is reporting. */
function assignsErrorState(assign) {
  const names = [];
  const collect = (node) => {
    if (!isNodeLike(node)) return;
    const isString = node.kind === 'string';
    if (isString) names.push(String(node.value));
    testNames(node, names);
    const isIndexed = node.kind === 'offsetlookup';
    if (isIndexed) collect(node.offset);
  };
  collect(assign.left);
  return names.some((name) => hasWord(name, ERROR_WORDS));
}

function isDiagnostic(node) {
  const speaks = SPEAKING_KINDS.has(node.kind);
  const reports = node.kind === 'call' && isReportingCall(node);
  const recordsError = node.kind === 'assign' && assignsErrorState(node);
  return speaks || reports || recordsError;
}

function bodySpeaks(body) {
  let found = false;
  const visit = (node) => {
    const isScannable = !found && isNodeLike(node) && !FUNCTION_KINDS.has(node.kind);
    const speaks = isScannable && isDiagnostic(node);
    found = found || speaks;
    if (isScannable) childrenOf(node).forEach(visit);
  };
  statementsOf(body).forEach(visit);
  return found;
}

function hookedCallables(ast) {
  const hooked = { nodes: new Set(), names: new Set() };
  const remember = (item) => {
    if (FUNCTION_KINDS.has(item.kind)) hooked.nodes.add(item);
    const isName = item.kind === 'string';
    if (isName) hooked.names.add(item.value);
  };
  walk(ast, (node) => {
    const callee = node.kind === 'call' ? callName(node) : null;
    const isRegistrar = Boolean(callee) && callee.kind === 'function' && HOOK_REGISTRARS.has(callee.name);
    const arrays = isRegistrar ? node.arguments : [];
    arrays.forEach((argument) => {
      const items = argument.kind === 'array' ? argument.items.map((item) => item.value || item) : [argument];
      items.forEach(remember);
    });
  });
  return hooked;
}

/** True when the test reads is_wp_error($p) or $p->get_error_*() on a parameter WordPress passed in. */
function testsPassedInError(test, fn) {
  const params = new Set((fn.arguments || []).map((parameter) => nameOf(parameter.name)));
  let found = false;
  walk(test, (node) => {
    const callee = node.kind === 'call' ? callName(node) : null;
    const first = callee ? node.arguments[0] : null;
    const passesParam = Boolean(first) && first.kind === 'variable' && params.has(nameOf(first.name));
    const isWpErrorCall = Boolean(callee) && callee.kind === 'function' && callee.name === 'is_wp_error' && passesParam;
    const isErrorGetter = Boolean(callee) && callee.kind === 'method' && /^get_error_/.test(callee.name) && params.has(callee.receiver);
    found = found || isWpErrorCall || isErrorGetter;
  });
  return found;
}

function isHookCallbackNoOp(ifNode, hooked) {
  const fn = nearestFunction(ifNode);
  const isHooked = Boolean(fn) && (hooked.nodes.has(fn) || hooked.names.has(nameOf(fn.name)));
  return isHooked && testsPassedInError(ifNode.test, fn);
}

function isSilentCandidate(node) {
  const isPlainIf = node.kind === 'if' && !node.alternate;
  return isPlainIf && statementsOf(node.body).some(isBareReturn);
}

function isSilentAbort(node, named) {
  const isMutation = Boolean(named) && MUTATION_NAME.test(nameOf(named.name));
  return isMutation && isErrorishTest(node.test) && !isBenignTest(node.test) && !bodySpeaks(node.body);
}

export function silentGuardPass(ctx) {
  let hooked = null;
  walk(ctx.ast, (node) => {
    const named = isSilentCandidate(node) ? nearestNamedFunction(node) : null;
    const isAbort = Boolean(named) && isSilentAbort(node, named);
    hooked = isAbort && !hooked ? hookedCallables(ctx.ast) : hooked;
    const isExempt = isAbort && isHookCallbackNoOp(node, hooked);
    const isReportable = isAbort && !isExempt;
    if (!isReportable) return;
    ctx.report('CONTROL_FLOW_SILENT_GUARD', node,
      `Silent guard abort in ${nameOf(named.name)}: bare return swallows an error condition with no log, response or error state. Report it or return an error.`);
  });
}

/** The one entry the analyzer registers for this family. */
export function controlFlowPass(ctx) {
  nestedTernaryPass(ctx);
  cascadeGuardsPass(ctx);
  silentGuardPass(ctx);
}
