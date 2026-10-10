import fs from 'node:fs';
import path from 'node:path';
import { parseSource, langForPath } from './source-parse.js';

const RESOLVE_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.mts', '.tsx', '.jsx', '.vue', '.json'];
const INDEX_FILES = ['index.js', 'index.mjs', 'index.ts', 'index.vue'];
const CHECKED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const IMPORT_NODES = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration']);

const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

const isRelative = (spec) => spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');

const existsAsModule = (base) => {
  const hasDirect = RESOLVE_EXTENSIONS.some((ext) => isFile(base + ext));
  const hasIndex = INDEX_FILES.some((name) => isFile(path.join(base, name)));
  return hasDirect || hasIndex;
};

// Static relative specifiers of import/export-from declarations (dynamic import() is not looked at).
export const relativeImportsOf = (text, filePath) => {
  const parsed = parseSource(text, filePath);
  const nodes = parsed.ok ? parsed.programs.flatMap((program) => program.body) : [];
  const isStaticRelative = (node) => {
    const source = node.source?.value;
    const isDeclaration = IMPORT_NODES.has(node.type) && typeof source === 'string';
    const isTypeOnly = node.importKind === 'type' || node.exportKind === 'type';
    return isDeclaration && isRelative(source) && !isTypeOnly;
  };
  return nodes.filter(isStaticRelative).map((node) => node.source.value);
};

/**
 * Relative imports that the new text adds and that point at no file. Only JS/TS files (not .vue)
 * are looked at, and an import the old text already had is left alone, so one edit is never
 * blocked by a break that was there before it. Not checked: aliases, packages, dynamic import().
 *
 * @returns {string[]} The missing specifiers, in source order.
 */
export const newMissingImports = (absPath, beforeText, afterText) => {
  const ext = path.extname(absPath).toLowerCase();
  const isChecked = Boolean(langForPath(absPath)) && CHECKED_EXTENSIONS.has(ext);
  if (!isChecked) return [];
  const known = new Set(beforeText ? relativeImportsOf(beforeText, absPath) : []);
  const dir = path.dirname(absPath);
  const fresh = relativeImportsOf(afterText, absPath).filter((spec) => !known.has(spec));
  return [...new Set(fresh)].filter((spec) => !existsAsModule(path.resolve(dir, spec)));
};

export const missingImportMessage = (file, missing) => `${file}: imports ${missing.join(', ')}, which does not exist, so nothing was written (a missing module crashes every process that loads this file). Create the module first, or pass allowMissingImport (CLI: --allow-missing-import) for a multi-file change that creates it next. Only relative JS/TS imports the edit adds are checked.`;
