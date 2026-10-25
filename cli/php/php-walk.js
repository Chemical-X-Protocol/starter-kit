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

// Hot path for every PHP pass: own keys in insertion order, no per-key pair or filter arrays.
function childNodes(node) {
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
  const skipChildren = visitor(node, parent) === false;
  if (skipChildren) return;
  for (const child of childNodes(node)) walk(child, visitor, node);
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
