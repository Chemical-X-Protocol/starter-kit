import fs from 'node:fs';
import { splitFileLines } from './line-count.js';
import path from 'node:path';
import { parse } from './babel-lazy.js';
import { ANSI } from './theme.js';
import { resolveSafePath } from './path-scope.js';
import { isBabelParsable } from './languages.js';
import { extractAstMetadata } from './search-ast.js';
import { isMarkdownFile, generateMarkdownOutline } from './reader-markdown.js';
import { locateSymbols } from './symbol-locator.js';
import { stripCommentsKeepingLines } from './comment-ranges.js';
import { parseSfc } from './sfc/sfc-parse.js';
import { outlineModuleAst } from './outline/ast-outline.js';
import { isStylesheetFile, outlineStylesheet } from './outline/style-outline.js';
import { conflictHunksOf, describeConflicts } from './conflicts.js';
import { resolveRevisionRead } from './read-revision.js';

const assertReadableFile = (resolvedPath, rawPath, targetPath) => {
  const isMissingFile = !fs.existsSync(resolvedPath);
  if (isMissingFile) {
    throw new Error(`File not found: ${rawPath}`);
  }
  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${targetPath}`);
  }
};

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

// Vue and Svelte both go through the shared SFC layer: every script block, line geometry kept.
const resolveSfcScript = (code, filePath) => {
  const sfc = parseSfc(code, filePath);
  return { scriptContent: sfc.scriptOverlay, externalSrc: sfc.scripts.find((s) => s.src)?.src ?? null };
};

const findCompanionController = (filePath) => {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const candidates = ['ts', 'js', 'tsx', 'jsx'].map((ext) => path.join(dir, `${base}.controller.${ext}`));
  return candidates.find((c) => fs.existsSync(c)) ?? null;
};

const describeCompanion = (filePath, scriptContent, externalSrc) => {
  const companionFound = findCompanionController(filePath);
  if (companionFound) {
    const relCompanion = path.relative(process.cwd(), companionFound);
    return `// Companion controller detected: ${relCompanion} (Run chemx read ${relCompanion} --outline to inspect logic)`;
  }
  if (externalSrc) return `// External script reference detected: ${externalSrc}`;
  const isTemplateOnly = !scriptContent.trim();
  return isTemplateOnly ? '// Template-only component (no <script> block detected)' : null;
};

