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

const listStagedSources = (cwd) => (gitText(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACM']) ?? '')
  .split('\n')
  .filter((file) => file && isSourceFilePath(file));

const countByRule = (violations) => {
  const counts = new Map();
  for (const v of violations) {
    const key = `${v.rule}\u0000${v.severity}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const compareFile = (cwd, file, config) => {
  const absPath = path.join(cwd, file);
  const staged = gitText(cwd, ['show', `:${file}`]) ?? '';
  const base = gitText(cwd, ['show', `HEAD:${file}`]) ?? '';
  const before = countByRule(auditCode(base, absPath, file, { config }));
  const after = countByRule(auditCode(staged, absPath, file, { config }));
  const increases = [...after.entries()]
    .filter(([key, count]) => count > (before.get(key) ?? 0))
    .map(([key, count]) => {
      const [rule, severity] = key.split('\u0000');
      return { rule, severity, before: before.get(key) ?? 0, after: count };
    });
  return { file, increases };
};

export const evaluateStagedDelta = (cwd = process.cwd(), rawArgs = []) => {
  const config = loadProjectConfig(cwd, rawArgs);
  const files = listStagedSources(cwd).map((file) => compareFile(cwd, file, config)).filter((f) => f.increases.length > 0);
  const isBlocking = (increase) => GATED_SEVERITIES.has(increase.severity);
  const isPassing = files.every((f) => !f.increases.some(isBlocking));
  return { isPassing, files };
};
