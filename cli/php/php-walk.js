// AST helpers for PHP passes (design spec 3.2). Pure functions over php-parser nodes.
// Columns are php-parser's own (0-based); lines are 1-based.

const SCOPE_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);
const BOUNDARY_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc', 'class']);
const SKIPPED_KEYS = new Set(['loc', 'parent', 'leadingComments', 'trailingComments']);
const RELATIVE_REFS = { selfreference: 'self', staticreference: 'static', parentreference: 'parent' };
const METHOD_LOOKUPS = new Set(['propertylookup', 'nullsafepropertylookup']);
const STRING_KINDS = new Set(['string', 'nowdoc']);

function isNode(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.kind === 'string';
}

function pushNodes(out, values) {
  for (const value of values) {
    const isChild = isNode(value);
    if (isChild) out.push(value);
  }
}

const CHILD_CACHE = new WeakMap();

// Hot path for every PHP pass: own keys in insertion order, no per-key pair or filter arrays.
// The list is cached per node (every pass re-walks the same tree); callers must not mutate it, and
// a node whose keys change after its first walk would keep the stale list.
function childNodes(node) {
  const cached = CHILD_CACHE.get(node);
  if (cached) return cached;
  const out = collectChildNodes(node);
  CHILD_CACHE.set(node, out);
  return out;
}

function collectChildNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    const value = SKIPPED_KEYS.has(key) ? null : node[key];
    const isList = Array.isArray(value);
    const isChild = !isList && isNode(value);
    if (isList) pushNodes(out, value);
    if (isChild) out.push(value);
  }
  return out;
}

/** Sets a non-enumerable `parent` on every node so JSON and traversal stay acyclic. */
export function linkParents(root) {
  const visit = (node, parent) => {
    Object.defineProperty(node, 'parent', { value: parent, writable: true, configurable: true, enumerable: false });
    for (const child of childNodes(node)) visit(child, node);
  };
  const valid = isNode(root);
  if (valid) visit(root, null);
  return root;
}

/** visitor(node, parent) runs pre-order; returning false skips that node's children. */
export function walk(node, visitor, parent = null) {
  const valid = isNode(node);
  if (!valid) return;
  const entry = flatEntryOf(node);
  if (!entry) return walkRecursive(node, visitor, parent);
  const { start } = entry;
  const { nodes, parentIndex, ends } = entry.flat;
  const stop = ends[start];
  let i = start;
  while (i < stop) {
    const skipChildren = visitor(nodes[i], i === start ? parent : nodes[parentIndex[i]]) === false;
    i = skipChildren ? ends[i] : i + 1;
  }
}

function walkRecursive(node, visitor, parent) {
  const skipChildren = visitor(node, parent) === false;
  if (skipChildren) return;
  for (const child of childNodes(node)) walkRecursive(child, visitor, node);
}

// Every pass walks the same tree many times. The tree is flattened once into pre-order arrays
// (nodes, parent index, subtree end), so a walk is a loop over a slice. The flat copy is cached per
// tree root like CHILD_CACHE: a tree edited after its first walk would keep the stale order.
const FLAT_INDEX = new WeakMap();

function flatEntryOf(node) {
  const known = FLAT_INDEX.get(node);
  if (known) return known;
  let root = node;
  while (root.parent) root = root.parent;
  if (!FLAT_INDEX.has(root)) flatten(root);
  return FLAT_INDEX.get(node) || null;
}

function flatten(root) {
  const flat = { nodes: [], parentIndex: [], ends: [] };
  const visit = (node, parentAt) => {
    const at = flat.nodes.length;
    flat.nodes.push(node);
    flat.parentIndex.push(parentAt);
    flat.ends.push(at + 1);
    FLAT_INDEX.set(node, { flat, start: at });
    for (const child of childNodes(node)) visit(child, at);
    flat.ends[at] = flat.nodes.length;
  };
  visit(root, -1);
}

/** Nearest enclosing function/method/closure/arrowfunc, or the program root. Needs linkParents. */
export function scopeOf(node) {
  let current = node && node.parent;
  while (current) {
    const isScope = SCOPE_KINDS.has(current.kind) || current.kind === 'program';
    if (isScope) return current;
    current = current.parent;
  }
  return null;
}

/** Walks a scope's own body: does not enter nested function, method, closure, arrowfunc or class. */
export function walkScope(scope, visitor) {
  const visit = (node, parent) => {
    const isNestedBoundary = node !== scope && BOUNDARY_KINDS.has(node.kind);
    return isNestedBoundary ? false : visitor(node, parent);
  };
  walk(scope, visit);
}

function nameText(node) {
  const text = typeof node === 'string' ? node : node && node.name;
  return typeof text === 'string' ? text : null;
}

function methodReceiver(inner) {
  const isVariable = Boolean(inner) && inner.kind === 'variable';
  return isVariable ? nameText(inner) : null;
}

function staticReceiver(inner) {
  const kind = inner ? inner.kind : '';
  const named = kind === 'name' ? inner.name : null;
  return RELATIVE_REFS[kind] || named;
}

function lookupCallee(what) {
  const isMethod = METHOD_LOOKUPS.has(what.kind);
  const isStatic = what.kind === 'staticlookup';
  const method = { kind: 'method', name: nameText(what.offset), receiver: methodReceiver(what.what) };
  const stat = { kind: 'static', name: nameText(what.offset), receiver: staticReceiver(what.what) };
  return (isMethod && method) || (isStatic && stat) || null;
}

function plainCallee(what) {
  const isName = what.kind === 'name';
  const fn = { kind: 'function', name: String(what.name).replace(/^\\/, ''), receiver: null };
  return isName ? fn : lookupCallee(what);
}

function newedClass(what) {
  const isName = what.kind === 'name';
  return isName ? { kind: 'new', name: what.name, receiver: null } : null;
}

/**
 * Describes the callee of a call node:
 * { kind: 'function'|'method'|'static'|'new', name, receiver } or null.
 * receiver: variable name for $obj->m, class name for C::m, 'self'|'static'|'parent'.
 */
export function callName(call) {
  const isCallLike = isNode(call) && (call.kind === 'call' || call.kind === 'new');
  const what = isCallLike ? call.what : null;
  const hasCallee = isNode(what);
  const isNew = isCallLike && call.kind === 'new';
  const resolve = isNew ? newedClass : plainCallee;
  return hasCallee ? resolve(what) : null;
}

/** Value of a plain (non-interpolated) string literal, else null. */
export function literalString(node) {
  const isLiteral = isNode(node) && STRING_KINDS.has(node.kind) && typeof node.value === 'string';
  return isLiteral ? node.value : null;
}

export function nodeLine(node) {
  return node && node.loc ? node.loc.start.line : 1;
}

export function endLine(node) {
  return node && node.loc ? node.loc.end.line : nodeLine(node);
}
