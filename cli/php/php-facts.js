// Per-file PHP facts (design spec 3.6): plain data, no trees, no cross-file lookups.
// Facts record what one file says. They do not prove a callee exists, that a call is reachable,
// or that a registration runs. Flow is not tracked: a variable holds the class of any `new C`
// assigned to it in the same function, and `$this->prop` the class of any `new C` assigned to it in the class.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHP_PARSE_VERSION } from './php-parse.js';
import { linkParents, walk, walkScope, literalString, nodeLine, endLine } from './php-walk.js';
import { createNameResolver } from './php-names.js';
import { describeCallable, returnsTrueOnly } from './php-callables.js';
import { labelCall } from './php-facts-vocab.js';
import { registrationsOf } from './php-registrations.js';

const CLASS_KINDS = new Set(['class', 'interface', 'trait', 'enum']);
const SCOPE_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);
const SCOPE_OR_FILE = new Set([...SCOPE_KINDS, 'program']);
const RELATIVE_REFS = { selfreference: 'self', staticreference: 'static', parentreference: 'parent' };
const LOOKUPS = new Set(['propertylookup', 'nullsafepropertylookup']);

function idText(node) {
  const inner = node && typeof node.name === 'object' ? node.name : null;
  return inner ? inner.name : (node && node.name) || null;
}

function enclosing(node, kinds) {
  let current = node && node.parent;
  while (current && !kinds.has(current.kind)) current = current.parent;
  return current || null;
}

function newedName(node) {
  const what = node && node.kind === 'new' ? node.what : null;
  return what && what.kind === 'name' ? what : null;
}

function isThis(node) {
  return Boolean(node) && node.kind === 'variable' && node.name === 'this';
}

function methodTarget(cls, name) {
  return cls && name ? `${cls}::${name}` : null;
}

function isWpdb(node) {
  const named = Boolean(node) && node.kind === 'variable' && node.name === 'wpdb';
  const prop = Boolean(node) && LOOKUPS.has(node.kind) && idText(node.offset) === 'wpdb';
  const global = Boolean(node) && node.kind === 'offsetlookup' && literalString(node.offset) === 'wpdb';
  return named || prop || global;
}

function paramsOf(fn) {
  return (fn.arguments || []).map((p) => ({
    name: idText(p),
    byRef: Boolean(p.byref),
    variadic: Boolean(p.variadic),
    hasDefault: p.value !== null && p.value !== undefined,
    type: p.type ? p.type.raw || p.type.name || null : null,
  }));
}

// Where an auth-like call's value goes (task #6696). A value that only becomes data (a ternary branch, the right
// side of ??, an array value) on its way to an assignment or a statement decides nothing: card vault's
// `isset( $p['cashierId'] ) ? intval( ... ) : get_current_user_id()` is not a guard. A value that reaches a test
// (if, while, a ternary test, !, a logical or comparison operator) or a return still counts. Syntax only.
const TEST_OPS = new Set(['!', '&&', '||', 'and', 'or', 'xor', '===', '==', '!==', '!=', '<', '>', '<=', '>=', '<=>']);
const TEST_HOLDERS = new Set(['if', 'while', 'do', 'retif']);
const VALUE_STOPS = new Set(['assign', 'expressionstatement', 'echo', 'block', 'program', ...SCOPE_KINDS]);

// Only calls that return an id, not a verdict, can be mere data. A predicate (current_user_can, wp_verify_nonce, ...)
// in a ternary branch is still a decision once the result is tested.
const ID_RETURNING = new Set(['get_current_user_id']);

const isTestSlot = (parent, child) => {
  const isOperator = (parent.kind === 'unary' || parent.kind === 'bin') && TEST_OPS.has(parent.type);
  const isHeldTest = TEST_HOLDERS.has(parent.kind) && parent.test === child;
  return parent.kind === 'return' || isOperator || isHeldTest;
};

const isDataSlot = (parent, child) => {
  const isBranch = parent.kind === 'retif' && parent.test !== child;
  const isFallback = parent.kind === 'bin' && parent.type === '??' && parent.right === child;
  const isArrayValue = parent.kind === 'entry' && parent.value === child;
  return isBranch || isFallback || isArrayValue;
};

