/**
 * Strict source parsing for mutation safety.
 *
 * parseSource() answers two questions about a file's text: does it parse, and which
 * top-level declarations does it define. JS/TS go through Babel without error recovery,
 * Vue/Svelte through their <script> blocks, JSON through JSON.parse. Anything else is
 * reported as kind 'unchecked' (no claim either way).
 */
import path from 'node:path';
import { parse } from './babel-lazy.js';
import { extractScriptBlocks, isSfcFile } from './sfc-scripts.js';

const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);
const TSX_EXTENSIONS = new Set(['.tsx']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

const pluginsForLang = (lang) => {
  const isTs = lang === 'ts';
  const isTsx = lang === 'tsx';
  if (isTs) return ['typescript', 'decorators-legacy'];
  if (isTsx) return ['typescript', 'jsx', 'decorators-legacy'];
  return ['jsx', 'decorators-legacy'];
};

export const langForPath = (filePath) => {
  const ext = path.extname(String(filePath)).toLowerCase();
  const isTs = TS_EXTENSIONS.has(ext);
  if (isTs) return 'ts';
  const isTsx = TSX_EXTENSIONS.has(ext);
  if (isTsx) return 'tsx';
  const isJs = JS_EXTENSIONS.has(ext);
  if (isJs) return 'js';
  return null;
};

/**
 * Parses one JS/TS source with Babel.
 *
 * @param {string} code Source text.
 * @param {string} lang 'ts' | 'tsx' | 'js'.
 * @param {object} [options] { errorRecovery }
 */
export const parseBabel = (code, lang, options = {}) => parse(code, {
  sourceType: 'unambiguous',
  plugins: pluginsForLang(lang),
  errorRecovery: Boolean(options.errorRecovery)
});

const collectPatternNames = (pattern, names) => {
  const hasNoPattern = !pattern;
  if (hasNoPattern) return;
  const isIdentifier = pattern.type === 'Identifier';
  if (isIdentifier) names.push(pattern.name);
  const isObjectPattern = pattern.type === 'ObjectPattern';
  if (isObjectPattern) pattern.properties.forEach((p) => collectPatternNames(p.value || p.argument, names));
  const isArrayPattern = pattern.type === 'ArrayPattern';
  if (isArrayPattern) pattern.elements.forEach((el) => collectPatternNames(el, names));
  const isRestElement = pattern.type === 'RestElement';
  if (isRestElement) collectPatternNames(pattern.argument, names);
  const isAssignmentPattern = pattern.type === 'AssignmentPattern';
  if (isAssignmentPattern) collectPatternNames(pattern.left, names);
};

/**
 * Names a top-level statement declares ('default' for a default export).
 *
 * @param {object} node Program body node.
 * @returns {string[]}
 */
export const declaredNames = (node) => {
  const names = [];
  const hasNoNode = !node;
  if (hasNoNode) return names;
  const isExportNamed = node.type === 'ExportNamedDeclaration';
  if (isExportNamed) return declaredNames(node.declaration);
  const isExportDefault = node.type === 'ExportDefaultDeclaration';
  if (isExportDefault) {
    names.push('default');
    const innerId = node.declaration?.id?.name;
    const hasInnerId = Boolean(innerId);
    if (hasInnerId) names.push(innerId);
    return names;
  }
  const isVariableDecl = node.type === 'VariableDeclaration';
  if (isVariableDecl) {
    node.declarations.forEach((d) => collectPatternNames(d.id, names));
    return names;
  }
  const hasIdentifier = Boolean(node.id?.name) && node.type !== 'ExpressionStatement';
  if (hasIdentifier) names.push(node.id.name);
  return names;
};

const collectDeclarations = (programs) => {
  const names = new Set();
  for (const program of programs) {
    for (const node of program.body) declaredNames(node).forEach((n) => names.add(n));
  }
  return [...names].sort();
};

const sfcLang = (blockLang) => (blockLang === 'ts' || blockLang === 'tsx' ? blockLang : 'js');

/**
 * @param {string} content File text.
 * @param {string} filePath Path, used for the language decision.
 * @returns {{ kind: 'babel'|'json'|'unchecked', ok: boolean, error: string|null, declarations: string[], programs: object[] }}
 */
export const parseSource = (content, filePath) => {
  const isJson = String(filePath).toLowerCase().endsWith('.json');
  const lang = langForPath(filePath);
  const isSfc = isSfcFile(filePath);
  const isUnchecked = !isJson && !lang && !isSfc;
  if (isUnchecked) return { kind: 'unchecked', ok: true, error: null, declarations: [], programs: [] };

  try {
    if (isJson) {
      JSON.parse(content);
      return { kind: 'json', ok: true, error: null, declarations: [], programs: [] };
    }
    const sources = isSfc
      ? extractScriptBlocks(content).map((b) => ({ code: b.code, lang: sfcLang(b.lang) }))
      : [{ code: content, lang }];
    const programs = sources.map((s) => parseBabel(s.code, s.lang).program);
    return { kind: 'babel', ok: true, error: null, declarations: collectDeclarations(programs), programs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: isJson ? 'json' : 'babel', ok: false, error: message, declarations: [], programs: [] };
  }
};
