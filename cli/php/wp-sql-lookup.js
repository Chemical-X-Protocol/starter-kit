// AST lookups for the SECURITY_WP_UNPREPARED_SQL classifier (design spec 4): receiver and method names,
// class members, property assignments, allowlist guards and call sites. Pure functions over linked
// php-parser trees (linkParents already run). Nothing here decides whether a value is safe.
import { walk, callName } from './php-walk.js';

/** `$wpdb`, `$this->wpdb` and `$this->db`: the receivers whose query methods are sinks. */
export const WPDB_RECEIVER = /^\$(wpdb|this->wpdb|this->db)$/;

const RELATIVE_REFS = new Set(['selfreference', 'staticreference']);
const EARLY_EXITS = new Set(['return', 'throw', 'continue', 'break', 'exit']);
const CLASS_KINDS = new Set(['class', 'trait']);
const FUNCTION_KINDS = new Set(['method', 'function', 'closure']);

const TEXTS = {
  variable: (n) => (typeof n.name === 'string' ? `$${n.name}` : '${}'),
  propertylookup: (n) => `${textOf(n.what)}->${textOf(n.offset)}`,
  nullsafepropertylookup: (n) => `${textOf(n.what)}->${textOf(n.offset)}`,
  staticlookup: (n) => `${textOf(n.what)}::${textOf(n.offset)}`,
  offsetlookup: (n) => `${textOf(n.what)}[${textOf(n.offset)}]`,
  identifier: (n) => String(n.name),
  name: (n) => String(n.name),
  selfreference: () => 'self',
  staticreference: () => 'static',
  string: (n) => JSON.stringify(n.value),
  number: (n) => String(n.value),
};

/** Short source-like text for a node, used to compare two expressions and to match receivers. */
export function textOf(node) {
  if (!node) return '';
  const text = TEXTS[node.kind];
  return text ? text(node) : node.kind;
}

/** The method name of `$obj->m()` or `$obj?->m()`, lowercased, else null. */
export function methodOf(call) {
  const info = callName(call);
  const isMethod = Boolean(info) && info.kind === 'method' && typeof info.name === 'string';
  return isMethod ? info.name.toLowerCase() : null;
}

/** The receiver text of a method call, else ''. */
export function receiverText(call) {
  const what = call && call.what;
  const isLookup = Boolean(what) && (what.kind === 'propertylookup' || what.kind === 'nullsafepropertylookup');
  return isLookup ? textOf(what.what) : '';
}

/** The plain function name of a call, lowercased and without a leading backslash, else null. */
export function functionOf(call) {
  const info = callName(call);
  const isFunction = Boolean(info) && info.kind === 'function';
  return isFunction ? info.name.toLowerCase() : null;
}

export const isWpdbCall = (call) => WPDB_RECEIVER.test(receiverText(call));

export function enclosingClass(node) {
  let current = node && node.parent;
  while (current && !CLASS_KINDS.has(current.kind)) current = current.parent;
  return current || null;
}

export const classNameOf = (cls) => (cls && cls.name ? String(cls.name.name || cls.name) : null);

/** `self`, `static`, or a name equal to the enclosing class: the class whose members the lookup reads. */
export function isOwnClassRef(ref, cls) {
  if (!ref) return false;
  const isRelative = RELATIVE_REFS.has(ref.kind);
  const isSameName = ref.kind === 'name' && Boolean(cls) && String(ref.name).replace(/^\\/, '') === classNameOf(cls);
  return isRelative || isSameName;
}

export function findMethod(cls, name) {
  const wanted = String(name).toLowerCase();
  const members = (cls && cls.body) || [];
  return members.find((m) => m.kind === 'method' && String(m.name.name || m.name).toLowerCase() === wanted) || null;
}

/** The first class or trait in `ast` with this short name. */
export function findClassNamed(ast, name) {
  let found = null;
  const wanted = String(name).replace(/^\\/, '').split('\\').pop();
  walk(ast, (n) => {
    const isMatch = CLASS_KINDS.has(n.kind) && classNameOf(n) === wanted;
    const isFirst = isMatch && !found;
    found = isFirst ? n : found;
    return !found;
  });
  return found;
}

/** The declared property `name` of a class: { value, isStatic, visibility } or null. */
export function propertyDeclaration(cls, name) {
  for (const member of (cls && cls.body) || []) {
    const hit = member.kind === 'propertystatement' ? member.properties.find((p) => p.name && p.name.name === name) : null;
    if (hit) return { value: hit.value || null, isStatic: member.isStatic, visibility: member.visibility };
  }
  return null;
}

function propertyTarget(left) {
  let target = left;
  while (target && target.kind === 'offsetlookup') target = target.what;
  return target;
}

function isInstanceProperty(target, name) {
  const isLookup = Boolean(target) && target.kind === 'propertylookup';
  return isLookup && target.what.kind === 'variable' && target.what.name === 'this' && target.offset.name === name;
}

function isStaticProperty(target, name, cls) {
  const isLookup = Boolean(target) && target.kind === 'staticlookup';
  return isLookup && target.offset.kind === 'variable' && target.offset.name === name && isOwnClassRef(target.what, cls);
}

/** Right-hand sides of every `$this->name = x` (or `self::$name = x`) in the class, element writes included. */
export function propertyAssignments(cls, name, isStatic) {
  const found = [];
  walk(cls, (n) => {
    const target = n.kind === 'assign' ? propertyTarget(n.left) : null;
    const matches = Boolean(target) && (isStatic ? isStaticProperty(target, name, cls) : isInstanceProperty(target, name));
    if (matches) found.push(n.right);
  });
  return found;
}

