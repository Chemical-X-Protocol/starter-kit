// Nudge rules: shell habits that a newer chemx command replaces. They never block on their own;
// the guard shows the model the replacement and lets the call run. `.chemxrc` guardNudges: "block"
// (or CHEMX_GUARD_NUDGES=block) promotes them to blocks. A nudge is only active while the running
// chemx has the named command, so a stale hint never points at something that does not exist.

import { fileOperands, gitSubcommand } from './guard-args.js';
import { isRepoPath } from './guard-paths.js';

const SHELL_NAMES = new Set(['bash', 'sh', 'zsh']);
const baseName = (word) => String(word ?? '').split('/').pop();

const isHandRolledWait = ({ tool, args }, command) => {
  const isSleep = tool === 'sleep';
  const isNodeTimer = tool === 'node' && args.some((arg) => arg.includes('setTimeout'));
  const isTimeoutShell = baseName(command.argv[0]) === 'timeout' && SHELL_NAMES.has(tool);
  return isSleep || isNodeTimer || isTimeoutShell;
};

const lsTargets = ({ args }) => {
  const operands = fileOperands(args, new Set());
  return operands.length > 0 ? operands : ['.'];
};

const gitIs = (names) => (invocation) => names.includes(gitSubcommand(invocation).sub);

export const NUDGE_RULES = [
  { id: 'nudge-git-status', command: 'status', use: 'chemx status (a compact working-tree summary)', matches: gitIs(['status']) },
  { id: 'nudge-git-add', command: 'commit', use: 'chemx commit (path-limited commit; see chemx commit --help)', matches: gitIs(['add']) },
  { id: 'nudge-git-commit', command: 'commit', use: 'chemx commit (path-limited commit; see chemx commit --help)', matches: gitIs(['commit']) },
  { id: 'nudge-wait', command: 'wait', use: 'chemx wait (see chemx wait --help) instead of a hand-rolled sleep, timer or polling loop', matches: isHandRolledWait },
  {
    id: 'nudge-ls',
    command: 'f',
    matches: (invocation, command, context) => invocation.tool === 'ls' && lsTargets(invocation).some((target) => isRepoPath(target, context)),
    use: (invocation, command, context) => `chemx f "${lsTargets(invocation).find((target) => isRepoPath(target, context))}"  (lists tracked files whose path contains the text)`,
  },
].map((rule) => ({ ...rule, severity: 'nudge' }));
