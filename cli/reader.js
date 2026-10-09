import fs from 'node:fs';
import { splitFileLines } from './line-count.js';
import path from 'node:path';
import { parse, traverse } from './babel-lazy.js';
import { ANSI } from './theme.js';
import { resolveSafePath } from './path-scope.js';
import { isBabelParsable } from './languages.js';
import { extractAstMetadata } from './search-ast.js';
import { isMarkdownFile, generateMarkdownOutline } from './reader-markdown.js';
import { locateSymbols } from './symbol-locator.js';
import { blankOutsideScripts } from './sfc-scripts.js';
import { stripCommentsKeepingLines } from './comment-ranges.js';

import {
  stripCodeComments,
  compactCode,
  resolveDeclarationKind,
  summarizeTemplate,
  extractTemplateContent,
  generateAstLogicSkeleton,
  SKELETON_LABEL
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


/**
 * Extracts an AST structural outline of a file (types, exports, props, signatures).
 *
 * @param {string} code Source code.
 * @param {string} filePath File path for parser context.
 * @returns {string} Compressed structural outline.
 */
const OUTLINE_KIND_LABELS = {
  class: 'class',
  function: 'function',
  symbol: 'symbol'
};

const at = (node) => (node?.loc ? `L${node.loc.start.line}-${node.loc.end.line}  ` : '');

export const generateAstOutline = (code, filePath) => {
  if (isMarkdownFile(filePath)) return generateMarkdownOutline(code, filePath);
  const isVue = filePath.endsWith('.vue');
  const isSvelte = filePath.endsWith('.svelte');
  let scriptContent = code;
  let companionAnnotation = null;

  if (isVue || isSvelte) {
    scriptContent = blankOutsideScripts(code);

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const controllerCandidates = [
      path.join(dir, `${base}.controller.ts`),
      path.join(dir, `${base}.controller.js`),
      path.join(dir, `${base}.controller.tsx`),
      path.join(dir, `${base}.controller.jsx`)
    ];

    let companionFound = null;
    for (const c of controllerCandidates) {
      if (fs.existsSync(c)) {
        companionFound = c;
        break;
      }
    }

    const scriptSrcMatch = code.match(/<script[^>]+src=["']([^"']+)["']/i);
    const externalSrc = scriptSrcMatch ? scriptSrcMatch[1] : null;

    if (companionFound) {
      const relCompanion = path.relative(process.cwd(), companionFound);
      companionAnnotation = `// Companion controller detected: ${relCompanion} (Run chemx read ${relCompanion} --outline to inspect logic)`;
    } else if (externalSrc) {
      companionAnnotation = `// External script reference detected: ${externalSrc}`;
    } else if (!scriptContent.trim()) {
      companionAnnotation = `// Template-only component (no <script> block detected)`;
    }
  }

  const lines = [];
  lines.push(`// Outline: ${filePath}`);
  if (companionAnnotation) {
    lines.push(companionAnnotation);
  }

  if (!scriptContent.trim()) {
    return lines.join('\n');
  }

  // Babel cannot parse C/C++, Python, Go, Rust, Java, C# or Kotlin. It also does not
  // throw on them, because errorRecovery swallows the failure and yields an empty AST,
  // so the catch-block fallback below never fires for these files. Route them to the
  // polyglot extractor instead.
  if (!isBabelParsable(filePath)) {
    const meta = extractAstMetadata(scriptContent, filePath);
    const seen = new Set();
    for (const sym of meta.symbols) {
      if (!sym?.name || seen.has(sym.name)) continue;
      seen.add(sym.name);
      lines.push(`${OUTLINE_KIND_LABELS[sym.kind] || 'symbol'} ${sym.name}`);
    }
    return lines.join('\n');
  }

  let omittedFunctionCount = 0;

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
          lines.push(`${at(nodePath.node)}export function ${decl.id.name}(${params})`);
        } else if (decl.type === 'VariableDeclaration') {
          decl.declarations.forEach((d) => {
            const name = d.id?.name;
            if (name) {
              const kind = resolveDeclarationKind(d);
              lines.push(`${at(nodePath.node)}export ${kind} ${name}`);
            }
          });
        } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
          lines.push(`${at(nodePath.node)}export type ${decl.id.name}`);
        } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
          lines.push(`${at(nodePath.node)}export interface ${decl.id.name}`);
        }
      },
      ExportDefaultDeclaration(nodePath) {
        lines.push(`${at(nodePath.node)}export default`);
      },
      TSTypeAliasDeclaration(nodePath) {
        if (nodePath.parent.type !== 'ExportNamedDeclaration') {
          lines.push(`${at(nodePath.node)}type ${nodePath.node.id.name}`);
        }
      },
      TSInterfaceDeclaration(nodePath) {
        if (nodePath.parent.type !== 'ExportNamedDeclaration') {
          lines.push(`${at(nodePath.node)}interface ${nodePath.node.id.name}`);
        }
      },
      VariableDeclaration(nodePath) {
        if (nodePath.parent.type !== 'Program') return;
        if (nodePath.parentPath?.parent?.type === 'ExportNamedDeclaration') return;
        nodePath.node.declarations.forEach((d) => {
          const name = d.id?.name;
          if (name) {
            const kind = resolveDeclarationKind(d);
            lines.push(`${at(nodePath.node)}${kind} ${name}`);
          }
        });
      },
      FunctionDeclaration(nodePath) {
        if (nodePath.parent.type !== 'Program') {
          omittedFunctionCount++;
          return;
        }
        if (nodePath.parentPath?.parent?.type === 'ExportNamedDeclaration') return;
        if (nodePath.node.id) {
          const params = nodePath.node.params.map((p) => p.name || p.type).join(', ');
          lines.push(`${at(nodePath.node)}function ${nodePath.node.id.name}(${params})`);
        }
      },
      ArrowFunctionExpression(nodePath) {
        if (nodePath.parent.type !== 'VariableDeclarator') {
          omittedFunctionCount++;
        }
      },
      FunctionExpression(nodePath) {
        if (nodePath.parent.type !== 'VariableDeclarator') {
          omittedFunctionCount++;
        }
      }
    });

    if (omittedFunctionCount > 0) {
      lines.push(`// [Notice: ${omittedFunctionCount} internal/unexported function(s) omitted. Use chemx read --symbol=<name> to inspect]`);
    }
  } catch (err) {
    // Regex fallback for non-parseable files
    if (process.env.CHEMX_DEBUG) process.stderr.write(`[outline] parse failed, using regex fallback: ${err.message}\n`);
    const typeMatches = scriptContent.match(/export\s+(type|interface|const|function|class)\s+([a-zA-Z0-9_$]+)/g) || [];
    typeMatches.forEach((m) => lines.push(m.trim()));
  }

  return lines.join('\n');
};

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Line-oriented fallback for languages Babel cannot parse (C-like brace languages).
 * The name is escaped; comment lines are skipped.
 */
