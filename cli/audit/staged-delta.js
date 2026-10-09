/**
 * Pre-commit gate on the staged delta (#1716, #2546): each staged source file's index
 * content is audited against its HEAD version, and the commit fails when any rule's
 * violation count rises, at any severity (the same rule the audit ratchet applies,
 * via gate-delta.js). A legacy file's absolute grade does not block a hazard-neutral
 * commit.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditCode } from './rules.js';
import { loadProjectConfig } from '../config/index.js';
import { isSourceFilePath } from '../audit-preflight-git.js';
import { evaluateChanges } from './gate-delta.js';

const gitText = (cwd, args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
};

/**
 * Staged additions, copies, modifications and renames as { file, basePath }. A rename
 * (git mv plus edits) is compared with HEAD at its old path, so it can neither slip
 * past the gate nor count its inherited hazards as new. `-z` keeps odd paths intact.
 */
const listStagedSources = (cwd) => {
  const fields = (gitText(cwd, ['diff', '--cached', '--name-status', '-z', '-M', '--diff-filter=ACMR']) ?? '').split('\0');
  const entries = [];
  let i = 0;
  while (i < fields.length && fields[i]) {
    const status = fields[i];
    const isRenameOrCopy = status.startsWith('R') || status.startsWith('C');
    const isRename = status.startsWith('R');
    const file = isRenameOrCopy ? fields[i + 2] : fields[i + 1];
    // A copy is new content: its hazards count as new, so it has no base.
    const basePath = status.startsWith('C') ? null : fields[i + 1];
    entries.push({ file, basePath, isRename });
    i += isRenameOrCopy ? 3 : 2;
  }
  return entries.filter((entry) => isSourceFilePath(entry.file));
};

const toChange = (cwd, { file, basePath, isRename }, config) => {
  const absPath = path.join(cwd, file);
  const staged = gitText(cwd, ['show', `:${file}`]) ?? '';
  const base = basePath ? gitText(cwd, ['show', `HEAD:${basePath}`]) ?? '' : '';
  const before = auditCode(base, absPath, file, { config });
  const after = auditCode(staged, absPath, file, { config });
  return isRename ? { file, renamedFrom: basePath, before, after } : { file, before, after };
};

/**
 * Hazard increases in `currentViolations` over the committed HEAD version of `relPath` (empty base
 * when the file is new). Returns [] when there is no HEAD commit to compare with, so callers
 * outside a git checkout are not blocked by a base that does not exist.
 */
export const hazardsAddedSinceHead = (cwd, relPath, currentViolations, config = loadProjectConfig(cwd)) => {
  const hasHead = gitText(cwd, ['rev-parse', '--verify', 'HEAD']) !== null;
  if (!hasHead) return [];
  const base = gitText(cwd, ['show', `HEAD:${relPath}`]) ?? '';
  const before = auditCode(base, path.join(cwd, relPath), relPath, { config });
  return evaluateChanges([{ file: relPath, before, after: currentViolations }]).files;
};

export const evaluateStagedDelta = (cwd = process.cwd(), rawArgs = []) => {
  const config = loadProjectConfig(cwd, rawArgs);
  return evaluateChanges(listStagedSources(cwd).map((entry) => toChange(cwd, entry, config)));
};
