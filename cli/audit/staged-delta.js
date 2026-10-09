/**
 * Pre-commit gate on the staged delta (#1716): each staged source file's index
 * content is audited against its HEAD version, and the commit fails only when a
 * (rule, severity) count rises at MEDIUM or above. LOW increases are warnings. A
 * legacy file's absolute grade no longer blocks a hazard-neutral commit.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditCode } from './rules.js';
import { loadProjectConfig } from '../config/index.js';
import { isSourceFilePath } from '../audit-preflight-git.js';

const GATED_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM']);

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

const countByRule = (violations) => {
  const counts = new Map();
  for (const v of violations) {
    const key = `${v.rule}\u0000${v.severity}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const compareFile = (cwd, { file, basePath, isRename }, config) => {
  const absPath = path.join(cwd, file);
  const staged = gitText(cwd, ['show', `:${file}`]) ?? '';
  const base = basePath ? gitText(cwd, ['show', `HEAD:${basePath}`]) ?? '' : '';
  const before = countByRule(auditCode(base, absPath, file, { config }));
  const after = countByRule(auditCode(staged, absPath, file, { config }));
  const increases = [...after.entries()]
    .filter(([key, count]) => count > (before.get(key) ?? 0))
    .map(([key, count]) => {
      const [rule, severity] = key.split('\u0000');
      return { rule, severity, before: before.get(key) ?? 0, after: count };
    });
  return isRename ? { file, renamedFrom: basePath, increases } : { file, increases };
};

export const evaluateStagedDelta = (cwd = process.cwd(), rawArgs = []) => {
  const config = loadProjectConfig(cwd, rawArgs);
  const files = listStagedSources(cwd).map((entry) => compareFile(cwd, entry, config)).filter((f) => f.increases.length > 0);
  const isBlocking = (increase) => GATED_SEVERITIES.has(increase.severity);
  const isPassing = files.every((f) => !f.increases.some(isBlocking));
  return { isPassing, files };
};