function isDataOnly(node) {
  let child = node;
  let parent = node.parent;
  let sawData = false;
  while (parent && !VALUE_STOPS.has(parent.kind)) {
    if (isTestSlot(parent, child)) return false;
    sawData = sawData || isDataSlot(parent, child);
    child = parent;
    parent = parent.parent;
  }
  return sawData;
}

function pick(rules, otherwise) {
  const rule = rules.find(([applies]) => applies);
  return rule ? rule[1]() : otherwise();
}

export function extractFacts(ast, relativePath) {
  linkParents(ast);
  const names = createNameResolver(ast);
  const classInfo = new Map();
  const idCache = new Map();
  const localsCache = new Map();
  const propsCache = new Map();
  const ctxOf = (node) => names.contextFor(node);

  const extendsOf = (classNode) => {
    const parent = classNode.extends;
    const single = parent && !Array.isArray(parent) && parent.kind === 'name' ? parent : null;
    return single ? ctxOf(classNode).resolveClass(single) : null;
  };

  const infoOf = (classNode) => {
    if (!classInfo.has(classNode)) {
      const name = idText(classNode);
      const fqn = name ? ctxOf(classNode).qualify(name) : `class@anonymous:${nodeLine(classNode)}`;
      classInfo.set(classNode, { fqn, extendsFqn: extendsOf(classNode) });
    }
    return classInfo.get(classNode);
  };

  const classContextOf = (node) => {
    const classNode = enclosing(node, CLASS_KINDS);
    const info = classNode ? infoOf(classNode) : null;
    return { classNode, classFqn: info ? info.fqn : null, parentFqn: info ? info.extendsFqn : null };
  };

  const computeId = (node) => {
    const { classFqn } = classContextOf(node);
    const scope = enclosing(node, SCOPE_OR_FILE);
    const outer = scope ? idOf(scope) : relativePath;
    const own = idText(node);
    return pick(
      [
        [node.kind === 'program', () => relativePath],
        [node.kind === 'method', () => `${classFqn}::${own}`],
        [node.kind === 'function', () => ctxOf(node).qualify(own)],
      ],
      () => `${outer}#closure@${nodeLine(node)}`,
    );
  };

  const idOf = (node) => {
    if (!idCache.has(node)) idCache.set(node, computeId(node));
    return idCache.get(node);
  };

  const resolveRel = (resolved, at) => {
    const { classFqn, parentFqn } = classContextOf(at);
    const rel = { self: classFqn, static: classFqn, parent: parentFqn };
    return Object.hasOwn(rel, resolved) ? rel[resolved] : resolved;
  };

  const resolveNew = (nameNode, at) => resolveRel(ctxOf(at).resolveClass(nameNode), at);

  const localsOf = (scope) => {
    if (!localsCache.has(scope)) {
      const locals = new Map();
      walkScope(scope, (n) => {
        const target = n.kind === 'assign' && n.left && n.left.kind === 'variable' ? n.left : null;
        const created = target ? newedName(n.right) : null;
        const named = Boolean(created) && typeof target.name === 'string';
        if (named) locals.set(target.name, resolveNew(created, n));
      });
      localsCache.set(scope, locals);
    }
    return localsCache.get(scope);
  };

  const propsOf = (classNode) => {
    if (!propsCache.has(classNode)) {
      const types = new Map();
      walk(classNode, (n) => {
        const target = n.kind === 'assign' && n.left && LOOKUPS.has(n.left.kind) && isThis(n.left.what) ? n.left : null;
        const created = target ? newedName(n.right) : null;
        const prop = target ? idText(target.offset) : null;
        const known = Boolean(created) && Boolean(prop);
        if (known) types.set(prop, resolveNew(created, n));
      });
      propsCache.set(classNode, types);
    }
    return propsCache.get(classNode);
  };

  const envFor = (node, scope) => {
    const { classFqn, parentFqn, classNode } = classContextOf(node);
    const locals = scope ? localsOf(scope) : new Map();
    const props = classNode ? propsOf(classNode) : new Map();
    return { ctx: ctxOf(node), classFqn, parentFqn, locals, props, idOf, classNode };
  };

  const callFact = (node, receiver, name, target, extra = {}) => {
    const label = labelCall({ kind: receiver, name, wpdb: extra.wpdb === true });
    return { name, receiver, target, fallback: extra.fallback || null, line: nodeLine(node), label };
  };

  const instanceCall = (node, what, env) => {
    const name = idText(what.offset);
    const holder = what.what;
    const local = holder.kind === 'variable' ? env.locals.get(holder.name) : null;
    const viaProp = LOOKUPS.has(holder.kind) && isThis(holder.what) && env.classNode;
    const prop = viaProp ? propsOf(env.classNode).get(idText(holder.offset)) : null;
    const typed = local || prop || null;
    return pick(
      [
        [isThis(holder), () => callFact(node, 'this', name, methodTarget(env.classFqn, name))],
        [Boolean(typed), () => callFact(node, 'var-new', name, methodTarget(typed, name))],
      ],
      () => callFact(node, 'var', name, null, { wpdb: isWpdb(holder) }),
    );
  };

  const staticCall = (node, what, env) => {
    const name = idText(what.offset);
    const holder = what.what;
    const word = RELATIVE_REFS[holder.kind];
    const isName = holder.kind === 'name';
    const named = isName ? resolveRel(env.ctx.resolveClass(holder), node) : null;
    return pick(
      [
        [word === 'self', () => callFact(node, 'self', name, methodTarget(env.classFqn, name))],
        [word === 'static', () => callFact(node, 'static', name, methodTarget(env.classFqn, name))],
        [word === 'parent', () => callFact(node, 'parent', name, methodTarget(env.parentFqn, name))],
        [isName, () => callFact(node, 'static-class', name, methodTarget(named, name))],
      ],
      () => callFact(node, 'var', name, null),
    );
  };

  const plainCall = (node, what, env) => {
    const written = String(what.name).replace(/^\\/, '');
    const { name: target, fallback } = env.ctx.resolveFunction(what);
    return callFact(node, 'func', written, target, { fallback });
  };

  const callOf = (node, env) => {
    const what = node.kind === 'call' ? node.what : null;
    const byKind = {
      name: () => plainCall(node, what, env),
      propertylookup: () => instanceCall(node, what, env),
      nullsafepropertylookup: () => instanceCall(node, what, env),
      staticlookup: () => staticCall(node, what, env),
    };
    const make = what ? byKind[what.kind] : null;
    return make ? make() : null;
  };

  const newCall = (node) => {
    const created = newedName(node);
    const cls = created ? resolveNew(created, node) : null;
    return created ? callFact(node, 'new', '__construct', methodTarget(cls, '__construct')) : null;
  };

  const functionFact = (scope) => {
    const env = envFor(scope, scope);
    const found = { calls: [], write: [], outbound: [], auth: [], nonce: [] };
    walkScope(scope, (n) => {
      const call = callOf(n, env) || newCall(n);
      if (!call) return;
      const { label: named, ...plain } = call;
      const label = { ...named, auth: named.auth && !(ID_RETURNING.has(call.name) && isDataOnly(n)) };
      const entry = { name: call.name, line: call.line };
      found.calls.push(plain);
      for (const key of ['write', 'outbound', 'auth', 'nonce']) if (label[key]) found[key].push(entry);
    });
    const isFile = scope.kind === 'program';
    return {
      id: idOf(scope),
      kind: isFile ? 'file' : scope.kind,
      name: isFile ? null : idText(scope),
      class: isFile ? null : env.classFqn,
      line: isFile ? 1 : nodeLine(scope),
      endLine: endLine(scope),
      params: isFile ? [] : paramsOf(scope),
      calls: found.calls,
      stateWrites: found.write,
      outboundRequests: found.outbound,
      authChecks: found.auth,
      nonceChecks: found.nonce,
      returnsTrueOnly: returnsTrueOnly(scope),
    };
  };

  const classFact = (node) => {
    const ctx = ctxOf(node);
    const info = infoOf(node);
    const list = (nodes) => (nodes || []).filter((n) => n && n.kind === 'name').map((n) => ctx.resolveClass(n));
    const members = node.body || [];
    const traits = members.filter((m) => m.kind === 'traituse').flatMap((m) => list(m.traits));
    const methods = members.filter((m) => m.kind === 'method').map(idOf);
    const parentInterfaces = Array.isArray(node.extends) ? list(node.extends) : [];
    return {
      fqn: info.fqn,
      name: idText(node),
      kind: node.kind,
      line: nodeLine(node),
      endLine: endLine(node),
      extends: info.extendsFqn,
      implements: [...list(node.implements), ...parentInterfaces],
      traits,
      methods,
    };
  };

  const classNodes = [];
  const scopes = [ast];
  walk(ast, (n) => {
    if (CLASS_KINDS.has(n.kind)) classNodes.push(n);
    if (SCOPE_KINDS.has(n.kind)) scopes.push(n);
  });
  const functions = scopes.map(functionFact).filter((f) => f.kind !== 'file' || f.calls.length > 0);
  const registrations = registrationsOf(ast, {
    envFor,
    describeCallable,
    enclosingScope: (n) => enclosing(n, SCOPE_OR_FILE),
    idOf,
  });
  return { file: relativePath, classes: classNodes.map(classFact), functions, registrations };
}

