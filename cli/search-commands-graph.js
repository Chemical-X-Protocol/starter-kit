import { ANSI } from './theme.js';
import { withIndex } from './search-output.js';
import {
  calculateCallTrace,
  calculateBacktrace
} from './search-db.js';
import { openSyncedIndex } from './search-session.js';
import { applyExitStatus, indexStatusOf, printIndexLine } from './search-output.js';
import { STATUS, toExitCode } from './result-status.js';

export { handleBlastRadiusCommand } from './search-commands-blast.js';

const renderCalleeTreeLines = (callees, indent = '  ') => {
  const lines = [];
  callees.forEach((c, idx) => {
    const isLast = idx === callees.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const subIndent = isLast ? '    ' : '│   ';
    const tag = c.isExternal ? `${ANSI.DIM}[external]${ANSI.RESET}` : `${ANSI.GOLD}[${c.tier}]${ANSI.RESET}`;
    const loc = c.file ? ` ${ANSI.DIM}(${c.file}${c.line ? `:${c.line}` : ''})${ANSI.RESET}` : '';
    lines.push(`${indent}${branch}${ANSI.BOLD}${c.symbol}${ANSI.RESET} ${tag}${loc}`);
    const hasCallees = Boolean(c.callees?.length > 0);
    if (hasCallees) {
      lines.push(...renderCalleeTreeLines(c.callees, `${indent}${subIndent}`));
    }
  });
  return lines;
};

export const handleCallTraceCommand = (db, target, { index = null, isJson = false, isCli = true, maxDepth = 3, root = process.cwd() } = {}) => {
  const result = calculateCallTrace(db, target, { maxDepth, root });
  const isNotFound = Boolean(result.notFound);
  if (isNotFound) {
    result.status = STATUS.INCONCLUSIVE;
    result.reason = `target "${result.target}" is not a symbol or file in the index scope`;
  }
  const shouldExitInconclusive = isCli && isNotFound;
  if (shouldExitInconclusive) process.exitCode = toExitCode(STATUS.INCONCLUSIVE);

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(result, index)) + '\n');
    if (isCli) process.exit();
    return result;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Forward Call Trace:${ANSI.RESET} ${ANSI.BOLD}${result.target}${ANSI.RESET}\n`);
  const hasFilePath = Boolean(result.filePath);
  if (hasFilePath) {
    process.stdout.write(`  ${ANSI.DIM}Defined in:${ANSI.RESET} ${result.filePath}:${result.startLine} ${ANSI.DIM}[${result.tier}]${ANSI.RESET}\n`);
  }
  if (isNotFound) process.stdout.write(`  ${ANSI.GOLD}? Inconclusive: ${result.reason}${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.MINT}Callee Summary:${ANSI.RESET} ${result.totalCallees} downstream calls mapped across ${result.depth} hops\n`);

  const hasNoCallees = result.callees.length === 0;
  if (hasNoCallees) {
    process.stdout.write(`    ${ANSI.DIM}No downstream calls or external invocations detected.${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return result;
  }

  const treeLines = renderCalleeTreeLines(result.callees, '  ');
  process.stdout.write(treeLines.join('\n') + '\n\n');

  if (isCli) process.exit();
  return result;
};

