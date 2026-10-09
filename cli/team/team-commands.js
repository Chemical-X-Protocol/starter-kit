/**
 * Chemical X Protocol: Swarm CLI Command Handlers
 * Parses arguments and dispatches actions for team status, feed, tasks, locks and merges.
 * The team db comes from openTeamContext (coordination-db.js): the coordination root's db for any
 * cwd, or an unmerged package silo until `chemx team migrate` merges it (#2488).
 */

import { openTeamContext, describeTeamDbFailure } from './coordination-db.js';
import { formatTeamHelpCard } from './team-format.js';
import { parseFlags } from './team-flags.js';
import { handleTrainCommand } from './team-commands-vds.js';
import { handleLockCommand, handleUnlockCommand } from './team-commands-lock.js';
import { runCheckStagedArgs } from './team-commands-lock-staged.js';
import { handleProfileCommand, handleHandoffCommand } from './team-commands-profile.js';
import { handleDispatchCommand } from './team-commands-dispatch.js';
import { handleRunTokens, parseRunArgs } from './team-commands-tokens.js';
import { runAuditRunCli } from './audit-run.js';
import { isBoardCommand, runBoardCommand } from './team-commands-board.js';
import { runTaskCommand } from './team-commands-task.js';
import { runTriage } from './team-commands-triage.js';
import { handleMigrateCommand } from './team-commands-migrate.js';
import { parseRepoFlags, resolveTaskIdArgs, REPO_VALUE_FLAGS } from './team-commands-repo.js';

const ARG_VAL_FLAGS = ['--target', '--as', '--to', '--agent', '--since', '--limit', '--thread', '--task', '--parent', '--rule', '--priority', '--prio', '--moscow', '--needs', '--url', '--pid', '--run', '--projects', ...REPO_VALUE_FLAGS];

const TEAM_COMMANDS = ['status', 'task', 'lock', 'unlock', 'feed', 'post', 'inbox', 'dm', 'tokens', 'audit-run', 'triage', 'benchmark', 'train', 'migrate'];

const splitPositionals = (restArgs) => {
  const positionals = [];
  for (let i = 0; i < restArgs.length; i++) {
    const a = restArgs[i];
    const isFlagToken = a.startsWith('-');
    if (isFlagToken) continue;
    const isVal = i > 0 && ARG_VAL_FLAGS.includes(restArgs[i - 1]);
    if (isVal) continue;
    positionals.push(a);
  }
  return positionals;
};

// `--` ends options: every later word is literal text (a task title may contain --test).
const parseArgs = (rawArgs) => {
  const terminatorIndex = rawArgs.indexOf('--');
  const hasTerminator = terminatorIndex !== -1;
  const optionArgs = hasTerminator ? rawArgs.slice(0, terminatorIndex) : rawArgs;
  const titleWords = hasTerminator ? rawArgs.slice(terminatorIndex + 1) : [];
  const restArgs = optionArgs.slice(1);
  const flags = { ...parseFlags(restArgs), ...parseRepoFlags(restArgs) };
  return { subCommand: optionArgs[0] || 'status', restArgs, flags, positionals: splitPositionals(restArgs), titleWords };
};

const SUB_COMMANDS = {
  task: (ctx, args, isCli, cwd) => runTaskCommand(ctx, args.positionals, args.flags, args.titleWords, isCli, cwd),
  lock: (ctx, args, isCli, cwd) => handleLockCommand(ctx.db, args.positionals, args.flags, isCli, cwd),
  unlock: (ctx, args, isCli, cwd) => handleUnlockCommand(ctx.db, args.positionals, args.flags, isCli, cwd),
  triage: (ctx, args, isCli, cwd) => runTriage(ctx, args.flags, isCli, cwd),
  train: (ctx, args, isCli) => handleTrainCommand(ctx.db, args.positionals[0] || 'status', args.flags, isCli, args.flags.isJson),
  profile: (ctx, args, isCli) => handleProfileCommand(ctx.db, args.positionals, args.flags, isCli),
  handoff: (ctx, args, isCli) => handleHandoffCommand(ctx.db, args.positionals, args.flags, isCli, args.titleWords),
  dispatch: (ctx, args, isCli, cwd) => handleDispatchCommand(ctx.db, { ...args.flags, root: ctx.root }, isCli, cwd)
};

const runSubCommand = (ctx, args, isCli, cwd) => {
  const { subCommand } = args;
  const isTokens = subCommand === 'tokens' || subCommand === 'telemetry';
  const runOptions = isTokens ? parseRunArgs(args.restArgs) : null;
  if (runOptions) return handleRunTokens(ctx.db, runOptions, args.flags.isJson, isCli, cwd);
  const isBoard = isBoardCommand(subCommand);
  if (isBoard) return runBoardCommand(ctx.db, subCommand, args.flags, args.positionals, isCli);
  const isKnown = Object.hasOwn(SUB_COMMANDS, subCommand);
  if (isKnown) return SUB_COMMANDS[subCommand](ctx, args, isCli, cwd);
  if (isCli) {
    process.stderr.write(`\x1b[31m✕ Unknown team command: "${subCommand}". Available commands: status, task, feed, post, lock, unlock, triage, inbox, dm, profile, handoff, dispatch, benchmark, migrate, tokens, audit-run\x1b[0m\n`);
  }
  return { error: `Unknown team command: ${subCommand}` };
};

export const runTeamCli = (rawArgs = [], isCli = false, cwd = process.cwd()) => {
  // The commit guard reads leases read-only and must not open (create, migrate) a team db first.
  const isStagedCheck = rawArgs[0] === 'lock' && rawArgs[1] === 'check-staged';
  if (isStagedCheck) return runCheckStagedArgs(rawArgs.slice(2), isCli, cwd);
  const args = parseArgs(rawArgs);
  const isTeamHelp = ['--help', '-h', 'help'].includes(args.subCommand) || (args.subCommand === 'status' && args.flags.help);
  if (isTeamHelp) {
    if (isCli) process.stdout.write(formatTeamHelpCard());
    return { help: true, commands: TEAM_COMMANDS };
  }
  // migrate opens its own target (the coordination db, or --into) and never the cwd's silo.
  const isMigrate = args.subCommand === 'migrate';
  if (isMigrate) return handleMigrateCommand(args.flags, isCli, cwd);
  // audit-run reads transcripts and uses the db only when one opens; it never needs the cwd's silo.
  const isAuditRun = args.subCommand === 'audit-run';
  if (isAuditRun) return runAuditRunCli(args.restArgs, args.flags, isCli, cwd);
  const ctx = openTeamContext(cwd);
  const isUnavailable = !ctx.db;
  if (isUnavailable) {
    if (isCli) process.stderr.write(`\x1b[31m✕ ${describeTeamDbFailure(ctx)}\x1b[0m\n`);
    return null;
  }
  // Every task-id argument (positional id, --parent, --task, --deps) resolves for the caller's repo.
  const taskAction = args.subCommand === 'task' ? (args.positionals[0] || 'list') : '';
  const resolved = resolveTaskIdArgs(ctx.db, ctx, taskAction, args.positionals, args.flags, isCli);
  return runSubCommand(ctx, { ...args, positionals: resolved.positionals, flags: resolved.flags }, isCli, cwd);
};
