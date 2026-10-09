import { patchFile } from '../patcher.js';
import { parseSearchReplaceBlocks } from '../search-replace-blocks.js';
import { handleCheckCommand } from '../search-commands.js';
import { resolveSafePath } from '../path-scope.js';

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

  const parseNote = result.parse?.note;
  const hasParseNote = Boolean(parseNote);
  if (hasParseNote) warnings.push(`[Parse] ${parseNote}`);

  const violations = result.violations || [];
  for (const v of violations) {
    if (isSevereViolation(v)) {
      warnings.push(`[${v.severity} - ${v.rule}] Line ${v.line}: ${v.hazard} -> ${v.directive || ''}`);
    }
  }

  return warnings.length > 0 ? warnings : undefined;
};

/**
 * MCP `blocks`: an array of { search, replace } (target/replacement spellings too), or one
 * string in the same SEARCH/REPLACE heredoc format the CLI reads from stdin.
 */
const normalizeBlocks = (raw) => {
  if (typeof raw === 'string') return parseSearchReplaceBlocks(raw);
  if (!Array.isArray(raw)) return [];
  return raw.map((b, i) => {
    const search = b?.search ?? b?.target ?? b?.targetContent;
    const replace = b?.replace ?? b?.replacement ?? b?.replacementContent;
    const isComplete = typeof search === 'string' && typeof replace === 'string';
    if (!isComplete) throw new Error(`blocks[${i}] needs string "search" and "replace". Nothing was changed.`);
    return { search, replace };
  });
};

export const handleChemxPatch = (args = {}, cwd = process.cwd()) => {
  const targetContent = args.targetContent ?? args.target ?? args.search;
  const replacementContent = args.replacementContent ?? args.replacement ?? args.replace;
  const hasPath = Boolean(args.path);
  const hasTargetContent = targetContent !== undefined;
  const hasReplacementContent = replacementContent !== undefined;
  const blocks = normalizeBlocks(args.blocks);
  const hasBlocks = blocks.length > 0;
  const hasRequiredArgs = hasPath && (hasBlocks || (hasTargetContent && hasReplacementContent));

  if (!hasRequiredArgs) {
    throw new Error('chemx_patch requires "path" plus either "blocks" ([{ search, replace }], applied in order, all-or-nothing) or target content ("targetContent", "target", or "search") and replacement content ("replacementContent", "replacement", or "replace").');
  }

  const targetPath = resolveSafePath(args.path, cwd);
  const isDryRun = isDryRunRequested(args);
  const result = patchFile(targetPath, {
    blocks: hasBlocks ? blocks : undefined,
    targetContent,
    replacementContent,
    allowMultiple: Boolean(args.allowMultiple || args.multiple),
    dryRun: isDryRun,
    allowRemoved: args.allowRemoved ?? args.allowRemove,
    agentId: args.agentId ?? args.as,
    cwd
  });
  if (isDryRun) return { ...result, dryRun: true, warnings: formatPatchWarnings(result) };

  return {
    ...result,
    warnings: formatPatchWarnings(result)
  };
};

const DRY_RUN_KEYS = ['dryRun', 'dry-run', 'dry_run', 'n'];

/**
 * MCP callers spell the preview flag several ways; all of them mean "do not write". When the
 * spellings disagree, the preview wins: a truthy value under any of them blocks the write.
 *
 * @param {object} args Tool params.
 * @returns {boolean}
 */
export const isDryRunRequested = (args = {}) => DRY_RUN_KEYS.some((key) => Boolean(args?.[key]));

export const handleChemxCheck = (args = {}, cwd = process.cwd()) => {
  if (args.path === 'RESTART_MCP') {
    setTimeout(() => process.exit(0), 50);
    return { restarting: true };
  }
  if (!args.path) {
    throw new Error('chemx_check requires "path" argument.');
  }
  const targetPath = resolveSafePath(args.path, cwd);
  return handleCheckCommand(targetPath, { isJson: true, isCli: false });
};
