/**
 * Babel visitor passes for script code (a plain module or an SFC script overlay).
 * Parsing, with the per-block fallback for SFCs whose combined overlay does not
 * parse, lives in cli/sfc/script-asts.js so Forge's standalone path reads the same trees.
 */
import traverse from '@babel/traverse';
import { createAstVisitors } from './ast-visitors.js';
import { createAiSlopVisitors } from './ai-slop-detector.js';
import { createExtendedVisitors } from './extended-visitors.js';
import { createPatternVisitors } from './pattern-detector.js';
import { createHookShapeRegistry } from './hook-shape-validator.js';
import { createJsxRenderDepthVisitor } from './render-depth.js';
import { createFingerprintVisitors } from '../forge/fingerprint-visitors.js';

export { parseScriptAsts } from '../sfc/script-asts.js';

const traverseFn = traverse.default || traverse;

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

/**
 * Runs every AST visitor family over the parsed script ASTs. options.fingerprint (a Forge collector)
 * fills its binding index in the same traverse and fingerprints each AST right after it; the legacy
 * pattern visitors still run alongside until Forge replaces them.
 */
export const runAstPasses = (asts, { relativePath, violations, ruleConfig, options, code = '' }) => {
  const hookRegistry = options.hookRegistry || createHookShapeRegistry();
  const fingerprint = options.fingerprint || null;
  for (const ast of asts) {
    const visitorSets = [
      createAstVisitors({ relativePath, violations, hookRegistry, config: ruleConfig }),
      createAiSlopVisitors({ relativePath, violations }),
      createExtendedVisitors({ relativePath, violations }),
      createJsxRenderDepthVisitor({ relativePath, violations, config: ruleConfig }),
      options.patternRegistry ? createPatternVisitors(options.patternRegistry, relativePath) : {},
      fingerprint ? createFingerprintVisitors(fingerprint) : {}
    ];
    traverseFn(ast, mergeVisitorSets(visitorSets));
    if (fingerprint) fingerprint.addScriptAst(ast, code);
  }
  const shouldRunLocalConsistency = !options.hookRegistry;
  if (shouldRunLocalConsistency) violations.push(...hookRegistry.validateCrossHookConsistency());
};
