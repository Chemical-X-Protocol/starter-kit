/**
 * Babel parse and visitor passes for script code (a plain module or an SFC script
 * overlay). When an SFC's combined overlay does not parse (for example the same
 * binding declared in both <script> blocks), each block is parsed on its own.
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { createAstVisitors } from './ast-visitors.js';
import { createAiSlopVisitors } from './ai-slop-detector.js';
import { createExtendedVisitors } from './extended-visitors.js';
import { createPatternVisitors } from './pattern-detector.js';
import { createHookShapeRegistry } from './hook-shape-validator.js';
import { buildScriptOverlay } from '../sfc/sfc-parse.js';
import { createJsxRenderDepthVisitor } from './render-depth.js';

const traverseFn = traverse.default || traverse;
const PARSE_OPTIONS = { sourceType: 'module', plugins: ['typescript', 'jsx'] };

const toParseError = (err) => ({
  message: err instanceof Error ? err.message : String(err),
  line: err?.loc?.line ?? 1
});

const tryParse = (code) => {
  try {
    return { ast: parse(code, PARSE_OPTIONS), error: null };
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

const mergeVisitorSets = (visitorSets) => {
  const merged = {};
  for (const visitorSet of visitorSets) {
    for (const [key, fn] of Object.entries(visitorSet)) {
      const previous = merged[key];
      merged[key] = previous ? (p, s) => { previous(p, s); fn(p, s); } : fn;
    }
  }
  return merged;
};

/** Runs every AST visitor family over the parsed script ASTs. */
export const runAstPasses = (asts, { relativePath, violations, ruleConfig, options }) => {
  const hookRegistry = options.hookRegistry || createHookShapeRegistry();
  for (const ast of asts) {
    const visitorSets = [
      createAstVisitors({ relativePath, violations, hookRegistry, config: ruleConfig }),
      createAiSlopVisitors({ relativePath, violations }),
      createExtendedVisitors({ relativePath, violations }),
      createJsxRenderDepthVisitor({ relativePath, violations, config: ruleConfig }),
      options.patternRegistry ? createPatternVisitors(options.patternRegistry, relativePath) : {}
    ];
    traverseFn(ast, mergeVisitorSets(visitorSets));
  }
  const shouldRunLocalConsistency = !options.hookRegistry;
  if (shouldRunLocalConsistency) violations.push(...hookRegistry.validateCrossHookConsistency());
};
