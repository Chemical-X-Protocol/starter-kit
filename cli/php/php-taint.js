// Request taint for PHP passes (design spec 3.3, 4). Shared and read-only for the sink rule families.
//
// Guarantees: a value is "request-derived" when a request source reaches it through assignments,
// concatenation, casts to string/array, array literals, foreach, destructuring and unknown calls whose
// arguments are derived, in the SAME function scope. Not covered: cross-function flow, loop-carried flow,
// properties, references, and sanitizers this file does not list. Callers need linkParents(ast) first;
// without parent links every assignment is treated as conditional (more taint, never less).
import { walkScope, callName, literalString } from './php-walk.js';

export const SUPERGLOBAL_SOURCES = {
  globals: new Set(['_GET', '_POST', '_REQUEST', '_COOKIE']),
  serverKeys: /^(HTTP_|REQUEST_URI$|QUERY_STRING$|PHP_SELF$)/,
};
export const REQUEST_OBJECT_SOURCES = {
  variables: new Set(['request', 'req']),
  methods: new Set(['get_param', 'get_params', 'get_json_params', 'get_body_params', 'get_query_params', 'get_file_params', 'get_header', 'get_body']),
  functions: new Set(['get_query_var', 'filter_input']),
};
export const superglobalSources = SUPERGLOBAL_SOURCES;
export const requestObjectSources = REQUEST_OBJECT_SOURCES;

export const SANITIZER_PATTERN = /^(intval|absint|floatval|doubleval|boolval|abs|round|floor|ceil|array_sum|sanitize_\w+|esc_\w+|wp_kses\w*|count|sizeof|strlen|md5|sha1|crc32|hash|wp_hash|filter_var|is_\w+|ctype_\w+|in_array|array_key_exists|preg_match|preg_match_all|hash_equals|password_verify|wp_check_password|wp_verify_nonce|check_admin_referer|check_ajax_referer|wp_validate_redirect|wp_http_validate_url|rest_sanitize_boolean|wp_parse_id_list|number_format|date|gmdate|strtotime)$/;
// APIs whose results are ids, objects, stored data or remote responses: taint stops there.
export const TAINT_STOP_PATTERN = /^(wp_insert_\w+|wp_update_\w+|wp_create_user|get_user_by|get_userdata|get_post|get_posts|get_term|get_term_by|get_current_user_id|wp_get_current_user|get_option|get_site_option|get_transient|get_(post|user|term|comment)_meta|wp_remote_\w+|wp_safe_remote_\w+)$/;

// Opt-in source 'payload': a parameter named like a hook or webhook payload. The caller (a hook, a bridge,
// a REST route) is not visible here, so this is a name heuristic that only applies where a rule asks for it.
const PAYLOAD_PARAMS = new Set(['payload']);
const VALIDATORS = new Set(['wp_http_validate_url', 'wp_validate_redirect']);
const HOST_SAFE = /^(home_url|admin_url|site_url|get_permalink|get_home_url|get_site_url|get_admin_url|network_\w+_url|rest_url|get_rest_url|plugins_url|content_url|includes_url|wp_login_url|get_term_link|get_author_posts_url)$/;
const HOST_PASS = /^(esc_url_raw|esc_url|trim|ltrim|rtrim|urldecode|rawurldecode|sanitize_text_field|sanitize_url|wp_unslash|stripslashes|strval|html_entity_decode|htmlspecialchars_decode|wp_specialchars_decode|strtolower|untrailingslashit|trailingslashit|wp_sanitize_redirect|set_url_scheme)$/;
const OPEN_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?\/\/$/i;
const CONDITIONAL_KINDS = new Set(['if', 'switch', 'case', 'for', 'foreach', 'while', 'do', 'try', 'catch', 'finally', 'retif', 'bin', 'match', 'matcharm', 'closure', 'arrowfunc']);
const APPEND_OPERATORS = new Set(['.=', '+=', '??=']);
const PROPAGATING_BINARY = new Set(['.', '+', '??']);
const PASS_CASTS = new Set(['string', 'array', 'object']);
const DESTRUCTURE_KINDS = new Set(['list', 'array']);
const BY_REF_OUTPUT = { preg_match: { out: 2, from: 1 }, preg_match_all: { out: 2, from: 1 }, parse_str: { out: 1, from: 0 } };