const extractSymbolBlockByText = (code, symbol) => {
  const lines = code.split('\n');
  const targetRegex = new RegExp(`(^|\\s)(const|function|class|type|interface|let|var|def|fn|func|struct|enum)\\s+${escapeRegExp(symbol)}\\b`);
  const isCommentLine = (line) => /^\s*(\/\/|#|\*|\/\*)/.test(line);
  const targetIndex = lines.findIndex((line) => !isCommentLine(line) && targetRegex.test(line));
  const isMissing = targetIndex === -1;
  if (isMissing) return null;

  let depth = 0;
  let hasBrace = false;
  let endIndex = targetIndex;
  for (let i = targetIndex; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') { depth++; hasBrace = true; }
      if (char === '}') depth--;
    }
    const isClosed = hasBrace && depth <= 0;
    const isOneLiner = !hasBrace && (lines[i].includes(';') || i + 1 >= lines.length || lines[i + 1].trim() === '');
    if (isClosed || isOneLiner) { endIndex = i; break; }
  }
  const slice = lines.slice(targetIndex, endIndex + 1).join('\n');
  const match = { name: symbol, kind: 'text', startLine: targetIndex + 1, endLine: endIndex + 1, code: slice };
  return { ...match, matches: [match] };
};

/**
 * Extracts a symbol declaration (AST ranges for JS/TS/Vue/Svelte, text fallback otherwise).
 *
 * @param {string} code Source code.
 * @param {string} symbol Symbol name, optionally qualified (Class.method, store.action).
 * @param {string} [filePath] File path; decides the parser.
 * @returns {{ code: string, startLine: number, endLine: number, name: string, matches: object[] } | null}
 */
