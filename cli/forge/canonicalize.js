// Forge canonicalization entry (engine doc section 2): Babel node -> canonical hashing tree.
// Pipeline: convert (strip TS/parens, !== as !(===), template strings, arrow bodies, block bodies)
// -> (opt-in, unsound-prone) single-use alias inlining to a fixpoint -> Boolean-in-test, n-ary flattening and De Morgan.
// The tree is for hashing only and is never emitted back into source files.
import { parse } from '../babel-lazy.js';
import { SCRIPT_PARSE_OPTIONS, parseOptionsFor } from '../sfc/script-asts.js';
import { buildBindingIndex } from './bindings.js';
import { convertNode } from './canon-nodes.js';
import { inlineAliases } from './canon-inline.js';
import { normalizeLogic } from './canon-logic.js';
import { isInlineRequested } from './inline-mode.js';

export const PARSE_OPTIONS = SCRIPT_PARSE_OPTIONS;

const childList = (value) => (Array.isArray(value) ? value : [value]);

/**
 * A direct eval or a `with` anywhere in the tree can read any binding by name, so renaming one is
 * visible (#2596): every binder keeps its name (hash-labels.js appends it to the #k / @k number).
 */
const keepBinderNames = (node) => {
  const isBinder = node.type === 'Identifier' && node.ident?.origin === 'local';
  if (isBinder) node.keepsName = true;
  for (const value of Object.values(node.kids)) {
    for (const child of childList(value)) child && keepBinderNames(child);
  }
};

/**
 * Canonicalizes one Babel node. bindings: Map<IdentifierNode, entry> from buildBindingIndex.
 * inline: run single-use alias inlining (unsound-prone, off by default; CHEMX_FORGE_INLINE=1 turns it on).
 */
export const canonicalize = (node, { bindings, inline = isInlineRequested() }) => {
  const ctx = { bindings, hasDynamicScope: false };
  const converted = convertNode(node, ctx);
  if (!converted) return null;
  if (ctx.hasDynamicScope) keepBinderNames(converted);
  return normalizeLogic(inline ? inlineAliases(converted) : converted);
};

/**
 * Parses a module source and canonicalizes its Program. Returns { ast, bindings, program }.
 * filePath (project-relative) resolves relative import sources in import anchors.
 */
export const canonicalizeSource = (code, { filePath = null } = {}) => {
  const ast = parse(code, parseOptionsFor(filePath));
  const bindings = buildBindingIndex(ast, { filePath });
  return { ast, bindings, program: canonicalize(ast.program, { bindings }) };
};