function isNodeLike(value) {
  return Boolean(value) && typeof value === 'object';
}

function varName(node) {
  const isVar = isNodeLike(node) && node.kind === 'variable' && typeof node.name === 'string';
  return isVar ? node.name : null;
}

function serverSource(node, base) {
  const key = literalString(node.offset);
  const isServerRead = base === '_SERVER' && key !== null;
  return isServerRead && SUPERGLOBAL_SOURCES.serverKeys.test(key);
}

export function isSuperglobalSource(node) {
  if (!isNodeLike(node)) return false;
  const bare = varName(node);
  if (bare) return SUPERGLOBAL_SOURCES.globals.has(bare);
  const isLookup = node.kind === 'offsetlookup';
  const base = isLookup ? varName(node.what) : null;
  const isGlobalRead = isLookup && SUPERGLOBAL_SOURCES.globals.has(base);
  return isGlobalRead || (isLookup && serverSource(node, base));
}

function isRequestCall(node) {
  const info = callName(node);
  if (!info) return false;
  const name = String(info.name).toLowerCase();
  const isMethod = info.kind === 'method';
  const isFunction = info.kind === 'function';
  const readsInput = isFunction && name === 'file_get_contents' && literalString(node.arguments[0]) === 'php://input';
  const isMethodSource = isMethod && REQUEST_OBJECT_SOURCES.methods.has(name);
  const isFunctionSource = isFunction && REQUEST_OBJECT_SOURCES.functions.has(name);
  return readsInput || isMethodSource || isFunctionSource;
}

export function isRequestObjectSource(node) {
  if (!isNodeLike(node)) return false;
  const isCall = node.kind === 'call';
  if (isCall) return isRequestCall(node);
  const base = varName(node.what);
  const isRequestVar = base !== null && REQUEST_OBJECT_SOURCES.variables.has(base);
  return node.kind === 'offsetlookup' && isRequestVar;
}

// ---- scope index -------------------------------------------------------------------------

function isUnconditional(node, scope) {
  let current = node.parent;
  while (current && current !== scope) {
    const isBranch = CONDITIONAL_KINDS.has(current.kind);
    if (isBranch) return false;
    current = current.parent;
  }
  return current === scope;
}

function addDef(idx, name, def) {
  if (!idx.defs.has(name)) idx.defs.set(name, []);
  idx.defs.get(name).push(def);
}

function leafVariables(target) {
  if (!isNodeLike(target)) return [];
  const bare = varName(target);
  if (bare) return [target];
  const isDestructure = DESTRUCTURE_KINDS.has(target.kind);
  const items = isDestructure ? target.items || [] : [];
  return items.flatMap((item) => leafVariables(item && item.kind === 'entry' ? item.value : item));
}

function baseVariable(target) {
  let current = target;
  while (isNodeLike(current) && current.kind === 'offsetlookup') current = current.what;
  return varName(current);
}

function plainDef(node, expr, kind, scope) {
  return { pos: node.loc.end.offset, plain: true, expr, kind, unconditional: isUnconditional(node, scope) };
}

function appendDef(node, expr) {
  return { pos: node.loc.end.offset, plain: false, expr, kind: 'append', unconditional: false };
}

function collectAssign(idx, node) {
  if (!node.loc) return;
  const { left, right, operator } = node;
  const direct = varName(left);
  const isPlain = operator === '=';
  const isAppend = APPEND_OPERATORS.has(operator);
  const base = baseVariable(left);
  const isElementWrite = base !== null && left.kind === 'offsetlookup';
  const plainTarget = direct !== null && isPlain;
  const appendTarget = direct !== null && isAppend;
  if (plainTarget) return addDef(idx, direct, plainDef(node, right, 'assign', idx.scope));
  if (appendTarget) return addDef(idx, direct, appendDef(node, right));
  if (isElementWrite) return addDef(idx, base, appendDef(node, right));
  const leaves = isPlain ? leafVariables(left) : [];
  for (const leaf of leaves) addDef(idx, leaf.name, plainDef(node, right, 'destructure', idx.scope));
}