/** `$wpdb->prepare(...)`, or `call_user_func(array($wpdb, 'prepare'), ...)` / `call_user_func_array(...)`. */
export function isPrepareCall(call) {
  const isCall = Boolean(call) && call.kind === 'call';
  if (!isCall) return false;
  const fn = functionOf(call);
  const isCallback = fn === 'call_user_func' || fn === 'call_user_func_array';
  const callback = isCallback ? call.arguments[0] : null;
  const pair = callback && callback.kind === 'array' ? callback.items.map((i) => i && (i.value || i)) : [];
  const preparesWpdb = pair.length === 2 && WPDB_RECEIVER.test(textOf(pair[0])) && pair[1].kind === 'string' && pair[1].value === 'prepare';
  return preparesWpdb || (methodOf(call) === 'prepare' && isWpdbCall(call));
}

/** The query-string argument of a prepare call: an expression node, or null when it cannot be seen. */
export function prepareQuery(call) {
  const fn = functionOf(call);
  const rest = call.arguments[1];
  const listed = rest && rest.kind === 'array' && rest.items[0] ? rest.items[0].value : null;
  const byFunction = { call_user_func: rest, call_user_func_array: listed };
  return fn ? byFunction[fn] || null : call.arguments[0] || null;
}

function isStrictInArray(call, name) {
  const isCall = Boolean(call) && call.kind === 'call' && functionOf(call) === 'in_array';
  const [subject, , strict] = isCall ? call.arguments : [];
  return Boolean(subject) && subject.kind === 'variable' && subject.name === name && Boolean(strict) && strict.kind === 'boolean' && strict.value === true;
}

const isJoin = (test, type) => test.kind === 'bin' && test.type === type;

function positiveGuard(test, name) {
  if (!test) return false;
  const either = isJoin(test, '&&') && (positiveGuard(test.left, name) || positiveGuard(test.right, name));
  return either || isStrictInArray(test, name);
}

function negativeGuard(test, name) {
  if (!test) return false;
  const either = isJoin(test, '||') && (negativeGuard(test.left, name) || negativeGuard(test.right, name));
  const negated = test.kind === 'unary' && test.type === '!' && isStrictInArray(test.what, name);
  return either || negated;
}

function statementsOf(node) {
  if (!node) return [];
  return node.kind === 'block' || node.kind === 'program' ? node.children : [node];
}

function endsEarly(body) {
  const last = statementsOf(body).slice(-1)[0];
  const isExpression = Boolean(last) && last.kind === 'expressionstatement';
  const kind = isExpression ? last.expression.kind : last && last.kind;
  return EARLY_EXITS.has(kind);
}

function startOf(node) {
  return node.loc ? node.loc.start.offset : Number.POSITIVE_INFINITY;
}

function guardedEarlier(container, child, name) {
  return statementsOf(container).some((st) => st !== child && startOf(st) < startOf(child) && st.kind === 'if' && negativeGuard(st.test, name) && endsEarly(st.body));
}

/**
 * True when a strict in_array allowlist on this variable dominates the use: the use sits in the body of
 * `if (in_array($v, ..., true))`, or an earlier `if (!in_array($v, ..., true)) { return; }` in an
 * enclosing block ended the function or iteration. Not guaranteed: the allowlist array is trusted.
 */
export function isAllowlisted(variable) {
  const name = variable.name;
  let child = variable;
  let current = variable.parent;
  while (current) {
    const insideThen = current.kind === 'if' && current.body === child && positiveGuard(current.test, name);
    const isContainer = current.kind === 'block' || current.kind === 'program';
    const isGuarded = insideThen || (isContainer && guardedEarlier(current, child, name));
    if (isGuarded) return true;
    if (FUNCTION_KINDS.has(current.kind)) return false;
    child = current;
    current = current.parent;
  }
  return false;
}

const sameName = (call, name) => {
  const info = callName(call);
  return Boolean(info) && typeof info.name === 'string' && info.name.toLowerCase() === name;
};

function isSiteOf(call, name, cls) {
  const info = sameName(call, name) ? callName(call) : null;
  if (!info) return false;
  const isOwnInstance = info.kind === 'method' && info.receiver === 'this';
  const isOwnStatic = info.kind === 'static' && (info.receiver === 'self' || info.receiver === 'static' || info.receiver === classNameOf(cls));
  return isOwnInstance || isOwnStatic;
}

/** Calls inside `root` that name method `name` of class `cls` through `$this`, `self`, `static` or the class name. */
export function callSites(root, name, cls) {
  const found = [];
  walk(root, (n) => {
    const isSite = n.kind === 'call' && isSiteOf(n, name, cls);
    if (isSite) found.push(n);
  });
  return found;
}

/** Calls inside `root` of `Class::name(...)` for another file's class. */
export function staticSites(root, name, clsName) {
  const found = [];
  walk(root, (n) => {
    const info = n.kind === 'call' && sameName(n, name) ? callName(n) : null;
    const receiver = info && info.kind === 'static' ? String(info.receiver).replace(/^\\/, '').split('\\').pop() : null;
    const isSite = receiver === clsName;
    if (isSite) found.push(n);
  });
  return found;
}
