import path from 'node:path';
import { readTokenOptimized } from '../reader.js';
import { buildReadCards } from '../reader-cards.js';
import { formatReadHeader, formatReadBody } from '../reader-format.js';
import { resolveSafePath } from '../path-scope.js';
import { EXT_LANG_MAP, resolveTargetCwd } from './tools-search-util.js';
import { parseLineRanges, extractColonRanges } from '../reader-ranges.js';

/**
 * MCP read. Verbatim by default: comments are stripped and blank lines compacted only when
 * the caller asks (stripComments:true / compact:true), and verbatim modes print `N|` numbers.
 */
export const handleChemxRead = (args = {}, cwd = process.cwd()) => {
  const isPathMissing = !args.path;
  if (isPathMissing) throw new Error('chemx_read requires "path" argument.');
  const targetCwd = resolveTargetCwd(args.cwd || cwd);
  let rawPath = args.path;
  let startLine = args.startLine;
  let endLine = args.endLine;

  let ranges = null;
  const hasArgsLines = Boolean(args.lines);
  const shouldParseLinesArg = hasArgsLines && (startLine === undefined || endLine === undefined);
  if (shouldParseLinesArg) {
    const parsed = parseLineRanges(String(args.lines));
    if (parsed) {
      ranges = parsed;
      const isStartLineMissing = startLine === undefined;
      if (isStartLineMissing) startLine = parsed[0].start;
      const isEndLineMissing = endLine === undefined;
      if (isEndLineMissing) endLine = parsed[parsed.length - 1].end;
    }
  }

  const colonExtracted = extractColonRanges(rawPath);
  if (colonExtracted.ranges) {
    rawPath = colonExtracted.cleanPath;
    const isRangesMissing = !ranges;
    if (isRangesMissing) {
      ranges = colonExtracted.ranges;
      const isStartLineMissing = startLine === undefined;
      if (isStartLineMissing) startLine = ranges[0].start;
      const isEndLineMissing = endLine === undefined;
      if (isEndLineMissing) endLine = ranges[ranges.length - 1].end;
    }
  }

  const targetPath = resolveSafePath(rawPath, targetCwd);
  const res = readTokenOptimized(targetPath, {
    cwd: targetCwd,
    outline: args.outline,
    logic: args.logic,
    template: args.template,
    enrich: args.enrich,
    symbol: args.symbol,
    stripComments: args.stripComments === true,
    compact: args.compact === true,
    startLine,
    endLine,
    ranges,
    full: args.full === true,
    bare: Boolean(args.bare),
    rev: args.rev,
    hintSyntax: 'mcp'
  });
  const relFile = path.relative(targetCwd, targetPath) || res.file;
  res.file = args.rev ? `${args.rev}:${relFile}` : relFile;

  const cards = buildReadCards(targetCwd, targetPath, {
    symbol: args.symbol,
    context: true,
    connections: args.connections,
    traceSymbol: args.traceSymbol,
    backtraceSymbol: args.backtraceSymbol
  });

  const isBare = Boolean(args.bare);
  if (isBare) {
    return res.trailer ? `${res.content}\n${res.trailer}` : res.content;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const lang = EXT_LANG_MAP[ext] || '';
  const bodyParts = [formatReadBody(res), res.enriched, cards.trace, cards.backtrace].filter(Boolean);
  const body = bodyParts.join('\n');
  const fence = body.includes('```') ? '~~~' : '```';
  const fenced = `${fence}${lang}\n${body}\n${fence}`;
  const header = `// ${formatReadHeader(res)}${cards.connection}\n`;
  return header + cards.context + fenced + (cards.freshness || '');
};
