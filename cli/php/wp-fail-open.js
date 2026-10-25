// Detects a fail-open permission callable (task #6707): it ends in `return true;` and every denial (a return of
// anything but true, a throw, wp_die or exit) sits under an `if` that tests only that a credential was sent.
// So a request that sends no credential is allowed. A shape match over one function body: it does not prove the
// callable is reachable, and a denial inside a called helper is not seen.
import { walk } from './php-walk.js';

const DENIAL_CALLS = new Set(['wp_die', 'die', 'exit']);
const PRESENCE_CALLS = new Set(['strlen', 'mb_strlen', 'is_string']);
const PRESENCE_OPS = new Set(['!==', '!=', '>']);
const NESTED = new Set(['function', 'closure', 'arrowfunc', 'class']);

const isKind = (node, kind) => Boolean(node) && node.kind === kind;
const isTrue = (node) => isKind(node, 'boolean') && node.value === true;
const calleeName = (node) => (isKind(node, 'call') && isKind(node.what, 'name') ? String(node.what.name).toLowerCase() : '');

function isDenial(node) {
  const isReturn = isKind(node, 'return') && !isTrue(node.expr);
  const isThrow = isKind(node, 'throw') || isKind(node, 'exit');
  return isReturn || isThrow || DENIAL_CALLS.has(calleeName(node));
}

const isExplicit = (node) => isDenial(node) && !(isKind(node, 'return') && isKind(node.expr, 'variable'));

/** A test that is true when something was sent: $k, isset($k), !empty($k), strlen($k), $k !== '', and any && with one. */
function isPresence(test) {
  const inner = isKind(test, 'parenthesis') ? test.inner : test;
  const isNotEmpty = isKind(inner, 'unary') && inner.type === '!' && isKind(inner.what, 'empty');
  const isCompare = isKind(inner, 'bin') && PRESENCE_OPS.has(inner.type);
  const isAnd = isKind(inner, 'bin') && (inner.type === '&&' || inner.type === 'and');
  const byRule = [
    [isKind(inner, 'variable') || isKind(inner, 'isset') || isNotEmpty || isCompare, () => true],
    [PRESENCE_CALLS.has(calleeName(inner)), () => true],
    [isAnd, () => isPresence(inner.left) || isPresence(inner.right)],
  ];
  const hit = byRule.find(([applies]) => applies);
  return hit ? hit[1]() : false;
}

/** Denials inside a presence-if body (guarded) and everywhere else in the body (open). */
function countDenials(body) {
  const counts = { guarded: 0, open: 0 };
  const visit = (node) => {
    if (NESTED.has(node.kind)) return false;
    const isGuard = isKind(node, 'if') && isPresence(node.test);
    if (isGuard) {
      walk(node.body, (n) => {
        if (isExplicit(n)) counts.guarded += 1;
      });
      if (node.alternate) walk(node.alternate, visit);
      return false;
    }
    if (isDenial(node)) counts.open += 1;
    return true;
  };
  walk(body, visit);
  return counts;
}

/** True when the function or method ends in `return true;` and its only denials sit under a credential-present branch. */
export function isFailOpen(fn) {
  const isFunction = Boolean(fn) && (fn.kind === 'function' || fn.kind === 'method');
  const statements = isFunction && fn.body ? fn.body.children || [] : [];
  const last = statements[statements.length - 1];
  const endsTrue = isKind(last, 'return') && isTrue(last.expr);
  if (!endsTrue) return false;
  const counts = countDenials(fn.body);
  return counts.guarded > 0 && counts.open === 0;
}
