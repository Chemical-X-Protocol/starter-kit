// Per-file PHP name resolution (design spec 3.6): namespace blocks and `use` imports.
// Single file only: no cross-file lookups, no autoload knowledge. Pure functions over php-parser nodes.
import { linkParents } from './php-walk.js';

const RELATIVE_WORDS = new Set(['self', 'static', 'parent']);
const NAMESPACE_KIND = 'namespace';

function strip(name) {
  return String(name).replace(/^\\+/, '');
}

function lastSegment(name) {
  const parts = String(name).split('\\');
  return parts[parts.length - 1];
}

function join(prefix, name) {
  return prefix ? `${prefix}\\${name}` : name;
}

function emptyImports() {
  return { class: new Map(), function: new Map(), const: new Map() };
}

function importKind(group, item) {
  return item.type || group.type || 'class';
}

/** Class and function names are case-insensitive in PHP; constants are not. */
function importKey(kind, alias) {
  return kind === 'const' ? alias : alias.toLowerCase();
}

function addUseItem(imports, group, item) {
  const kind = importKind(group, item);
  const prefix = group.name ? strip(group.name) : '';
  const full = join(prefix, strip(item.name));
  const alias = item.alias ? item.alias.name : lastSegment(full);
  imports[kind].set(importKey(kind, alias), full);
}

function collectImports(statements) {
  const imports = emptyImports();
  for (const stmt of statements) {
    const isUse = stmt.kind === 'usegroup';
    if (isUse) for (const item of stmt.items || []) addUseItem(imports, stmt, item);
  }
  return imports;
}

function qualifiedViaAlias(name, aliases, namespace) {
  const [first, ...rest] = name.split('\\');
  const hit = aliases.get(first.toLowerCase());
  const base = hit || join(namespace, first);
  return [base, ...rest].join('\\');
}

function classify(text) {
  const rooted = text.startsWith('\\');
  const relative = /^namespace\\/i.test(text);
  return (rooted && 'fqn') || (relative && 'rn') || 'uqn';
}

function asNameNode(name) {
  return typeof name === 'string' ? { name, resolution: classify(name) } : name;
}

function withoutNamespaceKeyword(text) {
  return text.replace(/^namespace\\/i, '');
}

function resolveClassIn(ctx, name) {
  const node = asNameNode(name);
  const text = String(node.name);
  const lower = text.toLowerCase();
  const isRelativeWord = RELATIVE_WORDS.has(lower);
  const isRooted = node.resolution === 'fqn';
  const isNamespaceRelative = node.resolution === 'rn';
  const byRule = [
    [isRelativeWord, () => lower],
    [isRooted, () => strip(text)],
    [isNamespaceRelative, () => join(ctx.namespace, withoutNamespaceKeyword(text))],
  ];
  const rule = byRule.find(([applies]) => applies);
  return rule ? rule[1]() : qualifiedViaAlias(text, ctx.imports.class, ctx.namespace);
}

function resolveCallableIn(ctx, name, kind) {
  const node = asNameNode(name);
  const text = String(node.name);
  const unqualified = node.resolution === 'uqn' && !text.includes('\\');
  const table = ctx.imports[kind];
  const key = importKey(kind, text);
  const exact = (resolved) => ({ name: resolved, fallback: null });
  const isRooted = node.resolution === 'fqn';
  const isNamespaceRelative = node.resolution === 'rn';
  const isImported = unqualified && table.has(key);
  const byRule = [
    [isRooted, () => exact(strip(text))],
    [isNamespaceRelative, () => exact(join(ctx.namespace, withoutNamespaceKeyword(text)))],
    [!unqualified, () => exact(qualifiedViaAlias(text, ctx.imports.class, ctx.namespace))],
    [isImported, () => exact(table.get(key))],
  ];
  const rule = byRule.find(([applies]) => applies);
  const global = ctx.namespace ? text : null;
  return rule ? rule[1]() : { name: join(ctx.namespace, text), fallback: global };
}

function makeContext(namespace, statements) {
  const ctx = { namespace, imports: collectImports(statements) };
  ctx.resolveClass = (name) => resolveClassIn(ctx, name);
  ctx.resolveFunction = (name) => resolveCallableIn(ctx, name, 'function');
  ctx.resolveConst = (name) => resolveCallableIn(ctx, name, 'const');
  ctx.qualify = (shortName) => join(ctx.namespace, shortName);
  return ctx;
}

function namespaceNameOf(node) {
  return node.name ? strip(node.name) : '';
}

/**
 * One resolver per parsed file. contextFor(node) returns the context of the namespace block (or the
 * global scope) that encloses `node`: { namespace, imports, resolveClass, resolveFunction,
 * resolveConst, qualify }. Needs parents; links them if the tree was not linked yet.
 *
 * resolveClass: self, static and parent come back as those lowercase words; every other name comes
 * back fully qualified without a leading backslash.
 * resolveFunction and resolveConst: { name, fallback } where `fallback` is the global name PHP tries
 * when the namespaced one is not defined (null when PHP does not fall back). Imports are only read
 * from the same namespace block (or the global scope) as the node.
 */
export function createNameResolver(ast) {
  linkParents(ast);
  const topStatements = (ast.children || []).filter((n) => n.kind !== NAMESPACE_KIND);
  const globalCtx = makeContext('', topStatements);
  const byNode = new Map();
  for (const node of ast.children || []) {
    const isNamespace = node.kind === NAMESPACE_KIND;
    if (isNamespace) byNode.set(node, makeContext(namespaceNameOf(node), node.children || []));
  }
  const contextFor = (node) => {
    let current = node;
    while (current) {
      if (byNode.has(current)) return byNode.get(current);
      current = current.parent;
    }
    return globalCtx;
  };
  return { contextFor, globalContext: globalCtx };
}
