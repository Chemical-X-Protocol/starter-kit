// Safe-value classifier for SECURITY_WP_UNPREPARED_SQL (design spec 4). reasons(expr) returns why a value
// placed in SQL text is not known to be safe ([] means no reason was found). Guarantees: it follows
// assignments, helper-method returns, array elements by key or position, class properties and call sites
// inside the project index. Not guaranteed: a value judged safe is safe (class properties can be written from
// outside the class, and private or static parameters are judged by the call sites the index can see).
import { walk, walkScope, scopeOf, literalString, callName } from './php-walk.js';
import { createScopeIndex } from './php-taint.js';
import {
  textOf, functionOf, isWpdbCall, isPrepareCall, enclosingClass, classNameOf, findMethod, findClassNamed, isAllowlisted,
} from './wp-sql-lookup.js';
import {
  ROOT_ENV, startOf, nameOfParam, nameOfMethod, rootOf, link, propertyReasons, staticReasons, siteReasons,
} from './wp-sql-members.js';

const MAX_DEPTH = 40;
const ANY = null;
const APPEND = Symbol('append');
const SUPERGLOBAL = /^_(GET|POST|REQUEST|COOKIE|SERVER|FILES)$/;
const SAFE_FUNCTIONS = /^(esc_sql|absint|intval|floatval|boolval|count|time|current_time|wp_date|gmdate|date|sizeof|max|min|array_sum|get_current_user_id|get_the_id|get_queried_object_id|str_repeat|array_fill|wp_parse_id_list|array_key_last|array_key_first)$/;
const CLEAN_CALLBACKS = new Set(['absint', 'intval', 'esc_sql', 'floatval']);
const PASS_THROUGH = new Set(['array_filter', 'array_unique', 'array_values', 'array_merge', 'array_slice', 'array_reverse']);
const NUMERIC_CASTS = new Set(['int', 'integer', 'float', 'double', 'bool', 'boolean']);
const SAFE_BINARY = new Set(['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '===', '!=', '!==', '&&', '||', 'and', 'or']);
const FUNCTION_LITERALS = new Set(['closure', 'arrowfunc']);
const WPDB_SAFE_METHODS = new Set(['prepare', 'get_charset_collate', 'get_blog_prefix', '_escape', '_real_escape', 'get_results', 'get_row', 'get_var', 'get_col', 'query']);

function indexOf(scope, st) {
  if (!st.indexes.has(scope)) st.indexes.set(scope, createScopeIndex(scope));
  return st.indexes.get(scope);
}

/** Definitions of `name` that can reach `pos`: the last plain assignment (or loop binding) and every append after it. */
function reaching(idx, name, pos) {
  const before = (idx.defs.get(name) || []).filter((def) => def.pos < pos);
  let start = 0;
  before.forEach((def, i) => {
    start = def.plain ? i : start;
  });
  return before.slice(start);
}

function reachingFor(node, st) {
  let scope = scopeOf(node);
  while (scope) {
    const defs = reaching(indexOf(scope, st), node.name, startOf(node));
    const climbs = defs.length === 0 && scope.kind === 'arrowfunc';
    if (!climbs) return { scope, defs };
    scope = scopeOf(scope);
  }
  return { scope: null, defs: [] };
}

// ---- helper methods -----------------------------------------------------------------------

function qualified(cls, name) {
  const parent = cls && cls.parent;
  const ns = parent && parent.kind === 'namespace' && parent.name ? String(parent.name.name || parent.name) : '';
  return ns ? `${ns}\\${name}` : name;
}

function methodFromIndex(clsNode, clsName, method, st) {
  const index = st.ctx.index;
  if (!index) return null;
  const hit = [clsName, qualified(clsNode, clsName)].map((c) => index.resolveCallable(`${c}::${method}`)).find(Boolean);
  const ast = hit ? link(st, index.loadAst(hit.file)) : null;
  let found = null;
  walk(ast, (n) => {
    const isMatch = n.kind === 'method' && n.loc.start.line === hit.line && nameOfMethod(n).toLowerCase() === method.toLowerCase();
    found = isMatch ? n : found;
    return !found;
  });
  return found;
}

function helperDecl(call, info, st) {
  const cls = enclosingClass(call);
  const target = info.kind === 'method' ? null : info.receiver;
  const isOwn = info.kind === 'method' || (typeof target === 'string' && ['self', 'static', classNameOf(cls)].includes(target));
  const holder = isOwn ? cls : findClassNamed(rootOf(call), target);
  const local = holder ? findMethod(holder, info.name) : null;
  const clsName = isOwn ? classNameOf(cls) : String(target).replace(/^\\/, '');
  return local || (clsName ? methodFromIndex(holder || cls, clsName, info.name, st) : null);
}

function returnsOf(decl, st) {
  if (!st.returns.has(decl)) {
    const found = [];
    walkScope(decl, (n) => {
      const isValueReturn = n.kind === 'return' && Boolean(n.expr);
      if (isValueReturn) found.push(n.expr);
    });
    st.returns.set(decl, found);
  }
  return st.returns.get(decl);
}

function bindingOf(decl, call, env) {
  const bind = new Map();
  decl.arguments.forEach((param, i) => bind.set(nameOfParam(param), { node: call.arguments[i], env }));
  return bind;
}

/** Reasons for `path` into the helper's returns (an empty path is the whole returned value), with call-site arguments bound. */
function helperReasons(call, decl, path, env, st) {
  if (st.busy.has(decl)) return [];
  st.busy.add(decl);
  const inner = { depth: env.depth, bind: bindingOf(decl, call, env), bindScope: decl };
  const why = returnsOf(decl, st).flatMap((expr) => elementReasons(expr, path, inner, st));
  st.busy.delete(decl);
  return why.length > 0 ? [`helper:${nameOfMethod(decl)}>${why[0]}`] : [];
}

function helperOfCall(call, st) {
  const info = callName(call);
  const isHelper = Boolean(info) && (info.kind === 'method' || info.kind === 'static') && typeof info.name === 'string';
  const isOwnReceiver = isHelper && (info.kind === 'static' || info.receiver === 'this');
  return isOwnReceiver ? helperDecl(call, info, st) : null;
}

// ---- array elements -----------------------------------------------------------------------

function keyOf(offset) {
  if (!offset) return APPEND;
  const isLiteral = (offset.kind === 'string' || offset.kind === 'number') && offset.value !== undefined;
  return isLiteral ? String(offset.value) : ANY;
}

function keyMatches(entryKey, query) {
  const isWild = query === ANY || entryKey === ANY;
  if (isWild) return true;
  return entryKey === APPEND ? /^\d+$/.test(query) : entryKey === query;
}

function elementOfArray(arr, path, env, st) {
  const [head, ...rest] = path;
  const items = arr.items.filter(Boolean);
  const hasSpread = items.some((item) => item.unpack);
  if (hasSpread) return classify(arr, env, st);
  let position = 0;
  const entries = items.map((item) => ({ key: item.key ? keyOf(item.key) : String(position++), value: item.value || item }));
  return entries.filter((entry) => keyMatches(entry.key, head)).flatMap((entry) => elementReasons(entry.value, rest, env, st));
}

function elementOfCall(call, path, env, st) {
  const decl = helperOfCall(call, st);
  return decl ? helperReasons(call, decl, path, env, st) : classify(call, env, st);
}

function elementOfTernary(e, path, env, st) {
  const branches = [e.trueExpr || e.test, e.falseExpr];
  return branches.flatMap((branch) => elementReasons(branch, path, env, st));
}

function appendReasons(def, path, env, st) {
  const assign = def.expr.parent;
  const left = assign && assign.kind === 'assign' ? assign.left : null;
  const isElementWrite = Boolean(left) && left.kind === 'offsetlookup' && assign.operator === '=';
  const isWhole = path.length === 0 || !isElementWrite;
  if (isWhole) return classify(def.expr, env, st);
  const [head, ...rest] = path;
  return keyMatches(keyOf(left.offset), head) ? elementReasons(def.expr, rest, env, st) : [];
}

function listPosition(list, name) {
  const items = list.items || [];
  const index = items.findIndex((item) => item && item.value && item.value.kind === 'variable' && item.value.name === name);
  const entry = index >= 0 ? items[index] : null;
  if (!entry) return null;
  return entry.key ? keyOf(entry.key) : String(index);
}

function destructureReasons(def, name, path, env, st) {
  const assign = def.expr.parent;
  const left = assign && assign.kind === 'assign' ? assign.left : null;
  const position = left ? listPosition(left, name) : null;
  return position === null ? classify(def.expr, env, st) : elementReasons(def.expr, [position, ...path], env, st);
}

function foreachReasons(def, name, path, env, st) {
  const loop = def.expr.parent;
  const isLoop = Boolean(loop) && loop.kind === 'foreach';
  const isKey = isLoop && Boolean(loop.key) && loop.key.kind === 'variable' && loop.key.name === name;
  const isListValue = isLoop && Boolean(loop.value) && loop.value.kind !== 'variable';
  const position = isListValue ? listPosition(loop.value, name) : null;
  if (isKey) return def.expr.kind === 'array' ? [] : classify(def.expr, env, st);
  const prefix = position === null ? [ANY] : [ANY, position];
  return elementReasons(def.expr, [...prefix, ...path], env, st);
}

function paramReasons(scope, name, env, st) {
  const bound = env.bind && env.bindScope === scope ? env.bind.get(name) : null;
  if (bound) return bound.node ? classify(bound.node, bound.env, st) : [];
  return siteReasons(scope, name, st);
}

function defReasons(def, scope, node, path, env, st) {
  const byKind = {
    param: () => paramReasons(scope, node.name, env, st),
    assign: () => elementReasons(def.expr, path, env, st),
    append: () => (def.expr ? appendReasons(def, path, env, st) : []),
    foreach: () => foreachReasons(def, node.name, path, env, st),
    destructure: () => destructureReasons(def, node.name, path, env, st),
  };
  const run = byKind[def.kind];
  return run ? run() : [];
}

function memoKey(path) {
  return path.map((p) => (typeof p === 'symbol' ? '[]' : String(p))).join('/');
}

function memoDef(def, scope, node, path, env, st) {
  const cacheable = !env.bind && def.kind !== 'param';
  const key = memoKey(path);
  const per = cacheable ? st.memo.get(def) || new Map() : null;
  if (cacheable) st.memo.set(def, per);
  const isCached = cacheable && per.has(key);
  if (isCached) return per.get(key);
  const result = defReasons(def, scope, node, path, env, st);
  if (cacheable) per.set(key, result);
  return result;
}

function elementOfVariable(e, path, env, st) {
  const name = e.name;
  const isDynamic = typeof name !== 'string';
  if (isDynamic) return ['varvar'];
  const isReceiver = name === 'wpdb' || name === 'this';
  if (isReceiver) return [];
  const isRequest = SUPERGLOBAL.test(name);
  if (isRequest) return ['superglobal'];
  if (isAllowlisted(e)) return [];
  const { scope, defs } = reachingFor(e, st);
  const isUnassigned = defs.length === 0;
  if (isUnassigned) return [`unassigned:$${name}`];
  return defs.flatMap((def) => memoDef(def, scope, e, path, env, st));
}

const ELEMENT_HANDLERS = {
  array: elementOfArray,
  variable: elementOfVariable,
  call: elementOfCall,
  retif: elementOfTernary,
};

/** Reasons for `expr[path[0]][path[1]]...`; an empty path is the whole value. Shapes it cannot index fall back to the whole value. */
function elementReasons(expr, path, env, st) {
  if (!expr) return [];
  const isTooDeep = env.depth > MAX_DEPTH;
  if (isTooDeep) return ['too-deep'];
  const isWhole = path.length === 0;
  const handler = isWhole ? null : ELEMENT_HANDLERS[expr.kind];
  return handler ? handler(expr, path, { ...env, depth: env.depth + 1 }, st) : classify(expr, env, st);
}

function variableReasons(e, env, st) {
  return elementOfVariable(e, [], env, st);
}

function offsetReasons(e, env, st) {
  const path = [];
  let base = e;
  while (base.kind === 'offsetlookup') {
    path.unshift(keyOf(base.offset) === APPEND ? ANY : keyOf(base.offset));
    base = base.what;
  }
  return elementReasons(base, path, env, st).length > 0 ? [`offset:${textOf(e)}`] : [];
}

// ---- calls --------------------------------------------------------------------------------

function isLiteralMap(node, env, st) {
  const isOutOfReach = !node || env.depth > MAX_DEPTH;
  if (isOutOfReach) return false;
  const deeper = { ...env, depth: env.depth + 1 };
  const byKind = {
    array: () => true,
    variable: () => literalMapVariable(node, deeper, st),
    call: () => literalMapCall(node, deeper, st),
  };
  const test = byKind[node.kind];
  return test ? test() : false;
}

function literalMapVariable(node, env, st) {
  const isDynamic = typeof node.name !== 'string';
  if (isDynamic) return false;
  const { defs } = reachingFor(node, st);
  return defs.length > 0 && defs.every((def) => def.kind === 'assign' && isLiteralMap(def.expr, env, st));
}

function literalMapCall(node, env, st) {
  const decl = helperOfCall(node, st);
  const isUnusable = !decl || st.busy.has(decl);
  if (isUnusable) return false;
  st.busy.add(decl);
  const rets = returnsOf(decl, st);
  const result = rets.length > 0 && rets.every((expr) => isLiteralMap(expr, env, st));
  st.busy.delete(decl);
  return result;
}

function implodeReasons(e, env, st) {
  const list = e.arguments[1] || e.arguments[0];
  const glue = e.arguments[1] ? classify(e.arguments[0], env, st) : [];
  return [...glue, ...classify(list, env, st).map((why) => `implode>${why}`)];
}

function mapReasons(e) {
  const callback = literalString(e.arguments[0]);
  return CLEAN_CALLBACKS.has(String(callback).toLowerCase()) ? [] : ['array_map'];
}

const FUNCTION_HANDLERS = {
  implode: implodeReasons,
  join: implodeReasons,
  array_map: mapReasons,
  array_keys: (e, env, st) => (isLiteralMap(e.arguments[0], env, st) ? [] : ['array_keys']),
  sprintf: (e, env, st) => e.arguments.flatMap((arg) => classify(arg, env, st)),
  call_user_func: (e) => (isPrepareCall(e) ? [] : ['call:call_user_func']),
  call_user_func_array: (e) => (isPrepareCall(e) ? [] : ['call:call_user_func_array']),
};

function functionReasons(e, name, env, st) {
  const isSafe = SAFE_FUNCTIONS.test(name);
  if (isSafe) return [];
  if (PASS_THROUGH.has(name)) return e.arguments.filter((a) => !FUNCTION_LITERALS.has(a.kind)).flatMap((a) => classify(a, env, st));
  const handler = FUNCTION_HANDLERS[name];
  return handler ? handler(e, env, st) : [`call:${name}`];
}

function wpdbReasons(method) {
  if (WPDB_SAFE_METHODS.has(method)) return [];
  return method === 'esc_like' ? ['esc_like-without-prepare'] : [`call:wpdb->${method}`];
}

function methodReasons(e, info, env, st) {
  const method = info.name.toLowerCase();
  if (isWpdbCall(e)) return wpdbReasons(method);
  const decl = helperOfCall(e, st);
  return decl ? helperReasons(e, decl, [], env, st) : [`call:${method}`];
}

function staticCallReasons(e, info, env, st) {
  const decl = helperOfCall(e, st);
  if (decl) return helperReasons(e, decl, [], env, st);
  const isTableHelper = typeof info.name === 'string' && /table/i.test(info.name);
  return isTableHelper ? [] : [`call:${info.receiver}::${info.name}`];
}

function callReasons(e, env, st) {
  const info = callName(e);
  const kind = info ? info.kind : '';
  const byKind = {
    function: () => functionReasons(e, functionOf(e), env, st),
    method: () => (typeof info.name === 'string' ? methodReasons(e, info, env, st) : ['call:dynamic']),
    static: () => staticCallReasons(e, info, env, st),
  };
  const run = byKind[kind];
  return run ? run() : ['call:dynamic'];
}

// ---- expressions --------------------------------------------------------------------------

function inArrayCall(test) {
  const isCall = Boolean(test) && test.kind === 'call' && functionOf(test) === 'in_array';
  return isCall ? test : null;
}

function ternaryReasons(e, env, st) {
  const positive = inArrayCall(e.test);
  const negative = e.test && e.test.kind === 'unary' && e.test.type === '!' ? inArrayCall(e.test.what) : null;
  const guardsTrue = Boolean(positive) && Boolean(e.trueExpr) && textOf(positive.arguments[0]) === textOf(e.trueExpr);
  const guardsFalse = Boolean(negative) && textOf(negative.arguments[0]) === textOf(e.falseExpr);
  if (guardsTrue) return classify(e.falseExpr, env, st);
  if (guardsFalse) return classify(e.trueExpr, env, st);
  return [...classify(e.trueExpr || e.test, env, st), ...classify(e.falseExpr, env, st)];
}

const none = () => [];
const HANDLERS = {
  string: none, nowdoc: none, number: none, boolean: none, nullkeyword: none, magic: none, name: none,
  selfreference: none, staticreference: none, identifier: none, isset: none, empty: none, unary: none,
  cast: (e, env, st) => (NUMERIC_CASTS.has(e.type) ? [] : classify(e.expr, env, st)),
  encapsed: (e, env, st) => e.value.flatMap((part) => classify(part.expression, env, st)),
  bin: (e, env, st) => (SAFE_BINARY.has(e.type) ? [] : [...classify(e.left, env, st), ...classify(e.right, env, st)]),
  retif: ternaryReasons,
  array: (e, env, st) => e.items.flatMap((item) => (item && item.value ? classify(item.value, env, st) : [])),
  silent: (e, env, st) => classify(e.expr, env, st),
  assign: (e, env, st) => classify(e.right, env, st),
  match: (e, env, st) => e.arms.flatMap((arm) => classify(arm.body, env, st)),
  variable: variableReasons,
  propertylookup: propertyReasons,
  nullsafepropertylookup: propertyReasons,
  staticlookup: staticReasons,
  offsetlookup: offsetReasons,
  call: callReasons,
};

function classify(expr, env, st) {
  if (!expr) return [];
  const isTooDeep = env.depth > MAX_DEPTH;
  if (isTooDeep) return ['too-deep'];
  const handler = HANDLERS[expr.kind];
  return handler ? handler(expr, { ...env, depth: env.depth + 1 }, st) : [`kind:${expr.kind}`];
}

/** One classifier per audited file; ctx.index (optional) resolves helpers and call sites in other files. */
export function createClassifier(ctx) {
  const st = {
    ctx, classify, linked: new WeakSet(), indexes: new Map(), memo: new Map(), busy: new Set(),
    sites: new Map(), props: new Map(), returns: new Map(),
  };
  return {
    reasons: (expr) => [...new Set(classify(expr, ROOT_ENV, st))],
    scopeIndex: (scope) => indexOf(scope, st),
  };
}
