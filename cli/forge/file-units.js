// All Forge units of one file, computed purely from (relativePath, content): script units (fn, stmt,
// expr) from the module or the SFC script overlay, plus tmpl units from the Vue template AST or from
// JSX. No disk, no index.db: the store and the incremental hooks wrap this (P2 part B).
import { parseSfc, isSfcFile } from '../sfc/sfc-parse.js';
import { canonicalizeSource } from './canonicalize.js';
import { collectScriptUnits } from './units.js';
import { collectJsxTemplateUnits, collectVueTemplateUnits } from './template-units.js';
import { isForgeExcluded } from './exclusions.js';

const SCRIPT_EXTENSIONS = /\.(m?js|cjs|jsx|ts|mts|cts|tsx)$/;
const JSX_EXTENSIONS = /\.(jsx|tsx)$/;

const toError = (err) => ({ message: err instanceof Error ? err.message : String(err), line: err?.loc?.line ?? 1 });

const scriptUnitsOf = (code, relativePath, options) => {
  const { ast, program } = canonicalizeSource(code);
  const { units, isExprCapped } = collectScriptUnits(program, options);
  const isJsx = JSX_EXTENSIONS.test(relativePath);
  const templateUnits = isJsx ? collectJsxTemplateUnits(ast, code, options) : [];
  return { units: [...units, ...templateUnits], isExprCapped };
};

const sfcUnitsOf = (content, relativePath, options) => {
  const sfc = parseSfc(content, relativePath);
  const hasScript = sfc.scriptOverlay.length > 0;
  const script = hasScript ? scriptUnitsOf(sfc.scriptOverlay, relativePath, options) : { units: [], isExprCapped: false };
  const isVueTemplate = Boolean(sfc.template?.isParsed) && relativePath.endsWith('.vue');
  const templateUnits = isVueTemplate ? collectVueTemplateUnits(sfc.template.ast, options) : [];
  return { units: [...script.units, ...templateUnits], isExprCapped: script.isExprCapped };
};

/**
 * Units of one file. options.ubiquitous feeds the expr gate. Returns
 * { units, isExcluded, isExprCapped, error } where error is null or { message, line } on a parse failure.
 */
export const collectFileUnits = (relativePath, content, options = {}) => {
  const isExcluded = isForgeExcluded(relativePath, content);
  const isSfc = isSfcFile(relativePath);
  const isScript = SCRIPT_EXTENSIONS.test(relativePath);
  const isSupported = isSfc || isScript;
  const isSkipped = isExcluded || !isSupported;
  if (isSkipped) return { units: [], isExcluded, isExprCapped: false, error: null };
  try {
    const collected = isSfc ? sfcUnitsOf(content, relativePath, options) : scriptUnitsOf(content, relativePath, options);
    return { ...collected, isExcluded: false, error: null };
  } catch (err) {
    return { units: [], isExcluded: false, isExprCapped: false, error: toError(err) };
  }
};
