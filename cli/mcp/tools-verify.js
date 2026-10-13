import path from 'node:path';
import { runBuildAudit } from '../build.js';
import { runTypecheckAudit, runTestAudit, runProjectVerify } from '../verify.js';
import { DEFAULT_STEP_TIMEOUT_MS } from '../verify-steps.js';
import { resolveTargetCwd } from './tools-search.js';

// A timeout from the caller goes through the CLI flag, so MCP gets the same validation and usage
// errors. Without one, MCP runs use the verify step default: an agent call never hangs forever.
const timeoutArgs = (args) => {
  const hasTimeout = args.timeout !== undefined && args.timeout !== null;
  return hasTimeout ? [`--timeout=${args.timeout}`] : [];
};

const MCP_QUEUE_RETURN_MS = 1500;

// A value as one shell word: as it is when plain, else single-quoted.
const shellWord = (value) => {
  const text = String(value);
  const isPlain = /^[\w@%+=:,./-]+$/.test(text);
  return isPlain ? text : `'${text.replaceAll("'", "'\\''")}'`;
};

// What to run later when the call answered {queued:true}: the CLI form of the call, from the dir
// the call ran in (`args.dir` resolved), since the agent's shell may sit elsewhere.
const retryCommandOf = (base, args, dir, extra = []) => {
  const command = [base, ...timeoutArgs(args), ...extra, ...(args.command ? ['--', args.command] : [])].join(' ');
  const hasDir = Boolean(args.dir);
  return hasDir ? `cd ${shellWord(dir)} && ${command}` : command;
};

// The scope of a chemx_test call as CLI words: its target, filter and change selection.
const testScopeArgs = (args) => {
  const target = args.testTarget ?? args.target;
  const related = Array.isArray(args.related) ? args.related.map(shellWord) : [];
  const words = [
    [Boolean(target), () => [shellWord(target)]],
    [Boolean(args.filter), () => [`--filter=${shellWord(args.filter)}`]],
    [Boolean(args.changed), () => ['--changed']],
    [Boolean(args.base), () => [`--base=${shellWord(args.base)}`]],
    [related.length > 0, () => ['--related', ...related]],
    [Boolean(args.allowEmpty), () => ['--allow-empty']],
    [Boolean(args.allPackages), () => ['--all-packages']]
  ];
  return words.filter(([isGiven]) => isGiven).flatMap(([, wordsOf]) => wordsOf());
};

// changed/base/related select affected specs (test-scope.js); related paths are as given.
const changeArgs = (args) => ({
  changed: Boolean(args.changed),
  base: args.base || null,
  related: Array.isArray(args.related) && args.related.length > 0 ? args.related.map(String) : undefined,
  allPackages: Boolean(args.allPackages)
});

const targetDirOf = (args, cwd) => {
  const baseCwd = resolveTargetCwd(cwd);
  return args.dir ? path.resolve(baseCwd, args.dir) : baseCwd;
};

export const handleAuditBuild = async (args = {}, cwd = process.cwd()) => {
  const rawArgs = ['--json', ...timeoutArgs(args)];
  const hasCommand = Boolean(args.command);
  if (hasCommand) {
    rawArgs.push('--', args.command);
  }
  // A host call timeout would kill a call that queues silently behind a heavy job: report {queued:true} instead.
  const dir = targetDirOf(args, cwd);
  return runBuildAudit(rawArgs, false, {
    print: false, cwd: dir, timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    returnQueuedAfterMs: MCP_QUEUE_RETURN_MS, retryCommand: retryCommandOf('chemx build', args, dir)
  });
};

export const handleChemxTypecheck = async (args = {}, cwd = process.cwd()) => {
  const dir = targetDirOf(args, cwd);
  return runTypecheckAudit(timeoutArgs(args), false, {
    json: true,
    command: args.command,
    allPackages: Boolean(args.allPackages),
    print: false,
    cwd: dir,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    // A host call timeout would kill a call that queues silently behind a heavy job: report {queued:true} instead.
    returnQueuedAfterMs: MCP_QUEUE_RETURN_MS,
    retryCommand: retryCommandOf('chemx typecheck', args, dir, args.allPackages ? ['--all-packages'] : [])
  });
};

export const handleChemxTest = async (args = {}, cwd = process.cwd()) => {
  const dir = targetDirOf(args, cwd);
  return runTestAudit(timeoutArgs(args), false, {
    json: true,
    command: args.command,
    target: args.testTarget ?? args.target,
    filter: args.filter,
    allowEmpty: Boolean(args.allowEmpty),
    ...changeArgs(args),
    print: false,
    cwd: dir,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    // A host call timeout would kill a call that queues silently: report {queued:true} instead.
    returnQueuedAfterMs: MCP_QUEUE_RETURN_MS,
    retryCommand: retryCommandOf('chemx test', args, dir, testScopeArgs(args))
  });
};

export const handleChemxVerify = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  return runProjectVerify(timeoutArgs(args), false, {
    json: true,
    targetDir: args.dir,
    includeBuild: Boolean(args.includeBuild),
    allowEmpty: Boolean(args.allowEmpty),
    changed: Boolean(args.changed),
    base: args.base || null,
    allPackages: Boolean(args.allPackages),
    print: false,
    cwd: baseCwd
  });
};
