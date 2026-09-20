import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { ANSI } from './theme.js';

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

const resolveDeclarationKind = (declaration) => {
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
 * Extracts an AST structural outline of a file (types, exports, props, signatures).
 *
 * @param {string} code Source code.
 * @param {string} filePath File path for parser context.
 * @returns {string} Compressed structural outline.
 */
export const generateAstOutline = (code, filePath) => {
  const isVue = filePath.endsWith('.vue');
  const isSvelte = filePath.endsWith('.svelte');
  let scriptContent = code;

  if (isVue) {
    const scriptMatch = code.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
    scriptContent = scriptMatch ? scriptMatch[1] : '';
  }

  if (isSvelte) {
    const scriptMatch = code.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
    scriptContent = scriptMatch ? scriptMatch[1] : '';
  }

  const lines = [];
  lines.push(`// Outline: ${filePath}`);

  try {
    const ast = parse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'topLevelAwait'],
      errorRecovery: true,
    });

    traverse(ast, {
      ExportNamedDeclaration(nodePath) {
        const decl = nodePath.node.declaration;
        if (!decl) return;

        if (decl.type === 'FunctionDeclaration' && decl.id) {
          const params = decl.params.map((p) => p.name || p.type).join(', ');
          lines.push(`export function ${decl.id.name}(${params})`);
        } else if (decl.type === 'VariableDeclaration') {
          decl.declarations.forEach((d) => {
            const name = d.id?.name;
            if (name) {
              const kind = resolveDeclarationKind(d);
              lines.push(`export ${kind} ${name}`);
            }
          });
        } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
          lines.push(`export type ${decl.id.name}`);
        } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
          lines.push(`export interface ${decl.id.name}`);
        }
      },
      ExportDefaultDeclaration(nodePath) {
        lines.push(`export default`);
      },
      TSTypeAliasDeclaration(nodePath) {
        if (nodePath.parent.type !== 'ExportNamedDeclaration') {
          lines.push(`type ${nodePath.node.id.name}`);
        }
      },
      TSInterfaceDeclaration(nodePath) {
        if (nodePath.parent.type !== 'ExportNamedDeclaration') {
          lines.push(`interface ${nodePath.node.id.name}`);
        }
      },
      VariableDeclaration(nodePath) {
        if (nodePath.parent.type !== 'Program') return;
        if (nodePath.parentPath?.parent?.type === 'ExportNamedDeclaration') return;
        nodePath.node.declarations.forEach((d) => {
          const name = d.id?.name;
          if (name) {
            const kind = resolveDeclarationKind(d);
            lines.push(`${kind} ${name}`);
          }
        });
      },
      FunctionDeclaration(nodePath) {
        if (nodePath.parent.type !== 'Program') return;
        if (nodePath.parentPath?.parent?.type === 'ExportNamedDeclaration') return;
        if (nodePath.node.id) {
          const params = nodePath.node.params.map((p) => p.name || p.type).join(', ');
          lines.push(`function ${nodePath.node.id.name}(${params})`);
        }
      },
    });
  } catch (err) {
    // Regex fallback for non-parseable files
    const typeMatches = scriptContent.match(/export\s+(type|interface|const|function|class)\s+([a-zA-Z0-9_$]+)/g) || [];
    typeMatches.forEach((m) => lines.push(m.trim()));
  }

  return lines.join('\n');
};

/**
 * Extracts a single symbol declaration and body from source code.
 *
 * @param {string} code Source code.
 * @param {string} symbol Target symbol name.
 * @returns {{ code: string, startLine: number, endLine: number } | null}
 */
export const extractSymbolBlock = (code, symbol) => {
  const lines = code.split('\n');
  const targetRegex = new RegExp(`(^|\\s)(const|function|class|type|interface|let|var)\\s+${symbol}\\b`);

  let targetIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (targetRegex.test(lines[i])) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    return null;
  }

  let depth = 0;
  let hasBrace = false;
  let endIndex = targetIndex;

  for (let i = targetIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{' || char === '(') {
        depth++;
        hasBrace = true;
      } else if (char === '}' || char === ')') {
        depth--;
      }
    }

    if (hasBrace && depth <= 0) {
      endIndex = i;
      break;
    }

    if (!hasBrace && line.includes(';')) {
      endIndex = i;
      break;
    }
  }

  const slice = lines.slice(targetIndex, endIndex + 1).join('\n');
  return {
    code: slice,
    startLine: targetIndex + 1,
    endLine: endIndex + 1,
  };
};

/**
 * Primary token-optimized file reader.
 *
 * @param {string} targetPath File path.
 * @param {object} options Reader configuration options.
 * @returns {object} Token-minified file payload.
 */
