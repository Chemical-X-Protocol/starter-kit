// Binding index for Forge canonicalization: one entry per Identifier node in a parsed file, saying
// whether it declares or references a binding, which binding (an opaque per-file id, never hashed) and
// where that binding comes from: 'import' (module binding), 'global' (no binding in the file),
// 'local' (declared somewhere in the file) or 'name' (a property name or key, not a binding at all).
// describeIdentifier is exported so a shared audit traversal can fill the same index in its own pass.
// An import entry also carries importRef '<source>#<imported>' (default, * or the exported name), so
// `get` from 'lodash' and `get` from './api' never share a label or an anchor. A relative source is
// resolved against the file's directory when filePath is known (extension dropped), and a `node:`
// prefix is dropped, so the same module reads the same from every file.
import path from 'node:path';
import { traverse } from '../babel-lazy.js';

const NAME_ENTRY = Object.freeze({ origin: 'name', bindingId: null, isDecl: false, importRef: null });
const SCRIPT_EXTENSION = /\.(m?js|cjs|jsx|ts|mts|cts|tsx|vue)$/;
const IMPORTED_NAME = {
  ImportDefaultSpecifier: () => 'default',
  ImportNamespaceSpecifier: () => '*',
  ImportSpecifier: (specifier) => specifier.imported.name ?? specifier.imported.value
};
const importRefCache = new WeakMap();

/** Module identity of an import source as seen from filePath (null: unknown file, kept verbatim). */
export const normalizeImportSource = (source, filePath = null) => {
  const bare = source.replace(/^node:/, '');
  const isResolvable = bare.startsWith('.') && Boolean(filePath);
  if (!isResolvable) return bare;
  return path.posix.join(path.posix.dirname(filePath), bare).replace(SCRIPT_EXTENSION, '');
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

/** Builds Map<IdentifierNode, entry> for a whole Babel File/Program AST in one traversal. */
export const buildBindingIndex = (ast, { filePath = null } = {}) => {
  const index = new Map();
  const ids = new Map();
  traverse(ast, {
    Identifier(nodePath) {
      index.set(nodePath.node, describeIdentifier(nodePath, ids, filePath));
    }
  });
  return index;
};

/** Entry for an Identifier the index never saw (synthesized nodes): treated as a global name. */
export const UNKNOWN_IDENTIFIER = Object.freeze({ origin: 'global', bindingId: null, isDecl: false, importRef: null });
