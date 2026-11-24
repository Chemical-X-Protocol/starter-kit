/**
 * cmd-arch.js: CLI Handler for `chemx arch` / `chemx map`.
 * Explains codebase architecture, capsule hierarchy, and intent routing
 * without burning tokens on raw directory traversals.
 */

import { ANSI } from '../theme.js';
import { indexArchitecture, resolveCapsuleForIntent } from '../arch-index.js';

const TIER_COLORS = {
  View: ANSI.CYAN,
  Layout: ANSI.CYAN,
  Organism: ANSI.PURPLE,
  Molecule: ANSI.GOLD,
  Atom: ANSI.MINT,
  Controller: ANSI.BLUE,
  Hook: ANSI.GREEN,
  Store: ANSI.YELLOW,
  Utility: ANSI.DIM
};

export const runArchCli = async (rawArgs = [], isCli = false, cwd = process.cwd()) => {
  const isJson = rawArgs.includes('--json');
  const intentFlag = rawArgs.find((a) => a.startsWith('--intent='));
  const intentText = intentFlag ? intentFlag.slice(9).trim() : null;

  const nonFlag = rawArgs.filter((a) => !a.startsWith('-'));
  const targetDir = nonFlag[0] || 'src';

  const archResult = indexArchitecture(targetDir, cwd);

  let recommendation = null;
  const hasIntent = Boolean(intentText);
  if (hasIntent) {
    recommendation = resolveCapsuleForIntent(archResult.capsules, intentText);
  }

  const payload = {
    ...archResult,
    recommendation
  };

  if (isJson) {
    const jsonOutput = JSON.stringify(payload, null, 2);
    if (isCli) process.stdout.write(`${jsonOutput}\n`);
    return payload;
  }

  if (isCli) {
    process.stdout.write(`\n${ANSI.BOLD}🏛️  Architecture Map:${ANSI.RESET} ${ANSI.CYAN}${archResult.targetDir}${ANSI.RESET} (${archResult.totalCapsules} capsules, ${archResult.totalLines} lines)\n\n`);

    if (recommendation) {
      process.stdout.write(`${ANSI.BOLD}${ANSI.MINT}🎯 Recommended Target for:${ANSI.RESET} "${intentText}"\n`);
      process.stdout.write(`   ${ANSI.BOLD}Capsule:${ANSI.RESET}    ${recommendation.capsule.name} [${recommendation.capsule.tier}]\n`);
      process.stdout.write(`   ${ANSI.BOLD}Target File:${ANSI.RESET} ${recommendation.targetFile}\n`);
      process.stdout.write(`   ${ANSI.BOLD}Rationale:${ANSI.RESET}  ${recommendation.rationale}\n\n`);
    }

    const tierGroups = new Map();
    for (const cap of archResult.capsules) {
      const list = tierGroups.get(cap.tier) || [];
      list.push(cap);
      tierGroups.set(cap.tier, list);
    }

    const displayTiers = ['View', 'Layout', 'Organism', 'Molecule', 'Atom', 'Controller', 'Hook', 'Store', 'Utility'];
    for (const tierName of displayTiers) {
      const capsules = tierGroups.get(tierName);
      const hasCapsules = Boolean(capsules && capsules.length > 0);
      if (!hasCapsules) continue;

      const color = TIER_COLORS[tierName] || ANSI.RESET;
      process.stdout.write(`${color}${ANSI.BOLD}[${tierName}s]${ANSI.RESET} (${capsules.length} items)\n`);

      for (let i = 0; i < capsules.length; i++) {
        const cap = capsules[i];
        const isLast = i === capsules.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const consumerTag = cap.consumers > 0 ? ` ${ANSI.DIM}[used by: ${cap.consumers}]${ANSI.RESET}` : '';
        const exportTag = cap.exports.length > 0 ? ` ${ANSI.DIM}(exports: ${cap.exports.slice(0, 3).join(', ')})${ANSI.RESET}` : '';
        const hazardTag = cap.hazardCount > 0 ? ` ${ANSI.RED}[${cap.hazardCount} hazards]${ANSI.RESET}` : ` ${ANSI.GREEN}[clean]${ANSI.RESET}`;

        process.stdout.write(`  ${branch}${ANSI.BOLD}${cap.name}${ANSI.RESET} (${cap.lines}L)${consumerTag}${hazardTag}${exportTag}\n`);
      }
      process.stdout.write('\n');
    }
  }

  return payload;
};
