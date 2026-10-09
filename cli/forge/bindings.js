// Binding index for Forge canonicalization: one entry per Identifier node in a parsed file, saying
// whether it declares or references a binding, which binding (an opaque per-file id, never hashed) and
// where that binding comes from: 'import' (module binding), 'global' (no binding in the file),
// 'local' (declared somewhere in the file) or 'name' (a property name or key, not a binding at all).
// describeIdentifier is exported so a shared audit traversal can fill the same index in its own pass.
// An import entry also carries importRef '<source>#<imported>' (default, * or the exported name), so
// `get` from 'lodash' and `get` from './api' never share a label or an anchor. A relative source is
// resolved against the file's directory when filePath is known, and a `node:` prefix is dropped for
// builtins that also exist without it, so the same module reads the same from every file. Only the
// .js/.jsx/.ts/.tsx family is dropped (a TS import of './a.js' means a.ts); .mjs, .cjs, .vue and the
// rest are distinct files and keep their extension (#2586).
// The index also holds two non-Identifier kinds of entry (#2586): a JSX component name (`<Foo>`, the
// root of `<foo.Bar>`) resolved like any reference, and the string source of a dynamic import() or a
// global require(), as an import entry with importRef '<source>#*'.
import { builtinModules } from 'node:module';
import path from 'node:path';
import { traverse } from '../babel-lazy.js';

const NAME_ENTRY = Object.freeze({ origin: 'name', bindingId: null, isDecl: false, importRef: null });
const INTERCHANGEABLE_EXTENSION = /\.(js|jsx|ts|tsx)$/;
const UNPREFIXED_BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith('node:')));
const JSX_NAME_PARENTS = new Set(['JSXOpeningElement', 'JSXClosingElement']);
const INTRINSIC_JSX_NAME = /^[a-z]|-/;
const IMPORTED_NAME = {
  ImportDefaultSpecifier: () => 'default',
  ImportNamespaceSpecifier: () => '*',
  ImportSpecifier: (specifier) => specifier.imported.name ?? specifier.imported.value
};
const importRefCache = new WeakMap();

/** Module identity of an import source as seen from filePath (null: unknown file, kept verbatim). */
export const normalizeImportSource = (source, filePath = null) => {
  const unprefixed = source.replace(/^node:/, '');
  const isSharedBuiltin = source.startsWith('node:') && UNPREFIXED_BUILTINS.has(unprefixed);
  const bare = isSharedBuiltin ? unprefixed : source;
  const isResolvable = bare.startsWith('.') && Boolean(filePath);
  if (!isResolvable) return bare;
  return path.posix.join(path.posix.dirname(filePath), bare).replace(INTERCHANGEABLE_EXTENSION, '');
};

const computeImportRef = (binding, filePath) => {
  const specifier = binding.path.node;
  const declaration = binding.path.parent;
  const isImportDeclaration = declaration?.type === 'ImportDeclaration';
  if (!isImportDeclaration) return null;
  const imported = IMPORTED_NAME[specifier.type]?.(specifier) ?? specifier.local?.name ?? '';
  return `${normalizeImportSource(declaration.source.value, filePath)}#${imported}`;
};

const importRefOf = (binding, filePath) => {
  const isCached = importRefCache.has(binding);
  if (isCached) return importRefCache.get(binding);
  const ref = computeImportRef(binding, filePath);
  importRefCache.set(binding, ref);
  return ref;
};

const originOf = (binding) => {
  if (!binding) return 'global';
  return binding.kind === 'module' ? 'import' : 'local';
};

const idFor = (binding, ids) => {
  if (!binding) return null;
  const isKnown = ids.has(binding);
  if (isKnown) return ids.get(binding);
  const next = ids.size + 1;
  ids.set(binding, next);
  return next;
};

/**
 * Describes one Identifier path. `ids` maps Babel binding objects to small per-file integers;
 * filePath (project-relative) resolves relative import sources.
 */
export const describeIdentifier = (nodePath, ids, filePath = null) => {
  // Babel reports some references (the operand of `!`) as binding identifiers too: a reference wins.
  const isRef = nodePath.isReferencedIdentifier();
  const isDecl = !isRef && nodePath.isBindingIdentifier();
  const isNameOnly = !isDecl && !isRef;
  if (isNameOnly) return NAME_ENTRY;
  const binding = nodePath.scope.getBinding(nodePath.node.name);
  const origin = originOf(binding);
  const importRef = origin === 'import' ? importRefOf(binding, filePath) : null;
  return { origin, bindingId: idFor(binding, ids), isDecl, importRef };
};

/** Entry for a JSX element name that names a value (component or member root), else null. */
const describeJsxName = (nodePath, ids, filePath) => {
  const { node, parent } = nodePath;
  const isElementName = JSX_NAME_PARENTS.has(parent.type) && parent.name === node;
  const isComponentName = isElementName && !INTRINSIC_JSX_NAME.test(node.name);
  const isMemberRoot = parent.type === 'JSXMemberExpression' && parent.object === node;
  const isReference = isComponentName || isMemberRoot;
  if (!isReference) return null;
  const binding = nodePath.scope.getBinding(node.name);
  const origin = originOf(binding);
  const importRef = origin === 'import' ? importRefOf(binding, filePath) : null;
  return { origin, bindingId: idFor(binding, ids), isDecl: false, importRef };
};

/** The string source of import('x') or a global require('x'), else null. */
const dynamicSourceOf = (nodePath) => {
  const { node } = nodePath;
  const callee = node.callee;
  const isImportCall = callee?.type === 'Import';
  const isRequire = callee?.type === 'Identifier' && callee.name === 'require' && !nodePath.scope.getBinding('require');
  const source = node.type === 'ImportExpression' ? node.source : node.arguments?.[0];
  const isCall = isImportCall || isRequire || node.type === 'ImportExpression';
  const isStatic = source?.type === 'StringLiteral';
  return isCall && isStatic ? source : null;
};

const indexDynamicSource = (nodePath, index, filePath) => {
  const source = dynamicSourceOf(nodePath);
  if (!source) return;
  const importRef = `${normalizeImportSource(source.value, filePath)}#*`;
  index.set(source, { origin: 'import', bindingId: null, isDecl: false, importRef });
};

/**
 * Babel visitors that fill `index` (Map<node, entry>); `ids` numbers bindings per file. Shared by
 * buildBindingIndex and the audit's merged traverse, so both build the same index.
 */
export const createBindingVisitors = (index, ids, filePath = null) => {
  const onCall = (nodePath) => indexDynamicSource(nodePath, index, filePath);
  return {
    Identifier(nodePath) {
      index.set(nodePath.node, describeIdentifier(nodePath, ids, filePath));
    },
    JSXIdentifier(nodePath) {
      const entry = describeJsxName(nodePath, ids, filePath);
      if (entry) index.set(nodePath.node, entry);
    },
    CallExpression: onCall,
    ImportExpression: onCall
  };
};

/** Builds Map<IdentifierNode, entry> for a whole Babel File/Program AST in one traversal. */
export const buildBindingIndex = (ast, { filePath = null } = {}) => {
  const index = new Map();
  traverse(ast, createBindingVisitors(index, new Map(), filePath));
  return index;
};

/** Entry for an Identifier the index never saw (synthesized nodes): treated as a global name. */
export const UNKNOWN_IDENTIFIER = Object.freeze({ origin: 'global', bindingId: null, isDecl: false, importRef: null });
