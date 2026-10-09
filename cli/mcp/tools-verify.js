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
    print: false,
    cwd: targetDirOf(args, cwd),
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS
  });
};

export const handleChemxTest = async (args = {}, cwd = process.cwd()) => {
  return runTestAudit(timeoutArgs(args), false, {
    json: true,
    command: args.command,
    target: args.target,
    filter: args.filter,
    allowEmpty: Boolean(args.allowEmpty),
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
    print: false,
    cwd: baseCwd
  });
};
