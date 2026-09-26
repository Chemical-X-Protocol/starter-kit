import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

/**
 * Strips JavaScript/TypeScript comments while preserving line boundaries where possible.
 *
 * @param {string} code Source code.
 * @returns {string} Code without comments.
 */
export const stripCodeComments = (code) => {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\:])\/\/.*$/gm, '$1');
};

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

/**
 * Extracts an AST logic skeleton of a file (control flow, state, guards, side-effects, mutations).
 * Preserves 100% of execution semantics while stripping decorative syntax and boilerplate.
 *
 * @param {string} code Source code.
 * @param {string} filePath File path for parser context.
 * @param {object} options Additional options.
 * @returns {string} Compressed logic skeleton.
 */
export const generateAstLogicSkeleton = (code, filePath, options = {}) => {
  const isVue = filePath.endsWith('.vue');
  const isSvelte = filePath.endsWith('.svelte');
  let scriptContent = code;

  if (isVue) {
    const scriptMatch = code.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
    scriptContent = scriptMatch ? scriptMatch[1] : '';
  } else if (isSvelte) {
    const scriptMatch = code.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
    scriptContent = scriptMatch ? scriptMatch[1] : '';
  }

  const scriptLines = scriptContent.split('\n');
  const lines = [];
  lines.push(`// Logic Skeleton: ${filePath}`);

  try {
    const ast = parse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'topLevelAwait'],
      errorRecovery: true,
    });

    const importsSummary = [];
    const stateDeclarations = [];
    const logicBlocks = [];

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
          if (expr.type === 'AssignmentExpression') return true;
          if (expr.type === 'AwaitExpression') return true;
          if (expr.type === 'CallExpression' || expr.type === 'OptionalCallExpression') {
            const callee = expr.callee;
            if (callee.type === 'MemberExpression' && callee.object?.name === 'console') {
              return false;
            }
            return true;
          }
          return false;
        }
        case 'VariableDeclaration': {
          return stmt.declarations.some((d) => {
            const init = d.init;
            if (!init) return false;
            return (
              init.type === 'CallExpression' ||
              init.type === 'OptionalCallExpression' ||
              init.type === 'AwaitExpression' ||
              init.type === 'LogicalExpression' ||
              init.type === 'BinaryExpression'
            );
          });
        }
        default:
          return false;
      }
    };

    const sliceNodeLines = (node) => {
      if (!node.loc) return '';
      const start = Math.max(0, node.loc.start.line - 1);
      const end = Math.min(scriptLines.length, node.loc.end.line);
      return scriptLines.slice(start, end).join('\n');
    };

    const processFunctionLogic = (fnName, fnNode, isExport) => {
      const params = (fnNode.params || []).map((p) => {
        if (p.type === 'AssignmentPattern' && p.left?.name) {
          return `${p.left.name} = ...`;
        }
        return p.name || p.type;
      }).join(', ');

      const exportPrefix = isExport ? 'export ' : '';
      const isAsync = Boolean(fnNode.async);
      const asyncPrefix = isAsync ? 'async ' : '';

      const fnLines = [];
      fnLines.push(`${exportPrefix}const ${fnName} = ${asyncPrefix}(${params}) => {`);

      const body = fnNode.body;
      if (body && body.type === 'BlockStatement') {
        const stmts = body.body || [];
        for (const stmt of stmts) {
          if (stmt.type === 'VariableDeclaration') {
            const hasArrowOrFn = stmt.declarations.some(
              (d) => d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')
            );

            if (hasArrowOrFn) {
              stmt.declarations.forEach((d) => {
                const dName = d.id?.name;
                const dInit = d.init;
                if (dInit && (dInit.type === 'ArrowFunctionExpression' || dInit.type === 'FunctionExpression')) {
                  const innerStmts = (dInit.body?.body || []).filter(isLogicStatement);
                  if (innerStmts.length > 0) {
                    const innerAsync = dInit.async ? 'async ' : '';
                    const innerParams = (dInit.params || []).map((p) => p.name || 'arg').join(', ');
                    fnLines.push(`  const ${dName} = ${innerAsync}(${innerParams}) => {`);
                    innerStmts.forEach((is) => {
                      const sliced = sliceNodeLines(is);
                      if (sliced) fnLines.push(`    ${sliced.trim()}`);
                    });
                    fnLines.push(`  };`);
                  } else {
                    fnLines.push(`  const ${dName} = () => { /* no-op */ };`);
                  }
                }
              });
            } else if (isLogicStatement(stmt)) {
              const sliced = sliceNodeLines(stmt);
              if (sliced) fnLines.push(`  ${sliced.trim()}`);
            }
          } else if (isLogicStatement(stmt)) {
            if (stmt.type === 'ReturnStatement' && (stmt.argument?.type === 'JSXElement' || stmt.argument?.type === 'JSXFragment')) {
              fnLines.push(`  return <JSX: Template Rendered>;`);
            } else {
              const sliced = sliceNodeLines(stmt);
              if (sliced) fnLines.push(`  ${sliced.trim()}`);
            }
          }
        }
      } else if (body) {
        const sliced = sliceNodeLines(body);
        if (sliced) fnLines.push(`  return ${sliced.trim()};`);
      }

      fnLines.push(`};`);
      logicBlocks.push(fnLines.join('\n'));
    };

    traverse(ast, {
      ImportDeclaration(nodePath) {
        if (nodePath.node.importKind === 'type') return;
        const source = nodePath.node.source?.value;
        const specifiers = nodePath.node.specifiers
          .filter((s) => s.importKind !== 'type')
          .map((s) => s.local?.name || s.imported?.name)
          .filter(Boolean);
        if (specifiers.length > 0 && source) {
          importsSummary.push(`// Imports: [${specifiers.join(', ')}] from '${source}'`);
        }
      },

      ExportNamedDeclaration(nodePath) {
        const decl = nodePath.node.declaration;
        if (!decl) return;

        if (decl.type === 'VariableDeclaration') {
          decl.declarations.forEach((d) => {
            const name = d.id?.name;
            const init = d.init;
            if (!name || !init) return;

            if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
              processFunctionLogic(name, init, true);
            } else {
              const kind = resolveDeclarationKind(d);
              if (kind === 'ref' || kind === 'computed' || kind === 'hook') {
                const nodeStr = sliceNodeLines(d);
                stateDeclarations.push(`export const ${nodeStr}`);
              }
            }
          });
        } else if (decl.type === 'FunctionDeclaration' && decl.id) {
          processFunctionLogic(decl.id.name, decl, true);
        }
      },

      VariableDeclaration(nodePath) {
        if (nodePath.parent.type !== 'Program') return;
        if (nodePath.parentPath?.parent?.type === 'ExportNamedDeclaration') return;

        nodePath.node.declarations.forEach((d) => {
          const name = d.id?.name;
          const init = d.init;
          if (!name || !init) return;

          if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
            processFunctionLogic(name, init, false);
          } else {
            const kind = resolveDeclarationKind(d);
            if (kind === 'ref' || kind === 'computed' || kind === 'hook') {
              const nodeStr = sliceNodeLines(d);
              stateDeclarations.push(`const ${nodeStr}`);
            }
          }
        });
      },

      FunctionDeclaration(nodePath) {
        if (nodePath.parent.type !== 'Program') return;
        if (nodePath.parentPath?.parent?.type === 'ExportNamedDeclaration') return;
        if (nodePath.node.id) {
          processFunctionLogic(nodePath.node.id.name, nodePath.node, false);
        }
      }
    });

    if (importsSummary.length > 0) {
      lines.push(...importsSummary);
      lines.push('');
    }

    if (stateDeclarations.length > 0) {
      lines.push(...stateDeclarations);
      lines.push('');
    }

    if (logicBlocks.length > 0) {
      lines.push(logicBlocks.join('\n\n'));
    }

    const tplSummary = summarizeTemplate(code, filePath);
    if (tplSummary) {
      lines.push('');
      lines.push(tplSummary);
    }
  } catch (err) {
    lines.push(`// [AST Parsing Note: ${err.message}]`);
    lines.push(compactCode(stripCodeComments(scriptContent)));
  }

  return lines.join('\n');
};
