// REST route resolution for the WordPress route rules (design spec 4, SECURITY_WP_REST_NO_PERMISSION_CALLBACK
// row). Reads register_rest_route( ns, route, args ) with WordPress core's algorithm (wp-includes/rest-api.php):
// the top-level 'args' key is dropped; the array is ONE endpoint only when it has a 'callback' key; otherwise
// only numeric keys are endpoints and 'schema' or any other string key is skipped.
// Data only. A result says what the file writes: a route is not proof that it is served, and a resolved
// callable is a name match through the project index, not proof of the runtime target. Dark until the language
// flip registers .php.
import path from 'node:path';
import { walk, walkScope, scopeOf, literalString, nodeLine } from './php-walk.js';
import { createScopeIndex } from './php-taint.js';
import { createNameResolver } from './php-names.js';
import { describeCallable, returnsTrueOnly } from './php-callables.js';
import { isFailOpen } from './wp-fail-open.js';

const CLASS_KINDS = new Set(['class', 'interface', 'trait', 'enum']);
const CLOSURE_KINDS = new Set(['closure', 'arrowfunc']);
const MAX_FOLLOW = 3;

/** WP_REST_Server's method constants (wp-includes/rest-api/class-wp-rest-server.php). */
const SERVER_CONSTANTS = {
  READABLE: 'GET',
  CREATABLE: 'POST',
  EDITABLE: 'POST, PUT, PATCH',
  DELETABLE: 'DELETE',
  ALLMETHODS: 'GET, POST, PUT, PATCH, DELETE',
};

export const PUBLIC_KINDS = new Set(['return_true', 'closure_true', 'callable_true']);

/** The file's path as the project index names it: relative to the WordPress root when known. */
export function indexPathOf(ctx) {
  const root = ctx.wp && ctx.wp.root;
  const isMeasurable = Boolean(root) && path.isAbsolute(ctx.filePath);
  return isMeasurable ? path.relative(root, ctx.filePath).split(path.sep).join('/') : ctx.relativePath;
}

const idText = (node) => {
  const inner = node && typeof node.name === 'object' ? node.name : null;
  return inner ? inner.name : (node && node.name) || null;
};

const isKind = (node, kind) => Boolean(node) && node.kind === kind;

function enclosingClass(node) {
  let current = node && node.parent;
  while (current && !CLASS_KINDS.has(current.kind)) current = current.parent;
  return current || null;
}

// ---- environment ---------------------------------------------------------------------------

/** One environment per file: name resolution, scope indexes and the index path. */
function makeEnv(ctx) {
  const names = createNameResolver(ctx.ast);
  const scopes = new Map();
  const locals = new Map();
  const rel = indexPathOf(ctx);
  const facts = () => (ctx.index ? ctx.index.facts(rel) : null);

  const scopeIndex = (scope) => {
    if (!scopes.has(scope)) scopes.set(scope, createScopeIndex(scope));
    return scopes.get(scope);
  };

  const classFqn = (classNode) => {
    const name = classNode ? idText(classNode) : null;
    return name ? names.contextFor(classNode).qualify(name) : null;
  };

  const parentFqn = (classNode) => {
    const parent = classNode && !Array.isArray(classNode.extends) ? classNode.extends : null;
    return isKind(parent, 'name') ? names.contextFor(classNode).resolveClass(parent) : null;
  };

  const localsOf = (scope, nameCtx) => {
    if (!locals.has(scope)) {
      const found = new Map();
      walkScope(scope, (n) => {
        const target = isKind(n, 'assign') && isKind(n.left, 'variable') ? n.left : null;
        const created = target && isKind(n.right, 'new') && isKind(n.right.what, 'name') ? n.right.what : null;
        const isNamed = Boolean(created) && typeof target.name === 'string';
        if (isNamed) found.set(target.name, nameCtx.resolveClass(created));
      });
      locals.set(scope, found);
    }
    return locals.get(scope);
  };

  // A closure's id in the project index is looked up by kind and line in the file's facts.
  const idOf = (node) => {
    const known = facts();
    const hit = known ? known.functions.find((f) => f.kind === node.kind && f.line === nodeLine(node)) : null;
    return hit ? hit.id : null;
  };

  const describeEnv = (node) => {
    const classNode = enclosingClass(node);
    const nameCtx = names.contextFor(node);
    const scope = scopeOf(node);
    return {
      ctx: nameCtx,
      classFqn: classFqn(classNode),
      parentFqn: parentFqn(classNode),
      locals: scope ? localsOf(scope, nameCtx) : new Map(),
      props: new Map(),
      idOf,
    };
  };

  return { ctx, rel, scopeIndex, describeEnv };
}

// ---- value following -----------------------------------------------------------------------

