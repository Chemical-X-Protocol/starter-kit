// WordPress registration facts for one file: REST routes, add_action/add_filter hooks (function and
// loader-method forms) and wp_ajax_*/admin_post_* map entries. Data only: a registration is what the
// file writes, not proof that it runs. Only literal hook, namespace and route strings are recorded.
import { walk, literalString, nodeLine, endLine } from './php-walk.js';
import { classOfExpr } from './php-callables.js';
import { HOOK_MAP_PREFIX } from './php-facts-vocab.js';

const HOOK_FUNCTIONS = new Set(['add_action', 'add_filter']);
const VERBS = {
  READABLE: ['GET'],
  CREATABLE: ['POST'],
  EDITABLE: ['POST', 'PUT', 'PATCH'],
  DELETABLE: ['DELETE'],
  ALLMETHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
};

function idName(node) {
  return node && typeof node.name === 'string' ? node.name : null;
}

function argSpan(node) {
  return { line: nodeLine(node), endLine: endLine(node) };
}

function ajaxKind(hook) {
  const match = hook ? HOOK_MAP_PREFIX.exec(hook) : null;
  return match ? match[1].replace(/_$/, '') : null;
}

function leadingLiteral(node) {
  const literal = literalString(node);
  const isConcat = Boolean(node) && node.kind === 'bin' && node.type === '.';
  const fromLeft = isConcat ? leadingLiteral(node.left) : null;
  return literal === null ? fromLeft : literal;
}

function verbsOf(node) {
  const literal = literalString(node);
  const constant = node && node.kind === 'staticlookup' ? idName(node.offset) : null;
  const items = node && node.kind === 'array' ? node.items.map((i) => verbsOf(i.value)).flat() : [];
  const byRule = [
    [literal !== null, () => literal.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean)],
    [Boolean(constant), () => VERBS[constant] || [`${idName(node.what) || '?'}::${constant}`]],
    [items.length > 0, () => items],
  ];
  const rule = byRule.find(([applies]) => applies);
  return rule ? rule[1]() : [];
}

function entriesByKey(arrayNode) {
  const map = new Map();
  for (const item of arrayNode.items || []) {
    const key = item && literalString(item.key);
    const hasKey = typeof key === 'string';
    if (hasKey) map.set(key, item.value);
  }
  return map;
}

function endpointOf(arrayNode, env, describe) {
  const fields = entriesByKey(arrayNode);
  const callback = fields.get('callback');
  const permission = fields.get('permission_callback');
  return {
    ...argSpan(arrayNode),
    methods: fields.has('methods') ? verbsOf(fields.get('methods')) : [],
    callback: callback ? describe(callback, env) : null,
    permission: permission ? describe(permission, env) : null,
  };
}

function endpointArrays(arg) {
  const isArray = arg && arg.kind === 'array';
  const hasFields = isArray && entriesByKey(arg).size > 0;
  const nested = isArray ? arg.items.map((i) => i && i.value).filter((v) => v && v.kind === 'array') : [];
  return hasFields ? [arg] : nested;
}

function restRoute(node, env, describe, scopeId) {
  const args = node.arguments || [];
  return {
    type: 'rest_route',
    line: nodeLine(node),
    endLine: endLine(node),
    in: scopeId,
    namespace: literalString(args[0]),
    route: literalString(args[1]),
    args: args.map(argSpan),
    endpoints: endpointArrays(args[2]).map((a) => endpointOf(a, env, describe)),
  };
}

function loaderCallable(args, env, describe) {
  const holder = args[1];
  const method = literalString(args[2]);
  // With a literal method name the second argument is the component: an object or a class name.
  const isComponent = Boolean(holder) && method !== null;
  const fallback = args[1] ? describe(args[1], env) : null;
  const cls = isComponent ? classOfExpr(holder, env) : null;
  if (!isComponent) return fallback;
  const fqn = cls ? cls.fqn : null;
  return {
    form: 'loader', class: fqn, method, function: null,
    target: fqn ? `${fqn}::${method}` : null, line: nodeLine(holder), viaThis: Boolean(cls && cls.viaThis),
  };
}

function hookCall(node, env, describe, scopeId, via) {
  const args = node.arguments || [];
  const hook = literalString(args[0]);
  const prefix = hook === null ? leadingLiteral(args[0]) : null;
  const isLoader = via === 'method';
  const plain = args[1] ? describe(args[1], env) : null;
  const callback = isLoader ? loaderCallable(args, env, describe) : plain;
  return {
    type: 'hook',
    via,
    function: idName(via === 'method' ? node.what.offset : node.what),
    line: nodeLine(node),
    endLine: endLine(node),
    in: scopeId,
    hook,
    hookPrefix: prefix,
    ajax: ajaxKind(hook !== null ? hook : prefix),
    callback,
  };
}

function hookMapEntry(entry, env, describe, scopeId) {
  const key = literalString(entry.key);
  const matches = key !== null && HOOK_MAP_PREFIX.test(key);
  if (!matches) return null;
  return { type: 'hook_map', line: nodeLine(entry), endLine: endLine(entry), in: scopeId, hook: key, ajax: ajaxKind(key), callback: describe(entry.value, env) };
}

function calleeKind(node) {
  const what = node.kind === 'call' ? node.what : null;
  const isPlain = what && what.kind === 'name';
  const isMethod = what && (what.kind === 'propertylookup' || what.kind === 'nullsafepropertylookup');
  const plain = isPlain ? String(what.name).replace(/^\\/, '').toLowerCase() : null;
  const method = isMethod && what.offset ? String(idName(what.offset) || '').toLowerCase() : null;
  const byRule = [
    [plain === 'register_rest_route', 'rest'],
    [HOOK_FUNCTIONS.has(plain), 'hook-func'],
    [HOOK_FUNCTIONS.has(method), 'hook-method'],
  ];
  const rule = byRule.find(([applies]) => applies);
  return rule ? rule[1] : null;
}

/**
 * @param ast linked program node
 * @param deps { envFor(node, scope), describeCallable, enclosingScope(node), idOf(scope) }
 */
export function registrationsOf(ast, deps) {
  const out = [];
  walk(ast, (node) => {
    const make = (fn) => {
      const scope = deps.enclosingScope(node);
      const scopeId = scope ? deps.idOf(scope) : null;
      return fn(deps.envFor(node, scope), deps.describeCallable, scopeId);
    };
    const kind = calleeKind(node);
    const isEntry = node.kind === 'entry' && node.key;
    const byRule = [
      [kind === 'rest', () => make((e, d, s) => restRoute(node, e, d, s))],
      [kind === 'hook-func', () => make((e, d, s) => hookCall(node, e, d, s, 'function'))],
      [kind === 'hook-method', () => make((e, d, s) => hookCall(node, e, d, s, 'method'))],
      [Boolean(isEntry), () => make((e, d, s) => hookMapEntry(node, e, d, s))],
    ];
    const rule = byRule.find(([applies]) => applies);
    const found = rule ? rule[1]() : null;
    if (found) out.push(found);
  });
  return out;
}
