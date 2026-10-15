/**
 * `chemx audit --staged-delta [--json]`: the pre-commit gate on new hazards in staged files (#1716, #2546).
 * `chemx audit --delta-base=<ref> [--json]`: the same per-rule gate on the changed files against a base ref (#6091).
 */
import { evaluateStagedDelta } from '../audit/staged-delta.js';
import { evaluateBaseDelta } from '../audit/base-delta.js';
import { formatSites } from '../audit/gate-delta.js';

const formatIncrease = (i) => `    [${i.severity}] ${i.rule}: ${i.before} -> ${i.after}`;

const GUIDANCE = [
  'Rule: a commit may not raise any rule\'s violation count in a staged file, at any severity (same rule as the audit ratchet).',
  'Fix the sites above, or bypass once with CHEMX_SKIP_PRECOMMIT=1 (skips only this hook; chemx verify fails on them only when a chemx-ratchet.json baseline exists and the rule is above it, otherwise it gates CRITICAL/HIGH only).'
];

const baseGuidance = (ref) => [
  'Rule: a change may not raise any rule\'s violation count in a changed file, at any severity (same rule as the pre-commit hook and the audit ratchet).',
  `Fix the sites above. Hazards that ${ref} already has do not count, and other rules the repo-wide ratchet fails on do not block this gate.`
];

const printSites = (result, guidance) => {
  for (const f of result.files) process.stdout.write(`  ${f.file}\n${f.increases.map(formatIncrease).join('\n')}\n`);
  const sites = result.files.flatMap(formatSites);
  const hasSites = sites.length > 0;
  if (hasSites) process.stdout.write(`  New hazards:\n${sites.map((s) => `    ${s}`).join('\n')}\n${guidance.join('\n')}\n`);
};

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
  printSites(result, GUIDANCE);
  return result;
};

/** `--delta-base=<ref>` or `--delta-base <ref>`; null when the flag has no value. */
export const deltaBaseOf = (rawArgs) => {
  const at = rawArgs.findIndex((arg) => arg === '--delta-base' || arg.startsWith('--delta-base='));
  const isAbsent = at === -1;
  if (isAbsent) return null;
  const inline = rawArgs[at].slice('--delta-base='.length);
  const hasInline = rawArgs[at].startsWith('--delta-base=') && inline !== '';
  if (hasInline) return inline;
  const next = rawArgs[at + 1];
  const hasNextValue = typeof next === 'string' && !next.startsWith('-');
  return hasNextValue ? next : null;
};

export const runBaseDeltaCommand = (rawArgs = [], cwd = process.cwd()) => {
  const ref = deltaBaseOf(rawArgs);
  const result = evaluateBaseDelta(cwd, ref, rawArgs);
  process.exitCode = result.isPassing ? 0 : 1;
  const isJson = rawArgs.includes('--json');
  if (isJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  if (result.baseMissing) {
    process.stdout.write(`[Chemical X] Delta vs ${ref ?? '(no revision given)'}: ${result.error}; use --delta-base=<ref> with a branch, tag or commit that exists\n`);
    return result;
  }
  const verdict = result.isPassing ? 'no new hazards in changed files (any severity)' : 'changed files add hazards';
  process.stdout.write(`[Chemical X] Delta vs ${ref}: ${verdict} (${result.checked} source file(s) compared)\n`);
  printSites(result, baseGuidance(ref));
  return result;
};