// Environment variable chemx_php_facts_cache (upper case): "off" disables the cache, a path moves it.
const FACTS_CACHE_ENV = ['CHEMX', 'PHP', 'FACTS', 'CACHE'].join('_');
let codeKey = null;

/** Hash of the analyzer sources (cli/php/php-*.js minus specs); a change in any of them retires every cached entry. */
function analyzerCodeKey() {
  if (codeKey) return codeKey;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const hash = crypto.createHash('sha1');
  try {
    const names = fs.readdirSync(dir).filter((n) => /^php-.*\.js$/.test(n) && !n.endsWith('.spec.js')).sort();
    names.forEach((n) => hash.update(n).update(fs.readFileSync(path.join(dir, n))));
  } catch {
    hash.update(String(Math.random()));
  }
  hash.update(PHP_PARSE_VERSION);
  codeKey = hash.digest('hex').slice(0, 16);
  return codeKey;
}

function factsCachePath(content, relativePath) {
  const override = process.env[FACTS_CACHE_ENV];
  const disabled = override === 'off';
  if (disabled) return null;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const dir = override || path.join(os.tmpdir(), `chemx-php-facts-${uid}`);
  const key = crypto.createHash('sha1').update(analyzerCodeKey()).update('\0').update(relativePath).update('\0').update(content).digest('hex');
  return path.join(dir, `${key}.json`);
}

