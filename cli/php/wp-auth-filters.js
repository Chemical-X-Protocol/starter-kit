// SECURITY_WP_AUTH_ERROR_CLEARED (task #6708): a callback registered on the rest_authentication_errors filter that
// returns null or true. WordPress reads null as "no auth error, anonymous" and true as "authenticated", so such a
// callback turns an authentication failure (for example rest_cookie_invalid_nonce, the CSRF check on cookie
// requests) into a request that proceeds. A shape match over one file: the callback is resolved from a closure, an
// arrow function, array( $this, 'name' ) / [ self::class, 'name' ] in the same class, or a function name string in
// the same file. A callback that calls a credential check (hash_equals, wp_check_password and the like) is treated
// as real authentication and skipped, and so is one that calls wp_set_current_user( 0 ), which answers as a guest. A callback in another file or class is not followed, and the rule does not
// prove which routes the callback affects.
import { walk, callName, literalString, nodeLine } from './php-walk.js';

const RULE = 'SECURITY_WP_AUTH_ERROR_CLEARED';
const HOOK = 'rest_authentication_errors';

// Weighted figures are in the task #6708 comment (corpus and held-out hits, each labelled by reading the callback).
export const RULE_DEFAULTS = {
  // Corpus (674 files, 2026-10-25): 6 hits, each a callback that returns null or true for a failed request, 6 TP. The
  // card vault callback in the corpus (HEAD) sets the current user to 0 first and is skipped. Held-out: card vault
  // a708d6a 1 hit (TP, the reported bypass), card vault ae81b02 0 hits (same callback, already skipped), and over
  // 15917 files under wp-content/plugins (vendor/ excluded) 1 hit outside the corpus (super-nerd-bros-dodo-air, TP) and
  // 0 hits in third-party plugins. The held-out figure rests on 2 hits, under the 10 the bar names, so the rule ships default-off until 10 held-out hits are labelled.
  [RULE]: { defaultOn: false, corpus: '6/6', heldOut: '2/2', measured: '2026-10-25' },
};

const CREDENTIAL_CALLS = new Set([
  'hash_equals', 'wp_check_password', 'password_verify', 'wp_validate_auth_cookie', 'wp_verify_nonce',
  'wp_authenticate', 'wp_authenticate_application_password', 'wp_validate_application_password',
  'wp_validate_logged_in_cookie', 'wp_validate_secure_auth_cookie', 'wp_signon', 'get_user_by',
  'current_user_can', 'is_user_logged_in', 'wp_get_current_user', 'get_current_user_id',
]);
const FUNCTION_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);
const SELF_NAMES = new Set(['self', 'static']);

const isKind = (node, kind) => Boolean(node) && node.kind === kind;
const nameOf = (node) => (node && typeof node.name === 'object' && node.name ? node.name.name : node && node.name);
const lower = (text) => String(text || '').toLowerCase();

/** True for literal null or true: the two return values that clear an authentication error. */
const isClearing = (expr) => isKind(expr, 'nullkeyword') || (isKind(expr, 'boolean') && expr.value === true);

const bodyRoots = (fn) => {
  const statements = fn.body && fn.body.children;
  return [fn.body].filter(Boolean).flatMap((body) => statements || [body]);
};

function ownNodes(fn) {
  const out = [];
  const visit = (node) => {
    out.push(node);
    return !FUNCTION_KINDS.has(node.kind);
  };
  for (const root of bodyRoots(fn)) walk(root, visit);
  return out;
}

/** True when the node sits in the body of an if ( ! is_wp_error( ... ) ) branch: the argument is not an error there, so nothing is cleared. */
const isGuardedByNonError = (node, fn) => {
  const chain = [];
  for (let cur = node; cur && cur !== fn; cur = cur.parent) chain.push(cur);
  return chain.some((cur) => {
    const owner = cur.parent;
    const test = owner && owner.kind === 'if' && owner.body === cur ? owner.test : null;
    const negated = isKind(test, 'unary') && test.type === '!' ? test.what : null;
    const callee = negated ? callName(negated) : null;
    return callee !== null && callee.kind === 'function' && lower(callee.name) === 'is_wp_error';
  });
};

/** The return (or arrow body) that clears the error, or null. */
const clearingNode = (nodes, fn) => {
  const arrowValue = [fn.body].filter((b) => isKind(fn, 'arrowfunc') && isClearing(b));
  const returned = nodes.filter((n) => isKind(n, 'return') && isClearing(n.expr) && !isGuardedByNonError(n, fn)).map((n) => n.expr);
  return [...arrowValue, ...returned][0] || null;
};

