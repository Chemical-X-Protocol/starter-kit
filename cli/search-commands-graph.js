import { ANSI } from './theme.js';
import { toColumnar } from './columnar.js';
import {
  calculateBlastRadius,
  calculateCallTrace,
  calculateBacktrace,
  openIndexDb
} from './search-db.js';

export const handleBlastRadiusCommand = (db, target, { isJson = false, isCli = true, isColumnar = false, maxDepth = 5 } = {}) => {
  const result = calculateBlastRadius(db, target, { maxDepth });
  const allConsumers = [...result.directConsumers, ...result.transitiveConsumers];

  if (isJson) {
    if (isColumnar) {
      const colData = toColumnar(allConsumers, ['path', 'tier', 'depth']);
      const payload = {
        target: result.target,
        seed: result.seedPath,
        count: result.totalImpactCount,
        depth: result.depth,
        tiers: result.tiers,
        format: 'columnar',
        cols: colData.cols,
        rows: colData.rows,
        tests: result.impactedTests.map((t) => t.path || t)
      };
      process.stdout.write(JSON.stringify(payload) + '\n');
      if (isCli) process.exit(0);
      return payload;
    }

    const payload = {
      target: result.target,
      seed: result.seedPath,
      count: result.totalImpactCount,
      depth: result.depth,
      tiers: result.tiers,
      consumers: allConsumers.map((c) => ({
        path: c.path,
        tier: c.tier,
        depth: c.depth
      })),
      tests: result.impactedTests.map((t) => t.path || t)
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
    if (isCli) process.exit(0);
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Blast Radius Analysis:${ANSI.RESET} ${ANSI.BOLD}${target}${ANSI.RESET}\n`);
  if (result.seedPath) {
    process.stdout.write(`  ${ANSI.DIM}Resolved Seed:${ANSI.RESET} ${result.seedPath}\n`);
  }
  process.stdout.write(`  ${ANSI.MINT}Impact Summary:${ANSI.RESET} ${result.totalImpactCount} total affected files across ${result.depth} dependency hops\n`);

  if (result.totalImpactCount === 0) {
    process.stdout.write(`    ${ANSI.DIM}No downstream consumers found. Modification has 0 blast radius.${ANSI.RESET}\n\n`);
    if (isCli) process.exit(0);
    return result;
  }

  if (result.directConsumers.length > 0) {
    process.stdout.write(`  ${ANSI.GOLD}Direct Consumers (Depth 1 - ${result.directConsumers.length}):${ANSI.RESET}\n`);
    for (const c of result.directConsumers) {
      process.stdout.write(`    ${ANSI.BOLD}${c.path}${ANSI.RESET} ${ANSI.DIM}[${c.tier}]${ANSI.RESET}\n`);
    }
  }

  if (result.transitiveConsumers.length > 0) {
    process.stdout.write(`  ${ANSI.PURPLE}Transitive Consumers (Depth 2+ - ${result.transitiveConsumers.length}):${ANSI.RESET}\n`);
    for (const c of result.transitiveConsumers) {
      process.stdout.write(`    ${ANSI.DIM}(depth ${c.depth})${ANSI.RESET} ${c.path} ${ANSI.DIM}[${c.tier}]${ANSI.RESET}\n`);
    }
  }

  if (result.impactedTests.length > 0) {
    process.stdout.write(`  ${ANSI.RED}Impacted Tests (${result.impactedTests.length}):${ANSI.RESET}\n`);
    for (const t of result.impactedTests) {
      process.stdout.write(`    ${ANSI.RED}▶${ANSI.RESET} ${t.path || t}\n`);
    }
  }

  process.stdout.write('\n');
  if (isCli) process.exit(0);
  return result;
};

const renderCalleeTreeLines = (callees, indent = '  ') => {
  const lines = [];
  callees.forEach((c, idx) => {
    const isLast = idx === callees.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const subIndent = isLast ? '    ' : '│   ';
    const tag = c.isExternal ? `${ANSI.DIM}[external]${ANSI.RESET}` : `${ANSI.GOLD}[${c.tier}]${ANSI.RESET}`;
    const loc = c.file ? ` ${ANSI.DIM}(${c.file}${c.line ? `:${c.line}` : ''})${ANSI.RESET}` : '';
    lines.push(`${indent}${branch}${ANSI.BOLD}${c.symbol}${ANSI.RESET} ${tag}${loc}`);
    if (c.callees && c.callees.length > 0) {
      lines.push(...renderCalleeTreeLines(c.callees, `${indent}${subIndent}`));
    }
  });
  return lines;
};

export const handleCallTraceCommand = (db, target, { isJson = false, isCli = true, maxDepth = 3 } = {}) => {
  const result = calculateCallTrace(db, target, { maxDepth });

  if (isJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    if (isCli) process.exit(0);
    return result;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Forward Call Trace:${ANSI.RESET} ${ANSI.BOLD}${result.target}${ANSI.RESET}\n`);
  if (result.filePath) {
    process.stdout.write(`  ${ANSI.DIM}Defined in:${ANSI.RESET} ${result.filePath}:${result.startLine} ${ANSI.DIM}[${result.tier}]${ANSI.RESET}\n`);
  }
  process.stdout.write(`  ${ANSI.MINT}Callee Summary:${ANSI.RESET} ${result.totalCallees} downstream calls mapped across ${result.depth} hops\n`);

  if (result.callees.length === 0) {
    process.stdout.write(`    ${ANSI.DIM}No downstream calls or external invocations detected.${ANSI.RESET}\n\n`);
    if (isCli) process.exit(0);
    return result;
  }

  const treeLines = renderCalleeTreeLines(result.callees, '  ');
  process.stdout.write(treeLines.join('\n') + '\n\n');

  if (isCli) process.exit(0);
  return result;
};

export const handleBacktraceCommand = (db, target, { isJson = false, isCli = true, maxDepth = 5 } = {}) => {
  const result = calculateBacktrace(db, target, { maxDepth });

  if (isJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    if (isCli) process.exit(0);
    return result;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Backtrace Causal Path:${ANSI.RESET} ${ANSI.BOLD}${result.target}${ANSI.RESET}\n`);
  if (result.seedPath) {
    process.stdout.write(`  ${ANSI.DIM}Resolved Target:${ANSI.RESET} ${result.seedPath}\n`);
  }
  process.stdout.write(`  ${ANSI.MINT}Caller Summary:${ANSI.RESET} ${result.totalCallers} upstream callers across ${result.depth} causal hops\n`);

  if (result.totalCallers === 0) {
    process.stdout.write(`    ${ANSI.DIM}No upstream callers found in project imports.${ANSI.RESET}\n\n`);
    if (isCli) process.exit(0);
    return result;
  }

  if (result.chains.length > 0) {
    process.stdout.write(`  ${ANSI.GOLD}Causal Chains (${result.chains.length}):${ANSI.RESET}\n`);
    result.chains.slice(0, 10).forEach((chain, idx) => {
      process.stdout.write(`    ${ANSI.DIM}${idx + 1}.${ANSI.RESET} ${chain}\n`);
    });
    if (result.chains.length > 10) {
      process.stdout.write(`    ${ANSI.DIM}...and ${result.chains.length - 10} more causal chain(s)${ANSI.RESET}\n`);
    }
  }

  if (result.rootCallers && result.rootCallers.length > 0) {
    process.stdout.write(`  ${ANSI.PURPLE}Root Entry Points (${result.rootCallers.length}):${ANSI.RESET}\n`);
    result.rootCallers.forEach((r) => {
      process.stdout.write(`    ${ANSI.BOLD}${r.path}${ANSI.RESET} ${ANSI.DIM}[${r.tier}] (depth ${r.depth})${ANSI.RESET}\n`);
    });
  }

  process.stdout.write('\n');
  if (isCli) process.exit(0);
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

  const db = openIndexDb(process.cwd());
  return handleCallTraceCommand(db, target, { isJson, isCli, maxDepth });
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

  const db = openIndexDb(process.cwd());
  return handleBacktraceCommand(db, target, { isJson, isCli, maxDepth });
};
