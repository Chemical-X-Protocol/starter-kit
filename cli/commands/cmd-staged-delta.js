/** `chemx audit --staged-delta [--json]`: the pre-commit gate on new hazards in staged files (#1716, #2546). */
import { evaluateStagedDelta } from '../audit/staged-delta.js';
import { formatSites } from '../audit/gate-delta.js';

const formatIncrease = (i) => `    [${i.severity}] ${i.rule}: ${i.before} -> ${i.after}`;

const GUIDANCE = [
  'Rule: a commit may not raise any rule\'s violation count in a staged file, at any severity (same rule as the audit ratchet).',
  'Fix the sites above, or bypass once with CHEMX_SKIP_PRECOMMIT=1 (skips only this hook; chemx verify still fails on the same hazards).'
];

export const runStagedDeltaCommand = (rawArgs = [], cwd = process.cwd()) => {
  const result = evaluateStagedDelta(cwd, rawArgs);
  process.exitCode = result.isPassing ? 0 : 1;
  const isJson = rawArgs.includes('--json');
  if (isJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  const verdict = result.isPassing ? 'no new hazards in staged files (any severity)' : 'staged files add hazards';
  process.stdout.write(`[Chemical X] Staged delta vs HEAD: ${verdict}\n`);
  for (const f of result.files) process.stdout.write(`  ${f.file}\n${f.increases.map(formatIncrease).join('\n')}\n`);
  const sites = result.files.flatMap(formatSites);
  const hasSites = sites.length > 0;
  if (hasSites) process.stdout.write(`  New hazards:\n${sites.map((s) => `    ${s}`).join('\n')}\n${GUIDANCE.join('\n')}\n`);
  return result;
};
