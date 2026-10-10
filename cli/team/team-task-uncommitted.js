/**
 * Chemical X Protocol: `task done` refuses while the task's target has uncommitted changes.
 * Guarantees only: when the target sits in a git work tree and `git status` lists it as
 * modified or untracked, the completion is refused and the path is named. The task's
 * set-files list (extra_files) is checked the same way; files in neither list are not. Outside a git
 * repo, or if git cannot run, nothing is checked. --force skips the check.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';

const gitStatusLines = (cwd, paths) => {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

const parseExtra = (raw) => {
  if (Array.isArray(raw)) return raw.filter((file) => typeof file === 'string' && file !== '');
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.filter((file) => typeof file === 'string' && file !== '') : [];
  } catch {
    return [];
  }
};

export const uncommittedTargets = (cwd, task) => {
  const hasTarget = Boolean(task?.target_path);
  if (!hasTarget) return [];
  const extra = parseExtra(task.extra_files);
  const all = [task.target_path, ...extra.filter((file) => file !== task.target_path)];
  const dirty = all.flatMap((file) => {
    const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
    return gitStatusLines(path.dirname(abs), [path.basename(abs)]).map((line) => line.slice(3));
  });
  return [...new Set(dirty)];
};

export const buildUncommittedRefusal = (taskId, files) => ({
  refused: true,
  uncommitted: true,
  taskId: Number(taskId),
  files,
  message: `Refusing to complete task #${taskId}: uncommitted changes in ${files.join(', ')}. Commit them first (chemx commit <files> -m "..." --release), or pass --force to complete anyway. The target and the files listed by task set-files are checked; files outside the task's lists are not.`
});