function collectForeach(idx, node) {
  const source = node.source;
  const hasSource = isNodeLike(source) && Boolean(source.loc);
  if (!hasSource) return;
  const pos = source.loc.end.offset;
  const targets = [...leafVariables(node.value), ...leafVariables(node.key)];
  for (const leaf of targets) addDef(idx, leaf.name, { pos, plain: true, expr: source, kind: 'foreach', unconditional: false });
}

function collectByRefOutput(idx, node, name) {
  const shape = BY_REF_OUTPUT[name];
  const out = shape ? varName(node.arguments[shape.out]) : null;
  if (out) addDef(idx, out, appendDef(node, node.arguments[shape.from]));
}

function collectCall(idx, node) {
  const info = callName(node);
  const isPlainCall = Boolean(info) && info.kind === 'function' && Boolean(node.loc);
  if (!isPlainCall) return;
  const name = info.name.toLowerCase();
  const checked = VALIDATORS.has(name) ? varName(node.arguments[0]) : null;
  if (checked) {
    if (!idx.validations.has(checked)) idx.validations.set(checked, []);
    idx.validations.get(checked).push(node.loc.end.offset);
  }
  collectByRefOutput(idx, node, name);
}

const COLLECTORS = { assign: collectAssign, foreach: collectForeach, call: collectCall };

function parameterName(param) {
  const raw = isNodeLike(param.name) ? param.name.name : param.name;
  return typeof raw === 'string' ? raw : null;
}

function addParameters(idx, scope) {
  const fromParams = (scope.arguments || []).map(parameterName);
  const fromUses = (scope.uses || []).map(varName);
  for (const name of [...fromParams, ...fromUses].filter(Boolean)) {
    addDef(idx, name, { pos: -1, plain: true, expr: null, kind: 'param', unconditional: true });
  }
}

/** One pass over the scope's own body. Nested functions and classes get their own index. */
export function createScopeIndex(scope) {
  const idx = { scope, defs: new Map(), validations: new Map(), caches: new Map() };
  addParameters(idx, scope);
  walkScope(scope, (node) => {
    const collect = COLLECTORS[node.kind];
    if (collect) collect(idx, node);
  });
  for (const list of idx.defs.values()) list.sort((a, b) => a.pos - b.pos);
  return idx;
}

function lastIndexWhere(list, test) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const matches = test(list[i]);
    if (matches) return i;
  }
  return -1;
}

/** Definitions of `name` that can reach `pos`. 'union' keeps every branch after the last unconditional overwrite; 'last' keeps the last plain one. */
function reachingDefs(idx, name, pos, mode) {
  const before = (idx.defs.get(name) || []).filter((def) => def.pos < pos);
  const killer = mode === 'last' ? (def) => def.plain : (def) => def.plain && def.unconditional;
  const start = Math.max(lastIndexWhere(before, killer), 0);
  return before.slice(start);
}

// ---- value taint -------------------------------------------------------------------------

function makeEval(idx, opts, host) {
  const list = opts.sources === undefined ? ['superglobal', 'request'] : [].concat(opts.sources);
  const mode = opts.mode === 'last' ? 'last' : 'union';
  const key = `${host ? 'host' : 'value'}|${mode}|${[...list].sort().join(',')}`;
  if (!idx.caches.has(key)) idx.caches.set(key, new Map());
  return { idx, mode, superglobal: list.includes('superglobal'), request: list.includes('request'), payload: list.includes('payload'), cache: idx.caches.get(key) };
}

function isSourceNode(node, ev) {
  const superglobal = ev.superglobal && isSuperglobalSource(node);
  return superglobal || (ev.request && isRequestObjectSource(node));
}