/**
 * Facts for one file through an on-disk cache keyed by the content hash, the relative path and a hash of
 * the analyzer sources. parse() runs only on a miss and returns the tree or null. Guarantees: a hit
 * returns what extractFacts built from the same content with the same analyzer sources. Not guaranteed:
 * the cache exists (CHEMX_PHP_FACTS_CACHE=off, an unwritable temp dir or a corrupt entry all fall back
 * to parsing), or that entries are ever pruned. Unparsable files are not cached.
 */
export function extractFactsCached(content, relativePath, parse) {
  const file = factsCachePath(content, relativePath);
  const cached = file === null ? null : readCachedFacts(file);
  const hit = cached !== null;
  if (hit) return cached;
  const ast = parse();
  const facts = ast ? extractFacts(ast, relativePath) : null;
  const cacheable = file !== null && facts !== null;
  if (cacheable) writeCachedFacts(file, facts);
  return facts;
}

function readCachedFacts(file) {
  try {
    const facts = JSON.parse(fs.readFileSync(file, 'utf8'));
    const shaped = facts !== null && typeof facts === 'object' && typeof facts.file === 'string';
    return shaped ? facts : null;
  } catch {
    // chemx-allow: best-effort a missing or corrupt entry is a miss and the caller parses
    return null;
  }
}

function writeCachedFacts(file, facts) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(facts));
    fs.renameSync(tmp, file);
  } catch {
    // chemx-allow: best-effort the cache is optional; a failed write only costs a later parse
  }
}
