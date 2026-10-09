import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath } from '../path-scope.js';
import { applyEdits } from '../apply-edits.js';
import { autofixContent } from './autofix-content.js';
import { STATUS, inconclusive } from '../result-status.js';

export { autofixContent } from './autofix-content.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.chemx',
  '.claude'
]);

// Markdown is deliberately absent: fences and prose are content there, not AI residue.
export const FIXABLE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.vue', '.svelte', '.scss', '.css']);

const isFixable = (filePath) => FIXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const collectFiles = (targetPath) => {
  const isFile = fs.statSync(targetPath).isFile();
  if (isFile) return isFixable(targetPath) ? [targetPath] : [];

  let files = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const isIgnored = IGNORED_DIRS.has(entry.name);
    if (isIgnored) continue;
    const fullPath = path.join(targetPath, entry.name);
    const isDirectory = entry.isDirectory();
    const isFixableFile = !isDirectory && isFixable(entry.name);
    if (isDirectory) files = files.concat(collectFiles(fullPath));
    else if (isFixableFile) files.push(fullPath);
  }
  return files;
};

// No fixable file was looked at: that proves nothing, so it is inconclusive (exit 3), never a green check.
const NOTHING_CHECKED = inconclusive('NO_FILES_CHECKED');

const excludedReason = (filePath) => {
  const ext = path.extname(filePath).toLowerCase() || 'extensionless';
  return `${ext} files are not autofix targets (fixable: ${[...FIXABLE_EXTENSIONS].join(' ')}); nothing was checked`;
};

/**
 * Applies token-aware mechanical fixes to a file or directory, through applyEdits
 * (parse check, declaration-loss check, team locks, atomic writes, one rollback-able batch).
 *
 * @param {string} targetPath File or directory (default 'src').
 * @param {object} [options] { cwd, dryRun, rules, agentId }
 * @returns {object} status (pass, or inconclusive when no fixable file was checked), the uncapped
 *   fix list, suggestions, skipped files, and the diff on a dry run.
 */
export const runAutofix = (targetPath, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const target = targetPath || 'src';
  const dryRun = Boolean(options.dryRun);
  const resolvedTarget = resolveSafePath(target, cwd);
  const root = fs.realpathSync(cwd);
  const empty = { ...NOTHING_CHECKED, target, dryRun, filesScanned: 0, filesChanged: 0, totalFixes: 0, fixes: [], suggestions: [], skipped: [] };
  const isMissing = !fs.existsSync(resolvedTarget);
  if (isMissing) return { ...empty, skipped: [{ file: target, reason: 'target does not exist; nothing was checked' }] };
  const isExcludedFile = fs.statSync(resolvedTarget).isFile() && !isFixable(resolvedTarget);
  if (isExcludedFile) return { ...empty, skipped: [{ file: path.relative(root, resolvedTarget), reason: excludedReason(resolvedTarget) }] };

  const files = collectFiles(resolvedTarget);
  const fixes = [];
  const suggestions = [];
  const skipped = [];
  const edits = [];
  for (const filePath of files) {
    const file = path.relative(root, filePath);
    const original = fs.readFileSync(filePath, 'utf-8');
    const result = autofixContent(original, { ...options, filePath });
    const isSkipped = Boolean(result.skipped);
    if (isSkipped) skipped.push({ file, reason: result.skipped });
    result.suggestions.forEach((s) => suggestions.push({ file, ...s }));
    const isChanged = result.fixes.length > 0 && result.fixedContent !== original;
    if (!isChanged) continue;
    result.fixes.forEach((f) => fixes.push({ file, line: f.line, rule: f.rule, action: f.action }));
    edits.push({ path: filePath, content: result.fixedContent });
  }

  const applied = edits.length > 0 ? applyEdits(edits, { cwd, dryRun, agentId: options.agentId }) : null;
  const isNothingChecked = files.length === 0;
  return {
    ...(isNothingChecked ? NOTHING_CHECKED : { status: STATUS.PASS }),
    target,
    dryRun,
    filesScanned: files.length,
    filesChanged: edits.length,
    totalFixes: fixes.length,
    fixes,
    suggestions,
    skipped,
    ...(dryRun && applied ? { diff: applied.diff } : {})
  };
};
