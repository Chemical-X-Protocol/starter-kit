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
  if (args.command) {
    rawArgs.push('--', args.command);
  }
  return runBuildAudit(rawArgs, false, { print: false, cwd: targetDirOf(args, cwd), timeoutMs: DEFAULT_STEP_TIMEOUT_MS });
};

export const handleChemxTypecheck = async (args = {}, cwd = process.cwd()) => {
  return runTypecheckAudit(timeoutArgs(args), false, {
    json: true,
    command: args.command,
    allPackages: Boolean(args.allPackages),
    print: false,
    cwd: targetDirOf(args, cwd),
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS
  });
};

export const handleChemxTest = async (args = {}, cwd = process.cwd()) => {
  return runTestAudit(timeoutArgs(args), false, {
    json: true,
    command: args.command,
    target: args.testTarget ?? args.target,
    filter: args.filter,
    allowEmpty: Boolean(args.allowEmpty),
    ...changeArgs(args),
    print: false,
    cwd: targetDirOf(args, cwd),
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS
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