/** A variable's value: the last plain assignment before the node in its scope (branches are not followed). */
function valueOf(node, env, depth = 0) {
  const isVariable = isKind(node, 'variable') && typeof node.name === 'string' && node.name !== 'this';
  const scope = isVariable && depth < MAX_FOLLOW ? scopeOf(node) : null;
  if (!scope) return node;
  const defs = (env.scopeIndex(scope).defs.get(node.name) || []).filter((d) => d.plain && d.pos < node.loc.start.offset);
  const last = defs[defs.length - 1];
  const isAssigned = Boolean(last) && last.kind === 'assign' && Boolean(last.expr);
  return isAssigned ? valueOf(last.expr, env, depth + 1) : node;
}

const entriesOf = (arrayNode) => {
  const map = new Map();
  for (const item of arrayNode.items || []) {
    const key = item && item.kind === 'entry' && !item.unpack ? literalString(item.key) : null;
    const hasKey = typeof key === 'string';
    if (hasKey) map.set(key, item);
  }
  return map;
};

const keyText = (key) => (key.kind === 'number' ? String(key.value) : literalString(key));

const isNumericKey = (item) => {
  const isEntry = item.kind === 'entry' && !item.unpack;
  const text = isEntry && item.key ? keyText(item.key) : null;
  const isAuto = isEntry && !item.key;
  return isAuto || (text !== null && /^-?\d+$/.test(text));
};

// ---- methods -------------------------------------------------------------------------------

function classNamed(env, shortName) {
  let found = null;
  walk(env.ctx.ast, (n) => {
    const isMatch = !found && CLASS_KINDS.has(n.kind) && idText(n) === shortName;
    if (isMatch) found = n;
  });
  return found;
}

function classConstant(classNode, name) {
  for (const member of (classNode && classNode.body) || []) {
    const constants = member.kind === 'classconstant' ? member.constants : [];
    const hit = constants.find((c) => idText(c.name) === name);
    if (hit) return hit.value;
  }
  return null;
}

function constantTarget(node, env) {
  const what = node.what;
  const isRelative = ['selfreference', 'staticreference'].includes(what && what.kind);
  const shortName = isKind(what, 'name') ? String(what.name).replace(/^\\/, '').split('\\').pop() : null;
  if (isRelative) return enclosingClass(node);
  return shortName ? classNamed(env, shortName) : null;
}

const splitVerbs = (text) => text.split(/[\s,|]+/).map((v) => v.toUpperCase()).filter(Boolean);

function verbsOfLookup(node, env, depth) {
  const constant = idText(node.offset);
  const holder = isKind(node.what, 'name') ? String(node.what.name).replace(/^\\/, '') : '';
  const isServer = holder.toLowerCase() === 'wp_rest_server' && Object.hasOwn(SERVER_CONSTANTS, constant);
  if (isServer) return { verbs: splitVerbs(SERVER_CONSTANTS[constant]), resolved: true };
  const owner = constantTarget(node, env);
  const value = owner ? classConstant(owner, constant) : null;
  return value ? verbsOf(value, env, depth + 1) : { verbs: [], resolved: false };
}

function mergeVerbs(parts) {
  return { verbs: [...new Set(parts.flatMap((p) => p.verbs))], resolved: parts.every((p) => p.resolved) };
}

/** { verbs: ['GET', ...], resolved } for a 'methods' value. Anything not understood leaves resolved false. */
function verbsOf(node, env, depth = 0) {
  const value = depth > MAX_FOLLOW ? null : valueOf(node, env);
  const literal = literalString(value);
  const parts = (isKind(value, 'array') ? value.items : []).map((i) => verbsOf(i.value, env, depth + 1));
  const sides = isKind(value, 'bin') && value.type === '.' ? [value.left, value.right] : [];
  const byRule = [
    [literal !== null, () => ({ verbs: splitVerbs(literal), resolved: true })],
    [isKind(value, 'staticlookup'), () => verbsOfLookup(value, env, depth)],
    [isKind(value, 'array'), () => mergeVerbs(parts)],
    [sides.length === 2, () => mergeVerbs(sides.map((s) => verbsOf(s, env, depth + 1)))],
  ];
  const rule = byRule.find(([applies]) => applies);
  return rule ? rule[1]() : { verbs: [], resolved: false };
}

// ---- callables -----------------------------------------------------------------------------

const isEmptyValue = (node) => {
  const literal = literalString(node);
  const isFalse = isKind(node, 'boolean') && node.value === false;
  return !node || isKind(node, 'nullkeyword') || isFalse || literal === '';
};

function describeRef(node, env) {
  return describeCallable(node, env.describeEnv(node));
}

function resolveTarget(desc, env) {
  const { ctx, rel } = env;
  const target = ctx.index ? ctx.index.resolveCallable(desc, rel) : null;
  const isHidden = Boolean(target) && target.file !== rel && ctx.crossFile === false;
  return isHidden ? null : target;
}

