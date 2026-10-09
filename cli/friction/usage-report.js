// `chemx friction --usage <transcript dir|file...>`: measure chemx adoption from Claude Code agent
// transcripts (JSONL). Counts Bash calls by category, chemx subcommands, bypass reasons, raw
// runners, recursive grep vs chemx q, chemx output piped through filters, MCP calls, native tools
// and guard denials, so adoption is measured rather than asserted (task #1741).

import fs from 'node:fs';
import path from 'node:path';
import { classifyBashCall } from './usage-classify.js';

const GUARD_DENIAL = 'chemx guard:';

const bump = (bucket, key, by = 1) => { bucket[key] = (bucket[key] ?? 0) + by; };

export const listTranscriptFiles = (targets) => targets.flatMap((target) => {
  const isDirectory = fs.existsSync(target) && fs.statSync(target).isDirectory();
  if (!isDirectory) return target.endsWith('.jsonl') && fs.existsSync(target) ? [target] : [];
  return fs.readdirSync(target).flatMap((name) => listTranscriptFiles([path.join(target, name)]));
});

const emptyReport = () => ({ files: 0, toolCalls: 0, bash: {}, chemx: {}, bypass: {}, raw: {}, search: { 'grep -r / rg': 0, 'chemx q': 0 }, pipeFilters: {}, mcp: {}, native: {}, guardDenials: 0 });

const resultText = (block) => (Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join('') : String(block.content ?? ''));

const recordToolUse = (report, block) => {
  report.toolCalls += 1;
  const isBash = block.name === 'Bash';
  if (!isBash) {
    const isChemxMcp = /chemx|chemical-x/.test(block.name);
    if (isChemxMcp) bump(report.mcp, block.input?.action ?? block.input?.command?.split(' ')[0] ?? block.name);
    else bump(report.native, block.name);
    return;
  }
  const call = classifyBashCall(String(block.input?.command ?? ''));
  bump(report.bash, call.category);
  for (const sub of call.chemx) bump(report.chemx, sub);
  const hasBypass = Boolean(call.bypass);
  if (hasBypass) bump(report.bypass, call.bypass);
  for (const rule of call.raw) bump(report.raw, rule);
  report.search['grep -r / rg'] += call.search.length;
  report.search['chemx q'] += call.chemx.filter((sub) => sub === 'q' || sub === 'search').length;
  for (const filter of call.pipeFilters) bump(report.pipeFilters, filter);
};

const parseRecord = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null; // partial or truncated transcript lines are skipped
  }
};

export const buildUsageReport = (targets) => {
  const report = emptyReport();
  for (const file of listTranscriptFiles(targets)) {
    report.files += 1;
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const content = parseRecord(line)?.message?.content;
      const hasBlocks = Array.isArray(content);
      if (!hasBlocks) continue;
      for (const block of content) {
        const isToolUse = block.type === 'tool_use';
        if (isToolUse) recordToolUse(report, block);
        const isDenial = block.type === 'tool_result' && resultText(block).includes(GUARD_DENIAL);
        if (isDenial) report.guardDenials += 1;
      }
    }
  }
  return report;
};

const sortedLines = (bucket, limit = 12) => Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => `    ${String(count).padStart(5)}  ${key}`);

export const renderUsageReport = (report) => {
  const mcpTotal = Object.values(report.mcp).reduce((sum, count) => sum + count, 0);
  const sections = [
    `chemx usage: ${report.files} transcripts, ${report.toolCalls} tool calls, ${report.guardDenials} guard denials, ${mcpTotal} chemx MCP calls`,
    '  Bash calls by category:', ...sortedLines(report.bash),
    '  chemx subcommands:', ...sortedLines(report.chemx),
    '  bypass reasons:', ...sortedLines(report.bypass),
    '  raw runners / git:', ...sortedLines(report.raw),
    '  search:', ...sortedLines(report.search),
    '  chemx output piped through:', ...sortedLines(report.pipeFilters),
    '  native tools:', ...sortedLines(report.native),
  ];
  return `${sections.join('\n')}\n`;
};
