// Forge canonicalization entry (engine doc section 2): Babel node -> canonical hashing tree.
// Pipeline: convert (strip TS/parens, !== as !(===), template strings, arrow bodies, block bodies)
// -> (opt-in, unsound-prone) single-use alias inlining to a fixpoint -> Boolean-in-test, n-ary flattening and De Morgan.
// The tree is for hashing only and is never emitted back into source files.
import { parse } from '../babel-lazy.js';
import { buildBindingIndex } from './bindings.js';
import { convertNode } from './canon-nodes.js';
import { inlineAliases } from './canon-inline.js';
import { normalizeLogic } from './canon-logic.js';
import { isInlineRequested } from './inline-mode.js';

export const PARSE_OPTIONS = Object.freeze({ sourceType: 'module', plugins: ['typescript', 'jsx'] });

/**
 * Canonicalizes one Babel node. bindings: Map<IdentifierNode, entry> from buildBindingIndex.
 * inline: run single-use alias inlining (unsound-prone, off by default; CHEMX_FORGE_INLINE=1 turns it on).
 */
export const canonicalize = (node, { bindings, inline = isInlineRequested() }) => {
  const converted = convertNode(node, { bindings });
  if (!converted) return null;
  return normalizeLogic(inline ? inlineAliases(converted) : converted);
};

/**
 * Parses a module source and canonicalizes its Program. Returns { ast, bindings, program }.
 * filePath (project-relative) resolves relative import sources in import anchors.
 */
export const canonicalizeSource = (code, { filePath = null } = {}) => {
  const ast = parse(code, PARSE_OPTIONS);
  const bindings = buildBindingIndex(ast, { filePath });
  return { ast, bindings, program: canonicalize(ast.program, { bindings }) };
};
