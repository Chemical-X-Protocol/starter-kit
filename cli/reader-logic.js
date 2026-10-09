import { parse } from './babel-lazy.js';
import { blankOutsideScripts } from './sfc-scripts.js';
import { stripCommentsKeepingLines } from './comment-ranges.js';

/**
 * Removes comments using real token ranges (strings, regexes and URLs are safe) and keeps
 * every newline, so line numbers do not move. Returns the code unchanged when the file type
 * has no tokenizer or does not parse.
 *
 * @param {string} code Source code.
 * @param {string} [filePath='file.tsx'] Path deciding the tokenizer.
 * @returns {string} Code without comments.
 */
export const stripCodeComments = (code, filePath = 'file.tsx') => stripCommentsKeepingLines(code, filePath) ?? code;

/**
 * Collapses consecutive blank lines and trims trailing spaces.
 *
 * @param {string} code Source code.
 * @returns {string} Compact code.
 */
export const compactCode = (code) => {
  return code
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => {
      const isCurrentEmpty = line.trim() === '';
      const isPrevEmpty = idx > 0 && arr[idx - 1].trim() === '';
      return !(isCurrentEmpty && isPrevEmpty);
    })
    .join('\n');
};

export const resolveDeclarationKind = (declaration) => {
  const init = declaration.init;
  if (!init) return 'const';

  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
    return 'function';
  }

  if (init.type !== 'CallExpression') {
    return 'const';
  }

  const calleeName = init.callee?.name;
  if (calleeName === 'computed') {
    return 'computed';
  }
  if (calleeName === 'ref') {
    return 'ref';
  }
  if (calleeName && calleeName.startsWith('use')) {
    return 'hook';
  }

  return 'const';
};

/**
 * Summarizes declarative template bindings, components, and events (Vue, Svelte, JSX).
 *
 * @param {string} code Source code.
 * @param {string} filePath File path.
 * @returns {string|null} Compact template summary.
 */
export const summarizeTemplate = (code, filePath = '') => {
  const isVue = filePath.endsWith('.vue');
  const isSvelte = filePath.endsWith('.svelte');
  let tpl = '';

  if (isVue) {
    const match = code.match(/<template[\s\S]*?>([\s\S]*?)<\/template>/i);
    if (match) tpl = match[1];
  } else if (isSvelte) {
    tpl = code
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
  } else if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
    tpl = code;
  }

  if (!tpl.trim()) return null;

  const tagMatches = tpl.matchAll(/<([A-Z][a-zA-Z0-9]+|[a-z]+-[a-z0-9-]+)\b/g);
  const tags = new Set();
  for (const m of tagMatches) {
    tags.add(`<${m[1]}>`);
  }

  const eventMatches = tpl.matchAll(/(?:@|v-on:|on:)([a-zA-Z0-9_.:-]+)="([^"]+)"/g);
  const events = new Set();
  for (const m of eventMatches) {
    events.add(`@${m[1]}="${m[2]}"`);
  }

  const reactEventMatches = tpl.matchAll(/\b(on[A-Z][a-zA-Z0-9]*)=\{([^}]+)\}/g);
  for (const m of reactEventMatches) {
    events.add(`${m[1]}={${m[2].trim()}}`);
  }

  const parts = [];
  if (tags.size > 0) parts.push(`Components: ${Array.from(tags).slice(0, 10).join(', ')}`);
  if (events.size > 0) parts.push(`Events: ${Array.from(events).slice(0, 8).join(', ')}`);

  return parts.length > 0
    ? `// [Template Summary: ${parts.join(' | ')}]`
    : '// [Template Summary: Static markup]';
};

/**
 * Extracts raw template markup from Vue, Svelte, or JSX files.
 *
 * @param {string} code Source code.
 * @param {string} filePath File path.
 * @returns {string} Extracted template markup.
 */
export const extractTemplateContent = (code, filePath = '') => {
  const isVue = filePath.endsWith('.vue');
  const isSvelte = filePath.endsWith('.svelte');

  if (isVue) {
    const match = code.match(/<template[\s\S]*?>([\s\S]*?)<\/template>/i);
    return match ? match[0].trim() : '// No <template> block found in Vue file.';
  }

  if (isSvelte) {
    const cleaned = code
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .trim();
    return cleaned || '// No template markup found in Svelte file.';
  }

  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
    const jsxMatch = code.match(/return\s*\(\s*(<[\s\S]*?>[\s\S]*?)\s*\);/);
    if (jsxMatch) return jsxMatch[1].trim();
  }

  return `// File ${filePath} is a script/module without declarative template syntax.`;
};

export const SKELETON_LABEL = 'skeleton: not verbatim, not a patch target';

const isFunctionInit = (init) => Boolean(init) && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression');

