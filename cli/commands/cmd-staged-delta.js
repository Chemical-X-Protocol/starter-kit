/** `chemx audit --staged-delta [--json]`: the pre-commit gate on new hazards in staged files (#1716). */
import { evaluateStagedDelta } from '../audit/staged-delta.js';

const formatIncrease = (i) => `    [${i.severity}] ${i.rule}: ${i.before} -> ${i.after}`;

export const runStagedDeltaCommand = (rawArgs = [], cwd = process.cwd()) => {
  const result = evaluateStagedDelta(cwd, rawArgs);
  process.exitCode = result.isPassing ? 0 : 1;
  const isJson = rawArgs.includes('--json');
  if (isJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  const verdict = result.isPassing ? 'no new MEDIUM+ hazards in staged files' : 'staged files add hazards';
  process.stdout.write(`[Chemical X] Staged delta vs HEAD: ${verdict}\n`);
  for (const f of result.files) process.stdout.write(`  ${f.file}\n${f.increases.map(formatIncrease).join('\n')}\n`);
  return result;
};
