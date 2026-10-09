// Binding index for Forge canonicalization: one entry per Identifier node in a parsed file, saying
// whether it declares or references a binding, which binding (an opaque per-file id, never hashed) and
// where that binding comes from: 'import' (module binding), 'global' (no binding in the file),
// 'local' (declared somewhere in the file) or 'name' (a property name or key, not a binding at all).
// describeIdentifier is exported so a shared audit traversal can fill the same index in its own pass.
import { traverse } from '../babel-lazy.js';

const NAME_ENTRY = Object.freeze({ origin: 'name', bindingId: null, isDecl: false });

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

/** Describes one Identifier path. `ids` maps Babel binding objects to small per-file integers. */
export const describeIdentifier = (path, ids) => {
  // Babel reports some references (the operand of `!`) as binding identifiers too: a reference wins.
  const isRef = path.isReferencedIdentifier();
  const isDecl = !isRef && path.isBindingIdentifier();
  const isNameOnly = !isDecl && !isRef;
  if (isNameOnly) return NAME_ENTRY;
  const binding = path.scope.getBinding(path.node.name);
  return { origin: originOf(binding), bindingId: idFor(binding, ids), isDecl };
};

/** Builds Map<IdentifierNode, entry> for a whole Babel File/Program AST in one traversal. */
export const buildBindingIndex = (ast) => {
  const index = new Map();
  const ids = new Map();
  traverse(ast, {
    Identifier(path) {
      index.set(path.node, describeIdentifier(path, ids));
    }
  });
  return index;
};

/** Entry for an Identifier the index never saw (synthesized nodes): treated as a global name. */
export const UNKNOWN_IDENTIFIER = Object.freeze({ origin: 'global', bindingId: null, isDecl: false });
