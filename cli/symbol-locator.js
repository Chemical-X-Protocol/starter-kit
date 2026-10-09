/**
 * AST symbol locator for `read --symbol`.
 *
 * Declaration ranges come from Babel node locations, never from brace counting, so
 * strings, regexes, comments and semicolon-free code cannot shift them. Supports
 * qualified names (`Class.method`, `useStore.fetch`, `useStore.actions.fetch`) and Vue/Svelte
 * script blocks (positions are file positions). Returns every match.
 */
// Babel loads on first use (babel-lazy.js), so plain reads that never parse skip it.
import { traverse } from './babel-lazy.js';
import { parseBabel, langForPath } from './source-parse.js';
import { extractScriptBlocks, isSfcFile } from './sfc-scripts.js';

const DECLARATION_TYPES = new Set([
  'FunctionDeclaration', 'ClassDeclaration', 'VariableDeclarator', 'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration',
  'ClassMethod', 'ClassPrivateMethod', 'ClassProperty', 'ObjectMethod', 'ObjectProperty'
]);
const FUNCTION_VALUE_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'ObjectExpression']);

const keyName = (key) => key?.name ?? key?.value ?? key?.id?.name ?? null;

const ownName = (node) => {
  const isKeyed = ['ClassMethod', 'ClassPrivateMethod', 'ClassProperty', 'ObjectMethod', 'ObjectProperty'].includes(node.type);
  if (isKeyed) return keyName(node.key);
  const isVariableDeclarator = node.type === 'VariableDeclarator';
  if (isVariableDeclarator) {
    const hasIdentifierId = node.id?.type === 'Identifier';
    return hasIdentifierId ? node.id.name : null;
  }
  return node.id?.name ?? null;
};

const isCandidate = (node) => {
  const isDeclarationType = DECLARATION_TYPES.has(node.type);
  if (!isDeclarationType) return false;
  const isPlainProperty = node.type === 'ObjectProperty' && !FUNCTION_VALUE_TYPES.has(node.value?.type);
  return !isPlainProperty && Boolean(ownName(node));
};

const containerNames = (nodePath) => {
  const names = [];
  let current = nodePath.parentPath;
  while (current) {
    const isNamedContainer = isCandidate(current.node) || current.node.type === 'ClassExpression';
    if (isNamedContainer) names.unshift(ownName(current.node));
    current = current.parentPath;
  }
  return names.filter(Boolean);
};

const rangeNode = (nodePath) => {
  let target = nodePath;
  const isDeclarator = nodePath.node.type === 'VariableDeclarator';
  if (isDeclarator) target = nodePath.parentPath;
  const isExported = ['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(target.parentPath?.node.type);
  return isExported ? target.parentPath.node : target.node;
};

const matchesQuery = (segments, containers, name) => {
  const last = segments[segments.length - 1];
  const isDifferentName = last !== name;
  if (isDifferentName) return false;
  let cursor = 0;
  for (const segment of segments.slice(0, -1)) {
    const found = containers.indexOf(segment, cursor);
    const isMissing = found === -1;
    if (isMissing) return false;
    cursor = found + 1;
  }
  return true;
};

const sourcesFor = (code, filePath) => {
  if (isSfcFile(filePath)) {
    return extractScriptBlocks(code).map((b) => ({ code: b.code, lang: b.lang === 'ts' || b.lang === 'tsx' ? b.lang : 'js' }));
  }
  const lang = langForPath(filePath);
  return lang ? [{ code, lang }] : null;
};

const tryParse = (source) => {
  try {
    return parseBabel(source.code, source.lang, { errorRecovery: true });
  } catch (err) {
    const isDebugEnabled = Boolean(process.env.CHEMX_DEBUG);
    if (isDebugEnabled) process.stderr.write(`[symbol-locator] parse failed: ${err.message}\n`);
    return null;
  }
};

/**
 * @param {string} code File content.
 * @param {string} filePath File path (decides the parser).
 * @param {string} query Symbol name, optionally qualified with dots.
 * @returns {Array<{ name: string, kind: string, startLine: number, endLine: number, code: string }>|null}
 *   null when the file type has no AST support (caller may fall back).
 */
export const locateSymbols = (code, filePath, query) => {
  const sources = sourcesFor(code, filePath);
  if (!sources) return null;
  const segments = String(query).split('.').filter(Boolean);
  const lines = code.split('\n');
  const matches = [];
  for (const source of sources) {
    const ast = tryParse(source);
    if (!ast) continue;
    traverse(ast, {
      enter(nodePath) {
        const isMatch = isCandidate(nodePath.node) && matchesQuery(segments, containerNames(nodePath), ownName(nodePath.node));
        if (!isMatch) return;
        const node = rangeNode(nodePath);
        const startLine = node.loc.start.line;
        const endLine = node.loc.end.line;
        const name = [...containerNames(nodePath), ownName(nodePath.node)].join('.');
        matches.push({ name, kind: nodePath.node.type, startLine, endLine, code: lines.slice(startLine - 1, endLine).join('\n') });
      }
    });
  }
  return matches.sort((a, b) => a.startLine - b.startLine);
};