function posOf(node) {
  return node.loc ? node.loc.start.offset : Number.POSITIVE_INFINITY;
}

function memoDef(def, ev, compute) {
  if (!def.expr) return false;
  if (ev.cache.has(def)) return ev.cache.get(def);
  ev.cache.set(def, false);
  const result = compute(def.expr);
  ev.cache.set(def, result);
  return result;
}

function variableTaint(node, ev) {
  const name = varName(node);
  if (!name) return false;
  const defs = reachingDefs(ev.idx, name, posOf(node), ev.mode);
  const isPayload = ev.payload && PAYLOAD_PARAMS.has(name) && defs.some((def) => def.kind === 'param');
  return isPayload || defs.some((def) => memoDef(def, ev, (expr) => derived(expr, ev)));
}

function isWpdbReceiver(inner) {
  if (!isNodeLike(inner)) return false;
  const direct = varName(inner);
  if (direct) return direct === 'wpdb';
  const isProperty = inner.kind === 'propertylookup' && isNodeLike(inner.offset);
  const prop = isProperty ? inner.offset.name : null;
  return prop === 'wpdb' || prop === 'db';
}

function anyDerived(nodes, ev) {
  return (nodes || []).some((node) => derived(node, ev));
}

function sanitizingMap(node) {
  const callback = literalString(node.arguments[0]);
  return callback !== null && SANITIZER_PATTERN.test(callback.toLowerCase());
}

function functionCallTaint(name, node, ev) {
  const stops = SANITIZER_PATTERN.test(name) || TAINT_STOP_PATTERN.test(name);
  const cleanMap = name === 'array_map' && sanitizingMap(node);
  return !stops && !cleanMap && anyDerived(node.arguments, ev);
}

function methodCallTaint(info, node, ev) {
  const isPrepare = info.name.toLowerCase() === 'prepare';
  const readsDatabase = isWpdbReceiver(node.what.what);
  const flows = derived(node.what.what, ev) || anyDerived(node.arguments, ev);
  return !isPrepare && !readsDatabase && flows;
}

const CALL_HANDLERS = {
  function: (info, node, ev) => functionCallTaint(info.name.toLowerCase(), node, ev),
  method: methodCallTaint,
};

function callTaint(node, ev) {
  const info = callName(node);
  const handler = info ? CALL_HANDLERS[info.kind] : null;
  return handler ? handler(info, node, ev) : anyDerived(node.arguments, ev);
}

function binaryTaint(node, ev) {
  const propagates = PROPAGATING_BINARY.has(node.type);
  return propagates && (derived(node.left, ev) || derived(node.right, ev));
}

function castTaint(node, ev) {
  return PASS_CASTS.has(node.type) && derived(node.expr, ev);
}

function encapsedTaint(node, ev) {
  return (node.value || []).some((part) => derived(part.expression, ev));
}

function arrayTaint(node, ev) {
  return (node.items || []).some((item) => derived(item && item.kind === 'entry' ? item.value : item, ev));
}

function ternaryTaint(node, ev) {
  const whenTrue = node.trueExpr || node.test;
  return derived(whenTrue, ev) || derived(node.falseExpr, ev);
}

function matchTaint(node, ev) {
  return (node.arms || []).some((arm) => derived(arm.body, ev));
}

const VALUE_HANDLERS = {
  variable: variableTaint,
  offsetlookup: (node, ev) => derived(node.what, ev),
  propertylookup: (node, ev) => derived(node.what, ev),
  nullsafepropertylookup: (node, ev) => derived(node.what, ev),
  call: callTaint,
  bin: binaryTaint,
  cast: castTaint,
  silent: (node, ev) => derived(node.expr, ev),
  clone: (node, ev) => derived(node.what, ev),
  retif: ternaryTaint,
  encapsed: encapsedTaint,
  array: arrayTaint,
  assign: (node, ev) => derived(node.right, ev),
  match: matchTaint,
};

