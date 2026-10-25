// Fits a planned test command to the worker slots it was granted (see test-slots.js): node
// --test gets --test-concurrency=N, vitest and jest get --maxWorkers=N. A package-manager script
// (`npm run test:run`) gets the flag forwarded only when the plan says the script is a single
// runner command or ends in `exec <runner> "$@"`; otherwise the command is left alone and the run
// still holds its slots.
import fs from 'node:fs';
import path from 'node:path';

const NODE_CONCURRENCY = /\s--test-concurrency(?:=|\s+)(\S+)/g;
const NODE_TEST_FLAG = /(^|\s)--test(?=\s|$)/;
const MAX_WORKERS = /\s--maxWorkers(?:=|\s+)\S+/g;
const MIN_WORKERS = /\s--minWorkers(?:=|\s+)\S+/g;
const PM_RUN = /^(?:npm|pnpm|bun)\s+run\s+\S+$|^yarn\s+\S+$/;

// vitest 1.x defaults minWorkers to the core count and its pool refuses a smaller --maxWorkers
// ("minThreads and maxThreads must not conflict"), so that major gets --minWorkers=N as well.
const installedVitestMajor = (cwd) => {
  const hasCwd = typeof cwd === 'string' && cwd.length > 0;
  if (!hasCwd) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/vitest/package.json'), 'utf-8'));
    const major = parseInt(String(pkg.version).split('.')[0], 10);
    return Number.isInteger(major) ? major : null;
  } catch {
    return null;
  }
};

const setMaxWorkers = (command, workers, runner, { forwardsArgs = false, cwd = null } = {}) => {
  const isPmRun = PM_RUN.test(command.trim());
  const shouldKeepCommand = isPmRun && !forwardsArgs;
  if (shouldKeepCommand) return command;
  const separator = isPmRun && !command.startsWith('yarn') ? ' --' : '';
  const stripped = command.replace(MAX_WORKERS, '').replace(MIN_WORKERS, '');
  const vitestMajor = runner === 'vitest' ? installedVitestMajor(cwd) : null;
  const needsMinWorkers = vitestMajor !== null && vitestMajor < 2;
  const minWorkers = needsMinWorkers ? ` --minWorkers=${workers}` : '';
  return `${stripped}${separator} --maxWorkers=${workers}${minWorkers}`;
};

const setNodeConcurrency = (command, workers) => {
  const isDirectNode = /^node\s/.test(command) && NODE_TEST_FLAG.test(command);
  if (!isDirectNode) return command;
  return command.replace(NODE_CONCURRENCY, '').replace(NODE_TEST_FLAG, (match, lead) => `${lead}--test --test-concurrency=${workers}`);
};

export const withWorkerCount = (command, runner, workers, options = {}) => {
  const isNodeRunner = runner === 'node';
  if (isNodeRunner) return setNodeConcurrency(command, workers);
  const usesMaxWorkers = runner === 'vitest' || runner === 'jest';
  return usesMaxWorkers ? setMaxWorkers(command, workers, runner, options) : command;
};

// A target that is one existing file (no glob characters, not a directory).
export const isFileTarget = (cwd, target) => !/[*?[{]/.test(target) && Boolean(fs.statSync(path.resolve(cwd, target), { throwIfNoEntry: false })?.isFile());

// The workers a run asks for: the budget, capped by the script's own --test-concurrency and,
// when every target is a plain spec file, by the number of files (one file never needs more).
export const requestedWorkers = ({ command, cwd, targets = [], budget }) => {
  const caps = [budget];
  const scriptConcurrency = Number([...command.matchAll(NODE_CONCURRENCY)].at(-1)?.[1]);
  const hasScriptConcurrency = Boolean(Number.isInteger(scriptConcurrency) && scriptConcurrency > 0);
  if (hasScriptConcurrency) caps.push(scriptConcurrency);
  const areAllFiles = targets.length > 0 && targets.every((target) => isFileTarget(cwd, target));
  if (areAllFiles) caps.push(targets.length);
  return Math.max(1, Math.min(...caps));
};
