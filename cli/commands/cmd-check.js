/**
 * `chemx check <file...> [--profile=X] [--json]`: single-file micro-audits with the
 * same config resolution as `chemx audit` (.chemxrc plus an explicit --profile).
 * Every path is checked; any dirty or missing path fails the command (#1674).
 */
import { handleCheckCommand } from '../search-commands.js';
import { loadProjectConfig } from '../config/index.js';

const VALUE_FLAGS = new Set(['--profile']);

const collectTargets = (args) => {
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const takesValue = VALUE_FLAGS.has(arg);
    if (takesValue) i += 1;
    const isPositional = !arg.startsWith('-');
    if (isPositional) targets.push(arg);
  }
  return targets;
};

const normalizeProfileArgs = (args) => args.map((arg, i) => (arg === '--profile' ? `--profile=${args[i + 1] ?? ''}` : arg));

const checkMany = (targets, { isJson, config }) => {
  const files = targets.map((target) => handleCheckCommand(target, { isJson, isCli: false, config }));
  const failed = files.filter((f) => f.error);
  for (const f of failed) {
    if (!isJson) process.stderr.write(`\x1b[31m✕ ${f.error}\x1b[0m\n`);
  }
  const isClean = files.every((f) => f.isClean === true);
  if (isJson) process.stdout.write(JSON.stringify({ success: failed.length === 0, isClean, files }) + '\n');
  process.exitCode = isClean ? 0 : 1;
  return { success: failed.length === 0, isClean, files };
};

/**
 * Compact JSON (--json --compact): per file only [rule, line, severity] rows, and each rule's
 * hazard/directive/pillar text once under `rules`. Rule text is whatever the first hit carried.
 */
const toCompact = (files) => {
  const rules = {};
  const out = files.map((f) => {
    const hasError = Boolean(f.error);
    if (hasError) return { error: f.error };
    const hazards = (f.violations ?? []).map((v) => {
      rules[v.rule] ??= { hazard: v.hazard, directive: v.directive, pillar: v.pillar };
      return [v.rule, v.line, v.severity];
    });
    return { file: f.file, isClean: f.isClean, hazards };
  });
  return { files: out, rules };
};

const checkCompact = (targets, config) => {
  const files = targets.map((t) => handleCheckCommand(t, { isJson: true, isCli: false, config }));
  const isClean = files.length > 0 && files.every((f) => f.isClean === true);
  const result = { success: files.every((f) => !f.error), isClean, ...toCompact(files) };
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = isClean ? 0 : 1;
  return result;
};

export const runCheckCommand = (args = [], cwd = process.cwd()) => {
  const isJson = args.includes('--json');
  const config = loadProjectConfig(cwd, normalizeProfileArgs(args));
  const targets = collectTargets(args);
  const isCompact = isJson && args.includes('--compact');
  const shouldCompact = isCompact;
  if (shouldCompact) return checkCompact(targets, config);
  const isSingleTarget = targets.length <= 1;
  if (isSingleTarget) return handleCheckCommand(targets[0], { isJson, isCli: true, config });
  return checkMany(targets, { isJson, config });
};