const callsCredentialCheck = (nodes) => nodes.some((n) => {
  const callee = callName(n);
  return callee !== null && callee.kind !== 'new' && CREDENTIAL_CALLS.has(lower(callee.name));
});

/** wp_set_current_user( 0 ): the callback answers as a guest, which is how a cleared nonce error is made safe. */
const resetsUser = (nodes) => nodes.some((n) => {
  const callee = callName(n);
  const isSetUser = callee !== null && callee.kind === 'function' && lower(callee.name) === 'wp_set_current_user';
  const first = isSetUser ? (n.arguments || [])[0] : null;
  return isKind(first, 'number') && Number(first.value) === 0;
});

function isSelfReceiver(node) {
  const isThis = isKind(node, 'variable') && node.name === 'this';
  const isSelfName = isKind(node, 'name') && SELF_NAMES.has(lower(node.name));
  const isRelative = isKind(node, 'selfreference') || isKind(node, 'staticreference');
  const isMagic = isKind(node, 'magic') && lower(node.value) === '__class__';
  const isSelfClass = isKind(node, 'staticlookup') && isSelfReceiver(node.what);
  return isThis || isSelfName || isRelative || isMagic || isSelfClass;
}

const isClassLike = (node) => isKind(node, 'class') || isKind(node, 'trait');

function enclosingClass(node) {
  const chain = [];
  for (let cursor = node.parent; cursor; cursor = cursor.parent) chain.push(cursor);
  return chain.find(isClassLike) || null;
}

const methodNamed = (cls, name) => ((cls && cls.body) || []).find((m) => isKind(m, 'method') && lower(nameOf(m)) === lower(name)) || null;

function functionNamed(ast, name) {
  let found = null;
  walk(ast, (n) => {
    const isMatch = isKind(n, 'function') && lower(nameOf(n)) === lower(name);
    found = isMatch ? n : found;
    return !isKind(n, 'class');
  });
  return found;
}

const arrayPair = (arg) => {
  const items = isKind(arg, 'array') ? arg.items : [];
  const isPair = items.length === 2 && items.every((item) => isKind(item, 'entry'));
  return isPair ? items : null;
};

/** The function node a callback argument resolves to in this file, or null. */
function resolveCallback(arg, call, ast) {
  const resolvers = [
    [isKind(arg, 'closure') || isKind(arg, 'arrowfunc'), () => arg],
    [literalString(arg) !== null, () => functionNamed(ast, literalString(arg))],
    [arrayPair(arg) !== null, () => resolvePair(arrayPair(arg), call)],
  ];
  const hit = resolvers.find(([applies]) => applies);
  return hit ? hit[1]() : null;
}

function resolvePair(items, call) {
  const method = literalString(items[1].value);
  const isOwn = method !== null && isSelfReceiver(items[0].value);
  return isOwn ? methodNamed(enclosingClass(call), method) : null;
}

const describeValue = (node) => (isKind(node, 'nullkeyword') ? 'null' : 'true');

function check(ctx, call) {
  const fn = resolveCallback((call.arguments || [])[1], call, ctx.ast);
  if (!fn) return;
  const nodes = ownNodes(fn);
  const clearing = clearingNode(nodes, fn);
  const isSafe = callsCredentialCheck(nodes) || resetsUser(nodes);
  const isCleared = clearing !== null && !isSafe;
  if (!isCleared) return;
  const hazard = `The ${HOOK} callback returns ${describeValue(clearing)} at line ${nodeLine(clearing)} without checking a credential, so a request that failed authentication (such as rest_cookie_invalid_nonce) goes on as anonymous or authenticated. Return the incoming error, or authenticate the request with a real credential check.`;
  ctx.report(RULE, nodeLine(call), hazard, { evidence: `add_filter( '${HOOK}' ) at line ${nodeLine(call)}; clearing return at line ${nodeLine(clearing)}` });
}

const isHookCall = (node) => {
  const callee = callName(node);
  const isAddFilter = callee !== null && callee.kind === 'function' && lower(callee.name) === 'add_filter';
  return isAddFilter && literalString((node.arguments || [])[0]) === HOOK;
};

/** Pass entry. One finding per add_filter( 'rest_authentication_errors', ... ) call whose resolved callback clears the error. */
export function wpAuthFiltersPass(ctx) {
  const isReady = Boolean(ctx.ast) && Boolean(ctx.wp) && ctx.wp.isWordPress === true;
  if (!isReady) return;
  walk(ctx.ast, (node) => {
    if (isHookCall(node)) check(ctx, node);
  });
}

/** The entry php-analyzer.js adds to the WordPress passes. */
export const wpAuthFiltersRegistration = { name: 'wp-auth-filters', rules: [RULE], isWordPress: true, run: wpAuthFiltersPass };
