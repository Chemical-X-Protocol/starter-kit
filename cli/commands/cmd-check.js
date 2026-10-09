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

export const runCheckCommand = (args = [], cwd = process.cwd()) => {
  const isJson = args.includes('--json');
  const config = loadProjectConfig(cwd, normalizeProfileArgs(args));
  const targets = collectTargets(args);
  const isSingleTarget = targets.length <= 1;
  if (isSingleTarget) return handleCheckCommand(targets[0], { isJson, isCli: true, config });
  return checkMany(targets, { isJson, config });
};
