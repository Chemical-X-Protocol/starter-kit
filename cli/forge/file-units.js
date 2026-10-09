// All Forge units of one file, computed purely from (relativePath, content): script units (fn, stmt,
// expr) from the module or the SFC script overlay, plus tmpl units from the Vue template AST or from
// JSX. No disk, no index.db: the store and the incremental hooks wrap this (P2 part B).
// It drives the same collector the audit feeds (createFileFingerprint) over the same trees
// (parseScriptAsts, with its per-block SFC fallback), so the audit, `chemx patterns --sync` and a
// chemx patch/write store identical rows. Vue template units never depend on the script parsing.
import { parseSfc, isSfcFile } from '../sfc/sfc-parse.js';
import { parseScriptAsts } from '../sfc/script-asts.js';
import { traverse } from '../babel-lazy.js';
import { createFileFingerprint, createFingerprintVisitors } from './fingerprint-visitors.js';
import { isForgeExcluded } from './exclusions.js';

const SCRIPT_EXTENSIONS = /\.(m?js|cjs|jsx|ts|mts|cts|tsx)$/;
const NO_SCRIPT = Object.freeze({ asts: [], error: null });

const toError = (err) => ({ message: err instanceof Error ? err.message : String(err), line: err?.loc?.line ?? 1 });

/** True for the files Forge can fingerprint at all: scripts and SFCs (exclusions are separate). */
export const isForgeSource = (relativePath) => isSfcFile(relativePath) || SCRIPT_EXTENSIONS.test(relativePath);

const unitsOf = (relativePath, content, options) => {
  const fingerprint = createFileFingerprint(relativePath, options);
  const sfc = isSfcFile(relativePath) ? parseSfc(content, relativePath) : null;
  if (sfc) fingerprint.addVueTemplate(sfc.template);
  const code = sfc ? sfc.scriptOverlay : content;
  const hasCode = code.trim().length > 0;
  const parsed = hasCode ? parseScriptAsts(code, sfc, content) : NO_SCRIPT;
  for (const ast of parsed.asts) {
    traverse(ast, createFingerprintVisitors(fingerprint));
    fingerprint.addScriptAst(ast, code);
  }
  const result = fingerprint.result();
  return { ...result, error: parsed.error ?? result.error };
};

/**
 * Units of one file. options.ubiquitous feeds the expr gate. Returns
 * { units, isExcluded, isExprCapped, error } where error is null or { message, line } on a parse failure
 * (template units of an SFC are still returned when only its script fails to parse).
 */
export const collectFileUnits = (relativePath, content, options = {}) => {
  const isExcluded = isForgeExcluded(relativePath, content);
  const isSkipped = isExcluded || !isForgeSource(relativePath);
  if (isSkipped) return { units: [], isExcluded, isExprCapped: false, error: null };
  try {
    const collected = unitsOf(relativePath, content, options);
    return { units: collected.units, isExcluded: false, isExprCapped: collected.isExprCapped, error: collected.error };
  } catch (err) {
    return { units: [], isExcluded: false, isExprCapped: false, error: toError(err) };
  }
};