const isLogicStatement = (stmt) => {
  if (!stmt) return false;
  switch (stmt.type) {
    case 'IfStatement':
    case 'ReturnStatement':
    case 'ThrowStatement':
    case 'SwitchStatement':
    case 'TryStatement':
    case 'WhileStatement':
    case 'ForStatement':
    case 'ForOfStatement':
    case 'ForInStatement':
      return true;
    case 'ExpressionStatement': {
      const expr = stmt.expression;
      const isCall = expr.type === 'CallExpression' || expr.type === 'OptionalCallExpression';
      const isConsoleCall = isCall && expr.callee.type === 'MemberExpression' && expr.callee.object?.name === 'console';
      return expr.type === 'AssignmentExpression' || expr.type === 'AwaitExpression' || (isCall && !isConsoleCall);
    }
    case 'VariableDeclaration':
      return stmt.declarations.some((d) => ['CallExpression', 'OptionalCallExpression', 'AwaitExpression', 'LogicalExpression', 'BinaryExpression'].includes(d.init?.type));
    default:
      return false;
  }
};

/**
 * Extracts an AST logic skeleton of a file (control flow, state, guards, side-effects, mutations).
 * Every emitted declaration header and statement is sliced verbatim from the source by character
 * range (keywords, export/async forms and TS annotations kept), but bodies are filtered, so the
 * result is labeled as a skeleton and each block names its source lines.
 *
 * @param {string} code Source code.
 * @param {string} filePath File path for parser context.
 * @returns {string} Labeled logic skeleton.
 */
export const generateAstLogicSkeleton = (code, filePath) => {
  const isSfc = filePath.endsWith('.vue') || filePath.endsWith('.svelte');
  const scriptContent = isSfc ? blankOutsideScripts(code) : code;
  const lines = [`// Logic Skeleton: ${filePath} (${SKELETON_LABEL})`];
  const src = (node) => scriptContent.slice(node.start, node.end).trim();
  const origin = (node) => `  // L${node.loc.start.line}-${node.loc.end.line}`;

  let ast;
  try {
    ast = parse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'topLevelAwait'],
      errorRecovery: true,
    });
  } catch (err) {
    lines.push(`// [AST parsing failed: ${err.message}. No skeleton available; read a line range instead.]`);
    return lines.join('\n');
  }

  const importsSummary = [];
  const stateDeclarations = [];
  const logicBlocks = [];

  const emitBody = (fnNode, indent) => {
    const out = [];
    for (const stmt of fnNode.body.body || []) {
      const innerFns = stmt.type === 'VariableDeclaration' ? stmt.declarations.filter((d) => isFunctionInit(d.init)) : [];
      const hasInnerFunctions = innerFns.length > 0;
      if (hasInnerFunctions) {
        innerFns.forEach((d) => out.push(...emitFunction(d.init, stmt, `${stmt.kind} ${scriptContent.slice(d.start, d.init.body.start).trim()}`, indent)));
      } else if (isLogicStatement(stmt)) {
        const isJsxReturn = stmt.type === 'ReturnStatement' && ['JSXElement', 'JSXFragment'].includes(stmt.argument?.type);
        out.push(`${indent}${isJsxReturn ? 'return (/* JSX template */);' : src(stmt)}`);
      }
    }
    return out;
  };

  function emitFunction(fnNode, declNode, header, indent = '') {
    const hasBlockBody = fnNode.body?.type === 'BlockStatement';
    if (!hasBlockBody) return [`${indent}${src(declNode)}${origin(declNode)}`];
    return [`${indent}${header} {${origin(declNode)}`, ...emitBody(fnNode, `${indent}  `), `${indent}}`];
  }

  const headerOf = (declNode, fnNode) => scriptContent.slice(declNode.start, fnNode.body.start).trim();
  const isStateKind = (d) => ['ref', 'computed', 'hook'].includes(resolveDeclarationKind(d));

  for (const node of ast.program.body) {
    const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
    const hasDeclaration = Boolean(decl);
    if (!hasDeclaration) continue;
    const isImport = node.type === 'ImportDeclaration';
    const isFunctionDeclaration = decl.type === 'FunctionDeclaration';
    const isVariableDeclaration = decl.type === 'VariableDeclaration';
    if (isImport) {
      const specifiers = node.importKind === 'type' ? [] : node.specifiers.filter((sp) => sp.importKind !== 'type').map((sp) => sp.local?.name).filter(Boolean);
      const hasValueImports = specifiers.length > 0;
      if (hasValueImports) importsSummary.push(`// Imports: [${specifiers.join(', ')}] from '${node.source.value}'`);
    } else if (isFunctionDeclaration) {
      logicBlocks.push(emitFunction(decl, node, headerOf(node, decl)).join('\n'));
    } else if (isVariableDeclaration) {
      const fnDecls = decl.declarations.filter((d) => isFunctionInit(d.init));
      fnDecls.forEach((d) => logicBlocks.push(emitFunction(d.init, node, headerOf(node, d.init), '').join('\n')));
      const hasState = fnDecls.length === 0 && decl.declarations.some(isStateKind);
      if (hasState) stateDeclarations.push(`${src(node)}${origin(node)}`);
    }
  }

  const hasImports = importsSummary.length > 0;
  const hasState = stateDeclarations.length > 0;
  const hasLogic = logicBlocks.length > 0;
  if (hasImports) lines.push(...importsSummary, '');
  if (hasState) lines.push(...stateDeclarations, '');
  if (hasLogic) lines.push(logicBlocks.join('\n\n'));

  const tplSummary = summarizeTemplate(code, filePath);
  const hasTemplateSummary = Boolean(tplSummary);
  if (hasTemplateSummary) lines.push('', tplSummary);
  return lines.join('\n');
};
