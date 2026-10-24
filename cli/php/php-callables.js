// Describes PHP callable expressions as plain data (design spec 3.6, callable resolution).
// Pure and per file: class names are resolved against the file's namespace and imports only.
// A descriptor says what the expression names; it does not prove the target exists.
import { literalString, nodeLine, endLine } from './php-walk.js';

const STATIC_CALLABLE = /^\\?([A-Za-z_][\w\\]*)::([A-Za-z_]\w*)$/;
const FUNCTION_NAME = /^\\?[A-Za-z_][\w\\]*$/;
const CLOSURE_KINDS = new Set(['closure', 'arrowfunc']);

function base(node, form) {
  return { form, class: null, method: null, function: null, target: null, line: nodeLine(node), viaThis: false };
}

function withClassMethod(desc, cls, method) {
  const known = Boolean(cls) && Boolean(method);
  return { ...desc, class: cls, method, target: known ? `${cls}::${method}` : null };
}

function isNamed(node, kind) {
  return Boolean(node) && node.kind === kind;
}

function onlyReturn(body) {
  const statements = (body && body.children) || [];
  const single = statements.length === 1 ? statements[0] : null;
  return isNamed(single, 'return') ? single.expr : null;
}

function trueBody(node) {
  const isArrow = node.kind === 'arrowfunc';
  const expr = isArrow ? node.body : onlyReturn(node.body);
  return isNamed(expr, 'boolean') && expr.value === true;
}

/** True when a function-like node's whole body is `return true;` (or `fn() => true`). */
export function returnsTrueOnly(node) {
  const functionLike = node && (node.kind === 'function' || node.kind === 'method' || CLOSURE_KINDS.has(node.kind));
  return Boolean(functionLike) && trueBody(node);
}

function relativeClass(word, env) {
  const isParent = word === 'parent';
  return isParent ? env.parentFqn : env.classFqn;
}

function nameToClass(nameNode, env) {
  const resolved = env.ctx.resolveClass(nameNode);
  const isRelative = resolved === 'self' || resolved === 'static' || resolved === 'parent';
  return isRelative ? relativeClass(resolved, env) : resolved;
}

function isClassConstant(node) {
  const offset = node.offset && node.offset.name;
  return node.kind === 'staticlookup' && String(offset).toLowerCase() === 'class';
}

const RELATIVE_REFS = { selfreference: 'self', staticreference: 'static', parentreference: 'parent' };

function classOfClassConstant(node, env) {
  const target = node.what;
  const word = RELATIVE_REFS[target && target.kind];
  const isName = isNamed(target, 'name');
  return (word && { fqn: relativeClass(word, env), viaThis: false }) || (isName && { fqn: nameToClass(target, env), viaThis: false }) || null;
}

/** Class named by an expression: 'C', X::class, self::class, __CLASS__, $this, or a variable known to hold `new C`. */
export function classOfExpr(node, env) {
  const literal = literalString(node);
  const isMagic = isNamed(node, 'magic') && node.value === '__CLASS__';
  const isVariable = isNamed(node, 'variable');
  const isThis = isVariable && node.name === 'this';
  const local = isVariable && !isThis ? env.locals.get(node.name) : null;
  const byRule = [
    [literal !== null, () => ({ fqn: literal.replace(/^\\/, ''), viaThis: false })],
    [isMagic, () => ({ fqn: env.classFqn, viaThis: false })],
    [isThis, () => ({ fqn: env.classFqn, viaThis: true })],
    [Boolean(local), () => ({ fqn: local, viaThis: false })],
    [Boolean(node) && isClassConstant(node), () => classOfClassConstant(node, env)],
  ];
  const rule = byRule.find(([applies]) => applies);
  return rule ? rule[1]() : null;
}

function concatParts(node, env, out = []) {
  const isConcat = isNamed(node, 'bin') && node.type === '.';
  const literal = literalString(node);
  const isNamespaceMagic = isNamed(node, 'magic') && node.value === '__NAMESPACE__';
  const cls = classOfExpr(node, env);
  if (isConcat) {
    concatParts(node.left, env, out);
    concatParts(node.right, env, out);
    return out;
  }
  const byRule = [
    [literal !== null, () => literal],
    [isNamespaceMagic, () => env.ctx.namespace],
    [Boolean(cls && cls.fqn), () => cls.fqn],
  ];
  const rule = byRule.find(([applies]) => applies);
  out.push(rule ? rule[1]() : null);
  return out;
}

function describeConcat(node, env) {
  const parts = concatParts(node, env);
  const complete = parts.every((p) => typeof p === 'string');
  const match = complete ? STATIC_CALLABLE.exec(parts.join('')) : null;
  const desc = base(node, 'concat');
  return match ? withClassMethod(desc, match[1], match[2]) : { ...desc, form: 'unknown' };
}

function describeArray(node, env) {
  const items = node.items || [];
  const [first, second] = items.map((i) => i && i.value);
  const cls = items.length === 2 ? classOfExpr(first, env) : null;
  const method = literalString(second);
  const desc = base(node, items.length === 2 ? 'array' : 'unknown');
  const named = withClassMethod(desc, cls ? cls.fqn : null, method);
  return { ...named, viaThis: Boolean(cls && cls.viaThis), method };
}

function describeString(text, node) {
  const match = STATIC_CALLABLE.exec(text);
  const isFunction = FUNCTION_NAME.test(text);
  if (match) return withClassMethod(base(node, 'static-string'), match[1], match[2]);
  if (isFunction) {
    const name = text.replace(/^\\/, '');
    return { ...base(node, 'function'), function: name, target: name };
  }
  return base(node, 'unknown');
}

function describeClosure(node, env) {
  const id = env.idOf ? env.idOf(node) : null;
  return { ...base(node, node.kind), target: id, closureId: id, endLine: endLine(node), returnsTrueOnly: returnsTrueOnly(node) };
}

/**
 * @param node an argument or array-value node
 * @param env { ctx, classFqn, parentFqn, locals: Map, idOf(node) }
 * @returns {{form, class, method, function, target, line, viaThis}} form is one of function, static-string,
 *   array, concat, closure, arrowfunc, unknown. Unresolvable pieces come back as null.
 */
export function describeCallable(node, env) {
  const literal = literalString(node);
  const isConcat = isNamed(node, 'bin') && node.type === '.';
  const isArray = isNamed(node, 'array');
  const isClosure = Boolean(node) && CLOSURE_KINDS.has(node.kind);
  const byRule = [
    [literal !== null, () => describeString(literal, node)],
    [isConcat, () => describeConcat(node, env)],
    [isArray, () => describeArray(node, env)],
    [isClosure, () => describeClosure(node, env)],
  ];
  const rule = byRule.find(([applies]) => applies);
  return rule ? rule[1]() : base(node, 'unknown');
}
