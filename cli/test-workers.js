// Fits a planned test command to the worker slots it was granted (see test-slots.js): node
// --test gets --test-concurrency=N, vitest and jest get --maxWorkers=N. A package-manager script
// (`npm run test:run`) gets the flag forwarded only when the plan says the script is a single
// runner command; otherwise the command is left alone and the run still holds its slots.
import fs from 'node:fs';
import path from 'node:path';

const NODE_CONCURRENCY = /\s--test-concurrency(?:=|\s+)(\S+)/g;
const NODE_TEST_FLAG = /(^|\s)--test(?=\s|$)/;
const MAX_WORKERS = /\s--maxWorkers(?:=|\s+)\S+/g;
const PM_RUN = /^(?:npm|pnpm|bun)\s+run\s+\S+$|^yarn\s+\S+$/;

const setMaxWorkers = (command, workers, { forwardsArgs = false } = {}) => {
  const isPmRun = PM_RUN.test(command.trim());
  if (isPmRun && !forwardsArgs) return command;
  const separator = isPmRun && !command.startsWith('yarn') ? ' --' : '';
  return `${command.replace(MAX_WORKERS, '')}${separator} --maxWorkers=${workers}`;
};

const setNodeConcurrency = (command, workers) => {
  const isDirectNode = /^node\s/.test(command) && NODE_TEST_FLAG.test(command);
  if (!isDirectNode) return command;
  return command.replace(NODE_CONCURRENCY, '').replace(NODE_TEST_FLAG, (match, lead) => `${lead}--test --test-concurrency=${workers}`);
};

export const withWorkerCount = (command, runner, workers, options = {}) => {
  if (runner === 'node') return setNodeConcurrency(command, workers);
  const usesMaxWorkers = runner === 'vitest' || runner === 'jest';
  return usesMaxWorkers ? setMaxWorkers(command, workers, options) : command;
};

// The workers a run asks for: the budget, capped by the script's own --test-concurrency and,
// when every target is a plain spec file, by the number of files (one file never needs more).
export const requestedWorkers = ({ command, cwd, targets = [], budget }) => {
  const caps = [budget];
  const scriptConcurrency = Number([...command.matchAll(NODE_CONCURRENCY)].at(-1)?.[1]);
  if (Number.isInteger(scriptConcurrency) && scriptConcurrency > 0) caps.push(scriptConcurrency);
  const isFileTarget = (target) => !/[*?[{]/.test(target) && fs.statSync(path.resolve(cwd, target), { throwIfNoEntry: false })?.isFile();
  const areAllFiles = targets.length > 0 && targets.every(isFileTarget);
  if (areAllFiles) caps.push(targets.length);
  return Math.max(1, Math.min(...caps));
};
