import { ANSI } from './theme.js';
import { toColumnar } from './columnar.js';
import { calculateBlastRadius } from './search-db.js';

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
