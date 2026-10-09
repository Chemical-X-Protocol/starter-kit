import fs from 'node:fs';
import { syncSingleFileIndex } from './search.js';
import { resolveSafePath } from './path-scope.js';
import { replaceLiteral } from './literal-replace.js';
import { applyEdits } from './apply-edits.js';
import { applySearchReplaceBlocks } from './search-replace-blocks.js';
import { evaluateGuardrails } from './edit-guardrails.js';
import { assertWriteLockClear } from './team/write-lock-guard.js';

export { runPatcherCli, runWriterCli } from './patcher-cli.js';

const syncIndex = (absPath, cwd) => {
  try {
    return Boolean(syncSingleFileIndex(absPath, cwd));
  } catch {
    return false;
  }
};

/**
 * Surgically applies a literal search-and-replace block to a file, through applyEdits
 * (parse check, declaration-loss check, team locks, atomic write with backup).
 *
 * @param {string} targetPath File path to patch.
 * @param {object} params Patch parameters.
 * @param {string} params.targetContent Exact text to replace (never empty).
 * @param {{search: string, replace: string}[]} [params.blocks] SEARCH/REPLACE blocks applied in order, all-or-nothing (instead of target/replacement).
 * @param {string} params.replacementContent Replacement text, inserted literally.
 * @param {boolean} [params.allowMultiple=false] Replace every occurrence.
 * @param {string} [params.cwd=process.cwd()] Workspace root.
 * @param {boolean} [params.dryRun=false] Validate and diff without writing.
 * @param {string[]} [params.allowRemoved] Top-level declarations this patch may remove.
 * @param {string} [params.agentId] Caller identity for team lock checks.
 * @param {boolean} [params.skipIndex=false] Skip SQLite micro-indexing.
 * @param {boolean} [params.skipCheck=false] Skip the architecture audit.
 * @returns {object} Patch result with unified diff and guardrails.
 */
export const patchFile = (targetPath, params = {}) => {
  const {
    targetContent, replacementContent, allowMultiple = false, cwd = process.cwd(),
    skipIndex = false, skipCheck = false, dryRun = false, allowRemoved, agentId
  } = params;

  const hasBlocks = Array.isArray(params.blocks) && params.blocks.length > 0;
  const isMissingTarget = !hasBlocks && (targetContent === undefined || targetContent === null);
  if (isMissingTarget) throw new Error('targetContent (or blocks) is required for patching');
  const isMissingReplacement = !hasBlocks && (replacementContent === undefined || replacementContent === null);
  if (isMissingReplacement) throw new Error('replacementContent is required for patching');

  const resolvedPath = resolveSafePath(targetPath, cwd);
  const isMissingFile = !fs.existsSync(resolvedPath);
  if (isMissingFile) throw new Error(`File not found: ${targetPath}`);
  // A foreign lease refuses with CHEMX_FILE_LOCKED (exit 1) before applyEdits plans anything.
  if (!dryRun) assertWriteLockClear(resolvedPath, cwd, agentId);

  const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  const beforeGuardrails = skipCheck ? { violations: [] } : evaluateGuardrails({ absPath: resolvedPath, relPath: targetPath, content: fileContent, skipCheck, cwd });
  const beforeKeys = new Set(beforeGuardrails.violations.map((v) => `${v.rule}:${v.hazard}`));

  const replaceOptions = { allowMultiple, filePath: targetPath };
  const replaced = hasBlocks
    ? applySearchReplaceBlocks(fileContent, params.blocks, replaceOptions)
    : replaceLiteral(fileContent, targetContent, replacementContent, replaceOptions);
  const applied = applyEdits([{ path: resolvedPath, content: replaced.content, allowRemoved }], { cwd, dryRun, agentId });
  const fileResult = applied.files[0];
  const shouldIndex = !skipIndex && !dryRun;
  const indexed = shouldIndex ? syncIndex(resolvedPath, cwd) : false;

  const guardrails = evaluateGuardrails({ absPath: resolvedPath, relPath: fileResult.file, content: replaced.content, skipCheck, cwd });
  const introducedViolations = guardrails.violations.filter((v) => !beforeKeys.has(`${v.rule}:${v.hazard}`));
  const preExistingViolations = guardrails.violations.filter((v) => beforeKeys.has(`${v.rule}:${v.hazard}`));

  return {
    file: fileResult.file,
    status: 'ok',
    dryRun: Boolean(dryRun),
    replaced: replaced.count,
    ...(hasBlocks ? { blocks: replaced.blocks } : {}),
    matchLines: replaced.lines,
    changedLines: replaced.changedLines,
    eol: replaced.eol,
    originalLines: fileResult.originalLines,
    newLines: fileResult.newLines,
    lineDelta: fileResult.newLines - fileResult.originalLines,
    indexed,
    backup: fileResult.backup,
    parse: fileResult.parse,
    declarations: fileResult.declarations,
    diff: fileResult.diff,
    ...guardrails,
    introducedViolations,
    preExistingViolations
  };
};

