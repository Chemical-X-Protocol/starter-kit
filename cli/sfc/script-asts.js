// Script ASTs of a module or an SFC script overlay, shared by the audit (cli/audit/ast-passes.js) and
// Forge's standalone fingerprinting (cli/forge/file-units.js) so both read the same trees. When an
// SFC's combined overlay does not parse (for example the same binding declared in both <script>
// blocks), each inline block is parsed on its own.
import { parse } from '../babel-lazy.js';
import { buildScriptOverlay } from './sfc-parse.js';

// Decorators and auto-accessors (#4563) are on for every file. JSX is on unless the path is a plain TypeScript
// file (.ts/.mts/.cts), where `<T>x` is a cast and JSX would reject it; a null path keeps JSX on.
const SHARED_PLUGINS = Object.freeze(['typescript', ['decorators', { decoratorsBeforeExport: false }], 'decoratorAutoAccessors']);
const PLAIN_TS = /\.[mc]?ts$/i;

export const SCRIPT_PARSE_OPTIONS = Object.freeze({ sourceType: 'module', plugins: [...SHARED_PLUGINS, 'jsx'] });
const PLAIN_TS_PARSE_OPTIONS = Object.freeze({ sourceType: 'module', plugins: [...SHARED_PLUGINS] });

/** Parse options for a file path (project-relative or absolute); null or an unknown path gets SCRIPT_PARSE_OPTIONS. */
export const parseOptionsFor = (filePath) => (typeof filePath === 'string' && PLAIN_TS.test(filePath) ? PLAIN_TS_PARSE_OPTIONS : SCRIPT_PARSE_OPTIONS);

const toParseError = (err) => ({
  message: err instanceof Error ? err.message : String(err),
  line: err?.loc?.line ?? 1
});

const tryParse = (code, options) => {
  try {
    return { ast: parse(code, options), error: null };
  } catch (err) {
    return { ast: null, error: toParseError(err) };
  }
};

/** Returns { asts, error }: one AST normally, one per script block on fallback. */
export const parseScriptAsts = (code, sfc, content, filePath = null) => {
  const options = parseOptionsFor(filePath);
  const combined = tryParse(code, options);
  const hasCombinedAst = Boolean(combined.ast);
  if (hasCombinedAst) return { asts: [combined.ast], error: null };
  const inlineScripts = sfc ? sfc.scripts.filter((s) => !s.src) : [];
  const canSplit = inlineScripts.length > 1;
  if (!canSplit) return { asts: [], error: combined.error };
  const perBlock = inlineScripts.map((block) => tryParse(buildScriptOverlay(content, [block]), options));
  const failed = perBlock.find((p) => p.error);
  if (failed) return { asts: [], error: failed.error };
  return { asts: perBlock.map((p) => p.ast), error: null };
};
