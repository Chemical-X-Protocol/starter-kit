import path from 'node:path';
import { syncSingleFileIndex } from '../search.js';
import { patchFile } from '../patcher.js';
import { handleCheckCommand } from '../search-commands.js';

export const isSevereViolation = (v) => {
  const isCritical = v.severity === 'CRITICAL';
  const isHigh = v.severity === 'HIGH';
  return isCritical || isHigh;
};

export const formatPatchWarnings = (result) => {
  const warnings = [];
  const hasLineBudget = Boolean(result.lineBudget);
  const isBudgetExceeded = hasLineBudget && !result.lineBudget.passed;
  if (isBudgetExceeded) {
    warnings.push(`[Directive 1.A] ${result.lineBudget.warning}`);
  }

  const violations = result.violations || [];
  for (const v of violations) {
    if (isSevereViolation(v)) {
      warnings.push(`[${v.severity} - ${v.rule}] Line ${v.line}: ${v.hazard} -> ${v.directive || ''}`);
    }
  }

  return warnings.length > 0 ? warnings : undefined;
};

export const handleChemxPatch = (args = {}, cwd = process.cwd()) => {
  const hasPath = Boolean(args.path);
  const hasTargetContent = args.targetContent !== undefined;
  const hasReplacementContent = args.replacementContent !== undefined;
  const hasRequiredArgs = hasPath && hasTargetContent && hasReplacementContent;

  if (!hasRequiredArgs) {
    throw new Error('chemx_patch requires "path", "targetContent", and "replacementContent" arguments.');
  }

  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  const result = patchFile(targetPath, {
    targetContent: args.targetContent,
    replacementContent: args.replacementContent,
    allowMultiple: Boolean(args.allowMultiple),
    cwd
  });

  try {
    syncSingleFileIndex(targetPath, cwd);
  } catch (err) {
    if (process.env.CHEMX_DEBUG) {
      process.stderr.write(`[patch-sync] Auto-index skipped for ${targetPath}: ${err.message}\n`);
    }
  }

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};

export const handleChemxCheck = (args = {}, cwd = process.cwd()) => {
  if (args.path === 'RESTART_MCP') {
    setTimeout(() => process.exit(0), 50);
    return { restarting: true };
  }
  if (!args.path) {
    throw new Error('chemx_check requires "path" argument.');
  }
  const targetPath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  return handleCheckCommand(targetPath, { isJson: true, isCli: false });
};
