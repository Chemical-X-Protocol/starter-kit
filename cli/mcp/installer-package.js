/**
 * Adds scripts to a consumer package.json without reformatting it or dropping content:
 * - a one-line (minified) file stays one line; otherwise its own indent is kept;
 * - a file with comments or that is not a JSON object is refused and left byte-identical;
 * - only missing script names are added, existing ones are never changed.
 */
import fs from 'node:fs';
import { parseJsonc } from './installer-jsonc.js';
import { writeFileSafely } from './installer-write.js';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const detectIndent = (text) => (text.match(/^[ \t]+(?=")/m) || ['  '])[0];

/** Serializes value in the layout of the original text. */
const serializeLike = (text, value) => {
  const isSingleLine = !text.trim().includes('\n');
  const body = isSingleLine ? JSON.stringify(value) : JSON.stringify(value, null, detectIndent(text));
  const hasTrailingNewline = text.endsWith('\n');
  return hasTrailingNewline ? `${body}\n` : body;
};

const refusal = (file, reason) => ({ status: 'refused', file, reason, added: [] });

/** Reasons a package.json must not be rewritten, or null when it is safe to edit. */
const findRefusalReason = (pkg, parseError, meta) => {
  const isObject = !parseError && isPlainObject(pkg);
  if (!isObject) return 'package.json is not a JSON object; left untouched';
  if (meta.hasComments) return 'package.json has comments that a rewrite would drop; left untouched';
  const hasInvalidScripts = pkg.scripts !== undefined && !isPlainObject(pkg.scripts);
  if (hasInvalidScripts) return '"scripts" is not an object; left untouched';
  return null;
};

/**
 * Adds the scripts that pickWanted(existingScripts) names and package.json lacks.
 * Returns { status: 'absent' | 'refused' | 'unchanged' | 'written', file, reason?, added }.
 */
export const addPackageScripts = (pkgPath, pickWanted) => {
  const hasPackage = fs.existsSync(pkgPath);
  if (!hasPackage) return { status: 'absent', file: pkgPath, added: [] };
  const text = fs.readFileSync(pkgPath, 'utf-8');
  const [pkg, parseError, meta] = parseJsonc(text);
  const reason = findRefusalReason(pkg, parseError, meta);
  const isRefused = reason !== null;
  if (isRefused) return refusal(pkgPath, reason);
  const scripts = pkg.scripts || {};
  const missing = Object.entries(pickWanted(scripts)).filter(([name]) => !scripts[name]);
  const hasNothingToAdd = missing.length === 0;
  if (hasNothingToAdd) return { status: 'unchanged', file: pkgPath, added: [] };
  const next = { ...pkg, scripts: { ...scripts, ...Object.fromEntries(missing) } };
  const { status } = writeFileSafely(pkgPath, serializeLike(text, next), { backup: false });
  return { status, file: pkgPath, added: missing.map(([name]) => name) };
};
