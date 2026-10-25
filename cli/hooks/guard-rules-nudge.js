// Nudge rules: shell habits that a newer chemx command replaces. They never block on their own;
// the guard shows the model the replacement and lets the call run. `.chemxrc` guardNudges: "block"
// (or CHEMX_GUARD_NUDGES=block) promotes them to blocks. A nudge is only active while the running
// chemx has the named command, so a stale hint never points at something that does not exist.

import { fileOperands, gitDirectory, gitSubcommand } from './guard-args.js';
import { isRepoPath } from './guard-paths.js';
import { isUnlistedProjectRunner, PROJECT_RUNNER_ADVICE } from './guard-test-runners.js';
import { isChemxInvocation, resolveInvocation } from './guard-invocation.js';
import { NAME_LIST_FLAGS, isOutputConsumed, shellWords, sleepSeconds } from './guard-shapes.js';

const SHELL_NAMES = new Set(['bash', 'sh', 'zsh']);
// A sleep this short is a pause, not a wait for a task or a lock (K11 #6756).
const SHORT_SLEEP_SECONDS = 120;
const POLLING_LOOP = /\b(?:until|while)\b/;
const baseName = (word) => String(word ?? '').split('/').pop();

const isTeamCall = (parsed) => {
  const invocation = resolveInvocation(parsed.argv);
  return isChemxInvocation(invocation) && invocation.args[0] === 'team';
};

// A sleep in a loop, or beside a chemx team call, is waiting for a task or a lock; chemx wait does that.
const isPollingSleep = (context) => {
  const waitsOnTeam = (context.siblings ?? []).some((parsed) => parsed.argv.length > 0 && isTeamCall(parsed));
  return waitsOnTeam || POLLING_LOOP.test(context.rawCommand ?? '');
};

const isWaitingSleep = ({ args }, context) => {
  const seconds = sleepSeconds(args);
  const isLong = seconds !== null && seconds > SHORT_SLEEP_SECONDS;
  return isLong || isPollingSleep(context);
};

const isHandRolledWait = (invocation, command, context) => {
  const { tool, args } = invocation;
  const isSleep = tool === 'sleep' && isWaitingSleep(invocation, context);
  const isNodeTimer = tool === 'node' && args.some((arg) => arg.includes('setTimeout'));
  const isTimeoutShell = baseName(command.argv[0]) === 'timeout' && SHELL_NAMES.has(tool);
  return isSleep || isNodeTimer || isTimeoutShell;
};

// `git diff --name-only` shown to the terminal; one that feeds a pipe, a substitution or a file is scripting and stays free.
const isShownNameList = (invocation, command, context) => {
  const { sub, rest } = gitSubcommand(invocation);
  const asksForNames = sub === 'diff' && rest.some((arg) => NAME_LIST_FLAGS.has(arg));
  return asksForNames && !isOutputConsumed(command, context.siblings ?? []);
};

const nameListUse = (invocation) => {
  const dir = gitDirectory(invocation);
  const { rest } = gitSubcommand(invocation);
  return `${dir === null ? 'chemx d' : `chemx d --root ${dir}`} ${shellWords(rest)}  (the file list; chemx d keeps summary formats whole)`;
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
  { id: 'nudge-project-runner', command: 'test', use: PROJECT_RUNNER_ADVICE, matches: isUnlistedProjectRunner },
  { id: 'nudge-wait', command: 'wait', use: 'chemx wait (see chemx wait --help) instead of a hand-rolled sleep, timer or polling loop', matches: isHandRolledWait },
  { id: 'nudge-git-diff-names', command: 'diff', use: nameListUse, matches: isShownNameList },
  {
    id: 'nudge-ls',
    command: 'f',
    matches: (invocation, command, context) => invocation.tool === 'ls' && lsTargets(invocation).some((target) => isRepoPath(target, context)),
    use: (invocation, command, context) => `chemx f "${lsTargets(invocation).find((target) => isRepoPath(target, context))}"  (lists tracked files whose path contains the text)`,
  },
].map((rule) => ({ ...rule, severity: 'nudge' }));
