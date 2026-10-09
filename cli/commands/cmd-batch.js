// chemx do / chemx batch: run several CLI commands in one warm process and report the combined status.
// Commands that call process.exit() are contained, so a failing item can never end the batch green.
import { STATUS, combineStatuses, toExitCode } from '../result-status.js';

const STATUS_BY_EXIT = { 0: STATUS.PASS, 3: STATUS.INCONCLUSIVE };

class BatchItemExit extends Error {
  constructor(code) {
    super(`command exited with code ${code}`);
    this.exitCode = code;
  }
}

export const statusOfExitCode = (code) => STATUS_BY_EXIT[code] ?? STATUS.FAIL;

// Runs fn with process.exit intercepted; resolves to the item's exit code.
export const runContained = async (fn) => {
  const realExit = process.exit;
  const priorExitCode = process.exitCode;
  process.exitCode = undefined;
  process.exit = (code) => { throw new BatchItemExit(code ?? process.exitCode ?? 0); };
  try {
    await fn();
    return Number(process.exitCode ?? 0);
  } catch (err) {
    const isContainedExit = err instanceof BatchItemExit;
    if (isContainedExit) return Number(err.exitCode);
    process.stderr.write(`${err?.message || err}\n`);
    return 1;
  } finally {
    process.exit = realExit;
    process.exitCode = priorExitCode;
  }
};

const tokenize = (cmdStr) => {
  const tokens = cmdStr.trim().split(/\s+/).filter(Boolean);
  const hasPrefix = tokens[0] === 'cx' || tokens[0] === 'chemx';
  return hasPrefix ? tokens.slice(1) : tokens;
};

export const runBatch = async (rawArgs = [], isCli = true, dispatchFn = null) => {
  const commands = rawArgs.filter((a) => a !== 'do' && a !== 'batch').map(tokenize).filter((t) => t.length > 0);
  const isEmpty = commands.length === 0 || typeof dispatchFn !== 'function';
  if (isEmpty) {
    if (isCli) process.stderr.write('Usage: chemx do "<command 1>" "<command 2>" ...\n');
    return { status: STATUS.FAIL, code: 1, items: [] };
  }
  const items = [];
  for (const tokens of commands) {
    const label = tokens.join(' ');
    if (isCli) process.stdout.write(`\n--- chemx ${label} ---\n`);
    const code = await runContained(() => dispatchFn(tokens[0], tokens));
    items.push({ label, code, status: statusOfExitCode(code) });
  }
  const status = combineStatuses(items.map((i) => i.status));
  const code = toExitCode(status);
  if (isCli) process.stdout.write(`\n--- chemx do: ${status} (${items.map((i) => `${i.label}: ${i.status}`).join(', ')}) ---\n`);
  return { status, code, items };
};
