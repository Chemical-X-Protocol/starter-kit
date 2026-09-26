import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { ANSI } from './theme.js';

import {
  stripCodeComments,
  compactCode,
  resolveDeclarationKind,
  summarizeTemplate,
  extractTemplateContent,
  generateAstLogicSkeleton
} from './reader-logic.js';
import { runReaderCli } from './reader-cli.js';

export {
  stripCodeComments,
  compactCode,
  resolveDeclarationKind,
  summarizeTemplate,
  extractTemplateContent,
  generateAstLogicSkeleton
} from './reader-logic.js';
export { runReaderCli } from './reader-cli.js';

const traverse = traverseModule.default || traverseModule;

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
 * Appends a compacted logic skeleton after an outline block.
 * Composable overlay: enriches outline without replacing it.
 *
 * @param {string} rawContent Full file source.
 * @param {string} filePath File path (for template detection).
 * @param {object} options Reader options forwarded to skeleton generator.
 * @returns {{ text: string, tokensEst: number }} Enriched section text and token estimate.
 */
const enrichOutline = (rawContent, filePath, options) => {
  const skeleton = generateAstLogicSkeleton(rawContent, filePath, options);
  const compacted = compactCode(skeleton);
  const text = `\n// --- Logic Skeleton ---\n${compacted}`;
  return { text, tokensEst: Math.round(text.length / 3.8) };
};

/**
 * Primary token-optimized file reader.
 *
 * @param {string} targetPath File path.
 * @param {object} options Reader configuration options.
 * @returns {object} Token-minified file payload.
 */
export const readTokenOptimized = (targetPath, options = {}) => {
  let rawPath = targetPath;
  let startLine = options.startLine;
  let endLine = options.endLine;

  const colonMatch = typeof targetPath === 'string' && targetPath.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
  if (colonMatch) {
    rawPath = colonMatch[1];
    if (startLine === undefined) startLine = parseInt(colonMatch[2], 10);
    if (endLine === undefined && colonMatch[3]) endLine = parseInt(colonMatch[3], 10);
  }

  const resolvedPath = path.resolve(process.cwd(), rawPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${rawPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${targetPath}`);
  }

  const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  const rawLines = rawContent.split('\n');
  const totalLines = rawLines.length;

  if (options.template) {
    const templateText = extractTemplateContent(rawContent, targetPath);
    return {
      file: targetPath,
      totalLines,
      mode: 'template',
      tokensEst: Math.round(templateText.length / 3.8),
      content: templateText,
    };
  }

  if (options.logic) {
    let logicSource = rawContent;
    if (options.symbol) {
      const block = extractSymbolBlock(rawContent, options.symbol);
      if (!block) {
        throw new Error(`Symbol "${options.symbol}" not found in ${targetPath}`);
      }
      logicSource = block.code;
    }
    let logicText = generateAstLogicSkeleton(logicSource, targetPath, options);
    if (options.compact !== false) {
      logicText = compactCode(logicText);
    }
    return {
      file: targetPath,
      totalLines,
      mode: 'logic',
      symbol: options.symbol || null,
      lineCount: logicText.split('\n').length,
      tokensEst: Math.round(logicText.length / 3.8),
      content: logicText,
    };
  }

  if (options.outline) {
    const outlineText = generateAstOutline(rawContent, targetPath);
    const enriched = options.enrich ? enrichOutline(rawContent, targetPath, options) : null;
    return {
      file: targetPath,
      totalLines,
      mode: 'outline',
      tokensEst: Math.round(outlineText.length / 3.8),
      tokensEnriched: enriched ? enriched.tokensEst : 0,
      content: outlineText,
      enriched: enriched ? enriched.text : null,
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

  const hasLineRange = typeof startLine === 'number' || typeof endLine === 'number';
  const autoThreshold = typeof options.autoOutlineThreshold === 'number' ? options.autoOutlineThreshold : 100;

  // Directive 1.A Guard: Monolithic files (> 100 lines) read without a target symbol or slice
  // automatically return AST outline to prevent token exhaustion and host buffer spillover.
  if (!hasLineRange && totalLines > autoThreshold) {
    const outlineText = generateAstOutline(rawContent, rawPath);
    const notice = [
      `// [Directive 1.A Surgical Guard] File has ${totalLines} lines (> 100 outer bound).`,
      `// Auto-rendered AST outline to conserve context tokens and prevent host buffer spillover.`,
      `// To read a specific block, request symbol: chemx({ action: 'read', params: { path: '${rawPath}', symbol: '<name>' } })`,
      `// Or specify a line range: chemx({ action: 'read', params: { path: '${rawPath}', startLine: 1, endLine: 50 } })\n`
    ].join('\n');
    const enriched = options.enrich ? enrichOutline(rawContent, rawPath, options) : null;
    return {
      file: rawPath,
      totalLines,
      mode: 'auto-outline',
      tokensEst: Math.round((outlineText.length + notice.length) / 3.8),
      tokensEnriched: enriched ? enriched.tokensEst : 0,
      content: notice + outlineText,
      enriched: enriched ? enriched.text : null,
    };
  }

  let startIdx = 0;
  let endIdx = rawLines.length;

  if (startLine) {
    startIdx = Math.max(0, parseInt(String(startLine), 10) - 1);
  }

  if (endLine) {
    endIdx = Math.min(rawLines.length, parseInt(String(endLine), 10));
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
    file: rawPath,
    totalLines,
    startLine: startIdx + 1,
    endLine: endIdx,
    lineCount,
    tokensEst,
    content: processedContent,
  };
};
