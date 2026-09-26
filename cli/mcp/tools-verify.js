import path from 'node:path';
import { runBuildAudit } from '../build.js';
import { runTypecheckAudit, runTestAudit, runProjectVerify } from '../verify.js';
import { resolveTargetCwd } from './tools-search.js';

export const handleAuditBuild = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const targetCwd = args.dir ? path.resolve(baseCwd, args.dir) : baseCwd;
  const rawArgs = ['--json'];
  if (args.command) {
    rawArgs.push('--', args.command);
  }
  return runBuildAudit(rawArgs, false, { print: false, cwd: targetCwd });
};

export const handleChemxTypecheck = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const targetCwd = args.dir ? path.resolve(baseCwd, args.dir) : baseCwd;
  return runTypecheckAudit([], false, {
    json: true,
    command: args.command,
    print: false,
    cwd: targetCwd
  });
};

export const handleChemxTest = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  const targetCwd = args.dir ? path.resolve(baseCwd, args.dir) : baseCwd;
  return runTestAudit([], false, {
    json: true,
    command: args.command,
    target: args.target,
    filter: args.filter,
    print: false,
    cwd: targetCwd
  });
};

export const handleChemxVerify = async (args = {}, cwd = process.cwd()) => {
  const baseCwd = resolveTargetCwd(cwd);
  return runProjectVerify([], false, {
    json: true,
    targetDir: args.dir,
    includeBuild: Boolean(args.includeBuild),
    print: false,
    cwd: baseCwd
  });
};
