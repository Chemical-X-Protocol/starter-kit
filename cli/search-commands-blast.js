// `chemx q <target> --blast-radius`: consumers by exact module resolution. An ambiguous or
// unknown target is inconclusive with candidates, never "0 blast radius".
import { ANSI } from './theme.js';
import { toColumnar } from './columnar.js';
import { calculateBlastRadius } from './search-queries-graph.js';
import { withIndex } from './search-output.js';
import { STATUS, combineStatuses, toExitCode } from './result-status.js';

const describeBlastStatus = (result) => {
  if (result.ambiguous) return { status: STATUS.INCONCLUSIVE, reason: `ambiguous target "${result.target}": ${result.candidates.length} candidates; pass a full path` };
  if (result.notFound) return { status: STATUS.INCONCLUSIVE, reason: `target "${result.target}" is not a file or symbol in the index scope` };
  return { status: STATUS.PASS, reason: null };
};

export const buildBlastPayload = (result, { isColumnar = false } = {}) => {
  const allConsumers = [...result.directConsumers, ...result.transitiveConsumers];
  const { status, reason } = describeBlastStatus(result);
  const base = {
    status, reason, target: result.target, seed: result.seedPath, symbol: result.symbol || null,
    count: result.totalImpactCount, depth: result.depth, tiers: result.tiers,
    tests: result.impactedTests.map((t) => t.path),
    possibleConsumers: result.possibleConsumers || [],
    candidates: result.candidates || []
  };
  if (isColumnar) {
    const colData = toColumnar(allConsumers, ['path', 'tier', 'depth']);
    return { ...base, format: 'columnar', cols: colData.cols, rows: colData.rows };
  }
  return { ...base, consumers: allConsumers.map((c) => ({ path: c.path, tier: c.tier, depth: c.depth })) };
};

const printList = (title, color, items, render) => {
  const hasItems = items.length > 0;
  if (!hasItems) return;
  process.stdout.write(`  ${color}${title} (${items.length}):${ANSI.RESET}\n`);
  for (const item of items) process.stdout.write(`    ${render(item)}\n`);
};

export const handleBlastRadiusCommand = (db, target, { index = null, isJson = false, isCli = true, isColumnar = false, maxDepth = 5 } = {}) => {
  const result = calculateBlastRadius(db, target, { maxDepth });
  const payload = buildBlastPayload(result, { isColumnar });
  const status = combineStatuses([payload.status, index ? index.status : STATUS.PASS]);
  payload.status = status;
  if (isCli) process.exitCode = toExitCode(status);

  if (isJson) {
    process.stdout.write(JSON.stringify(withIndex(payload, index)) + '\n');
    if (isCli) process.exit();
    return payload;
  }

  process.stdout.write(`\n${ANSI.BOLD}${ANSI.CYAN}Blast Radius:${ANSI.RESET} ${ANSI.BOLD}${target}${ANSI.RESET}\n`);
  const hasReason = Boolean(payload.reason);
  if (hasReason) process.stdout.write(`  ${ANSI.GOLD}? Inconclusive: ${payload.reason}${ANSI.RESET}\n`);
  printList('Candidates', ANSI.GOLD, payload.candidates, (c) => c);
  if (result.seedPath) process.stdout.write(`  ${ANSI.DIM}Seed:${ANSI.RESET} ${result.seedPath}${result.symbol ? ` (symbol ${result.symbol})` : ''}\n`);
  const isResolved = Boolean(result.seedPath);
  if (isResolved) process.stdout.write(`  ${ANSI.MINT}Impact:${ANSI.RESET} ${result.totalImpactCount} files across ${result.depth} hops (exact import resolution)\n`);
  printList('Direct consumers (depth 1)', ANSI.GOLD, result.directConsumers, (c) => `${c.path} ${ANSI.DIM}[${c.tier}]${ANSI.RESET}`);
  printList('Transitive consumers', ANSI.PURPLE, result.transitiveConsumers, (c) => `${ANSI.DIM}(depth ${c.depth})${ANSI.RESET} ${c.path}`);
  printList('Impacted tests', ANSI.RED, result.impactedTests, (t) => t.path);
  printList('Possible consumers (unresolved import of the same name)', ANSI.DIM, payload.possibleConsumers, (p) => `${p.path}:${p.line} from '${p.sourceModule}'`);
  process.stdout.write('\n');
  if (isCli) process.exit();
  return result;
};