export const extractSymbolBlock = (code, symbol, filePath = '') => {
  const matches = locateSymbols(code, filePath, symbol);
  const isUnsupported = matches === null;
  if (isUnsupported) return extractSymbolBlockByText(code, symbol);
  const hasMatch = matches.length > 0;
  if (!hasMatch) return null;
  return { ...matches[0], matches: matches.map(({ code: _code, ...range }) => range) };
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
  const hasJsAst = isBabelParsable(filePath);
  if (!hasJsAst) return null;
  const skeleton = generateAstLogicSkeleton(rawContent, filePath, options);
  const compacted = compactCode(skeleton);
  const text = `\n// --- Logic Skeleton --- (${SKELETON_LABEL})\n${compacted}`;
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

  const cwd = options.cwd || process.cwd();
  const resolvedPath = resolveSafePath(rawPath, cwd);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${rawPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${targetPath}`);
  }

  const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  const rawLines = splitFileLines(rawContent);
  const totalLines = rawLines.length;

  if (options.template) {
    const templateText = extractTemplateContent(rawContent, targetPath);
    const templateIndex = rawContent.indexOf(templateText);
    const isVerbatimSlice = templateIndex !== -1 && templateText.length > 0;
    const templateStart = isVerbatimSlice ? rawContent.slice(0, templateIndex).split('\n').length : undefined;
    return {
      file: targetPath,
      totalLines,
      mode: isVerbatimSlice ? 'template' : 'template-note',
      ...(isVerbatimSlice ? { startLine: templateStart, endLine: templateStart + templateText.split('\n').length - 1 } : {}),
      tokensEst: Math.round(templateText.length / 3.8),
      content: templateText,
    };
  }

  if (options.logic) {
    let logicSource = rawContent;
    if (options.symbol) {
      const block = extractSymbolBlock(rawContent, options.symbol, resolvedPath);
      if (!block) {
        throw new Error(`Symbol "${options.symbol}" not found in ${targetPath}`);
      }
      logicSource = block.code;
    }
    let logicText = generateAstLogicSkeleton(logicSource, path.relative(cwd, resolvedPath) || targetPath, options);
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
    const block = extractSymbolBlock(rawContent, options.symbol, resolvedPath);
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
      matches: block.matches,
      tokensEst: Math.round(block.code.length / 3.8),
      content: block.code,
    };
  }

  const hasLineRange = typeof startLine === 'number' || typeof endLine === 'number';
  const autoThreshold = typeof options.autoOutlineThreshold === 'number' ? options.autoOutlineThreshold : 100;

  // Read window: files longer than autoThreshold read without a symbol or slice return an AST
  // outline to protect context. A tool budget, not an architecture rule (AGENTS.md owns those).
  if (!hasLineRange && totalLines > autoThreshold) {
    const outlineText = generateAstOutline(rawContent, rawPath);
    const isCliHint = options.hintSyntax === 'cli';
    const symbolHint = isCliHint
      ? `chemx read ${rawPath} --symbol=<name>`
      : `chemx({ action: 'read', params: { path: '${rawPath}', symbol: '<name>' } })`;
    const rangeHint = isCliHint
      ? `chemx read ${rawPath}:1-50`
      : `chemx({ action: 'read', params: { path: '${rawPath}', startLine: 1, endLine: 50 } })`;
    const notice = [
      `// [chemx read window] File has ${totalLines} lines (over the ${autoThreshold}-line read window).`,
      `// Auto-rendered AST outline to conserve context tokens and prevent host buffer spillover.`,
      `// To read a specific block, request symbol: ${symbolHint}`,
      `// Or specify a line range: ${rangeHint}\n`
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

  // Cap each slice to the read window (a tool budget, not an architecture rule)
  const maxLines = autoThreshold;
  const isCapped = (endIdx - startIdx) > maxLines;
  if (isCapped) {
    endIdx = startIdx + maxLines;
  }

  const slice = sliceWithTransforms(rawContent, resolvedPath, startIdx, endIdx, options);
  const trailer = isCapped
    ? `// [Truncated at the ${maxLines}-line chemx read window. Use startLine=${endIdx + 1} to inspect subsequent lines]`
    : null;

  return {
    file: rawPath,
    totalLines,
    mode: 'range',
    startLine: startIdx + 1,
    endLine: endIdx,
    lineCount: slice.lines.length,
    tokensEst: Math.round(slice.content.length / 3.8),
    content: slice.content,
    ...(slice.lineNumbers ? { lineNumbers: slice.lineNumbers } : {}),
    ...(slice.notes.length > 0 ? { notes: slice.notes } : {}),
    ...(trailer ? { trailer } : {}),
  };
};

/**
 * Slices lines [startIdx, endIdx) and applies opt-in stripComments/compact without ever
 * shifting line numbers: comments are blanked by token range, and compacted lines keep
 * their original numbers (returned in lineNumbers).
 */
const sliceWithTransforms = (rawContent, filePath, startIdx, endIdx, options) => {
  const notes = [];
  let sourceLines = rawContent.split('\n');
  if (options.stripComments) {
    const stripped = stripCommentsKeepingLines(rawContent, filePath);
    const isStripped = stripped !== null;
    if (isStripped) sourceLines = stripped.split('\n');
    notes.push(isStripped ? 'comments stripped' : 'strip-comments unsupported for this file; shown verbatim');
  }
  let entries = sourceLines.slice(startIdx, endIdx).map((text, i) => ({ n: startIdx + i + 1, text }));
  if (options.compact) {
    const before = entries.length;
    entries = entries.filter((entry, i) => !(entry.text.trim() === '' && i > 0 && entries[i - 1].text.trim() === ''));
    const removed = before - entries.length;
    if (removed > 0) notes.push(`${removed} blank line(s) removed; numbers are original`);
  }
  const isContiguous = entries.every((entry, i) => entry.n === startIdx + i + 1);
  return {
    lines: entries,
    content: entries.map((e) => e.text).join('\n'),
    lineNumbers: isContiguous ? null : entries.map((e) => e.n),
    notes
  };
};