function derived(node, ev) {
  if (!isNodeLike(node)) return false;
  if (isSourceNode(node, ev)) return true;
  const handler = VALUE_HANDLERS[node.kind];
  return handler ? handler(node, ev) : false;
}

/** opts: { sources: ['superglobal','request'] (default both), mode: 'union' (default) | 'last' }. */
export function isRequestDerived(expr, idx, opts = {}) {
  return derived(expr, makeEval(idx, opts, false));
}

// ---- URL host taint ----------------------------------------------------------------------

function concatParts(node) {
  const isConcat = node.kind === 'bin' && node.type === '.';
  return isConcat ? [...concatParts(node.left), ...concatParts(node.right)] : [node];
}

function hostConcat(parts, ev) {
  let prefix = '';
  for (const part of parts) {
    const text = literalString(part);
    const isLiteral = text !== null;
    if (isLiteral) {
      prefix += text;
      continue;
    }
    const open = prefix === '' || OPEN_AUTHORITY.test(prefix);
    return open && host(part, ev);
  }
  return false;
}

function validatedBetween(idx, name, from, to) {
  return (idx.validations.get(name) || []).some((at) => at > from && at < to);
}

function hostVariable(node, ev) {
  const name = varName(node);
  if (!name) return false;
  const pos = posOf(node);
  const reaching = reachingDefs(ev.idx, name, pos, ev.mode);
  const plain = reaching.filter((def) => def.plain);
  const candidates = plain.length > 0 ? plain : reaching;
  const live = candidates.filter((def) => !validatedBetween(ev.idx, name, def.pos, pos));
  return live.some((def) => memoDef(def, ev, (expr) => host(expr, ev)));
}

function addQueryArgBase(node) {
  const first = node.arguments[0];
  const paramsForm = isNodeLike(first) && first.kind === 'array';
  return paramsForm ? node.arguments[1] : node.arguments[2];
}

function hostCall(node, ev) {
  const info = callName(node);
  const isFunction = Boolean(info) && info.kind === 'function';
  const name = isFunction ? info.name.toLowerCase() : '';
  if (!isFunction) return derived(node, ev);
  const isSafe = HOST_SAFE.test(name) || VALIDATORS.has(name);
  const isQueryArg = name === 'add_query_arg';
  const passes = HOST_PASS.test(name);
  if (isSafe) return false;
  if (isQueryArg) return host(addQueryArgBase(node), ev);
  return passes ? host(node.arguments[0], ev) : derived(node, ev);
}

function hostCast(node, ev) {
  return node.type === 'string' ? host(node.expr, ev) : derived(node, ev);
}

function hostBinary(node, ev) {
  const isConcat = node.type === '.';
  const isCoalesce = node.type === '??';
  if (isConcat) return hostConcat(concatParts(node), ev);
  return isCoalesce ? host(node.left, ev) || host(node.right, ev) : derived(node, ev);
}

function hostEncapsed(node, ev) {
  const interpolated = node.type === 'string' || node.type === 'heredoc';
  return interpolated ? hostConcat((node.value || []).map((part) => part.expression), ev) : false;
}

function hostTernary(node, ev) {
  return host(node.trueExpr || node.test, ev) || host(node.falseExpr, ev);
}

const HOST_HANDLERS = {
  variable: hostVariable,
  call: hostCall,
  cast: hostCast,
  bin: hostBinary,
  encapsed: hostEncapsed,
  retif: hostTernary,
  silent: (node, ev) => host(node.expr, ev),
  assign: (node, ev) => host(node.right, ev),
};

function host(node, ev) {
  if (!isNodeLike(node)) return false;
  const handler = HOST_HANDLERS[node.kind];
  return handler ? handler(node, ev) : derived(node, ev);
}

/**
 * True when the scheme and host of the URL in `expr` can be chosen by the request: the left side of a
 * concatenation, the first interpolated part, the add_query_arg base. A request value appended after
 * literal text that already fixes the host (a path or query) is not host taint.
 */
export function hostTaint(expr, idx, opts = {}) {
  return host(expr, makeEval(idx, opts, true));
}
