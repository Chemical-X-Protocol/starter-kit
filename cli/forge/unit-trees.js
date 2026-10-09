// Canonical trees of group instances, for the LGG (engine doc section 6). The ledger stores only hashes,
// so each member file is parsed and canonicalized again, once per file per run, through the same steps
// the fingerprint pass takes (parseScriptAsts over the module or the SFC script overlay, the binding
// index, canonicalize), and a ledger row is found again by its kind and its offsets:
//   fn    the function node; the LGG walks its body, and its params are the binders a hole may use
//   stmt  the statement of a block body
//   expr  the outermost expression node with those offsets
// A window instance is the list of its statement rows. Template rows have no script tree (null), and so
// has a row whose file changed or no longer parses: the LGG then treats the group as unresolved. A file
// changed since the ledger was written is found by its sha1 against the stored content_hash (the hash
// the sync writes), not by offsets, since an edit can keep them.
import { isSfcFile, parseSfc } from '../sfc/sfc-parse.js';
import { parseScriptAsts } from '../sfc/script-asts.js';
import { buildBindingIndex } from './bindings.js';
import { canonicalize } from './canonicalize.js';
import { contentHashOf } from './fingerprint-session.js';

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);

const childList = (value) => (Array.isArray(value) ? value : [value]);

const spanKey = (start, end) => `${start}:${end}`;

const isFunctionUnit = (node) => FUNCTION_TYPES.has(node.type) && node.kids.body?.type === 'BlockStatement';

// Offsets -> node, one map per unit kind; the first node seen (preorder) wins, so an expr key names the
// outermost expression of that span.
const indexProgram = (program, index) => {
  const remember = (kind, node) => {
    const loc = node.loc;
    const hasOffsets = loc && loc.startOffset !== null && loc.startOffset !== undefined;
    const key = hasOffsets ? spanKey(loc.startOffset, loc.endOffset) : null;
    const isNew = key !== null && !index[kind].has(key);
    if (isNew) index[kind].set(key, node);
  };
  const visit = (node, parentType, key) => {
    const isStatement = parentType === 'BlockStatement' && key === 'body';
    if (isStatement) remember('stmt', node);
    if (isFunctionUnit(node)) remember('fn', node);
    if (node.isExpr) remember('expr', node);
    for (const [childKey, value] of Object.entries(node.kids)) {
      for (const child of childList(value)) child && visit(child, node.type, childKey);
    }
  };
  visit(program, null, null);
};

const emptyIndex = () => ({ fn: new Map(), stmt: new Map(), expr: new Map() });

const scriptOf = (relativePath, content) => {
  const sfc = isSfcFile(relativePath) ? parseSfc(content, relativePath) : null;
  const code = sfc ? sfc.scriptOverlay : content;
  return { sfc, code };
};

const indexFile = (relativePath, content) => {
  const index = emptyIndex();
  const { sfc, code } = scriptOf(relativePath, content);
  const hasCode = code.trim().length > 0;
  const asts = hasCode ? parseScriptAsts(code, sfc, content).asts : [];
  for (const ast of asts) {
    const bindings = buildBindingIndex(ast, { filePath: relativePath });
    const program = canonicalize(ast.program, { bindings });
    if (program) indexProgram(program, index);
  }
  return index;
};

const declaredIds = (nodes) => {
  const ids = new Set();
  const visit = (node) => {
    const isDeclaration = node.type === 'Identifier' && node.ident?.isDecl && node.ident.bindingId !== null;
    if (isDeclaration) ids.add(node.ident.bindingId);
    for (const value of Object.values(node.kids)) {
      for (const child of childList(value)) child && visit(child);
    }
  };
  nodes.forEach(visit);
  return ids;
};

// Binders a hole may read: only a fn unit's own params, since a piece cut from a function body takes
// them as its own. Params of a nested callback are unit locals like any other (R3): a value param cannot
// read a name bound only inside the piece, unless the hole side declares it itself (hole-kinds.js).
const NO_PARAMS = Object.freeze(new Set());

// One instance tree: { root, declScope, paramIds, kind }. root is a node, or an array for a window.
const fnTree = (node) => ({ root: node.kids.body, declScope: node, paramIds: declaredIds(node.kids.params ?? []), kind: 'fn' });
const plainTree = (kind) => (node) => ({ root: node, declScope: null, paramIds: NO_PARAMS, kind });
const TREE_OF_KIND = { fn: fnTree, stmt: plainTree('stmt'), expr: plainTree('expr') };

const safeIndexOf = (relativePath, content) => {
  try {
    return indexFile(relativePath, content);
  } catch {
    return emptyIndex();
  }
};

// A file is current when the ledger has no hash for it (a caller without one) or the hashes agree.
const isCurrent = (contentHashes, relativePath, content) => {
  const stored = contentHashes?.get(relativePath) ?? null;
  return stored === null || stored === contentHashOf(content);
};

/**
 * Tree reader over readFile(relativePath) => text | null and the ledger rows (for window members).
 * options.contentHashes (the ledger's path -> content_hash): a file whose text no longer hashes to it
 * has no trees, so its members are stale. treeOf(instance) returns { root, declScope, paramIds, kind }
 * or null when a member cannot be found.
 */
export const createTreeReader = (readFile, rows, { contentHashes = null } = {}) => {
  const indexes = new Map();
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const indexOf = (relativePath) => {
    const isCached = indexes.has(relativePath);
    if (isCached) return indexes.get(relativePath);
    const content = readFile(relativePath);
    const isUsable = content !== null && isCurrent(contentHashes, relativePath, content);
    const index = isUsable ? safeIndexOf(relativePath, content) : emptyIndex();
    indexes.set(relativePath, index);
    return index;
  };

  const nodeOf = (row) => indexOf(row.file_path)[row.kind]?.get(spanKey(row.start, row.end)) ?? null;

  const windowTree = (instance) => {
    const nodes = instance.unitIds.map((id) => nodeOf(rowsById.get(id)));
    const isComplete = nodes.every(Boolean);
    return isComplete ? { root: nodes, declScope: null, paramIds: NO_PARAMS, kind: 'window' } : null;
  };

  const readTree = (instance) => {
    const isWindow = instance.kind === 'window';
    if (isWindow) return windowTree(instance);
    const toTree = TREE_OF_KIND[instance.kind];
    const row = rowsById.get(instance.unitIds[0]);
    const node = toTree && row ? nodeOf(row) : null;
    return node ? toTree(node) : null;
  };

  // One tree object per instance span, so the LGG can memoize its per-node notes on it.
  const trees = new Map();
  const treeOf = (instance) => {
    const key = `${instance.kind}|${instance.unitIds.join(',')}`;
    const isKnown = trees.has(key);
    if (!isKnown) trees.set(key, readTree(instance));
    return trees.get(key);
  };

  return { treeOf };
};
