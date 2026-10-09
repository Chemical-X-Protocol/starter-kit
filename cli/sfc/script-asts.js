// Script ASTs of a module or an SFC script overlay, shared by the audit (cli/audit/ast-passes.js) and
// Forge's standalone fingerprinting (cli/forge/file-units.js) so both read the same trees. When an
// SFC's combined overlay does not parse (for example the same binding declared in both <script>
// blocks), each inline block is parsed on its own.
import { parse } from '../babel-lazy.js';
import { buildScriptOverlay } from './sfc-parse.js';

export const SCRIPT_PARSE_OPTIONS = Object.freeze({ sourceType: 'module', plugins: ['typescript', 'jsx'] });

const toParseError = (err) => ({
  message: err instanceof Error ? err.message : String(err),
  line: err?.loc?.line ?? 1
});

const tryParse = (code) => {
  try {
    return { ast: parse(code, SCRIPT_PARSE_OPTIONS), error: null };
  } catch (err) {
    return { ast: null, error: toParseError(err) };
  }
};

/** Returns { asts, error }: one AST normally, one per script block on fallback. */
export const parseScriptAsts = (code, sfc, content) => {
  const combined = tryParse(code);
  const hasCombinedAst = Boolean(combined.ast);
  if (hasCombinedAst) return { asts: [combined.ast], error: null };
  const inlineScripts = sfc ? sfc.scripts.filter((s) => !s.src) : [];
  const canSplit = inlineScripts.length > 1;
  if (!canSplit) return { asts: [], error: combined.error };
  const perBlock = inlineScripts.map((block) => tryParse(buildScriptOverlay(content, [block])));
  const failed = perBlock.find((p) => p.error);
  if (failed) return { asts: [], error: failed.error };
  return { asts: perBlock.map((p) => p.ast), error: null };
};