export const generateAstOutline = (code, filePath) => {
  if (isMarkdownFile(filePath)) return generateMarkdownOutline(code, filePath);
  if (isStylesheetFile(filePath)) return [`// Outline: ${filePath}`, ...outlineStylesheet(code)].join('\n');
  const isComponentFile = filePath.endsWith('.vue') || filePath.endsWith('.svelte');
  const sfcScript = isComponentFile ? resolveSfcScript(code, filePath) : { scriptContent: code, externalSrc: null };
  const { scriptContent } = sfcScript;
  const companionAnnotation = isComponentFile ? describeCompanion(filePath, scriptContent, sfcScript.externalSrc) : null;

  const lines = [`// Outline: ${filePath}`];
  if (companionAnnotation) lines.push(companionAnnotation);
  const hasNoScript = !scriptContent.trim();
  if (hasNoScript) return lines.join('\n');

  // Babel cannot parse C/C++, Python, Go, Rust, Java, C# or Kotlin. It also does not
  // throw on them, because errorRecovery swallows the failure and yields an empty AST.
  // Route them to the polyglot extractor instead.
  if (!isBabelParsable(filePath)) {
    const meta = extractAstMetadata(scriptContent, filePath);
    const seen = new Set();
    for (const sym of meta.symbols) {
      const isUnnamedOrSeen = !sym?.name || seen.has(sym.name);
      if (isUnnamedOrSeen) continue;
      seen.add(sym.name);
      lines.push(`${OUTLINE_KIND_LABELS[sym.kind] || 'symbol'} ${sym.name}`);
    }
    return lines.join('\n');
  }

  try {
    const ast = parse(scriptContent, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'topLevelAwait'],
      errorRecovery: true
    });
    lines.push(...outlineModuleAst(ast, scriptContent));
  } catch (err) {
    // Regex fallback for non-parseable files
    const isDebugEnabled = Boolean(process.env.CHEMX_DEBUG);
    if (isDebugEnabled) process.stderr.write(`[outline] parse failed, using regex fallback: ${err.message}\n`);
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
      const isOpenBrace = char === '{';
      if (isOpenBrace) { depth++; hasBrace = true; }
      const isCloseBrace = char === '}';
      if (isCloseBrace) depth--;
    }
    const isClosed = hasBrace && depth <= 0;
    const isOneLiner = !hasBrace && (lines[i].includes(';') || i + 1 >= lines.length || lines[i + 1].trim() === '');
    const isBlockEnd = isClosed || isOneLiner;
    if (isBlockEnd) { endIndex = i; break; }
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
  const atRevision = resolveRevisionRead(targetPath, options);
  if (atRevision) {
    const { rev, path: revPath, content, startLine: revStart, endLine: revEnd } = atRevision;
    const res = readTokenOptimized(revPath, { ...options, rev: undefined, sourceContent: content, startLine: revStart, endLine: revEnd });
    const label = path.isAbsolute(revPath) ? path.relative(options.cwd || process.cwd(), revPath) : revPath;
    return { ...res, file: `${rev}:${label}`, rev };
  }
  let rawPath = targetPath;
  let startLine = options.startLine;
  let endLine = options.endLine;

  const colonMatch = typeof targetPath === 'string' && targetPath.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
  if (colonMatch) {
    rawPath = colonMatch[1];
    const needsStartLine = startLine === undefined;
    if (needsStartLine) startLine = parseInt(colonMatch[2], 10);
    const needsEndLine = endLine === undefined && Boolean(colonMatch[3]);
    if (needsEndLine) endLine = parseInt(colonMatch[3], 10);
  }

  const cwd = options.cwd || process.cwd();
  const resolvedPath = resolveSafePath(rawPath, cwd);
  const hasSourceContent = typeof options.sourceContent === 'string';
  if (!hasSourceContent) assertReadableFile(resolvedPath, rawPath, targetPath);

  const rawContent = hasSourceContent ? options.sourceContent : fs.readFileSync(resolvedPath, 'utf-8');
  const rawLines = splitFileLines(rawContent);
  const totalLines = rawLines.length;

  // An unmerged file is not parseable: AST modes would print a wrong outline or "symbol not
  // found". Show the numbered lines (what a merge needs) with a one-line note instead.
  const conflictHunks = conflictHunksOf(rawContent);
  const conflictNote = conflictHunks.length > 0 ? describeConflicts(rawPath, conflictHunks) : null;
  if (conflictNote) options = { ...options, template: false, logic: false, outline: false, symbol: undefined, enrich: false };

  const wantsTemplate = Boolean(options.template);
  if (wantsTemplate) {
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

  const wantsLogic = Boolean(options.logic);
  if (wantsLogic) {
    let logicSource = rawContent;
    const wantsLogicSymbol = Boolean(options.symbol);
    if (wantsLogicSymbol) {
      const block = extractSymbolBlock(rawContent, options.symbol, resolvedPath);
      if (!block) {
        throw new Error(`Symbol "${options.symbol}" not found in ${targetPath}`);
      }
      logicSource = block.code;
    }
    let logicText = generateAstLogicSkeleton(logicSource, path.relative(cwd, resolvedPath) || targetPath, options);
    const isCompactAllowed = options.compact !== false;
    if (isCompactAllowed) {
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

  const wantsOutline = Boolean(options.outline);
  if (wantsOutline) {
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

  const wantsSymbol = Boolean(options.symbol);
  if (wantsSymbol) {
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
  const isOverWindow = !hasLineRange && totalLines > autoThreshold;
  const shouldAutoOutline = isOverWindow && !conflictNote;
  if (shouldAutoOutline) {
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
  const isCliHint = options.hintSyntax === 'cli';
  const nextEnd = Math.min(totalLines, endIdx + maxLines);
  const formatTruncationHint = () => {
    if (!isCapped) return null;
    if (isCliHint) {
      return `// [Truncated at the ${maxLines}-line chemx read window. Use chemx read ${rawPath}:${endIdx + 1}-${nextEnd} to inspect subsequent lines]`;
    }
    return `// [Truncated at the ${maxLines}-line chemx read window. Use startLine=${endIdx + 1} to inspect subsequent lines]`;
  };
  const trailer = formatTruncationHint();

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
    ...(conflictNote ? { conflict: conflictNote } : {}),
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
  const wantsStripComments = Boolean(options.stripComments);
  if (wantsStripComments) {
    const stripped = stripCommentsKeepingLines(rawContent, filePath);
    const isStripped = stripped !== null;
    if (isStripped) sourceLines = stripped.split('\n');
    notes.push(isStripped ? 'comments stripped' : 'strip-comments unsupported for this file; shown verbatim');
  }
  let entries = sourceLines.slice(startIdx, endIdx).map((text, i) => ({ n: startIdx + i + 1, text }));
  const wantsCompact = Boolean(options.compact);
  if (wantsCompact) {
    const before = entries.length;
    entries = entries.filter((entry, i) => !(entry.text.trim() === '' && i > 0 && entries[i - 1].text.trim() === ''));
    const removed = before - entries.length;
    const hasRemovedLines = removed > 0;
    if (hasRemovedLines) notes.push(`${removed} blank line(s) removed; numbers are original`);
  }
  const isContiguous = entries.every((entry, i) => entry.n === startIdx + i + 1);
  return {
    lines: entries,
    content: entries.map((e) => e.text).join('\n'),
    lineNumbers: isContiguous ? null : entries.map((e) => e.n),
    notes
  };
};
