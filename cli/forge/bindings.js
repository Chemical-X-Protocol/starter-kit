// Binding index for Forge canonicalization: one entry per Identifier node in a parsed file, saying
// whether it declares or references a binding, which binding (an opaque per-file id, never hashed) and
// where that binding comes from: 'import' (module binding), 'global' (no binding in the file),
// 'local' (declared somewhere in the file) or 'name' (a property name or key, not a binding at all).
// describeIdentifier is exported so a shared audit traversal can fill the same index in its own pass.
// Every describer reads a site { node, parent, grandparent, scope }: createBindingVisitors builds one
// from each NodePath of a Babel traverse (the audit's merged pass), and fillBindingIndex from a plain
// walk over the scopes Babel crawled (binding-walk.js, #5911), so both fill the same index.
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
import { lazyTypes, traverse } from '../babel-lazy.js';
import { walkBindingSites } from './binding-walk.js';

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
const ALWAYS_INITIALIZED = new Set(['var', 'param', 'hoisted']);
const LEXICAL_KINDS = new Set(['let', 'const']);
const RELATIVE_PATH = /^\.\.?\//;
const MODULE_SOURCE_PARENTS = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration']);

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
 * True when a read of the binding here can never hit its TDZ (#2594): a var, param or function binding,
 * or a let/const/class declared earlier in the same function, outside a switch case (a case can be
 * jumped over). Imports, class-expression names and reads from a nested function are never certain.
 */
const isInitializedAt = (binding, site) => {
  const kind = binding?.kind;
  const isAlwaysInitialized = ALWAYS_INITIALIZED.has(kind);
  if (isAlwaysInitialized) return true;
  const isLexical = LEXICAL_KINDS.has(kind);
  if (!isLexical) return false;
  const declaration = binding.path;
  const end = declaration.node?.end;
  const endsBefore = typeof end === 'number' && typeof site.node.start === 'number' && end <= site.node.start;
  const isSameFunction = binding.scope.getFunctionParent() === site.scope.getFunctionParent();
  const statement = declaration.isVariableDeclarator() ? declaration.parentPath : declaration;
  const isInCase = Boolean(statement?.parentPath?.isSwitchCase());
  return endsBefore && isSameFunction && !isInCase;
};

let babelTests = null;
const identifierTests = () => {
  babelTests = babelTests ?? { isReferenced: lazyTypes.isReferenced, isBinding: lazyTypes.isBinding };
  return babelTests;
};

/** The site of a NodePath: what every describer reads (grandparent as NodePath#isReferencedIdentifier reads it). */
export const siteOfPath = (nodePath) => ({ node: nodePath.node, parent: nodePath.parent, grandparent: nodePath.parentPath?.parent, scope: nodePath.scope });

/**
 * Describes one Identifier site ({ node, parent, grandparent, scope }, see siteOfPath). `ids` maps
 * Babel binding objects to small per-file integers; filePath (project-relative) resolves relative
 * import sources. isInitialized (references only) says the read cannot throw a TDZ ReferenceError
 * (alias inlining relies on it). isRef and isDecl are t.isReferenced and t.isBinding, which is what
 * NodePath#isReferencedIdentifier and #isBindingIdentifier compute for an Identifier.
 */
export const describeIdentifier = (site, ids, filePath = null) => {
  const { node, parent, grandparent } = site;
  const { isReferenced, isBinding } = identifierTests();
  // Babel reports some references (the operand of `!`) as binding identifiers too: a reference wins.
  const isRef = isReferenced(node, parent, grandparent);
  const isDecl = !isRef && isBinding(node, parent, grandparent);
  const isNameOnly = !isDecl && !isRef;
  if (isNameOnly) return NAME_ENTRY;
  const binding = site.scope.getBinding(node.name);
  const origin = originOf(binding);
  const importRef = origin === 'import' ? importRefOf(binding, filePath) : null;
  const isInitialized = isRef && isInitializedAt(binding, site);
  return { origin, bindingId: idFor(binding, ids), isDecl, importRef, isInitialized };
};

/** Entry for a JSX element name that names a value (component or member root), else null. */
const describeJsxName = (site, ids, filePath) => {
  const { node, parent } = site;
  const isElementName = JSX_NAME_PARENTS.has(parent.type) && parent.name === node;
  const isComponentName = isElementName && !INTRINSIC_JSX_NAME.test(node.name);
  const isMemberRoot = parent.type === 'JSXMemberExpression' && parent.object === node;
  const isReference = isComponentName || isMemberRoot;
  if (!isReference) return null;
  const binding = site.scope.getBinding(node.name);
  const origin = originOf(binding);
  const importRef = origin === 'import' ? importRefOf(binding, filePath) : null;
  return { origin, bindingId: idFor(binding, ids), isDecl: false, importRef };
};

/** The string source of import('x') or a global require('x'), else null. */
const dynamicSourceOf = (site) => {
  const { node } = site;
  const callee = node.callee;
  const isImportCall = callee?.type === 'Import';
  const isRequire = callee?.type === 'Identifier' && callee.name === 'require' && !site.scope.getBinding('require');
  const source = node.type === 'ImportExpression' ? node.source : node.arguments?.[0];
  const isCall = isImportCall || isRequire || node.type === 'ImportExpression';
  const isStatic = source?.type === 'StringLiteral';
  return isCall && isStatic ? source : null;
};

const indexDynamicSource = (site, index, filePath) => {
  const source = dynamicSourceOf(site);
  if (!source) return;
  const importRef = `${normalizeImportSource(source.value, filePath)}#*`;
  index.set(source, { origin: 'import', bindingId: null, isDecl: false, importRef });
};

/**
 * Any './' or '../' string (or expression-free template) is a file-relative path anchor (#2594):
 * createRequire's require, require.resolve, import.meta.resolve/glob, new URL(rel, import.meta.url) and
 * vi.mock all resolve it against the file, so the same text in two directories names two files.
 * Static import/export sources are left to their bindings.
 */
const indexRelativeString = (site, value, index, filePath) => {
  const isRelative = Boolean(filePath) && typeof value === 'string' && RELATIVE_PATH.test(value);
  const isModuleSource = MODULE_SOURCE_PARENTS.has(site.parent?.type) && site.parent.source === site.node;
  const isAnchor = isRelative && !isModuleSource && !index.has(site.node);
  if (!isAnchor) return;
  const importRef = `${normalizeImportSource(value, filePath)}#*`;
  index.set(site.node, { origin: 'import', bindingId: null, isDecl: false, importRef });
};

/** Site handlers by node type that fill `index` (Map<node, entry>); `ids` numbers bindings per file. */
const createSiteHandlers = (index, ids, filePath) => {
  const onCall = (site) => indexDynamicSource(site, index, filePath);
  return {
    Identifier(site) {
      index.set(site.node, describeIdentifier(site, ids, filePath));
    },
    JSXIdentifier(site) {
      const entry = describeJsxName(site, ids, filePath);
      if (entry) index.set(site.node, entry);
    },
    CallExpression: onCall,
    ImportExpression: onCall,
    StringLiteral(site) {
      indexRelativeString(site, site.node.value, index, filePath);
    },
    TemplateLiteral(site) {
      const isPlain = site.node.expressions.length === 0 && site.parent?.type !== 'TaggedTemplateExpression';
      if (isPlain) indexRelativeString(site, site.node.quasis[0]?.value.cooked, index, filePath);
    }
  };
};

/**
 * Babel visitors that fill `index` (Map<node, entry>); `ids` numbers bindings per file. The audit's
 * merged traverse uses these; fillBindingIndex builds the same index without a visitor traverse.
 */
export const createBindingVisitors = (index, ids, filePath = null) => {
  const visitors = {};
  for (const [type, handle] of Object.entries(createSiteHandlers(index, ids, filePath))) visitors[type] = (nodePath) => handle(siteOfPath(nodePath));
  return visitors;
};

/**
 * Fills `index` and `ids` for one Babel AST as createBindingVisitors would in a traverse of it, from a
 * walk over the scopes Babel crawled (binding-walk.js). When the walk cannot finish (a scopable node
 * without a crawled scope, or a root that is not a File), nothing it found is kept and a real
 * traverse fills the index instead.
 */
export const fillBindingIndex = (ast, index, ids, filePath = null) => {
  const walkedIndex = new Map();
  const walkedIds = new Map(ids);
  const isWalked = walkBindingSites(ast, createSiteHandlers(walkedIndex, walkedIds, filePath));
  if (!isWalked) {
    traverse(ast, createBindingVisitors(index, ids, filePath));
    return;
  }
  for (const [node, entry] of walkedIndex) index.set(node, entry);
  for (const [binding, id] of walkedIds) ids.set(binding, id);
};

/** Builds Map<IdentifierNode, entry> for a whole Babel File/Program AST. */
export const buildBindingIndex = (ast, { filePath = null } = {}) => {
  const index = new Map();
  fillBindingIndex(ast, index, new Map(), filePath);
  return index;
};

/** Entry for an Identifier the index never saw (synthesized nodes): treated as a global name. */
export const UNKNOWN_IDENTIFIER = Object.freeze({ origin: 'global', bindingId: null, isDecl: false, importRef: null });
