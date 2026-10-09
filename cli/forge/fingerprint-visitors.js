// Forge inside the audit's own Babel traverse (engine doc section 1): no file is parsed twice.
// createFingerprintVisitors fills the binding index (the costly part of a standalone run) during the
// traverse the audit already does; after it, addScriptAst canonicalizes the Program and collects the
// script units, and addVueTemplate reads the template AST the SFC parse already built.
// The result equals collectFileUnits(relativePath, content) for the same file (fingerprint-visitors.spec).
import { describeIdentifier } from './bindings.js';
import { canonicalize } from './canonicalize.js';
import { collectScriptUnits } from './units.js';
import { collectJsxTemplateUnits, collectVueTemplateUnits } from './template-units.js';

const JSX_EXTENSIONS = /\.(jsx|tsx)$/;

const toError = (err) => ({ message: err instanceof Error ? err.message : String(err), line: err?.loc?.line ?? 1 });

const maxBlockId = (units) => units.reduce((max, unit) => Math.max(max, unit.blockId ?? 0), 0);

/**
 * Per-file collector. options.ubiquitous feeds the expr gate. The audit hands it every script AST
 * (one, or one per script block on the SFC fallback) and the parsed Vue template; result() returns
 * { units, isExprCapped, error } with script units first, as collectFileUnits orders them.
 */
export const createFileFingerprint = (relativePath, { ubiquitous } = {}) => {
  const bindings = new Map();
  const ids = new Map();
  const scriptUnits = [];
  const templateUnits = [];
  const options = { ubiquitous };
  const isJsx = JSX_EXTENSIONS.test(relativePath);
  const isVue = relativePath.endsWith('.vue');
  let isExprCapped = false;
  let error = null;

  const collectAst = (ast, code) => {
    const program = canonicalize(ast.program, { bindings });
    const collected = collectScriptUnits(program, options);
    const offset = maxBlockId(scriptUnits);
    for (const unit of collected.units) scriptUnits.push(unit.blockId ? { ...unit, blockId: unit.blockId + offset } : unit);
    isExprCapped = isExprCapped || collected.isExprCapped;
    if (isJsx) templateUnits.push(...collectJsxTemplateUnits(ast, code, options));
  };

  const guard = (step) => {
    try {
      step();
    } catch (err) {
      error = error ?? toError(err);
    }
  };

  return {
    relativePath,
    bindings,
    ids,
    addScriptAst: (ast, code) => guard(() => collectAst(ast, code)),
    addVueTemplate: (template) => {
      const isVueTemplate = isVue && Boolean(template?.isParsed);
      if (isVueTemplate) guard(() => templateUnits.push(...collectVueTemplateUnits(template.ast, options)));
    },
    result: () => ({ units: [...scriptUnits, ...templateUnits], isExprCapped, error })
  };
};

/** Visitor set merged into the audit traverse: one binding-index entry per Identifier. */
export const createFingerprintVisitors = (fingerprint) => ({
  Identifier(path) {
    fingerprint.bindings.set(path.node, describeIdentifier(path, fingerprint.ids, fingerprint.relativePath));
  }
});