/** The method or function declared at a line of this file, or null (a callable in another file is not read). */
function declarationAt(target, env) {
  const isHere = Boolean(target) && target.file === env.rel;
  let found = null;
  const visit = (n) => {
    const isMatch = (n.kind === 'method' || n.kind === 'function') && nodeLine(n) === target.line;
    if (isMatch) found = n;
    return found === null;
  };
  if (isHere) walk(env.ctx.ast, visit);
  return found;
}

function permissionOf(entry, env) {
  const node = entry ? entry.value : null;
  const literal = literalString(node);
  const isMissing = !entry || isEmptyValue(node);
  const isReturnTrue = literal !== null && literal.replace(/^\\/, '').toLowerCase() === '__return_true';
  const isClosure = Boolean(node) && CLOSURE_KINDS.has(node.kind);
  const desc = !isMissing && !isReturnTrue ? describeRef(node, env) : null;
  const target = desc ? resolveTarget(desc, env) : null;
  const isTrueTarget = Boolean(target) && target.fact.returnsTrueOnly === true;
  const byRule = [
    [isMissing, 'missing'],
    [isReturnTrue, 'return_true'],
    [isClosure && returnsTrueOnly(node), 'closure_true'],
    [isTrueTarget, 'callable_true'],
    [Boolean(target) && isFailOpen(declarationAt(target, env)), 'callable_fail_open'],
  ];
  const hit = byRule.find(([applies]) => applies);
  return { kind: hit ? hit[1] : 'other', line: entry ? nodeLine(entry) : null, target: isTrueTarget ? target : null };
}

function callbackOf(entry, env) {
  const node = entry ? entry.value : null;
  const desc = node ? describeRef(node, env) : null;
  const target = desc ? resolveTarget(desc, env) : null;
  const label = desc ? desc.target || desc.function || desc.form : null;
  return { line: entry ? nodeLine(entry) : null, label, target };
}

// ---- endpoints -----------------------------------------------------------------------------

function endpointOf(arrayNode, shape, env) {
  const fields = entriesOf(arrayNode);
  const methodsEntry = fields.get('methods');
  const methods = methodsEntry ? verbsOf(methodsEntry.value, env) : { verbs: ['GET'], resolved: true };
  return {
    line: nodeLine(arrayNode),
    shape,
    methods: { ...methods, isDefault: !methodsEntry },
    permission: permissionOf(fields.get('permission_callback'), env),
    callback: callbackOf(fields.get('callback'), env),
  };
}

/** WordPress core's split of the third argument into endpoint arrays: [{ node, shape }] plus a count of unreadable items. */
function endpointArrays(arg, env) {
  const value = valueOf(arg, env);
  const isArray = isKind(value, 'array');
  const isSingle = isArray && entriesOf(value).has('callback');
  const items = isArray && !isSingle ? value.items.filter(isNumericKey) : [];
  const resolved = items.map((i) => valueOf(i.value, env));
  const arrays = resolved.filter((v) => isKind(v, 'array')).map((node) => ({ node, shape: 'list' }));
  const single = isSingle ? [{ node: value, shape: 'single' }] : [];
  return { arrays: [...single, ...arrays], unreadable: resolved.length - arrays.length, isReadable: isArray };
}

function isRestRouteCall(node) {
  const what = node.kind === 'call' ? node.what : null;
  const name = isKind(what, 'name') ? String(what.name).replace(/^\\/, '').toLowerCase() : '';
  return name === 'register_rest_route';
}

function routeOf(call, env) {
  const args = call.arguments || [];
  const none = { arrays: [], unreadable: 0, isReadable: false };
  const { arrays, unreadable, isReadable } = args[2] ? endpointArrays(args[2], env) : none;
  return {
    line: nodeLine(call),
    namespace: literalString(args[0]),
    route: literalString(args[1]),
    isReadable,
    unreadable,
    endpoints: arrays.map(({ node, shape }) => endpointOf(node, shape, env)),
  };
}

const cache = new WeakMap();

/**
 * Every register_rest_route call in the file, resolved: [{ line, namespace, route, isReadable, unreadable,
 * endpoints: [{ line, shape, methods: { verbs, resolved, isDefault }, permission: { kind, line, target },
 * callback: { line, label, target } }] }]. permission.kind is missing, return_true, closure_true, callable_true, callable_fail_open
 * (task #6707: ends in return true, denials only under a credential-present branch, same-file callable only; data,
 * not in PUBLIC_KINDS, so no rule acts on it) or other. A target is a project-index declaration ({ id, file, line, fact }) or null when it did not resolve (or
 * lies in another file while ctx.crossFile is false). Memoised per ctx (the parse cache can hand the same tree to two ctxs).
 */
export function resolveRestRoutes(ctx) {
  if (cache.has(ctx)) return cache.get(ctx);
  const env = makeEnv(ctx);
  const routes = [];
  walk(ctx.ast, (node) => {
    if (isRestRouteCall(node)) routes.push(routeOf(node, env));
  });
  cache.set(ctx, routes);
  return routes;
}