/**
 * Creates (or, with overwrite:true, replaces) a file through applyEdits.
 *
 * @param {string} targetPath File path to write.
 * @param {object} params Write parameters.
 * @param {string} params.content Content to write (required; never defaulted).
 * @param {boolean} [params.overwrite=false] Allow replacing an existing file.
 * @param {boolean} [params.dryRun=false] Validate and diff without writing.
 * @param {string[]} [params.allowRemoved] Top-level declarations an overwrite may remove.
 * @param {string} [params.agentId] Caller identity for team lock checks.
 * @param {string} [params.cwd=process.cwd()] Workspace root.
 * @param {boolean} [params.skipIndex=false] Skip SQLite micro-indexing.
 * @param {boolean} [params.skipCheck=false] Skip the architecture audit.
 * @returns {object} Write result summary.
 */
export const writeFile = (targetPath, params = {}) => {
  const {
    content, cwd = process.cwd(), skipIndex = false, skipCheck = false,
    dryRun = false, overwrite = false, allowRemoved, agentId
  } = params;

  const isMissingContent = typeof content !== 'string';
  if (isMissingContent) throw new Error('content is required for writeFile');

  const resolvedPath = resolveSafePath(targetPath, cwd);
  if (!dryRun) assertWriteLockClear(resolvedPath, cwd, agentId);
  const isExisting = fs.existsSync(resolvedPath);
  const isBlockedOverwrite = isExisting && !overwrite;
  if (isBlockedOverwrite) {
    throw new Error(`Refusing to overwrite existing file ${targetPath}. Pass overwrite:true (CLI: --overwrite), or use patch for a partial change.`);
  }

  const beforeContent = isExisting ? fs.readFileSync(resolvedPath, 'utf-8') : null;
  const beforeGuardrails = beforeContent && !skipCheck ? evaluateGuardrails({ absPath: resolvedPath, relPath: targetPath, content: beforeContent, skipCheck, cwd }) : { violations: [] };
  const beforeKeys = new Set(beforeGuardrails.violations.map((v) => `${v.rule}:${v.hazard}`));

  const applied = applyEdits([{ path: resolvedPath, content, allowRemoved }], { cwd, dryRun, agentId });
  const fileResult = applied.files[0];
  const shouldIndex = !skipIndex && !dryRun;
  const indexed = shouldIndex ? syncIndex(resolvedPath, cwd) : false;

  const guardrails = evaluateGuardrails({ absPath: resolvedPath, relPath: fileResult.file, content, skipCheck, cwd });
  const introducedViolations = guardrails.violations.filter((v) => !beforeKeys.has(`${v.rule}:${v.hazard}`));
  const preExistingViolations = guardrails.violations.filter((v) => beforeKeys.has(`${v.rule}:${v.hazard}`));

  return {
    file: fileResult.file,
    status: 'ok',
    dryRun: Boolean(dryRun),
    created: !isExisting,
    lines: fileResult.newLines,
    indexed,
    backup: fileResult.backup,
    parse: fileResult.parse,
    declarations: fileResult.declarations,
    diff: fileResult.diff,
    ...guardrails,
    introducedViolations,
    preExistingViolations
  };
};