export const handleBacktraceCommand = (db, target, { index = null, isJson = false, isCli = true, maxDepth = 5 } = {}) => {
  const result = calculateBacktrace(db, target, { maxDepth });
  const isUnresolved = Boolean(result.ambiguous || result.notFound);
  if (isUnresolved) {
    result.status = STATUS.INCONCLUSIVE;
    result.reason = result.ambiguous ? `ambiguous target: ${result.candidates.join(', ')}` : `target "${result.target}" not found in the index scope`;
  }
  const shouldExitUnresolved = isCli && isUnresolved;
  if (shouldExitUnresolved) process.exitCode = toExitCode(STATUS.INCONCLUSIVE);

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(result, index)) + '\n');
    if (isCli) process.exit();
    return result;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Backtrace Causal Path:${ANSI.RESET} ${ANSI.BOLD}${result.target}${ANSI.RESET}\n`);
  const hasSeedPath = Boolean(result.seedPath);
  if (hasSeedPath) {
    process.stdout.write(`  ${ANSI.DIM}Resolved Target:${ANSI.RESET} ${result.seedPath}\n`);
  }
  if (isUnresolved) process.stdout.write(`  ${ANSI.GOLD}? Inconclusive: ${result.reason}${ANSI.RESET}\n`);
  process.stdout.write(`  ${ANSI.MINT}Caller Summary:${ANSI.RESET} ${result.totalCallers} upstream callers across ${result.depth} causal hops\n`);

  const hasNoCallers = result.totalCallers === 0;
  if (hasNoCallers) {
    process.stdout.write(`    ${ANSI.DIM}No upstream callers found in project imports.${ANSI.RESET}\n\n`);
    if (isCli) process.exit();
    return result;
  }

  const hasChains = result.chains.length > 0;
  if (hasChains) {
    process.stdout.write(`  ${ANSI.GOLD}Causal Chains (${result.chains.length}):${ANSI.RESET}\n`);
    result.chains.slice(0, 10).forEach((chain, idx) => {
      process.stdout.write(`    ${ANSI.DIM}${idx + 1}.${ANSI.RESET} ${chain}\n`);
    });
    const hasMoreChains = result.chains.length > 10;
    if (hasMoreChains) {
      process.stdout.write(`    ${ANSI.DIM}...and ${result.chains.length - 10} more causal chain(s)${ANSI.RESET}\n`);
    }
  }

  const hasRootCallers = Boolean(result.rootCallers?.length > 0);
  if (hasRootCallers) {
    process.stdout.write(`  ${ANSI.PURPLE}Root Entry Points (${result.rootCallers.length}):${ANSI.RESET}\n`);
    result.rootCallers.forEach((r) => {
      process.stdout.write(`    ${ANSI.BOLD}${r.path}${ANSI.RESET} ${ANSI.DIM}[${r.tier}] (depth ${r.depth})${ANSI.RESET}\n`);
    });
  }

  process.stdout.write('\n');
  if (isCli) process.exit();
  return result;
};

export const runTraceCli = async (args = [], isCli = true) => {
  const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
  const target = nonFlagArgs[0];
  if (!target) {
    process.stderr.write(`${ANSI.RED}✕ Missing symbol or file target. Usage: chemx trace <symbol> [--max-depth=N] [--json]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }
  const isJson = args.includes('--json') || args.includes('-j');
  const maxDepthFlag = args.find((a) => a.startsWith('--max-depth=') || a.startsWith('-d='));
  const maxDepth = maxDepthFlag ? parseInt(maxDepthFlag.split('=')[1], 10) : 3;

  const { db, index, root } = openSyncedIndex(process.cwd(), null, { includeHeldScopes: true });
  printIndexLine(index, isJson);
  applyExitStatus(indexStatusOf(index), isCli);
  return handleCallTraceCommand(db, target, { index, isJson, isCli, maxDepth, root });
};

export const runBacktraceCli = async (args = [], isCli = true) => {
  const nonFlagArgs = args.filter((a) => !a.startsWith('-'));
  const target = nonFlagArgs[0];
  if (!target) {
    process.stderr.write(`${ANSI.RED}✕ Missing symbol or file target. Usage: chemx backtrace <symbol> [--max-depth=N] [--json]${ANSI.RESET}\n`);
    if (isCli) process.exit(1);
    return null;
  }
  const isJson = args.includes('--json') || args.includes('-j');
  const maxDepthFlag = args.find((a) => a.startsWith('--max-depth=') || a.startsWith('-d='));
  const maxDepth = maxDepthFlag ? parseInt(maxDepthFlag.split('=')[1], 10) : 5;

  const { db, index } = openSyncedIndex(process.cwd(), null, { includeHeldScopes: true });
  printIndexLine(index, isJson);
  applyExitStatus(indexStatusOf(index), isCli);
  return handleBacktraceCommand(db, target, { index, isJson, isCli, maxDepth });
};
