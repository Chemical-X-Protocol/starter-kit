import path from 'node:path';
import { readTokenOptimized } from '../reader.js';
import { buildReadCards } from '../reader-cards.js';
import { formatReadHeader, formatReadBody } from '../reader-format.js';
import { resolveSafePath } from '../path-scope.js';
import { EXT_LANG_MAP, resolveTargetCwd } from './tools-search-util.js';

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

  const colonMatch = typeof rawPath === 'string' && rawPath.match(/^([^:]+):(\d+)(?:[-:](\d+))?$/);
  const hasColonRange = Boolean(colonMatch);
  if (hasColonRange) {
    rawPath = colonMatch[1];
    const isStartLineMissing = startLine === undefined;
    if (isStartLineMissing) startLine = parseInt(colonMatch[2], 10);
    const shouldTakeEndLine = Boolean(endLine === undefined && colonMatch[3]);
    if (shouldTakeEndLine) endLine = parseInt(colonMatch[3], 10);
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
    rev: args.rev
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

  const ext = path.extname(targetPath).toLowerCase();
  const lang = EXT_LANG_MAP[ext] || '';
  const bodyParts = [formatReadBody(res), res.enriched, cards.trace, cards.backtrace].filter(Boolean);
  const body = bodyParts.join('\n');
  const fence = body.includes('```') ? '~~~' : '```';
  const fenced = `${fence}${lang}\n${body}\n${fence}`;
  const header = `// ${formatReadHeader(res)}${cards.connection}\n`;
  return header + cards.context + fenced + (cards.freshness || '');
};