export const readTokenOptimized = (targetPath, options = {}) => {
  const resolvedPath = path.resolve(process.cwd(), targetPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${targetPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${targetPath}`);
  }

  const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  const rawLines = rawContent.split('\n');
  const totalLines = rawLines.length;

  if (options.outline) {
    const outlineText = generateAstOutline(rawContent, targetPath);
    return {
      file: targetPath,
      totalLines,
      mode: 'outline',
      tokensEst: Math.round(outlineText.length / 3.8),
      content: outlineText,
    };
  }

  if (options.symbol) {
    const block = extractSymbolBlock(rawContent, options.symbol);
    if (!block) {
      throw new Error(`Symbol "${options.symbol}" not found in ${targetPath}`);
    }
    return {
      file: targetPath,
      totalLines,
      mode: 'symbol',
      symbol: options.symbol,
      startLine: block.startLine,
      endLine: block.endLine,
      tokensEst: Math.round(block.code.length / 3.8),
      content: block.code,
    };
  }

  const hasLineRange = typeof options.startLine === 'number' || typeof options.endLine === 'number';
  const autoThreshold = typeof options.autoOutlineThreshold === 'number' ? options.autoOutlineThreshold : 100;

  // Directive 1.A Guard: Monolithic files (> 100 lines) read without a target symbol or slice
  // automatically return AST outline to prevent token exhaustion and host buffer spillover.
  if (!hasLineRange && totalLines > autoThreshold) {
    const outlineText = generateAstOutline(rawContent, targetPath);
    const notice = [
      `// [Directive 1.A Surgical Guard] File has ${totalLines} lines (> 100 outer bound).`,
      `// Auto-rendered AST outline to conserve context tokens and prevent host buffer spillover.`,
      `// To read a specific block, request symbol: chemx({ action: 'read', params: { path: '${targetPath}', symbol: '<name>' } })`,
      `// Or specify a line range: chemx({ action: 'read', params: { path: '${targetPath}', startLine: 1, endLine: 50 } })\n`
    ].join('\n');
    return {
      file: targetPath,
      totalLines,
      mode: 'auto-outline',
      tokensEst: Math.round((outlineText.length + notice.length) / 3.8),
      content: notice + outlineText
    };
  }

  let startIdx = 0;
  let endIdx = rawLines.length;

  if (options.startLine) {
    startIdx = Math.max(0, parseInt(String(options.startLine), 10) - 1);
  }

  if (options.endLine) {
    endIdx = Math.min(rawLines.length, parseInt(String(options.endLine), 10));
  }

  // Cap maximum slice at 100 lines per read (Directive 1.A outer bound)
  const maxLines = 100;
  const isCapped = (endIdx - startIdx) > maxLines;
  if (isCapped) {
    endIdx = startIdx + maxLines;
  }

  let processedLines = rawLines.slice(startIdx, endIdx);
  let processedContent = processedLines.join('\n');

  if (options.stripComments) {
    processedContent = stripCodeComments(processedContent);
  }

  if (options.compact) {
    processedContent = compactCode(processedContent);
  }

  if (isCapped) {
    processedContent += `\n// [Truncated at 100 lines per Directive 1.A. Use startLine=${endIdx + 1} to inspect subsequent lines]`;
  }

  const lineCount = processedContent.split('\n').length;
  const tokensEst = Math.round(processedContent.length / 3.8);

  return {
    file: targetPath,
    totalLines,
    startLine: startIdx + 1,
    endLine: endIdx,
    lineCount,
    tokensEst,
    content: processedContent,
  };
};

/**
 * CLI command runner for chemx read / chemx view.
 *
 * @param {string[]} args CLI arguments.
 * @param {boolean} isCli Whether invoked directly from CLI.
 */
export const runReaderCli = (args, isCli = false) => {
  const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
  const filePath = nonFlagArgs[0];

  if (!filePath) {
    process.stderr.write(`${ANSI.RED}✕ Missing file path. Usage: chemx read <file> [--outline] [--symbol=name] [--start=1] [--end=50] [--strip-comments] [--compact] [--json]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }

  const isJson = args.includes('--json');
  const isOutline = args.includes('--outline');
  const isCompact = args.includes('--compact');
  const isStripComments = args.includes('--strip-comments') || args.includes('--no-comments');

  const symbolFlag = args.find((a) => a.startsWith('--symbol='));
  const symbol = symbolFlag ? symbolFlag.split('=')[1] : null;

  const startFlag = args.find((a) => a.startsWith('--start=') || a.startsWith('-s='));
  const startLine = startFlag ? parseInt(startFlag.split('=')[1], 10) : undefined;

  const endFlag = args.find((a) => a.startsWith('--end=') || a.startsWith('-e='));
  const endLine = endFlag ? parseInt(endFlag.split('=')[1], 10) : undefined;

  try {
    const res = readTokenOptimized(filePath, {
      outline: isOutline,
      compact: isCompact,
      stripComments: isStripComments,
      symbol,
      startLine,
      endLine,
    });

    if (isJson) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stdout.write(`${ANSI.BOLD}${ANSI.CYAN}--- ${res.file} (${res.lineCount || res.totalLines} lines, ~${res.tokensEst} tokens) ---${ANSI.RESET}\n`);
      process.stdout.write(res.content + '\n');
    }

    if (isCli) process.exit(0);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${ANSI.RED}✕ ${msg}${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }
};
